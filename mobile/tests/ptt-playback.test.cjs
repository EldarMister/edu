const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(file, modules, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, setTimeout, clearTimeout, AbortController, ...globals,
    require: name => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; },
  });
  return module.exports;
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => resolve = done);
  return { promise, resolve };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const message = chunk => ({ channel: 'general', senderId: 'other', mimeType: 'audio/mp4', chunk });

function playbackHarness({ writing, creating } = {}) {
  const sounds = [], written = [], deleted = [], speakers = [], cues = [];
  const modules = {
    'expo-av': { Audio: { Sound: { createAsync: async () => {
      if (creating) await creating.promise;
      const sound = {
        plays: 0, unloads: 0, status: null,
        setOnPlaybackStatusUpdate(callback) { this.status = callback; },
        async playAsync() { this.plays++; },
        async unloadAsync() { this.unloads++; },
        finish() { this.status?.({ isLoaded: true, didJustFinish: true }); },
      };
      sounds.push(sound);
      return { sound };
    } } } },
    'expo-file-system': {
      cacheDirectory: '/cache/', EncodingType: { Base64: 'base64' },
      writeAsStringAsync: async (file, chunk) => { written.push(chunk); if (writing) await writing.promise; },
      deleteAsync: async file => deleted.push(file),
    },
    '@/lib/sound': { configureAudioPlayback: async () => {} },
    './sounds': { playPttCue: async kind => { cues.push(kind); } },
  };
  const playback = loadSource('src/features/ptt/audioPlayback.ts', modules);
  const queue = new playback.PttPlaybackQueue(payload => speakers.push(payload?.chunk ?? null));
  return { queue, playback, sounds, written, deleted, speakers, cues };
}

test('every received radio message is wrapped by the PWA start and end cues', async () => {
  const env = playbackHarness();
  env.queue.enqueue(message('voice'));
  await settle();
  assert.deepEqual(env.cues, ['start']);
  assert.equal(env.sounds[0].plays, 1);
  env.sounds[0].finish();
  await settle();
  assert.deepEqual(env.cues, ['start', 'end']);
});

test('logout stops the current radio sound and discards queued messages', async () => {
  const env = playbackHarness();
  env.queue.enqueue(message('playing'));
  env.queue.enqueue(message('queued'));
  await settle();
  assert.equal(env.sounds[0].plays, 1);
  env.queue.clear();
  await settle();
  assert.equal(env.sounds[0].unloads, 1);
  assert.deepEqual(env.written, ['playing']);
  assert.equal(env.speakers.at(-1), null);
  assert.equal(env.deleted.length, 1);
});

test('logout during file write prevents a late sound and deletes its temporary file', async () => {
  const writing = deferred();
  const env = playbackHarness({ writing });
  env.queue.enqueue(message('old-user'));
  env.queue.clear();
  writing.resolve();
  await settle();
  assert.equal(env.sounds.length, 0);
  assert.equal(env.deleted.length, 1);
});

test('logout during native sound creation unloads the result without playing it', async () => {
  const creating = deferred();
  const env = playbackHarness({ creating });
  env.queue.enqueue(message('old-user'));
  await settle();
  env.queue.clear();
  creating.resolve();
  await settle();
  assert.equal(env.sounds[0].plays, 0);
  assert.equal(env.sounds[0].unloads, 1);
});

test('old playback completion cannot stop or advance the new session queue', async () => {
  const env = playbackHarness();
  env.queue.enqueue(message('old-playing'));
  env.queue.enqueue(message('old-queued'));
  await settle();
  env.queue.clear();
  env.queue.enqueue(message('new-playing'));
  await settle();
  assert.deepEqual(env.written, ['old-playing', 'new-playing']);
  assert.equal(env.sounds[1].plays, 1);
  assert.equal(env.sounds[1].unloads, 0);
  assert.equal(env.speakers.at(-1), 'new-playing');
  env.sounds[1].finish();
  await settle();
  assert.equal(env.sounds[1].unloads, 1);
});

test('live playout schedules the MP3 before speech and recovers from stalls at normal speed', async () => {
  const voices = [], cues = [], startCues = [];
  const mp3 = { duration: 0.235 };
  let clock = 0;
  function source(list) {
    return {
      playbackRate: { value: 1 }, frequency: { value: 0 },
      connect() {}, disconnect() {}, start(at) { this.startAt = at; list.push(this); }, stop() {},
    };
  }
  class AudioContext {
    get currentTime() { return clock; }
    createBuffer(_channels, length, rate) {
      return { duration: length / rate, sampleRate: rate, copyToChannel() {} };
    }
    createBufferSource() {
      const node = source(voices);
      const start = node.start;
      node.start = function (at) {
        if (this.buffer === mp3) {
          this.startAt = at;
          startCues.push(this);
        } else start.call(this, at);
      };
      return node;
    }
    createOscillator() { return source(cues); }
    createGain() {
      return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
  }
  const { RadioPlayout } = loadSource('src/features/ptt/nativeAudio.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'react-native-audio-api': {
      AudioContext, AudioManager: { getDevicePreferredSampleRate: () => 48000 },
      OfflineAudioContext: class {
        async decodeAudioDataSource(uri) {
          assert.equal(uri, 'file:///ptt1.mp3');
          return mp3;
        }
      },
    },
    'expo-asset': { Asset: { fromModule(id) {
      assert.equal(id, 1);
      return { downloadAsync: async () => ({ localUri: 'file:///ptt1.mp3' }) };
    } } },
    './sounds': { PTT_START_SOUND: 1 },
    './opusAudio': {},
  });
  const play = new RadioPlayout();
  await play.prepareStartCue();
  const samples = new Float32Array(480);
  play.push(samples, true, 24000);
  assert.equal(startCues.length, 1);
  assert.ok(startCues[0].startAt < 0.02);
  assert.equal(voices[0].startAt, startCues[0].startAt + mp3.duration);
  clock = 0.06;
  for (let frame = 0; frame < 30; frame++) play.push(samples, false, 24000);
  assert.ok(voices.every(voice => voice.playbackRate.value === 1));
  for (let index = 1; index < voices.length; index++) {
    const previous = voices[index - 1];
    assert.equal(voices[index].startAt, previous.startAt + previous.buffer.duration);
  }
  clock = voices.at(-1).startAt + 0.12;
  play.push(samples, false, 24000);
  const resumed = voices.at(-1);
  assert.ok(resumed.startAt >= clock + 0.06);
  assert.ok(resumed.startAt <= clock + 0.24);
  assert.equal(startCues.length, 1);
  play.endCue();
  assert.equal(cues[0].startAt, resumed.startAt + 0.02);
  assert.ok(play.remainingMs() > (cues[0].startAt + 0.05 - clock) * 1000);
});

test('live capture delivers 20 ms buffers and keeps the final short buffer on release', async () => {
  let onReady;
  const chunks = [];
  class AudioRecorder {
    constructor(options) {
      assert.equal(options.sampleRate, 24000);
      assert.equal(options.bufferLengthInSamples, 480);
    }
    onAudioReady(callback) { onReady = callback; }
    start() {}
    stop() { emit(107); }
  }
  function emit(numFrames) {
    onReady({ buffer: { getChannelData: () => new Float32Array(480) }, numFrames });
  }
  const { startRadioCapture } = loadSource('src/features/ptt/nativeAudio.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-asset': {},
    './sounds': {},
    'react-native-audio-api': { AudioRecorder },
    './opusAudio': { CAPTURE_RATE: 24000, CAPTURE_SAMPLES: 480 },
  });
  const capture = startRadioCapture(samples => chunks.push(samples.length));
  emit(480);
  assert.equal(await capture.stop(), true);
  assert.deepEqual(chunks, [480, 107]);
});

test('live receiver plays high-quality Opus and coalesces legacy Opus packets at their own sample rates', () => {
  const effects = [], listeners = new Map(), played = [];
  const opus = loadSource('src/features/ptt/opusAudio.ts', {
    buffer: require('node:buffer'), opusscript: require('opusscript'),
  });
  const { useAudioPttReceiver } = loadSource('src/features/ptt/useAudioPttReceiver.ts', {
    react: { useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect) },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    '@/services/socket': { getSocket: () => ({ on: (event, callback) => listeners.set(event, callback), off: event => listeners.delete(event) }) },
    '@/store/auth': { useAuth: selector => selector({ user: { id: 'listener' } }) },
    './types': { PTT_EVENTS: { AUDIO_MESSAGE: 'audio', AUDIO_PACKET: 'packet', AUDIO_FRAME: 'frame', CHANNEL_BUSY: 'busy', CHANNEL_FREE: 'free' } },
    './audioPlayback': { PttPlaybackQueue: class { clear() {} } },
    './backgroundFlag': { isPttBackgroundRuntimeActive: () => false },
    './nativeAudio': { RadioPlayout: class {
      async prepareStartCue() {}
      push(samples, newTalk, rate) { played.push([samples.length, newTalk, rate]); }
      remainingMs() { return 0; }
      endCue() {}
      stop() {}
    } },
    './opusAudio': opus,
  });
  useAudioPttReceiver('general', true);
  const cleanup = effects[0]();
  try {
    const sender = { id: 'sender', name: 'Sender' };
    for (const [codec, talkId] of [
      ['opus-hq', '00000000-0000-4000-8000-000000000001'],
      ['opus', '00000000-0000-4000-8000-000000000002'],
    ]) {
      listeners.get('busy')({ channel: 'general', speaker: sender, codec, talkId });
      const packets = [];
      const encoder = opus.createOpusEncoder(talkId, data => packets.push(Buffer.from(data)), codec);
      try {
        encoder.push(new Float32Array(24000 * 0.12));
        encoder.flush();
      } finally {
        encoder.close();
      }
      if (codec === 'opus') {
        // Older talkers source two frames with a single talk ID in the middle of a transmission.
        packets.splice(1, 2, Buffer.concat([packets[1], packets[2].subarray(16)]));
      }
      for (const packet of packets) listeners.get('packet')(packet);
      listeners.get('free')({ talkId });
    }
    assert.deepEqual(played[0], [480, true, 24000]);
    assert.deepEqual(played.filter(([, , rate]) => rate === 16000), [
      [640, true, 16000], [1280, false, 16000], [640, false, 16000],
    ]);
  } finally {
    cleanup();
  }
});

test('foreground receiver unmount cancels real playback and removes the socket listener', async () => {
  const env = playbackHarness();
  const effects = [], listeners = new Map();
  const hooks = {
    useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }),
    useEffect: effect => effects.push(effect),
  };
  const { useAudioPttReceiver } = loadSource('src/features/ptt/useAudioPttReceiver.ts', {
    react: hooks,
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    '@/services/socket': { getSocket: () => ({ on: (event, callback) => listeners.set(event, callback), off: event => listeners.delete(event) }) },
    '@/store/auth': { useAuth: selector => selector({ user: { id: 'staff' } }) },
    './types': { PTT_EVENTS: { AUDIO_MESSAGE: 'audio', AUDIO_PACKET: 'packet', AUDIO_FRAME: 'frame', CHANNEL_BUSY: 'busy', CHANNEL_FREE: 'free' } },
    './audioPlayback': env.playback,
    './backgroundFlag': { isPttBackgroundRuntimeActive: () => false },
    './nativeAudio': { RadioPlayout: class { async prepareStartCue() {} stop() {} } },
    './opusAudio': {},
  });
  useAudioPttReceiver('general', true);
  const cleanups = effects.map(effect => effect());
  listeners.get('audio')(message('playing'));
  listeners.get('audio')(message('queued'));
  await settle();
  cleanups.forEach(cleanup => cleanup?.());
  await settle();
  assert.equal(listeners.size, 0);
  assert.equal(env.sounds[0].unloads, 1);
  assert.deepEqual(env.written, ['playing']);
});

test('logout cancels a background runtime waiting for native audio initialization', async () => {
  const configuring = deferred();
  const auth = { user: { id: 'staff' }, accessToken: 'token' };
  const listeners = new Map(), flags = [];
  let starts = 0;
  const noop = () => {};
  const { startPttBackgroundRuntime, stopPttBackgroundRuntime } = loadSource('src/features/ptt/backgroundRuntime.ts', {
    'react-native': { AppState: { currentState: 'active' }, Platform: { OS: 'android' }, Vibration: { vibrate: noop } },
    '@react-native-async-storage/async-storage': { getItem: async () => null, setItem: async () => {} },
    'react-native-background-actions': { isRunning: () => false, start: async () => { starts++; }, stop: async () => {} },
    '@/services/socket': { getSocket: () => ({ on: (event, callback) => listeners.set(event, callback), off: event => listeners.delete(event) }) },
    '@/services/socket/events': { SERVER_EVENTS: {} },
    '@/services/kitchenVoice': { kitchenVoice: { enqueue: noop } },
    '@/services/kitchenVoiceSettings': { getKitchenVoiceSettings: () => ({}) },
    '@/services/waiterVoice': { waiterVoice: { enqueue: noop } },
    '@/services/adminVoice': {},
    '@/services/realtimeVoice': {}, '@/services/push': {},
    '@/store/auth': { useAuth: { getState: () => auth } },
    '@/lib/sound': { configureAudioPlayback: () => configuring.promise },
    '@/utils/format': { displayOrderNumber: String },
    './types': { PTT_CHANNELS: [{ key: 'general' }], PTT_EVENTS: { AUDIO_MESSAGE: 'audio' } },
    './opusAudio': { PTT_CODEC_CAPABILITIES: ['opus-hq'] },
    './backgroundFlag': { setPttBackgroundRuntimeActive: value => flags.push(value) },
    './audioPlayback': { PttPlaybackQueue: class { clear() {} } },
  });
  const pending = startPttBackgroundRuntime('general');
  auth.user = null; auth.accessToken = null;
  await stopPttBackgroundRuntime();
  configuring.resolve();
  await pending;
  assert.equal(starts, 0);
  assert.equal(listeners.size, 0);
  assert.ok(!flags.includes(true));
});

function liveTalkHarness() {
  const media = {
    enabled: true, readyState: 'live',
    stop() { this.readyState = 'ended'; },
  };
  const callbacks = [];
  const delays = [];
  const operations = [];
  const cue = deferred();
  let stopCue;
  class Room {
    constructor() {
      this.localParticipant = {
        permissions: { canPublish: true },
        publishTrack: async track => {
          operations.push(['published', track.mediaStreamTrack.enabled]);
          return { trackSid: 'TR_radio' };
        },
      };
    }
    async connect() { this.state = 'connected'; }
    async disconnect() { this.state = 'disconnected'; }
    on() {}
  }
  const socket = {
    connected: true,
    timeout() { return this; },
    on() {},
    off() {},
    emit(event) { operations.push([event, media.enabled]); },
    async emitWithAck(event) {
      if (event === 'ptt_livekit_connect') return { ok: true, url: 'wss://test', channels: [{ channel: 'general', token: 'test' }] };
      if (event === 'ptt_start_talk') return { ok: true, codec: 'livekit' };
      assert.ok(['ptt_livekit_ready', 'ptt_livekit_wait_track'].includes(event));
      return { ok: true };
    },
  };
  const modules = {
    react: {
      useRef: current => ({ current }),
      useState: value => [value, () => {}],
      useCallback: callback => callback,
      useEffect: callback => { const cleanup = callback(); if (cleanup) callbacks.push(cleanup); },
    },
    'livekit-client': {
      Room, RoomEvent: {}, Track: { Source: { Microphone: 'microphone' } },
      LocalAudioTrack: class {
        constructor(track) {
          this.mediaStreamTrack = track;
          queueMicrotask(() => { track.enabled = true; });
        }
        stop() { media.stop(); }
      },
    },
    '@/services/socket': { getSocket: () => socket },
    'expo-crypto': { randomUUID: () => 'talk' },
    './liveKitAudio': {
      activateRadioAudio: async () => () => {},
      attachRemoteAudio: () => () => {},
      observeRadioInterruption: () => () => {},
      prepareRadioCue: () => {},
      radioCue(side, signal) {
        operations.push([side, media.enabled]);
        stopCue = signal;
        return cue.promise;
      },
    },
  };
  const { useLiveKitPtt } = loadSource('src/features/ptt/useLiveKitPtt.ts', modules, {
    navigator: { mediaDevices: { async getUserMedia() { return { getAudioTracks: () => [media] }; } } },
    setInterval: () => 0, clearInterval() {},
    setTimeout(resolve, ms) { if (ms === 0) queueMicrotask(resolve); else delays.push(resolve); },
  });
  const sender = useLiveKitPtt('general', true, true, { start: () => assert.fail('unexpected fallback'), stop() {} }, 'staff-id');
  return { sender, media, cue, delays, operations, cueSignal: () => stopCue, dispose: () => callbacks.forEach(callback => callback()) };
}

test('LiveKit listener receives silence before speech and drains the tail before permissions are revoked', async () => {
  const h = liveTalkHarness();
  try {
    await settle();
    const start = h.sender.start();
    await settle();
    assert.deepEqual(h.operations, [['published', false], ['sender', false]]);
    h.cue.resolve();
    assert.equal(await start, true);
    assert.equal(h.media.enabled, true);

    h.sender.stop();
    assert.equal(h.media.enabled, true);
    h.delays.shift()();
    await settle();
    assert.equal(h.media.enabled, false);
    assert.equal(h.operations.length, 2);
    h.delays.shift()();
    await settle();
    assert.deepEqual(h.operations.at(-1), ['ptt_stop_talk', false]);
  } finally {
    h.dispose();
  }
});

test('releasing during the LiveKit cue never enables the microphone', async () => {
  const h = liveTalkHarness();
  try {
    await settle();
    const start = h.sender.start();
    await settle();
    h.sender.stop();
    assert.equal(h.cueSignal().aborted, true);
    h.cue.resolve();
    assert.equal(await start, false);
    assert.equal(h.media.enabled, false);
    assert.deepEqual(h.operations.at(-1), ['ptt_stop_talk', false]);
  } finally {
    h.dispose();
  }
});
