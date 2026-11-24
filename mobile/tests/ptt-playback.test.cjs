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
    './androidPttInput': { startAndroidPttInput: () => undefined },
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
    './androidPttInput': { startAndroidPttInput: () => undefined },
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
    './types': { PTT_EVENTS: { AUDIO_MESSAGE: 'audio', AUDIO_PACKET: 'packet', AUDIO_FRAME: 'frame', AUDIO_BATCH: 'batch', PRESENCE: 'presence', CHANNEL_BUSY: 'busy', CHANNEL_FREE: 'free' } },
    './audioPlayback': { PttPlaybackQueue: class { clear() {} } },
    './backgroundFlag': { isPttBackgroundRuntimeActive: () => false },
    './radioAudioGate': { radioInputActive: () => false, onRadioInput: () => () => {} },
    './sequencedAudio': { pttAudioHistory: () => () => {}, createPttStreamReceiver: () => ({ batch() {}, joined() {}, disconnected() {}, dispose() {} }) },
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
    './types': { PTT_EVENTS: { AUDIO_MESSAGE: 'audio', AUDIO_PACKET: 'packet', AUDIO_FRAME: 'frame', AUDIO_BATCH: 'batch', PRESENCE: 'presence', CHANNEL_BUSY: 'busy', CHANNEL_FREE: 'free' } },
    './audioPlayback': env.playback,
    './backgroundFlag': { isPttBackgroundRuntimeActive: () => false },
    './radioAudioGate': { radioInputActive: () => false, onRadioInput: () => () => {} },
    './sequencedAudio': { pttAudioHistory: () => () => {}, createPttStreamReceiver: () => ({ batch() {}, joined() {}, disconnected() {}, dispose() {} }) },
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
    './androidWavRadio': { radioJoinOptions: channel => ({ channel, codecs: ['opus-hq'], sequenced: true }) },
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

const sequencedModule = loadSource('src/features/ptt/sequencedAudio.ts', { './types': { PTT_EVENTS: {} } }, { Uint8Array,Float32Array,ArrayBuffer });
const settleSequenced = settle;

test('a radio gap is repaired in order and overlapping live frames play only once', async () => {
  const decodedFrames = [];
  const played = [];
  const ended = [];
  const payload = (firstFrame, samples, senderId = 'other') => ({
    channel: 'waiters', talkId: 'radio-talk', codec: 'opus-hq', firstFrame, senderId,
    audio: new Uint8Array(samples).buffer,
  });
  const receiver = sequencedModule.createPttStreamReceiver({
    hears: batch => batch.senderId !== 'me' && batch.channel === 'waiters',
    openDecoder: () => ({ frameBytes: 1, frameSamples: 1, sampleRate: 24000,
      decode(frame) { decodedFrames.push(frame[0]); return Float32Array.of(frame[0] / 255); },
      close() {},
    }),
    async sync(id, frame) {
      assert.equal(id, 'radio-talk');
      if (frame === 2) return { ok: true, batch: payload(2, [20, 21, 30, 31]) };
      assert.equal(frame, 6);
      return { ok: true, finished: true, nextFrame: 8, batch: payload(6, [40, 41]) };
    },
    play(batch, samples) { played.push([batch.firstFrame, samples.length]); },
    end(id) { ended.push(id); },
  });
  receiver.batch(payload(0, [200, 201], 'me'));
  receiver.batch(payload(0, [10, 11]));
  receiver.batch(payload(4, [30, 31]));
  await settleSequenced();
  receiver.disconnected();
  receiver.joined();
  await settleSequenced();
  receiver.batch(payload(6, [40, 41]));
  await settleSequenced();
  assert.deepEqual(decodedFrames, [10, 11, 20, 21, 30, 31, 40, 41]);
  assert.deepEqual(played, [[0, 2], [2, 4], [6, 2]]);
  assert.deepEqual(ended, ['radio-talk']);
  receiver.dispose();
});

test('radio packs Opus frames and flushes the last partial batch before the channel is released', () => {
  const sent = [];
  const batcher = sequencedModule.createPttBatcher(2, (first, audio) => sent.push([first, Array.from(new Uint8Array(audio))]));
  for (let frame = 1; frame <= 6; frame++) batcher.push(new Uint8Array(18).fill(frame).buffer);
  assert.deepEqual(sent, [[0, [1, 1, 2, 2, 3, 3, 4, 4]]]);
  assert.equal(batcher.flush(), 6);
  assert.deepEqual(sent[1], [4, [5, 5, 6, 6]]);
  assert.equal(batcher.flush(), 6);
  assert.equal(sent.length, 2);
});
