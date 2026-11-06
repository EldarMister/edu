const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness({ permission, preparation, permissionGranted = false } = {}) {
  let permissionRequests = 0;
  const events = [], recordings = [], cues = [], effects = [], errors = [];
  let appState;
  let ackError = null;
  let pendingAck;
  const socket = {
    on() {}, off() {},
    timeout(ms) { assert.equal(ms, 5000); return { emit: (event, data, cb) => { events.push(event); pendingAck = () => cb(ackError, { ok: !ackError }); } }; },
    emit(event) { events.push(event); },
  };
  const modules = {
    react: {
      useState: initial => [initial, value => errors.push(value)], useRef: current => ({ current }),
      useCallback: fn => fn, useEffect: fn => effects.push(fn),
    },
    'react-native': { AppState: { addEventListener: (_, callback) => { appState = callback; return { remove() {} }; } } },
    'expo-av': { Audio: {
      AndroidOutputFormat: { MPEG_4: 1 }, AndroidAudioEncoder: { AAC: 1 }, IOSOutputFormat: { MPEG4AAC: 1 }, IOSAudioQuality: { HIGH: 1 },
      getPermissionsAsync: async () => ({ granted: permissionGranted }),
      requestPermissionsAsync: async () => { permissionRequests++; return permission ? permission.promise : { granted: true }; }, setAudioModeAsync: async () => {},
      Recording: class {
        constructor() { this.stops = 0; recordings.push(this); }
        async prepareToRecordAsync() { if (preparation) await preparation.promise; }
        async startAsync() { this.started = true; }
        async stopAndUnloadAsync() { this.stops++; }
        getURI() { return 'recording'; }
      },
    } },
    'expo-file-system': { EncodingType: { Base64: 'base64' }, readAsStringAsync: async () => 'voice', deleteAsync: async () => {} },
    '@/lib/sound': { configureAudioRecording: async () => {} },
    '@/services/socket': { getSocket: () => socket },
    './sounds': { playPttCue: async kind => cues.push(kind) },
    './types': { PTT_EVENTS: { START_TALK: 'start', STOP_TALK: 'stop', AUDIO_MESSAGE: 'audio', TALK_DENIED: 'denied' } },
  };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/ptt/useAudioPttSender.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, AbortController, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  const sender = module.exports.useAudioPttSender('general', true);
  effects.forEach(effect => effect());
  return { sender, events, cues, recordings, errors, permissionRequests: () => permissionRequests, ack: error => { ackError = error; pendingAck(); }, background: () => appState('background') };
}

test('a quick release during microphone permission does not reserve the channel or record', async () => {
  const permission = deferred();
  const env = harness({ permission });
  const start = env.sender.start();
  env.sender.stop();
  permission.resolve({ granted: true });
  assert.equal(await start, false);
  assert.deepEqual(env.events, []);
  assert.equal(env.recordings.length, 0);
});

test('concurrent presses start only one recorder and send one message between the cues', async () => {
  const env = harness();
  const first = env.sender.start();
  assert.equal(await env.sender.start(), false);
  await settle(); env.ack(null);
  assert.equal(await first, true);
  env.sender.stop();
  await settle();
  assert.deepEqual(env.events, ['start', 'audio', 'stop']);
  assert.deepEqual(env.cues, ['start', 'end']);
  assert.equal(env.recordings.length, 1);
  assert.equal(env.recordings[0].stops, 1);
});

test('ACK timeout releases the starting guard so a retry can succeed', async () => {
  const env = harness();
  const first = env.sender.start();
  await settle(); env.ack(new Error('timeout'));
  assert.equal(await first, false);
  assert.equal(env.recordings.length, 0);
  const second = env.sender.start();
  await settle(); env.ack(null);
  assert.equal(await second, true);
  env.sender.stop(); await settle();
});

test('backgrounding during preparation stops the late recorder instead of leaving the mic open', async () => {
  const preparation = deferred();
  const env = harness({ preparation });
  const first = env.sender.start();
  await settle(); env.ack(null); await settle();
  env.background();
  preparation.resolve();
  await first; await settle();
  assert.equal(env.recordings[0].stops, 1);
  assert.equal(env.events.at(-1), 'stop');
});


test('an authorized microphone starts without reopening Android permission UI and cancelling the hold', async () => {
  const env = harness({ permissionGranted: true });
  const start = env.sender.start();
  await settle(); env.ack(null);
  assert.equal(await start, true);
  assert.equal(env.permissionRequests(), 0);
  env.sender.stop(); await settle();
  assert.deepEqual(env.events, ['start', 'audio', 'stop']);
});
