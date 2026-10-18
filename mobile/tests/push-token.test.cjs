const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(file, modules = {}, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports,
    require: name => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; },
    ...globals,
  });
  return module.exports;
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const nativeToken = data => ({ type: 'android', data });
function timerHarness() {
  const timers = new Map();
  let id = 0;
  return {
    timers,
    setTimeout: callback => { timers.set(++id, callback); return id; },
    clearTimeout: key => { timers.delete(key); },
    expire() { const [key, callback] = timers.entries().next().value; timers.delete(key); callback(); },
  };
}
function harness({ native = async () => nativeToken('native'), expo = async () => 'expo' } = {}) {
  const clock = timerHarness(), diagnostics = [], exchanges = [];
  const { PushTokenAcquisition } = loadSource('src/services/push/token.ts', {}, clock);
  const acquisition = new PushTokenAcquisition({
    nativeToken: native,
    expoToken: token => { exchanges.push(token.data); return expo(token); },
    onFailure: diagnostic => { diagnostics.push({ ...diagnostic }); },
  });
  return { acquisition, diagnostics, exchanges, clock };
}

test('a rejected native request is retried and successful acquisition clears its in-flight promise', async () => {
  let calls = 0;
  const env = harness({ native: async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('native failed: SERVICE_NOT_AVAILABLE'), { code: 'E_REGISTRATION_FAILED' });
    return nativeToken('recovered-native');
  } });
  await assert.rejects(env.acquisition.acquire());
  assert.deepEqual(env.diagnostics, [{ stage: 'native', code: 'E_REGISTRATION_FAILED', reason: 'SERVICE_NOT_AVAILABLE' }]);
  assert.equal(await env.acquisition.acquire(), 'expo');
  assert.equal(calls, 2);
  assert.deepEqual(env.exchanges, ['recovered-native']);
  assert.equal(await env.acquisition.acquire(), 'expo');
  assert.equal(calls, 3);
  assert.equal(env.clock.timers.size, 0);
});

test('concurrent callers share one acquisition instead of issuing duplicate native and Expo requests', async () => {
  const pendingNative = deferred();
  let calls = 0;
  const env = harness({ native: () => { calls += 1; return pendingNative.promise; } });
  const first = env.acquisition.acquire(), second = env.acquisition.acquire();
  assert.equal(first, second);
  await settle();
  assert.equal(calls, 1);
  pendingNative.resolve(nativeToken('single-native'));
  assert.equal(await first, 'expo');
  assert.equal(await second, 'expo');
  assert.deepEqual(env.exchanges, ['single-native']);
});

test('native request emissions and duplicate tokens do not trigger registration; genuine rotations do', async () => {
  const events = [];
  let current = nativeToken('first-native'), acquisition;
  const env = harness({ native: async () => {
    events.push(acquisition.onNativeToken(current));
    return current;
  } });
  acquisition = env.acquisition;
  await acquisition.acquire();
  assert.deepEqual(events, [false]);
  assert.equal(acquisition.onNativeToken(current), false);
  current = nativeToken('rotated-native');
  assert.equal(acquisition.onNativeToken(current), true);
  assert.equal(acquisition.onNativeToken(current), false);
  await acquisition.acquire();
  assert.deepEqual(events, [false, false]);
  assert.deepEqual(env.exchanges, ['first-native', 'rotated-native']);
});

test('rotation during native acquisition is exchanged immediately instead of being lost', async () => {
  const pendingNative = deferred();
  const env = harness({ native: () => pendingNative.promise });
  const pending = env.acquisition.acquire();
  await settle();
  assert.equal(env.acquisition.onNativeToken(nativeToken('newest-native')), false);
  pendingNative.resolve(nativeToken('older-native'));
  await pending;
  assert.deepEqual(env.exchanges, ['newest-native']);
  assert.equal(env.acquisition.onNativeToken(nativeToken('newest-native')), false);
});

test('rotation during Expo exchange signals a follow-up registration', async () => {
  const pendingExpo = deferred();
  const env = harness({ expo: () => pendingExpo.promise });
  const pending = env.acquisition.acquire();
  await settle();
  assert.equal(env.acquisition.onNativeToken(nativeToken('rotated-during-exchange')), true);
  assert.equal(env.acquisition.onNativeToken(nativeToken('rotated-during-exchange')), false);
  pendingExpo.resolve('first-expo');
  assert.equal(await pending, 'first-expo');
});

test('native timeout clears in-flight state and late completion cannot exchange or clear a newer request', async () => {
  const oldNative = deferred(), nextNative = deferred();
  let calls = 0;
  const env = harness({ native: () => (++calls === 1 ? oldNative.promise : nextNative.promise) });
  const oldRequest = env.acquisition.acquire();
  const rejected = assert.rejects(oldRequest);
  await settle();
  env.clock.expire();
  await rejected;
  assert.deepEqual(env.diagnostics, [{ stage: 'native', code: 'PUSH_TOKEN_TIMEOUT', reason: 'TIMEOUT' }]);
  const newRequest = env.acquisition.acquire();
  await settle();
  oldNative.resolve(nativeToken('obsolete-native'));
  await settle();
  assert.deepEqual(env.exchanges, []);
  assert.equal(env.acquisition.acquire(), newRequest);
  nextNative.resolve(nativeToken('current-native'));
  assert.equal(await newRequest, 'expo');
  assert.deepEqual(env.exchanges, ['current-native']);
  assert.equal(env.clock.timers.size, 0);
});

test('Expo timeout is diagnosed by stage and a fresh request can recover', async () => {
  const delayedExpo = deferred();
  let calls = 0;
  const env = harness({ expo: () => (++calls === 1 ? delayedExpo.promise : Promise.resolve('recovered-expo')) });
  const pending = env.acquisition.acquire();
  const rejected = assert.rejects(pending);
  await settle();
  env.clock.expire();
  await rejected;
  assert.deepEqual(env.diagnostics, [{ stage: 'expo', code: 'PUSH_TOKEN_TIMEOUT', reason: 'TIMEOUT' }]);
  assert.equal(await env.acquisition.acquire(), 'recovered-expo');
  delayedExpo.resolve('obsolete-expo');
  await settle();
  assert.equal(env.clock.timers.size, 0);
});

test('diagnostics exclude unknown error codes, raw native tokens, credentials and server bodies', async () => {
  const sensitive = 'secret-must-never-be-logged';
  const env = harness({ expo: async () => { throw Object.assign(new Error(`response body ${sensitive} FIS_AUTH_ERROR`), { code: sensitive }); } });
  await assert.rejects(env.acquisition.acquire(), error => error.message === 'Push token acquisition failed');
  assert.deepEqual(env.diagnostics, [{ stage: 'expo', code: 'UNKNOWN', reason: 'FIS_AUTH_ERROR' }]);
  assert.equal(JSON.stringify(env.diagnostics).includes(sensitive), false);
});

test('TLS and DNS failures are classified without logging SDK exception messages', async () => {
  for (const reason of ['SSLHandshakeException', 'UnknownHostException']) {
    const env = harness({ native: async () => { throw Object.assign(new Error(`java.net.${reason}: secret-host-and-response`), { code: 'E_REGISTRATION_FAILED' }); } });
    await assert.rejects(env.acquisition.acquire());
    assert.deepEqual(env.diagnostics, [{ stage: 'native', code: 'E_REGISTRATION_FAILED', reason }]);
    assert.equal(JSON.stringify(env.diagnostics).includes('secret-host-and-response'), false);
  }
});

test('root lifecycle uses fresh Android bridge requests and repeated native emissions register only once', async () => {
  const clock = timerHarness();
  const tokenModule = loadSource('src/services/push/token.ts', {}, clock);
  const registrationModule = loadSource('src/services/push/registration.ts');
  let listener, cleanup, nativeCalls = 0, registrations = 0, native = 'first-native';
  const exchanged = [], diagnostics = [];
  const noop = () => {};
  const notifications = {
    AndroidImportance: { HIGH: 4 }, AndroidNotificationVisibility: { PRIVATE: 0 },
    setNotificationHandler: noop, setNotificationChannelAsync: async () => {},
    getPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
    getDevicePushTokenAsync: () => { throw new Error('SDK 52 cached wrapper must not be called on Android'); },
    getExpoPushTokenAsync: async options => {
      assert.equal(options.projectId, 'test-project');
      assert.equal(options.devicePushToken.type, 'android');
      exchanged.push(options.devicePushToken.data);
      return { data: 'test-expo' };
    },
    addPushTokenListener: callback => { listener = callback; return { remove: noop }; },
    addNotificationsDroppedListener: () => ({ remove: noop }),
  };
  const push = loadSource('src/services/push/index.ts', {
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) } },
    react: { useEffect: effect => { cleanup = effect(); }, useCallback: fn => fn, useRef: value => ({ current: value }), useState: value => [value, noop] },
    axios: { post: async () => { registrations += 1; }, delete: async () => {} },
    'expo-device': { isDevice: false }, 'expo-notifications': notifications,
    'expo-secure-store': { getItemAsync: async () => null, setItemAsync: async () => {} },
    'expo-constants': { expoConfig: { extra: { eas: { projectId: 'test-project' } }, version: '0.2.1' }, appOwnership: 'standalone' },
    'expo-modules-core': { requireNativeModule: name => {
      assert.equal(name, 'ExpoPushTokenManager');
      return { getDevicePushTokenAsync: async () => {
        nativeCalls += 1;
        if (nativeCalls === 1) throw Object.assign(new Error('synthetic FCM first-start failure'), { code: 'E_REGISTRATION_FAILED' });
        listener({ type: 'android', data: native });
        return native;
      } };
    } },
    '@/config/env': { API_BASE: 'http://test.local/api' },
    '@/store/auth': { useAuth: { getState: () => ({ user: { id: 'test-user' }, accessToken: 'test-credential' }), subscribe: () => noop } },
    '@/store/notifications': {}, '@/lib/queryClient': {}, '@/lib/sound': {}, '@/utils/format': {},
    './registration': registrationModule, './token': tokenModule, './events': {},
  }, { ...clock, console: { warn: (label, diagnostic) => { diagnostics.push({ ...diagnostic }); } } });
  push.usePushNotificationLifecycle();
  await settle();
  assert.equal(nativeCalls, 1);
  assert.equal(registrations, 0);
  assert.deepEqual(diagnostics, [{ stage: 'native', code: 'E_REGISTRATION_FAILED' }]);
  clock.expire(); // existing lifecycle backoff retries the failed attempt
  await settle();
  assert.equal(nativeCalls, 2);
  assert.equal(registrations, 1);
  assert.deepEqual(exchanged, ['first-native']);
  listener({ type: 'android', data: native });
  await settle();
  assert.equal(registrations, 1);
  native = 'rotated-native';
  listener({ type: 'android', data: native });
  await settle();
  assert.equal(nativeCalls, 3);
  assert.equal(registrations, 2);
  assert.deepEqual(exchanged, ['first-native', 'rotated-native']);
  assert.equal(clock.timers.size, 0);
  cleanup();
});
