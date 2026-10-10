const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(file, modules) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, setTimeout, clearTimeout,
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
  const sounds = [], written = [], deleted = [], speakers = [];
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
  };
  const playback = loadSource('src/features/ptt/audioPlayback.ts', modules);
  const queue = new playback.PttPlaybackQueue(payload => speakers.push(payload?.chunk ?? null));
  return { queue, playback, sounds, written, deleted, speakers };
}

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
    './types': { PTT_EVENTS: { AUDIO_MESSAGE: 'audio' } }, './audioPlayback': env.playback,
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
    '@/services/realtimeVoice': {}, '@/services/push': {},
    '@/store/auth': { useAuth: { getState: () => auth } },
    '@/lib/sound': { configureAudioPlayback: () => configuring.promise },
    '@/utils/format': { displayOrderNumber: String },
    './types': { PTT_CHANNELS: [{ key: 'general' }], PTT_EVENTS: { AUDIO_MESSAGE: 'audio' } },
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
