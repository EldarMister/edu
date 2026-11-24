require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PttGateway } = require('../src/realtime/ptt.gateway.ts');
const { PttStreamBuffer } = require('../src/realtime/ptt-stream.ts');

function radioFixture() {
  const clients = [];
  function client(id, userId, cafeId = 'one') {
    const socket = {
      id, connected: true, rooms: new Set([id]), messages: [],
      data: { user: { id: userId, cafeId, role: 'WAITER' } },
      join(rooms) { rooms.forEach(room => this.rooms.add(room)); },
      leave(room) { this.rooms.delete(room); },
      emit(event, payload) { this.messages.push({ event, payload }); },
      to(rooms) { return broadcast(rooms).except(id); },
    };
    clients.push(socket);
    return socket;
  }
  function broadcast(rooms, exclusions = []) {
    return {
      except(excluded) { return broadcast(rooms, [...exclusions, ...[excluded].flat()]); },
      emit(event, payload) {
        for (const socket of clients) {
          if (socket.connected && [rooms].flat().some(room => socket.rooms.has(room))
            && !exclusions.some(room => socket.rooms.has(room))) socket.emit(event, payload);
        }
      },
    };
  }
  const gateway = new PttGateway({}, {});
  gateway.server = {
    in: rooms => ({ fetchSockets: async () => clients.filter(socket => socket.connected && [rooms].flat().some(room => socket.rooms.has(room))) }),
    to: broadcast,
  };
  return { client, gateway };
}

test('radio sends the same Opus speech to current and older listeners without playing it to the sender account', async () => {
  const { client, gateway } = radioFixture();
  const speaker = client('phone', 'speaker');
  const sameAccount = client('tablet', 'speaker');
  const listener = client('listener-session', 'listener');
  const legacy = client('old-session', 'legacy');
  const otherCafe = client('other', 'outside', 'two');
  const otherChannel = client('admin', 'outside-channel');
  await gateway.handleJoin(speaker, { channel: 'waiters', sequenced: true, codecs: ['opus-hq'] });
  await gateway.handleJoin(sameAccount, { channel: 'waiters', sequenced: true, codecs: ['opus-hq'] });
  await gateway.handleJoin(listener, { channel: 'waiters', sequenced: true, codecs: ['opus-hq'] });
  await gateway.handleJoin(legacy, { channel: 'waiters', codecs: ['opus-hq'] });
  await gateway.handleJoin(otherCafe, { channel: 'waiters', sequenced: true, codecs: ['opus-hq'] });
  await gateway.handleJoin(otherChannel, { channel: 'admin', sequenced: true, codecs: ['opus-hq'] });
  const talk = { channel: 'waiters', talkId: randomUUID(), codec: 'opus', preferHq: true, sequenced: true };
  assert.deepEqual(await gateway.handleStartTalk(speaker, talk), {
    ok: true, channel: 'waiters', talkId: talk.talkId, codec: 'opus-hq', sequenced: true,
  });

  const audio1 = Buffer.alloc(4 * 80, 41);
  const audio2 = Buffer.alloc(2 * 80, 62);
  gateway.handleAudioBatch(speaker, { ...talk, firstFrame: 0, audio: audio1 });
  gateway.handleAudioBatch(speaker, { ...talk, firstFrame: 0, audio: audio1 }); // duplicate
  gateway.handleAudioBatch(speaker, { ...talk, firstFrame: 6, audio: audio2 }); // gap
  assert.equal((await gateway.handleStopTalk(speaker, { ...talk, frames: 6 })).ok, false);
  gateway.handleAudioBatch(speaker, { ...talk, firstFrame: 4, audio: audio2 });
  assert.equal((await gateway.handleStopTalk(speaker, { ...talk, frames: 6 })).ok, true);

  const speech = socket => socket.messages.filter(({ event }) => event === 'ptt_audio_batch' || event === 'ptt_audio_packet');
  assert.deepEqual(speech(listener).map(({ payload }) => payload.firstFrame), [0, 4]);
  assert.deepEqual(speech(listener).map(({ payload }) => payload.audio), [audio1, audio2]);
  assert.deepEqual(speech(legacy).map(({ payload }) => payload.length), [96, 96, 96, 96, 96, 96]);
  for (const socket of [speaker, sameAccount, otherCafe, otherChannel]) {
    assert.deepEqual(speech(socket), []);
    assert.equal(gateway.syncAudio(socket, { talkId: talk.talkId, fromFrame: 0 }).ok, false);
  }

  const replay = gateway.syncAudio(listener, { talkId: talk.talkId, fromFrame: 3 });
  assert.equal(replay.finished, true);
  assert.equal(replay.nextFrame, 6);
  assert.equal(replay.batch.firstFrame, 3);
  assert.deepEqual(replay.batch.audio, Buffer.concat([audio1.subarray(3 * 80), audio2]));
  const nearLive = gateway.syncAudio(listener, { talkId: talk.talkId, fromFrame: 0, maxFrames: 2 });
  assert.equal(nearLive.batch.firstFrame, 4);
  assert.deepEqual(nearLive.batch.audio, audio2);
  assert.equal(listener.messages.findLast(({ event }) => event === 'ptt_channel_free').payload.frames, 6);
});

test('native files and PWA Opus stream in both directions and the general channel counts its actual audience', async () => {
  const { client, gateway } = radioFixture();
  const web = client('desktop', 'a');
  const phone = client('phone', 'b');
  const outsider = client('outside', 'c', 'two');
  const joinWeb = { channel: 'general', codecs: ['opus-hq'], sequenced: true };
  await gateway.handleJoin(web, joinWeb);
  await gateway.handleJoin(outsider, { channel: 'admin' });
  const talk = { channel: 'general', talkId: randomUUID(), codec: 'opus', preferHq: true, sequenced: true, nativePcm: true };
  assert.equal((await gateway.handleStartTalk(web, talk)).nativePcm, undefined);
  await gateway.handleJoin(phone, { channel: 'admin' });
  assert.equal(web.messages.findLast(m => m.event === 'ptt_presence').payload.onlineCount, 2);
  assert.equal(web.messages.findLast(m => m.event === 'ptt_native_listener').payload.talkId, talk.talkId);
  assert.equal((await gateway.handleStartTalk(phone, { channel: 'admin' })).reason, 'busy');
  const opus = Buffer.alloc(80, 1);
  gateway.handleAudioBatch(web, { ...talk, firstFrame: 0, audio: opus });
  const pcm = Buffer.alloc(960, 7);
  gateway.handleNativePcm(web, { ...talk, firstSample: 0, audio: pcm });
  gateway.handleNativePcm(web, { ...talk, firstSample: 0, audio: pcm }); // repeated
  gateway.handleNativePcm(web, { ...talk, firstSample: 500000, audio: pcm }); // ahead of speech
  const clips = phone.messages.filter(m => m.event === 'ptt_audio_stream');
  assert.equal(clips.length, 1);
  const payload = clips[0].payload;
  assert.equal(payload.channel, 'admin'); // compatible with older native builds
  assert.equal(payload.mimeType, 'audio/wav');
  const file = Buffer.from(payload.chunk, 'base64');
  assert.equal(file.toString('ascii', 0, 4), 'RIFF');
  assert.equal(file.readUInt32LE(24), 24000);
  assert.deepEqual(file.subarray(44), pcm);
  assert.equal(outsider.messages.some(m => m.event === 'ptt_audio_stream'), false);
  assert.equal((await gateway.handleStopTalk(web, { ...talk, frames: 1 })).ok, true);
  await gateway.handleJoin(phone, { channel: 'general' });
  assert.equal((await gateway.handleStartTalk(phone, { channel: 'general' })).ok, true);
  const input = { channel: 'general', mimeType: 'audio/mp4', chunk: 'YWJjZA==' };
  assert.equal((await gateway.handleNativeChunk(phone, input)).ok, true);
  const segment = web.messages.find(m => m.event === 'ptt_audio_message').payload;
  assert.equal(segment.senderId, 'b');
  assert.equal(segment.segment, true);
  assert.equal(segment.chunk, input.chunk);
  assert.equal(phone.messages.some(m => m.event === 'ptt_audio_message'), false);
  await gateway.handleStopTalk(phone, { channel: 'general' });
  assert.equal(web.messages.findLast(m => m.event === 'ptt_channel_free').payload.talkId, segment.talkId);
});

test('radio replay keeps a bounded tail and exposes its true first frame', () => {
  const history = new PttStreamBuffer(80);
  for (let packet = 0; packet < 125; packet++) history.append(Buffer.alloc(4 * 80, packet));
  const replay = history.read(0);
  assert.equal(history.nextFrame, 500);
  assert.equal(replay.firstFrame, 100);
  assert.equal(replay.audio.length, 400 * 80);
  assert.equal(replay.audio[0], 25);
  assert.equal(history.read(500), undefined);
});
