const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness({ writing, creating } = {}) {
  const requests = [], sounds = [], deleted = [];
  const modules = {
    axios: { get: (_, config) => { const request = defer(); requests.push({ ...request, ...config }); return request.promise; } },
    '@/config/env': { API_BASE: 'https://test.invalid/api' },
    '@/lib/sound': { configureAudioPlayback: async () => {} },
    '@/lib/ttsFile': {
      wavBufferToTempFile: async data => { if (writing) await writing.promise; return data; },
      deleteTempFile: async file => deleted.push(file),
    },
    'expo-av': { Audio: { Sound: { createAsync: async (source, options) => {
      assert.equal(options.shouldPlay, false);
      if (creating) await creating.promise;
      const sound = {
        uri: source.uri, plays: 0, unloads: 0, status: null,
        setOnPlaybackStatusUpdate(callback) { this.status = callback; },
        async playAsync() { this.plays++; }, async unloadAsync() { this.unloads++; },
        finish() { this.status?.({ isLoaded: true, didJustFinish: true }); },
      };
      sounds.push(sound); return { sound };
    } } } },
  };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/queueVoice.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, AbortController, setTimeout, clearTimeout, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  const voice = new module.exports.QueueVoice({ cafe: 'test' }); voice.enable();
  return { voice, requests, sounds, deleted, respond: index => requests[index].resolve({ data: `file-${index}` }) };
}
test('queue disable aborts pending synthesis and ignores a late response after re-enable', async () => {
  const env = harness(); env.voice.enqueue('old'); env.voice.disable();
  assert.equal(env.requests[0].signal.aborted, true);
  env.voice.enable(); env.voice.enqueue('new'); env.respond(0); await settle();
  assert.equal(env.sounds.length, 0);
  env.respond(1); await settle(); assert.equal(env.sounds[0].plays, 1);
  env.voice.disable(); await settle(); assert.equal(env.sounds[0].unloads, 1);
});
test('queue disable during file write cleans the file without playing it', async () => {
  const writing = defer(); const env = harness({ writing });
  env.voice.enqueue('old'); env.respond(0); await settle(); env.voice.disable();
  writing.resolve(); await settle();
  assert.equal(env.sounds.length, 0); assert.deepEqual(env.deleted, ['file-0']);
});
test('queue disable during native creation unloads the late sound without playing it', async () => {
  const creating = defer(); const env = harness({ creating });
  env.voice.enqueue('old'); env.respond(0); await settle(); env.voice.disable();
  creating.resolve(); await settle();
  assert.equal(env.sounds[0].plays, 0); assert.equal(env.sounds[0].unloads, 1);
});
test('queue stop resolves active playback immediately and does not advance an old queue', async () => {
  const env = harness(); env.voice.enqueue('old'); env.voice.enqueue('old-pending'); env.respond(0); await settle();
  env.voice.disable(); env.voice.enable(); env.voice.enqueue('new'); env.respond(1); await settle();
  assert.equal(env.requests.length, 2); assert.equal(env.sounds[0].unloads, 1); assert.equal(env.sounds[1].plays, 1);
  env.voice.disable(); await settle();
});
