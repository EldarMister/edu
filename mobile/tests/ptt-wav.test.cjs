const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');

const tick = () => new Promise(done => setImmediate(done));
const events = { START_TALK: 'start', STOP_TALK: 'stop', NATIVE_CHUNK: 'wav', NATIVE_STREAM: 'stream', TALK_DENIED: 'denied' };

function mount(name, dependencies, channel = 'general') {
  const effects = [];
  const states = [];
  const module = { exports: {} };
  const modules = {
    react: { useCallback: callback => callback, useRef: current => ({ current }), useEffect: effect => effects.push(effect),
      useState: initial => [initial, value => states.push(value)] },
    './types': { PTT_EVENTS: events }, ...dependencies,
  };
  const input = readFileSync(resolve(__dirname, '../src/features/ptt', name + '.ts'), 'utf8');
  const { outputText } = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  new Function('module', 'exports', 'require', outputText)(module, module.exports, key => {
    assert.ok(key in modules, key);
    return modules[key];
  });
  const hook = module.exports[name](channel, true);
  const cleanups = effects.map(effect => effect());
  return { ...hook, states, close: () => cleanups.forEach(cleanup => cleanup?.()) };
}

function senderHarness() {
  const socketEvents = [], nativeEvents = new Map(), tokens = [];
  let grant, permissionPrompts = 0;
  const socket = {
    connected: true, id: 'connection', on() {}, off() {},
    timeout() { return { emitWithAck(event, body) { socketEvents.push([event, body]); return new Promise(resolve => { grant = resolve; }); } }; },
    emit(event, body) { socketEvents.push([event, body]); },
  };
  const sender = mount('useAndroidWavSender', {
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-av': { Audio: { getPermissionsAsync: async () => ({ granted: true }), requestPermissionsAsync: async () => { permissionPrompts++; } } },
    '@/services/socket': { getSocket: () => socket },
    './radioAudioGate': { startRadioInput: () => () => {} },
    './androidWavRadio': { wavCapture: {
      addListener: (event, listener) => { nativeEvents.set(event, listener); return { remove: () => nativeEvents.delete(event) }; },
      start: async token => { tokens.push(token); return true; }, take: () => 'part', finish: () => ['tail'],
    } },
  });
  return { sender, tokens, socketEvents, grant: () => grant({ ok: true }),
    sendNative: () => nativeEvents.get('onChunkReady')({ token: tokens[0] }), permissionPrompts: () => permissionPrompts };
}

test('Android WAV streams while held, then sends the last packet before releasing the channel', async (t) => {
  const env = senderHarness();
  t.after(env.sender.close);
  const start = env.sender.start();
  await tick();
  env.grant();
  assert.equal(await start, true);
  env.sendNative();
  env.sender.stop();
  env.sender.stop();
  assert.deepEqual(env.socketEvents.map(([event]) => event), ['start', 'wav', 'wav', 'stop']);
  assert.deepEqual(env.socketEvents.slice(1, 3).map(([, data]) => [data.seq, data.mimeType, data.chunk]),
    [[0, 'audio/wav', 'part'], [1, 'audio/wav', 'tail']]);
  assert.equal(env.permissionPrompts(), 0);
});

test('Android WAV releases a late grant without opening the microphone after button-up', async (t) => {
  const env = senderHarness();
  t.after(env.sender.close);
  const start = env.sender.start();
  await tick();
  env.sender.stop();
  env.grant();
  assert.equal(await start, false);
  assert.equal(env.tokens.length, 0);
  assert.deepEqual(env.socketEvents.map(([event]) => event), ['start', 'stop']);
});

test('Android WAV receives successive packets on one native track, also while listening in background', async (t) => {
  const trace = [], handlers = new Map();
  const receiver = mount('useAndroidWavReceiver', {
    'react-native': { AppState: { currentState: 'background' } },
    '@/services/socket': { getSocket: () => ({ on: (event, handler) => handlers.set(event, handler), off: event => handlers.delete(event) }) },
    '@/store/auth': { useAuth: pick => pick({ user: { id: 'staff' } }) },
    './backgroundFlag': { isPttBackgroundRuntimeActive: () => true },
    './radioAudioGate': { onRadioInput: () => () => {}, radioInputActive: () => false },
    './audioPlayback': { PttPlaybackQueue: class { constructor(publish) { this.publish = publish; } clear() { this.publish(null); } } },
    './androidWavRadio': { wavPlayback: {
      begin: id => trace.push(['open', id]), stop: id => trace.push(['stop', id]),
      enqueue: async (id, packet) => { trace.push([packet, id]); return true; }, remaining: () => 60,
    } },
  }, 'kitchen');
  t.after(receiver.close);
  const packet = (channel, senderId, chunk) => handlers.get('stream')({ channel, senderId, chunk, mimeType: 'audio/wav' });
  packet('general', 'other', 'one');
  packet('kitchen', 'other', 'two');
  packet('waiters', 'other', 'wrong-channel');
  packet('general', 'staff', 'own');
  await tick();
  assert.deepEqual(trace.map(([name]) => name), ['open', 'one', 'two']);
  assert.equal(new Set(trace.map(([, id]) => id)).size, 1);
});
