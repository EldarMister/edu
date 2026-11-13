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
    module, exports: module.exports, AbortController,
    console: { error() {} },
    require: name => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; },
  });
  return module.exports;
}

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const session = id => ({ user: { id }, accessToken: `access-${id}`, refreshToken: `refresh-${id}` });

function authHarness() {
  const noop = () => {};
  return loadSource('src/store/auth.ts', {
    zustand: { create: () => initializer => {
      let state;
      const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
      const store = { getState: () => state, setState: set };
      state = initializer(set, store.getState, store);
      return store;
    } },
    'zustand/middleware': { persist: initializer => initializer, createJSONStorage: () => ({}) },
    'expo-secure-store': {},
    '@/lib/queryClient': { queryClient: { clear: noop } },
    './cart': { useCart: { getState: () => ({ resetAll: noop }) } },
    './replacement': { useReplacement: { getState: () => ({ clear: noop }) } },
    './receiptPrint': { useReceiptPrint: { getState: () => ({ dismiss: noop }) } },
    './notifications': { useNotifications: { setState: noop } },
  });
}

function voiceHarness(kind, { writing, creating, configuring, sample, byUser = {} } = {}) {
  const auth = authHarness();
  const requests = [], sounds = [], written = [], deleted = [];
  const settings = { voiceEnabled: true, speaker: 'baya', speechRate: 1, preferredModel: 'v5_2_ru', fallbackModel: 'v4_ru' };
  const modules = {
    '@/store/auth': auth,
    '@/lib/api': { api: { post: (route, data, config) => {
      assert.equal(route, '/tts/synthesize');
      const response = deferred();
      requests.push({ ...response, text: data.text, speaker: data.speaker, signal: config.signal });
      // Deliberately ignore cancellation: a late adapter/native response must still be harmless.
      return response.promise;
    } } },
    '@/lib/sound': { configureAudioPlayback: async () => { if (configuring) await configuring.promise; } },
    '@/lib/ttsFile': {
      wavBufferToTempFile: async data => {
        written.push(data);
        if (writing) await writing.promise;
        return `/cache/${data}.wav`;
      },
      deleteTempFile: async file => { deleted.push(file); },
    },
    'expo-av': { Audio: { Sound: { createAsync: async (source, initial) => {
      assert.equal(initial.shouldPlay, false);
      if (creating) await creating.promise;
      const sound = {
        uri: source.uri, rate: initial.rate, plays: 0, stops: 0, unloads: 0, status: null,
        setOnPlaybackStatusUpdate(callback) { this.status = callback; },
        async playAsync() { this.plays += 1; },
        async stopAsync() { this.stops += 1; },
        async unloadAsync() { this.unloads += 1; },
        finish() { this.status?.({ isLoaded: true, didJustFinish: true }); },
      };
      sounds.push(sound);
      return { sound };
    } } } },
    './kitchenVoiceSettings': { getKitchenVoiceSettings: () => settings },
    './waiterVoiceSettings': { useWaiterVoiceSettings: { getState: () => ({ byUser }) } },
    './kitchenVoiceSamples': { kitchenVoiceSample: () => sample },
  };
  const voice = loadSource(`src/services/${kind}Voice.ts`, modules)[`${kind}Voice`];
  auth.useAuth.getState().setSession(session('first'));
  const respond = index => requests[index].resolve({ data: requests[index].text });
  return { auth: auth.useAuth, voice, requests, sounds, written, deleted, respond };
}

test('waiter notifications use the signed-in waiter’s speaker and playback speed', async () => {
  const env = voiceHarness('waiter', { byUser: { first: { speaker: 'aidar', speechRate: 1.2 } } });
  const waiter = session('first');
  waiter.user.role = 'WAITER';
  env.auth.getState().setSession(waiter);
  env.voice.enqueue('Заказ готов');
  assert.equal(env.requests[0].speaker, 'aidar');
  env.respond(0);
  await settle();
  assert.equal(env.sounds[0].rate, 1.2);
  env.sounds[0].finish();
  await settle();
});

test('waiter can mute speech without changing the notification sound preference', async () => {
  const preferences = { first: { notificationsEnabled: true, voiceEnabled: false } };
  const env = voiceHarness('waiter', { byUser: preferences });
  const waiter = session('first');
  waiter.user.role = 'WAITER';
  env.auth.getState().setSession(waiter);
  env.voice.enqueue('muted');
  assert.equal(env.requests.length, 0);
  preferences.first = { notificationsEnabled: false, voiceEnabled: true };
  env.voice.enqueue('voice only');
  assert.equal(env.requests.length, 1);
  await env.voice.clear();
  env.respond(0);
  await settle();
  assert.equal(env.sounds.length, 0);
});

for (const kind of ['kitchen', 'waiter']) {
  test(`${kind}: logout stops active audio, clears pending speech, and lets the next account speak`, async () => {
    const env = voiceHarness(kind);
    env.voice.enqueue('first-playing');
    env.voice.enqueue('first-queued');
    env.respond(0);
    await settle();
    assert.equal(env.sounds[0].plays, 1);
    env.auth.getState().logout();
    await settle();
    assert.equal(env.auth.getState().user, null);
    assert.equal(env.sounds[0].stops, 1);
    assert.equal(env.sounds[0].unloads, 1);
    assert.equal(env.sounds[0].status, null);
    assert.deepEqual(env.deleted, ['/cache/first-playing.wav']);
    assert.equal(env.requests.length, 1);

    env.auth.getState().setSession(session('second'));
    env.voice.enqueue('second-playing');
    env.respond(1);
    await settle();
    assert.equal(env.sounds[1].plays, 1);
    assert.equal(env.sounds[1].unloads, 0);
    env.sounds[1].finish();
    await settle();
    assert.equal(env.sounds[1].unloads, 1);
  });

  test(`${kind}: account switch aborts TTS and rejects late responses without advancing the new queue`, async () => {
    const env = voiceHarness(kind);
    env.voice.enqueue('first-request');
    env.voice.enqueue('first-queued');
    env.auth.getState().setSession(session('second'));
    assert.equal(env.requests[0].signal.aborted, true);
    env.voice.enqueue('second-playing');
    env.voice.enqueue('second-queued');
    assert.equal(env.requests.length, 2);
    assert.equal(env.requests[1].signal.aborted, false);

    env.respond(0);
    await settle();
    assert.deepEqual(env.written, []);
    assert.equal(env.requests.length, 2);
    env.respond(1);
    await settle();
    assert.equal(env.sounds[0].plays, 1);
    assert.equal(env.requests.length, 2);
    env.sounds[0].finish();
    await settle();
    assert.equal(env.requests.length, 3);
    assert.equal(env.requests[2].text, 'second-queued');
    env.respond(2);
    await settle();
    assert.deepEqual(env.written, ['second-playing', 'second-queued']);
    env.auth.getState().logout();
    await settle();
  });

  test(`${kind}: logout during file writing deletes the late file without creating audio`, async () => {
    const writing = deferred();
    const env = voiceHarness(kind, { writing });
    env.voice.enqueue('old-file');
    env.respond(0);
    await settle();
    assert.deepEqual(env.written, ['old-file']);
    env.auth.getState().logout();
    writing.resolve();
    await settle();
    assert.equal(env.sounds.length, 0);
    assert.deepEqual(env.deleted, ['/cache/old-file.wav']);
  });

  test(`${kind}: logout during audio configuration prevents native sound creation`, async () => {
    const configuring = deferred();
    const env = voiceHarness(kind, { configuring });
    env.voice.enqueue('old-config');
    env.respond(0);
    await settle();
    env.auth.getState().logout();
    configuring.resolve();
    await settle();
    assert.equal(env.sounds.length, 0);
    assert.deepEqual(env.deleted, ['/cache/old-config.wav']);
  });

  test(`${kind}: logout during native creation stops and unloads the late sound without playing`, async () => {
    const creating = deferred();
    const env = voiceHarness(kind, { creating });
    env.voice.enqueue('old-native');
    env.respond(0);
    await settle();
    env.auth.getState().logout();
    creating.resolve();
    await settle();
    assert.equal(env.sounds[0].plays, 0);
    assert.equal(env.sounds[0].stops, 1);
    assert.equal(env.sounds[0].unloads, 1);
    assert.deepEqual(env.deleted, ['/cache/old-native.wav']);
  });

  test(`${kind}: token refresh preserves current speech`, async () => {
    const env = voiceHarness(kind);
    env.voice.enqueue('current');
    env.auth.getState().setTokens('refreshed-access', 'refreshed-refresh');
    assert.equal(env.requests[0].signal.aborted, false);
    env.respond(0);
    await settle();
    assert.equal(env.sounds[0].plays, 1);
    assert.equal(env.sounds[0].stops, 0);
    env.auth.getState().logout();
    await settle();
  });
}

test('kitchen: scenario preview aborts previous speech and cannot survive logout', async () => {
  const env = voiceHarness('kitchen');
  env.voice.enqueue('old-request');
  const preview = env.voice.testScenario({ id: 'preview', text: 'preview-request' });
  await settle();
  assert.equal(env.requests[0].signal.aborted, true);
  assert.equal(env.requests[1].text, 'preview-request');
  env.auth.getState().logout();
  assert.equal(env.requests[1].signal.aborted, true);
  env.respond(0);
  env.respond(1);
  await preview;
  await settle();
  assert.deepEqual(env.written, []);
  assert.equal(env.sounds.length, 0);
});

test('kitchen: bundled PWA preview plays offline and is stopped on logout', async () => {
  const env = voiceHarness('kitchen', { sample: 42 });
  const preview = env.voice.testScenario({ id: 's1', text: 'pre-recorded' });
  await settle();
  assert.equal(env.requests.length, 0);
  assert.equal(env.sounds[0].plays, 1);
  env.auth.getState().logout();
  await preview;
  assert.equal(env.sounds[0].stops, 1);
  assert.equal(env.sounds[0].unloads, 1);
});
