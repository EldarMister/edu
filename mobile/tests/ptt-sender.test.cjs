const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const talkId = '1bf119a1-5269-45d2-aec7-511b7b35e111';

function harness({ permission, preparation, permissionGranted = false } = {}) {
  let permissionRequests = 0;
  const events = [], effects = [], states = [], listeners = new Map();
  let appState, pendingAck, captured, finalFrames, stops = 0;
  const socket = {
    connected: true,
    on(event, listener) { listeners.set(event, listener); },
    off(event) { listeners.delete(event); },
    timeout(ms) {
      assert.equal(ms, 3500);
      return { emit(event, data, callback) {
        events.push([event, data]);
        pendingAck = (error, ack) => callback(error, ack ?? { ok: true, talkId: data.talkId, codec: data.codec });
      } };
    },
    emit(event, data) { events.push([event, data]); },
  };
  const modules = {
    react: {
      useState: initial => [initial, value => states.push(value)], useRef: current => ({ current }),
      useCallback: fn => fn, useEffect: fn => effects.push(fn),
    },
    'react-native': { AppState: { addEventListener: (_, callback) => { appState = callback; return { remove() {} }; } } },
    'expo-av': { Audio: {
      getPermissionsAsync: async () => ({ granted: permissionGranted }),
      requestPermissionsAsync: async () => { permissionRequests++; return permission ? permission.promise : { granted: true }; },
    } },
    'expo-crypto': { randomUUID: () => talkId },
    '@/lib/sound': { configureAudioRecording: async active => { if (active && preparation) await preparation.promise; } },
    '@/services/socket': { getSocket: () => socket },
    './nativeAudio': {
      configureRadioAudioSession() {},
      startRadioCapture(onSamples) {
        captured = onSamples;
        return { async stop() { stops++; if (finalFrames) onSamples(finalFrames); return true; } };
      },
    },
    './opusAudio': {
      createOpusEncoder(id, send) {
        assert.equal(id, talkId);
        return { push: send, flush: () => send('tail'), close() {} };
      },
    },
    './types': { PTT_EVENTS: { START_TALK: 'start', STOP_TALK: 'stop', AUDIO_PACKET: 'audio', TALK_DENIED: 'denied' } },
  };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/ptt/useAudioPttSender.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, setTimeout, clearTimeout, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  const sender = module.exports.useAudioPttSender('general', true);
  effects.forEach(effect => effect());
  return {
    sender, events, states,
    eventNames: () => events.map(event => event[0]),
    permissionRequests: () => permissionRequests,
    ack: (error, data) => pendingAck(error, data),
    background: () => appState('background'),
    capture: frame => captured(frame),
    hasCapture: () => !!captured,
    finalFrames: frames => { finalFrames = frames; },
    micStops: () => stops,
    disconnect: () => { socket.connected = false; listeners.get('disconnect')(); },
  };
}

test('releasing during permissions does not reserve a channel or open capture', async () => {
  const permission = deferred();
  const env = harness({ permission });
  const start = env.sender.start();
  env.sender.stop();
  permission.resolve({ granted: true });
  assert.equal(await start, false);
  assert.deepEqual(env.eventNames(), []);
  assert.equal(env.hasCapture(), false);
});

test('capture starts before the channel grant and streams until the final microphone samples are sent', async () => {
  const env = harness();
  const first = env.sender.start();
  assert.equal(await env.sender.start(), false);
  await settle();
  env.capture('first word');
  assert.deepEqual(env.eventNames(), ['start']);
  assert.equal(env.events[0][1].talkId, talkId);
  assert.equal(env.events[0][1].codec, 'opus');
  env.ack(null);
  assert.equal(await first, true);
  env.capture('live words');
  assert.deepEqual(env.eventNames(), ['start', 'audio', 'audio']);
  env.finalFrames('last syllable');
  env.sender.stop();
  await settle();
  assert.deepEqual(env.events.slice(1, -1).map(event => event[1]), ['first word', 'live words', 'last syllable', 'tail']);
  assert.deepEqual(env.eventNames(), ['start', 'audio', 'audio', 'audio', 'audio', 'stop']);
  assert.equal(env.events.at(-1)[1].talkId, talkId);
  assert.equal(env.micStops(), 1);
});

test('a short transmission released before acknowledgement is drained after the grant', async () => {
  const env = harness({ permissionGranted: true });
  const start = env.sender.start();
  await settle();
  env.capture('short phrase');
  env.sender.stop();
  await settle();
  assert.deepEqual(env.eventNames(), ['start']);
  env.ack(null);
  assert.equal(await start, false);
  await settle();
  assert.deepEqual(env.eventNames(), ['start', 'audio', 'audio', 'stop']);
  assert.equal(env.permissionRequests(), 0);
});

test('timeout releases the channel and microphone so a retry can succeed', async () => {
  const env = harness();
  const first = env.sender.start();
  await settle();
  env.ack(new Error('timeout'));
  assert.equal(await first, false);
  await settle();
  assert.equal(env.micStops(), 1);
  const second = env.sender.start();
  await settle(); env.ack(null);
  assert.equal(await second, true);
  env.sender.stop(); await settle();
});

test('backgrounding during native setup never opens a late microphone', async () => {
  const preparation = deferred();
  const env = harness({ preparation });
  const first = env.sender.start();
  await settle();
  env.background();
  preparation.resolve();
  assert.equal(await first, false);
  assert.equal(env.hasCapture(), false);
  assert.deepEqual(env.eventNames(), []);
});

test('disconnect stops capture and avoids queuing radio audio for reconnection', async () => {
  const env = harness();
  const start = env.sender.start();
  await settle(); env.ack(null);
  assert.equal(await start, true);
  env.finalFrames('stale audio');
  env.disconnect();
  await settle();
  assert.equal(env.micStops(), 1);
  assert.deepEqual(env.eventNames(), ['start']);
});
