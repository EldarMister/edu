const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath, globals = {}, requireMock = require) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: requireMock, console, ...globals });
  return exports;
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('waiter signal and speech preferences are independent and saved per account', () => {
  const storage = new Map();
  const window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  const loadSettings = () => load('src/services/kitchenVoiceSettings.ts', { window });
  const settings = loadSettings();
  settings.saveWaiterVoiceSettings('first', { notificationsEnabled: false });
  settings.saveWaiterVoiceSettings('second', { voiceEnabled: false });
  const restored = loadSettings();
  assert.equal(restored.waiterNotificationSoundEnabled('first'), false);
  assert.equal(restored.getWaiterVoiceSettings('first').voiceEnabled, true);
  assert.equal(restored.waiterNotificationSoundEnabled('second'), true);
  assert.equal(restored.getWaiterVoiceSettings('second').voiceEnabled, false);
  assert.equal(restored.getKitchenVoiceSettings().notificationsEnabled, true);
});

function audioHarness() {
  const elements = [];
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  let gesture = false;
  class Audio {
    paused = true;
    allowed = false;
    duration = 2;
    src = '';
    calls = [];
    constructor() { elements.push(this); }
    setAttribute() {}
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    pause() { this.paused = true; }
    play() {
      this.calls.push(this.src);
      if (gesture) this.allowed = true;
      if (!this.allowed) return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
      this.paused = false;
      this.onplaying?.();
      return Promise.resolve();
    }
  }
  const session = { type: 'auto' };
  const window = {
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    addEventListener(type, fn) { listeners.set(type, fn); },
  };
  const document = { visibilityState: 'visible', addEventListener(type, fn) { listeners.set(type, fn); } };
  const api = load('src/lib/audio.ts', {
    Audio, Blob, window, document, navigator: { audioSession: session },
    clearTimeout: (id) => timers.delete(id), btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  });
  const radioElement = elements.shift();
  return {
    ...api, elements, radioElement, timers, session, listeners,
    gesture(fn) { gesture = true; try { fn(); } finally { gesture = false; } },
  };
}

test('gesture unlock uses valid PCM and reuses the same player after an async TTS response', async () => {
  const h = audioHarness();
  const player = new h.AudioPlayer();
  h.gesture(() => h.unlockAudio());
  const wav = Buffer.from(h.elements[0].src.split(',')[1], 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.ok(wav.readUInt32LE(40) > 0);
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  await flush();
  const playing = player.play('blob:tts', 1.2);
  await flush();
  assert.equal(h.elements.length, 1);
  assert.equal(h.elements[0].paused, false);
  assert.equal(h.elements[0].playbackRate, 1.2);
  h.elements[0].onended();
  await playing;
  assert.equal(h.timers.size, 0);
});

test('blocked notification exposes recovery and retries the real sound on a gesture', async () => {
  const h = audioHarness();
  const player = new h.AudioPlayer();
  const playing = player.play('/sounds/notify.mp3');
  await flush();
  assert.equal(h.audioNeedsGesture(), true);
  h.gesture(() => h.unlockAudio());
  await flush();
  assert.equal(h.audioNeedsGesture(), false);
  assert.equal(h.elements[0].src, '/sounds/notify.mp3');
  assert.equal(h.elements[0].paused, false);
  h.elements[0].onended();
  await playing;
});

test('blocked or interrupted audio cannot leave the voice queue pending forever', async () => {
  const h = audioHarness();
  const player = new h.AudioPlayer();
  const playing = player.play('blob:blocked');
  const rejected = assert.rejects(playing, /Коснитесь/);
  await flush();
  [...h.timers.values()][0].fn();
  await rejected;
  assert.equal(h.elements[0].src, '');
  h.gesture(() => h.unlockAudio());
  await flush();
  const next = player.play('blob:next');
  h.elements[0].onended();
  await next;
});

test('foreground restores paused playback and gestures do not override recording mode', async () => {
  const h = audioHarness();
  h.installAudioUnlock();
  const player = new h.AudioPlayer();
  h.gesture(() => h.unlockAudio());
  await flush();
  h.setAudioRecording(true);
  h.gesture(() => h.unlockAudio());
  assert.equal(h.session.type, 'play-and-record');
  h.setAudioRecording(false);
  assert.equal(h.session.type, 'playback');
  const playing = player.play('blob:voice');
  h.elements[0].pause();
  h.listeners.get('visibilitychange')();
  assert.equal(h.elements[0].paused, false);
  player.stop();
  await playing;
});

test('replacing audio settles the old playback and ignores its delayed rejection', async () => {
  const h = audioHarness();
  const player = new h.AudioPlayer();
  let rejectOld;
  h.elements[0].play = () => new Promise((_, reject) => { rejectOld = reject; });
  const old = player.play('blob:old');
  h.elements[0].play = () => Promise.resolve();
  const next = player.play('blob:next');
  rejectOld(new Error('old decode failure'));
  await flush();
  await old;
  assert.equal(h.elements[0].src, 'blob:next');
  h.elements[0].onended();
  await next;
});

test('quiet radio speech is amplified without clipping, while silence stays silent', () => {
  const h = audioHarness();
  const buffer = (samples) => ({ numberOfChannels: 1, getChannelData: () => samples });
  assert.equal(h.speechGain(buffer([0, 0, 0])), 1);
  assert.equal(h.speechGain(buffer([0.00001, -0.00001])), 1);
  const quiet = h.speechGain(buffer([0.01, -0.02, 0.01]));
  assert.ok(quiet > 1 && quiet <= 8);
  const peaked = h.speechGain(buffer([0.9, 0.01, -0.02]));
  assert.ok(peaked * 0.9 <= 0.95);
});

test('normalized radio WAV preserves sample rate, stereo order, and amplitude headroom', async () => {
  const h = audioHarness();
  const channels = [new Float32Array([0.01, -0.02]), new Float32Array([-0.01, 0.02])];
  const blob = h.normalizedRadioWav({
    numberOfChannels: 2, sampleRate: 16000, length: 2, getChannelData: (i) => channels[i],
  });
  assert.equal(blob.type, 'audio/wav');
  const bytes = new DataView(await blob.arrayBuffer());
  assert.equal(bytes.getUint16(22, true), 2);
  assert.equal(bytes.getUint32(24, true), 16000);
  assert.equal(bytes.getUint32(40, true), 8);
  assert.ok(bytes.getInt16(44, true) > 0.01 * 32767);
  assert.ok(bytes.getInt16(46, true) < 0);
  assert.ok(bytes.getInt16(48, true) < 0);
  assert.ok(bytes.getInt16(50, true) > 0);
  for (let i = 44; i < 52; i += 2) assert.ok(Math.abs(bytes.getInt16(i, true)) < 32767);
});

function senderHarness({ captureFails = false, pendingPermission = false, pendingAck = false, codec = 'opus' } = {}) {
  const events = [];
  const modes = [];
  const cues = [];
  let stopped = 0;
  let disconnected = 0;
  let connectedCapture = 0;
  let permissionResolve;
  let ack;
  let onFrame;
  let tail;
  let constraints;
  const stream = { getTracks: () => [{ stop: () => stopped++ }], getAudioTracks: () => [] };
  const socket = {
    connected: true,
    emit(event, payload) { events.push({ event, payload }); },
    timeout() { return { emit(event, payload, callback) {
      events.push({ event, payload });
      ack = (error) => callback(error, { ok: true, talkId: payload.talkId, codec });
      if (!pendingAck) ack(null);
    } }; },
  };
  const eventsApi = { START_TALK: 'start', STOP_TALK: 'stop', AUDIO_PACKET: 'frame' };
  const api = load('src/features/ptt/useAudioPttSender.ts', {
    DOMException, AudioWorkletNode: class {},
    crypto: { randomUUID: () => '75d0a019-a195-450b-89e4-766c7de92ea5' },
    navigator: { mediaDevices: { getUserMedia(value) {
      constraints = value;
      return pendingPermission ? new Promise((resolve) => { permissionResolve = resolve; }) : Promise.resolve(stream);
    } } },
  }, (id) => {
    if (id === 'react') return {
      useCallback: (fn) => fn, useRef: (current) => ({ current }), useState: (value) => [value, () => {}], useEffect() {},
    };
    if (id === '@/lib/socket') return { getSocket: () => socket };
    if (id === '@/lib/audio') return { unlockAudio() {}, setAudioRecording: (value) => modes.push(value) };
    if (id === './liveAudio') return {
      playPttReadyCue() { cues.push('start'); },
      async createPttCapture(_stream, sendFrame) {
        if (captureFails) throw new Error('capture failed');
        onFrame = sendFrame;
        return {
          connect() { connectedCapture++; },
          close() { disconnected++; },
          async flush() { if (tail) sendFrame(tail); return true; },
        };
      },
    };
    if (id === './opusAudio') return {
      isPttOpusCodec: (value) => value === 'opus' || value === 'opus-hq',
      async createPttOpusEncoder(talkId, transmit, codec) {
        return { push: (audio) => transmit({ audio, talkId, codec }), flush() {}, close() {} };
      },
    };
    if (id === './types') return { PTT_EVENTS: eventsApi };
    throw new Error(id);
  });
  return {
    sender: api.useAudioPttSender('general', true), events, modes, cues,
    get stopped() { return stopped; }, get constraints() { return constraints; },
    get disconnected() { return disconnected; }, get connectedCapture() { return connectedCapture; },
    grant: () => permissionResolve(stream), acknowledge: (error) => ack(error),
    frame: (audio) => onFrame(audio), tail: (audio) => { tail = audio; },
  };
}

test('capture setup failure releases the microphone without taking the channel', async () => {
  const h = senderHarness({ captureFails: true });
  assert.equal(await h.sender.start(), false);
  assert.equal(h.stopped, 1);
  assert.equal(h.modes.at(-1), false);
  assert.deepEqual(h.events, []);
});

test('releasing while microphone permission is pending does not start live audio', async () => {
  const h = senderHarness({ pendingPermission: true });
  const starting = h.sender.start();
  h.sender.stop();
  h.grant();
  assert.equal(await starting, false);
  assert.equal(h.stopped, 1);
  assert.equal(h.modes.at(-1), false);
  assert.deepEqual(h.events, []);
});

test('server timeout releases the microphone and stops the requested transmission', async () => {
  const h = senderHarness({ pendingAck: true });
  const starting = h.sender.start();
  await flush();
  assert.equal(await h.sender.start(), false);
  h.acknowledge(new Error('timeout'));
  assert.equal(await starting, false);
  assert.equal(h.stopped, 1);
  assert.equal(h.disconnected, 1);
  assert.equal(h.modes.at(-1), false);
  assert.deepEqual(h.events.map(({ event }) => event), ['start', 'stop']);
});

test('radio sends binary frames during the press and releases the microphone on stop', async () => {
  const h = senderHarness({ codec: 'opus-hq' });
  assert.equal(await h.sender.start(), true);
  assert.equal(h.constraints.audio.autoGainControl, true);
  assert.equal(h.constraints.audio.noiseSuppression, true);
  assert.equal(h.connectedCapture, 1);
  const audio = new ArrayBuffer(960);
  h.frame(audio);
  assert.deepEqual(h.events.map(({ event }) => event), ['start', 'frame']);
  assert.equal(h.events[0].payload.codec, 'opus');
  assert.equal(h.events[0].payload.preferHq, true);
  assert.equal(h.events[1].payload.codec, 'opus-hq');
  assert.equal(h.events[1].payload.audio, audio);
  const tail = new ArrayBuffer(960);
  h.tail(tail);
  h.sender.stop();
  assert.equal(h.stopped, 1);
  await flush();
  h.frame(audio);
  assert.equal(h.disconnected, 1);
  assert.equal(h.modes.at(-1), false);
  assert.deepEqual(h.events.map(({ event }) => event), ['start', 'frame', 'frame', 'stop']);
  assert.equal(h.events[2].payload.audio, tail);
  assert.equal(h.events[0].payload.talkId, h.events[3].payload.talkId);
  assert.deepEqual(h.cues, ['start']);
});

test('capture keeps the first words during the grant and completes short presses in order', async () => {
  const h = senderHarness({ pendingAck: true });
  const starting = h.sender.start();
  await flush();
  assert.equal(h.connectedCapture, 1);
  const opening = new ArrayBuffer(960);
  const tail = new ArrayBuffer(960);
  h.frame(opening);
  h.tail(tail);
  h.sender.stop();
  assert.equal(h.stopped, 1);
  await flush();
  assert.deepEqual(h.events.map(({ event }) => event), ['start']);
  h.acknowledge(null);
  assert.equal(await starting, false);
  assert.deepEqual(h.events.map(({ event }) => event), ['start', 'frame', 'frame', 'stop']);
  assert.equal(h.events[1].payload.audio, opening);
  assert.equal(h.events[1].payload.codec, 'opus');
  assert.equal(h.events[2].payload.audio, tail);
  assert.equal(h.disconnected, 1);
  assert.ok(h.events.every(({ payload }) => payload.talkId === h.events[0].payload.talkId));
});

test('capture worklet resamples 48 kHz and emits 20 ms PCM frames before the stream ends', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/ptt-capture.worklet.js'), 'utf8');
  const frames = [];
  let Worklet;
  vm.runInNewContext(source, {
    sampleRate: 48000, AudioWorkletProcessor: class { port = { postMessage: (bytes) => frames.push(bytes) }; },
    registerProcessor: (_, processor) => { Worklet = processor; },
  });
  const capture = new Worklet({ processorOptions: { sampleRate: 24000 } });
  capture.process([[new Float32Array(960).fill(0.25)]]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].byteLength, 960);
  const frame = new DataView(frames[0]);
  assert.equal(frame.getInt16(0, true), 8192);
  assert.equal(frame.getInt16(958, true), 8192);
  capture.process([[new Float32Array(128).fill(-0.25)]]);
  capture.port.onmessage({ data: 'flush' });
  assert.equal(frames.length, 3);
  assert.equal(frames[2], 'drained');
  const tail = new DataView(frames[1]);
  assert.equal(tail.getInt16(0, true), -8192);
  assert.equal(tail.getInt16(958, true), 0);
  capture.process([[new Float32Array(1920)]]);
  assert.equal(frames.length, 3);
});

test('playback keeps all queued frames at normal speed after a burst and through a brief stall', () => {
  const played = [];
  const stopped = [];
  const ctx = {
    currentTime: 10, state: 'running', destination: {},
    createBuffer(_channels, length, sampleRate) {
      const samples = new Float32Array(length);
      return { duration: length / sampleRate, getChannelData: () => samples };
    },
    createBufferSource() {
      return {
        playbackRate: { value: 1 },
        connect() {}, disconnect() {},
        start(at) { played.push([at, this.buffer.duration / this.playbackRate.value]); },
        stop() { stopped.push(this); },
      };
    },
    createOscillator() { return { frequency: {}, connect(node) { return node; }, disconnect() {}, start() {}, stop() {} }; },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; },
  };
  const { PttPlayback } = load('src/features/ptt/liveAudio.ts', { ArrayBuffer, Float32Array }, (id) => {
    if (id === '@/lib/audio') return { getAudioContext: () => ctx };
    if (id === './opusAudio') return load('src/features/ptt/opusAudio.ts');
    throw new Error(id);
  });
  const playback = new PttPlayback();
  for (let index = 0; index < 24; index++) playback.push(new Float32Array(480), index === 0, 24000);
  ctx.currentTime = 10.605;
  playback.push(new Float32Array(480), false, 24000);
  assert.ok(played.at(-1)[0] - ctx.currentTime < 0.02);
  ctx.currentTime = 10.7;
  playback.push(new Float32Array(480), false, 24000);
  const resumedAt = played.at(-1)[0];
  assert.ok(resumedAt > ctx.currentTime + 0.12 && resumedAt <= ctx.currentTime + 0.3);
  ctx.currentTime += 0.02;
  playback.push(new Float32Array(480), false, 24000);
  assert.ok(Math.abs(played.at(-1)[0] - (resumedAt + 0.02)) < 1e-6);
  playback.endCue();
  playback.push(new ArrayBuffer(1280), true);
  assert.equal(played.length, 28);
  assert.deepEqual(stopped, []);
  assert.ok(played[0][0] - 10 < 0.2);
  assert.ok(played.slice(0, 27).every(([, duration]) => duration === 0.02));
  for (let index = 1; index < played.length; index++) {
    assert.ok(played[index][0] >= played[index - 1][0] + played[index - 1][1] - 1e-6);
  }
});

test('Opus sends both negotiated formats and drains the last samples', async () => {
  const libopus = await import('libopus-wasm');
  const radio = load('src/features/ptt/opusAudio.ts', { ArrayBuffer, Uint8Array }, (id) => {
    if (id === 'libopus-wasm') return libopus;
    throw new Error(id);
  });
  const talkId = '75d0a019-a195-450b-89e4-766c7de92ea5';
  for (const codec of ['opus', 'opus-hq']) {
    const packets = [];
    const highQuality = codec === 'opus-hq';
    const encoder = await radio.createPttOpusEncoder(talkId, (packet) => packets.push(packet), codec);
    const decoder = await radio.createPttOpusDecoder(codec);
    try {
      const tone = new Int16Array(480).map((_, index) => Math.round(Math.sin(index * Math.PI * 880 / 24000) * 12000));
      encoder.push(tone.buffer);
      assert.deepEqual(packets.map((packet) => packet.byteLength), highQuality ? [96] : []);
      encoder.push(tone.buffer);
      assert.deepEqual(packets.map((packet) => packet.byteLength), highQuality ? [96, 96] : [76]);
      const id = radio.pttOpusHeader(talkId);
      if (!highQuality) {
        const batch = new Uint8Array(136);
        batch.set(id);
        batch.set(new Uint8Array(packets[0]).subarray(16), 16);
        batch.set(new Uint8Array(packets[0]).subarray(16), 76);
        assert.equal(radio.pttOpusFrames(batch.buffer, id, codec).length, 2);
      }
      encoder.flush();
      assert.deepEqual(packets.map((packet) => packet.byteLength), highQuality ? [96, 96, 96] : [76, 76]);
      const frames = packets.flatMap((packet) => radio.pttOpusFrames(packet, id, codec));
      const decoded = frames.map((frame) => decoder.decodeFloat(frame));
      assert.equal(decoded[0].length, highQuality ? 480 : 640);
      assert.ok(decoded[0].some((sample) => Math.abs(sample) > 0.05));
      assert.ok(decoded.at(-1).subarray(0, 104).some((sample) => Math.abs(sample) > 0.02));
      assert.equal(radio.pttOpusFrames(packets[0], new Uint8Array(16), codec).length, 0);
      assert.equal(radio.pttOpusFrames(packets[0], id, highQuality ? 'opus' : 'opus-hq').length, 0);
    } finally {
      encoder.close();
      decoder.free();
    }
  }
});

function cueHarness(mode) {
  const calls = [];
  const timers = new Map();
  let next = 0;
  class AudioPlayer {
    play(url) {
      calls.push(url);
      if (mode === 'fail') return Promise.reject(new Error('missing cue'));
      if (mode === 'stalled') return new Promise(() => {});
      return Promise.resolve();
    }
    stop() { calls.push('stop'); }
  }
  const api = load('src/features/ptt/sounds.ts', {
    console: { warn() {} },
    window: { setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); } },
  }, id => { if (id === '@/lib/audio') return { AudioPlayer }; throw new Error(id); });
  return { ...api, calls, timers };
}

test('incoming radio messages play start, speech, end sequentially, including queued messages', async () => {
  const h = cueHarness();
  for (let i = 0; i < 2; i++) await h.playPttMessage(async () => { h.calls.push('voice'); });
  assert.deepEqual(h.calls, ['/sounds/ptt1.mp3', 'voice', '/sounds/ptt2.mp3', '/sounds/ptt1.mp3', 'voice', '/sounds/ptt2.mp3']);
  assert.equal(h.timers.size, 0);
});

test('missing cues do not swallow speech; voice failure still ends the transmission', async () => {
  const h = cueHarness('fail');
  await h.playPttMessage(async () => { h.calls.push('voice'); });
  assert.deepEqual(h.calls, ['/sounds/ptt1.mp3', 'voice', '/sounds/ptt2.mp3']);
  const ok = cueHarness();
  await assert.rejects(ok.playPttMessage(async () => { throw new Error('voice error'); }), /voice error/);
  assert.deepEqual(ok.calls, ['/sounds/ptt1.mp3', '/sounds/ptt2.mp3']);
});

test('a stalled cue is stopped within its bound and its timer is cleared', async () => {
  const h = cueHarness('stalled');
  const pending = h.playPttCue('start');
  [...h.timers.values()][0]();
  await pending;
  assert.deepEqual(h.calls, ['/sounds/ptt1.mp3', 'stop']);
  assert.equal(h.timers.size, 0);
});
