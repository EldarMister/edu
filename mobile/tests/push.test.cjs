const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function source(name) {
  const filename = path.join(__dirname, '../src/services/push', name);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return compiled.exports;
}

const { PushRegistrationManager } = source('registration.ts');
const { NotificationDeduper, notificationTarget, notificationData } = source('events.ts');
const oldSession = { userId: 'waiter-a', accessToken: 'jwt-a' };
function fixture(overrides = {}) {
  const state = { session: oldSession, saved: null, token: 'ExpoPushToken[old]', registered: [], removed: [] };
  const adapter = {
    session: () => state.session,
    available: () => 'supported',
    permission: async () => 'granted',
    token: async () => state.token,
    load: async () => state.saved && structuredClone(state.saved),
    save: async (value) => { state.saved = structuredClone(value); },
    deviceId: () => 'installation-a',
    register: async (binding, id) => { state.registered.push({ ...binding, id }); },
    unregister: async (binding) => { state.removed.push({ ...binding }); },
    ...overrides,
  };
  return { state, adapter, manager: new PushRegistrationManager(adapter) };
}

test('permission granted is not subscribed when backend registration fails', async () => {
  const f = fixture({ register: async () => { throw new Error('offline'); } });
  assert.equal(await f.manager.reconcile(), 'error');
  assert.equal(f.manager.hasRegisteredBinding, false);
});

test('physical-device/project availability is checked before token acquisition', async () => {
  const f = fixture({ available: () => 'unavailable', token: () => { throw new Error('must not run'); } });
  assert.equal(await f.manager.reconcile(true), 'unavailable');
  assert.equal(f.state.registered.length, 0);
});

test('offline logout persists revocation and a restarted process retries with old credentials', async () => {
  const f = fixture();
  assert.equal(await f.manager.reconcile(), 'subscribed');
  f.adapter.unregister = async () => { throw new Error('offline'); };
  const cleanup = f.manager.unregister();
  f.state.session = null;
  await cleanup;
  assert.equal(f.state.saved.binding, null);
  assert.equal(f.state.saved.pending[0].accessToken, 'jwt-a');
  f.adapter.unregister = async (binding) => { f.state.removed.push(binding); };
  const restarted = new PushRegistrationManager(f.adapter);
  await restarted.reconcile();
  assert.deepEqual(f.state.removed[0], { ...oldSession, pushToken: 'ExpoPushToken[old]' });
  assert.equal(f.state.saved.pending.length, 0);
});

test('account switch does not use the new account JWT to unregister the old account', async () => {
  const f = fixture();
  await f.manager.reconcile();
  f.state.session = { userId: 'bar-b', accessToken: 'jwt-b' };
  await f.manager.reconcile();
  assert.equal(f.state.removed[0].accessToken, 'jwt-a');
  assert.equal(f.state.saved.binding.userId, 'bar-b');
  assert.equal(f.state.registered[1].accessToken, 'jwt-b');
});

test('logout during token acquisition prevents server registration', async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => { started = resolve; });
  const f = fixture({ token: () => { started(); return new Promise((resolve) => { release = resolve; }); } });
  const registration = f.manager.reconcile();
  await gate;
  const cleanup = f.manager.unregister();
  f.state.session = null;
  release('ExpoPushToken[late]');
  await Promise.all([registration, cleanup]);
  assert.equal(f.state.registered.length, 0);
});

test('logout during server registration immediately queues captured-owner cleanup', async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => { started = resolve; });
  const f = fixture({ register: () => { started(); return new Promise((resolve) => { release = resolve; }); } });
  const registration = f.manager.reconcile();
  await gate;
  const cleanup = f.manager.unregister();
  f.state.session = null;
  release();
  await Promise.all([registration, cleanup]);
  assert.equal(f.state.removed[0].userId, oldSession.userId);
  assert.equal(f.state.saved.binding, null);
});

test('rotated token replaces the previous binding on the same installation', async () => {
  const f = fixture();
  await f.manager.reconcile();
  f.state.token = 'ExpoPushToken[new]';
  await f.manager.reconcile();
  assert.equal(f.state.saved.binding.pushToken, 'ExpoPushToken[new]');
  assert.equal(f.state.registered[0].id, f.state.registered[1].id);
});

test('revoking OS permission removes a persisted registration', async () => {
  const f = fixture();
  await f.manager.reconcile();
  f.adapter.permission = async () => 'denied';
  assert.equal(await f.manager.reconcile(), 'denied');
  assert.equal(f.state.saved.binding, null);
  assert.equal(f.state.removed.length, 1);
});

test('push/socket duplicates are suppressed in either order without suppressing distinct IDs', () => {
  let now = 100;
  const dedup = new NotificationDeduper(() => now);
  const event = { notificationId: 'one', orderId: 'order-a', type: 'success' };
  assert.equal(dedup.claim(event, 'Готов'), true);
  assert.equal(dedup.claim(event, 'Готов'), false);
  assert.equal(dedup.claim({ ...event, notificationId: 'two' }, 'Готов'), true);
  assert.equal(dedup.claim({ orderId: 'order-a', type: 'success' }, 'Готов'), false);
  now += 5_001;
  assert.equal(dedup.claim({ orderId: 'order-a', type: 'success' }, 'Готов'), true);
  dedup.clear();
  assert.equal(dedup.claim(event, 'Готов'), true);
});

test('SDK 52 raw Android handler dataString preserves socket identity in either arrival order', () => {
  const body = 'Проверка настоящего удалённого уведомления';
  const payload = { notificationId: 'qa:foreground:event', orderId: 'order-a', type: 'info', recipientUserId: 'waiter-a', url: '/waiter' };
  // NotificationSerializer produces dataString. NotificationsHandler forwards it
  // raw, whereas response listeners map it to content.data before callbacks.
  const rawHandlerContent = { body, dataString: JSON.stringify(payload) };
  const mappedResponseContent = { body, data: payload };
  assert.deepEqual(notificationData(rawHandlerContent), payload);
  assert.deepEqual(notificationData(mappedResponseContent), payload);
  for (const pushFirst of [true, false]) {
    const dedup = new NotificationDeduper();
    const incoming = pushFirst ? [notificationData(rawHandlerContent), payload] : [payload, notificationData(rawHandlerContent)];
    assert.equal(incoming.filter((data) => dedup.claim(data, body)).length, 1, 'One history entry/toast/sound for the two transports');
    assert.equal(dedup.claim({ ...payload, notificationId: 'qa:foreground:next-event' }, body), true, 'Later equal text with another ID remains distinct');
  }
  assert.deepEqual(notificationTarget(notificationData(rawHandlerContent), 'waiter-a', 'WAITER'), { kind: 'waiter-order', orderId: 'order-a' });
  assert.equal(notificationTarget(notificationData(rawHandlerContent), 'waiter-b', 'WAITER'), null, 'Raw foreground metadata retains recipient isolation');
});

test('malformed or non-object native notification data falls back safely', () => {
  const data = { notificationId: 'mapped', orderId: 'order-a' };
  assert.deepEqual(notificationData({ dataString: '{broken', data }), data);
  assert.deepEqual(notificationData({ dataString: 'null', data }), data);
  assert.deepEqual(notificationData({ dataString: '[]' }), {});
  assert.deepEqual(notificationData({ data: null }), {});
});

test('notification taps are role/account scoped and accept only internal destinations', () => {
  assert.deepEqual(notificationTarget({ orderId: 'order-a', url: '/waiter', recipientUserId: 'waiter-a' }, 'waiter-a', 'WAITER'), { kind: 'waiter-order', orderId: 'order-a' });
  assert.equal(notificationTarget({ url: '/waiter', recipientUserId: 'waiter-b' }, 'waiter-a', 'WAITER'), null);
  assert.equal(notificationTarget({ url: '/admin/orders' }, 'waiter-a', 'WAITER'), null);
  assert.equal(notificationTarget({ url: 'https://example.com' }, 'waiter-a', 'WAITER'), null);
  assert.equal(notificationTarget({ url: '//example.com' }, 'waiter-a', 'WAITER'), null);
  assert.equal(notificationTarget({ kind: 'sound-test' }, 'waiter-a', 'WAITER'), null);
  assert.deepEqual(notificationTarget({ url: '/admin/receipts' }, 'admin-a', 'ADMIN'), { kind: 'admin-receipts', orderId: undefined });
});
