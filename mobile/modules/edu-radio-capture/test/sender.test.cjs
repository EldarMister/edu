const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const file = resolve(__dirname, '../../../src/features/ptt/useAudioPttSender.ts');
const code = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const ticks = () => new Promise((done) => setImmediate(done));

function app(firstStart, withCaptureEvents = false) {
  const starts = [], finishes = [], reads = [], sent = [];
  const samples = new Map(), listeners = new Map(), timers = new Set();
  const captureListeners = new Map();
  const state = { talking: false, grantedChecks: 0, permissionPrompts: 0 };
  const drain = (token) => {
    const data = samples.get(token) ?? null;
    samples.delete(token);
    return data;
  };
  const capture = {
    start(token) { starts.push(token); return starts.length === 1 && firstStart ? firstStart : Promise.resolve(true); },
    take(token) { reads.push(token); return drain(token); },
    finish(token) { finishes.push(token); return drain(token); },
  };
  if (withCaptureEvents) {
    capture.addListener = (event, handler) => {
      const handlers = captureListeners.get(event) ?? new Set();
      handlers.add(handler);
      captureListeners.set(event, handlers);
      return { remove: () => handlers.delete(handler) };
    };
  }
  const socket = {
    id: 'first', connected: true, timeout() { return this; },
    emitWithAck(event, body) { this.emit(event, body); return Promise.resolve({ ok: true }); },
    emit(event, body) { sent.push([this.id, event, body]); },
    on(event, fn) { listeners.set(event, fn); }, off(event) { listeners.delete(event); },
  };
  const dependencies = {
    react: { useRef: (initial) => ({ current: initial }), useCallback: (fn) => fn,
      useEffect(fn) { state.cleanup = fn(); },
      useState: (initial) => [initial, (value) => { if (initial === false) state.talking = value; }] },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-av': { Audio: {
      AndroidOutputFormat: { MPEG_4: 2 }, AndroidAudioEncoder: { AAC: 3 },
      IOSOutputFormat: { MPEG4AAC: 'aac' }, IOSAudioQuality: { MEDIUM: 64 },
      getPermissionsAsync: async () => { state.grantedChecks++; return { granted: true }; },
      requestPermissionsAsync: async () => { state.permissionPrompts++; return { granted: true }; },
    } },
    expo: { requireOptionalNativeModule: () => capture }, 'expo-file-system': {},
    '@/services/socket': { getSocket: () => socket },
    './types': { PTT_EVENTS: { START_TALK: 'start', CHUNK: 'chunk', STOP_TALK: 'stop', TALK_DENIED: 'denied' } },
  };
  const exports = {};
  new Function('exports', 'require', 'setTimeout', 'clearTimeout', code)(exports, (name) => dependencies[name],
    (fn) => { timers.add(fn); return fn; }, (fn) => timers.delete(fn));
  const sender = exports.useAudioPttSender('kitchen', true);
  return { sender, starts, finishes, reads, sent, samples, timers, state, socket, captureListeners,
    nativeEvent(event, token) { for (const handler of captureListeners.get(event) ?? []) handler({ token }); },
    disconnect() { socket.connected = false; listeners.get('disconnect')(); } };
}

test('a quick release sends the captured tail before freeing the channel, once', async (t) => {
  const radio = app();
  t.after(() => radio.state.cleanup());
  const speaking = radio.sender.start();
  await ticks();
  assert.equal(radio.state.talking, true);
  assert.equal(radio.state.grantedChecks, 1);
  assert.equal(radio.state.permissionPrompts, 0);
  const [token] = radio.starts;
  const [pendingPoll] = radio.timers;
  assert.equal(typeof pendingPoll, 'function');
  radio.samples.set(token, 'speech-before-release');
  radio.sender.stop();
  assert.deepEqual(radio.sent, [
    ['first', 'start', { channel: 'kitchen' }],
    ['first', 'chunk', { channel: 'kitchen', seq: 0, mimeType: 'audio/wav', chunk: 'speech-before-release' }],
    ['first', 'stop', { channel: 'kitchen' }],
  ]);
  radio.samples.set(token, 'speech-after-release');
  pendingPoll();
  radio.sender.stop();
  await speaking;
  assert.deepEqual(radio.finishes, [token]);
  assert.deepEqual(radio.reads, []);
  assert.equal(radio.sent.length, 3);
  assert.equal(radio.timers.size, 0);
});

test('native ready events stream live speech, then release drains every queued block in order before STOP', async (t) => {
  const radio = app(undefined, true);
  t.after(() => radio.state.cleanup());
  const speaking = radio.sender.start();
  await ticks();
  const [token] = radio.starts;
  radio.samples.set(token, 'live');
  radio.nativeEvent('onChunkReady', token);
  radio.samples.set(token, ['queued-1', 'queued-2', 'short-tail']);
  radio.sender.stop();
  radio.sender.stop();
  radio.nativeEvent('onCaptureEnded', token);
  await speaking;
  assert.deepEqual(radio.sent.map(([, event, body]) => [event, body.seq, body.chunk]), [
    ['start', undefined, undefined],
    ['chunk', 0, 'live'],
    ['chunk', 1, 'queued-1'],
    ['chunk', 2, 'queued-2'],
    ['chunk', 3, 'short-tail'],
    ['stop', undefined, undefined],
  ]);
  assert.deepEqual(radio.finishes, [token]);
  assert.deepEqual(radio.reads, [token]);
  assert.equal(radio.captureListeners.get('onChunkReady').size, 0);
  assert.equal(radio.captureListeners.get('onCaptureEnded').size, 0);
});

test('late ready and ended events from the old microphone cannot read or release the current one', async (t) => {
  const radio = app(undefined, true);
  t.after(() => radio.state.cleanup());
  const first = radio.sender.start();
  await ticks();
  const [oldToken] = radio.starts;
  const [oldReady] = radio.captureListeners.get('onChunkReady');
  const [oldEnded] = radio.captureListeners.get('onCaptureEnded');
  radio.sender.stop();
  await first;
  const second = radio.sender.start();
  await ticks();
  const newToken = radio.starts[1];
  assert.ok(newToken > oldToken);
  radio.samples.set(newToken, 'current-speech');

  // The bridge can deliver an old token to a new listener, or run a callback queued before removal.
  radio.nativeEvent('onChunkReady', oldToken);
  radio.nativeEvent('onCaptureEnded', oldToken);
  oldReady({ token: oldToken });
  oldEnded({ token: oldToken });
  assert.deepEqual(radio.reads, []);
  assert.deepEqual(radio.finishes, [oldToken]);
  assert.deepEqual(radio.sent.map(([, event]) => event), ['start', 'stop', 'start']);
  assert.equal(radio.state.talking, true);

  radio.nativeEvent('onChunkReady', newToken);
  radio.nativeEvent('onCaptureEnded', newToken);
  await second;
  assert.deepEqual(radio.reads, [newToken]);
  assert.deepEqual(radio.finishes, [oldToken, newToken]);
  assert.deepEqual(radio.sent.slice(3), [
    ['first', 'chunk', { channel: 'kitchen', seq: 0, mimeType: 'audio/wav', chunk: 'current-speech' }],
    ['first', 'stop', { channel: 'kitchen' }],
  ]);
});

for (const interruption of ['release', 'disconnect']) {
  test(`a late native start after ${interruption} cannot send or stop the next transmission`, async (t) => {
    let completeFirstStart;
    const radio = app(new Promise((done) => { completeFirstStart = done; }));
    t.after(() => radio.state.cleanup());
    const first = radio.sender.start();
    await ticks();
    const [oldToken] = radio.starts;
    if (interruption === 'disconnect') {
      radio.samples.set(oldToken, 'discarded-offline-tail');
      radio.disconnect();
      radio.socket.id = 'reconnected';
      radio.socket.connected = true;
    } else radio.sender.stop();

    const second = radio.sender.start();
    await ticks();
    const newToken = radio.starts[1];
    assert.ok(newToken > oldToken);
    assert.equal(radio.state.talking, true);
    const validStartEvents = interruption === 'disconnect' ? ['start', 'start'] : ['start', 'stop', 'start'];
    assert.deepEqual(radio.sent.map(([, event]) => event), validStartEvents);

    completeFirstStart(true);
    await first;
    assert.equal(radio.state.talking, true);
    assert.deepEqual(radio.finishes, [oldToken]);
    assert.deepEqual(radio.sent.map(([, event]) => event), validStartEvents);
    radio.samples.set(newToken, 'new-speech');
    radio.sender.stop();
    radio.sender.stop();
    await second;
    assert.deepEqual(radio.finishes, [oldToken, newToken]);
    assert.deepEqual(radio.sent.slice(validStartEvents.length), [
      [radio.socket.id, 'chunk', { channel: 'kitchen', seq: 0, mimeType: 'audio/wav', chunk: 'new-speech' }],
      [radio.socket.id, 'stop', { channel: 'kitchen' }],
    ]);
  });
}
