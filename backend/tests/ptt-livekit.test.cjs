require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const media = require('../src/realtime/ptt-livekit.ts');
const { PttGateway } = require('../src/realtime/ptt.gateway.ts');

function decode(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

test('LiveKit issues cafe-scoped listen-only tokens and grants the microphone only during an approved talk', async () => {
  const original = media.liveKitRadio;
  const permissions = [];
  const broadcasts = [];
  const client = (id, channel, ready) => ({
    id, connected: true,
    data: { user: { id, role: 'WAITER', cafeId: 'cafe-a' }, pttChannel: channel, pttLiveKitChannel: channel, pttLiveKitReady: ready },
    handshake: { auth: { token: id } }, emit() {},
  });
  const speaker = client('speaker', 'waiters', false);
  const listener = client('listener', 'waiters', true);
  const legacy = client('old', 'waiters', false);
  const talkId = randomUUID();
  let audience = [speaker, listener, legacy];
  media.liveKitRadio = () => ({
    url: 'wss://radio.example.test/', key: 'test', secret: 'test-secret-for-local-token-tests-only',
    rooms: { async updateParticipant(room, id, options) { permissions.push({ room, id, permission: options.permission }); } },
  });
  try {
    const gateway = new PttGateway({ verifyAsync: async (id) => ({ sub: id }) }, {
      user: { findUnique: async () => ({ id: speaker.id, role: 'WAITER', cafeId: 'cafe-a', isActive: true }) },
      cafe: { findUnique: async () => ({ status: 'active' }) },
    });
    gateway.server = {
      in: () => ({ fetchSockets: async () => audience }),
      to: (rooms) => ({ emit: (event, payload) => broadcasts.push({ rooms, event, payload }) }),
    };
    const enrolled = await gateway.connectLiveKit(speaker, { channel: 'waiters' });
    assert.equal(enrolled.ok, true);
    assert.deepEqual(enrolled.channels.map(({ channel }) => channel), ['general', 'waiters']);
    for (const { channel, token } of enrolled.channels) {
      const claims = decode(token);
      assert.equal(claims.sub, speaker.id);
      assert.equal(claims.video.room, `edu-pos:ptt:cafe-a:${channel}`);
      assert.equal(claims.video.canPublish, false);
      assert.equal(claims.video.canPublishData, false);
    }
    assert.equal(gateway.readyLiveKit(speaker, { channel: 'waiters', ready: true }).ok, true);
    const request = { channel: 'waiters', talkId, codec: 'livekit' };
    assert.equal((await gateway.handleStartTalk(speaker, request)).reason, 'legacy_required');
    assert.equal(permissions.length, 0);
    audience = [speaker, listener];
    const ack = await gateway.handleStartTalk(speaker, request);
    assert.equal(ack.codec, 'livekit');
    assert.equal(broadcasts.at(-1).payload.codec, 'livekit');
    assert.equal(permissions[0].permission.canPublish, true);
    assert.equal(permissions[0].permission.canPublishData, false);
    assert.deepEqual(permissions[0].permission.canPublishSources, radioSources());
    assert.equal((await gateway.handleStartTalk(listener, { ...request, talkId: randomUUID() })).reason, 'busy');
    const trackSid = 'TR_radio123';
    assert.equal(gateway.subscribedLiveKit(legacy, { channel: 'waiters', publisher: 'speaker', trackSid }).ok, false);
    assert.equal(gateway.subscribedLiveKit(listener, { channel: 'waiters', publisher: 'wrong', trackSid }).ok, false);
    const ready = gateway.waitForLiveKitTrack(speaker, { ...request, trackSid });
    assert.equal(gateway.subscribedLiveKit(listener, { channel: 'waiters', publisher: 'speaker', trackSid }).ok, true);
    assert.deepEqual(await ready, { ok: true });
    assert.equal(gateway.keepLiveKitTalk(speaker, request).ok, true);
    await gateway.handleStopTalk(speaker, request);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(permissions[1].permission.canPublish, false);
    assert.equal(broadcasts.at(-1).event, 'ptt_channel_free');
    assert.equal(gateway.keepLiveKitTalk(speaker, request).ok, false);
  } finally {
    media.liveKitRadio = original;
  }
});

function radioSources() {
  const { TrackSource } = require('livekit-server-sdk');
  return [TrackSource.MICROPHONE];
}
