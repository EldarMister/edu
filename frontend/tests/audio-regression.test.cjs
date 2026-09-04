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

function senderHarness({ recorderFails = false, pendingPermission = false, pendingAck = false } = {}) {
  const events = [];
  const modes = [];
  const effects = [];
  let stopped = 0;
  let permissionResolve;
  let ack;
  let recorder;
  let constraints;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const socket = {
    emit(event, payload) { events.push({ event, payload }); },
    timeout() { return { emit(event, payload, callback) {
      events.push({ event, payload });
      ack = callback;
      if (!pendingAck) callback(null, { ok: true });
    } }; },
    on() {}, off() {},
  };
  class MediaRecorder {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    state = 'inactive';
    mimeType = 'audio/mp4';
    constructor() { if (recorderFails) throw new Error('recorder failed'); recorder = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop()); }
  }
  const eventsApi = { START_TALK: 'start', STOP_TALK: 'stop', AUDIO_MESSAGE: 'audio', TALK_DENIED: 'denied' };
  const api = load('src/features/ptt/useAudioPttSender.ts', {
    MediaRecorder, Blob, DOMException, queueMicrotask,
    navigator: { mediaDevices: { getUserMedia(value) {
      constraints = value;
      return pendingPermission ? new Promise((resolve) => { permissionResolve = resolve; }) : Promise.resolve(stream);
    } } },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    window: { addEventListener() {}, removeEventListener() {} },
  }, (id) => {
    if (id === 'react') return {
      useCallback: (fn) => fn, useRef: (current) => ({ current }), useState: (value) => [value, () => {}],
      useEffect: (effect) => effects.push(effect),
    };
    if (id === '@/lib/socket') return { getSocket: () => socket };
    if (id === '@/lib/audio') return { unlockAudio() {}, setAudioRecording: (value) => modes.push(value) };
    if (id === './types') return { PTT_EVENTS: eventsApi };
    throw new Error(id);
  });
  return {
    sender: api.useAudioPttSender('general', true), events, modes,
    get stopped() { return stopped; }, get constraints() { return constraints; },
    grant: () => permissionResolve(stream), acknowledge: (...args) => ack(...args),
    get recorder() { return recorder; },
  };
}

test('recorder construction failure releases microphone and restores playback mode', async () => {
  const h = senderHarness({ recorderFails: true });
  assert.equal(await h.sender.start(), false);
  assert.ok(h.stopped > 0);
  assert.equal(h.modes.at(-1), false);
  assert.ok(h.events.some((event) => event.event === 'stop'));
});

test('releasing while microphone permission is pending does not start a recording', async () => {
  const h = senderHarness({ pendingPermission: true });
  const starting = h.sender.start();
  h.sender.stop();
  h.grant();
  assert.equal(await starting, false);
  assert.equal(h.stopped, 1);
  assert.equal(h.modes.at(-1), false);
  assert.equal(h.events.length, 0);
});

test('server timeout releases microphone and permits another attempt', async () => {
  const h = senderHarness({ pendingAck: true });
  const starting = h.sender.start();
  await flush();
  assert.equal(await h.sender.start(), false);
  h.acknowledge(new Error('timeout'));
  assert.equal(await starting, false);
  assert.equal(h.stopped, 1);
  assert.equal(h.modes.at(-1), false);
});

test('normal radio recording enables mic gain and restores output after stop', async () => {
  const h = senderHarness();
  assert.equal(await h.sender.start(), true);
  assert.equal(h.constraints.audio.autoGainControl, true);
  assert.equal(h.constraints.audio.channelCount, 1);
  h.sender.stop();
  await flush();
  assert.equal(h.stopped, 1);
  assert.equal(h.modes.at(-1), false);
  assert.equal(h.events.at(-1).event, 'stop');
});
