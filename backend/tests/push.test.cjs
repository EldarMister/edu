require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const { PushService } = require('../src/push/push.service.ts');

function fixture(devices = []) {
  const calls = { find: [], removed: [], upserts: [] };
  const prisma = {
    user: { findUnique: async () => ({ cafeId: 'cafe-a' }) },
    userDevice: {
      findMany: async (query) => { calls.find.push(query); return devices; },
      deleteMany: async (query) => { calls.removed.push(query); return { count: 1 }; },
      upsert: async (query) => { calls.upserts.push(query); },
    },
    $transaction: async (fn) => fn(prisma),
  };
  const service = new PushService(prisma);
  service.configured = false;
  return { service, calls };
}

test('Expo payload uses sound/channel/priority and individual user targeting, batches <=100', async (context) => {
  const devices = Array.from({ length: 205 }, (_, i) => ({ pushToken: `ExpoPushToken[token${i}]`, pushProvider: 'EXPO', userId: `user-${i}` }));
  const f = fixture(devices);
  const requests = [];
  context.mock.method(global, 'fetch', async (url, options) => {
    const messages = JSON.parse(options.body);
    requests.push(messages);
    return { ok: true, json: async () => ({ data: messages.map((_, i) => ({ status: 'ok', id: `${requests.length}-${i}` })) }) };
  });
  await f.service.notifyRole('KITCHEN', { title: 'Новый заказ', body: 'Заказ 1', orderId: 'order-a' }, 'cafe-a');
  assert.deepEqual(requests.map((request) => request.length), [100, 100, 5]);
  assert.equal(requests[0][0].sound, 'new_order.mp3');
  assert.equal(requests[0][0].channelId, 'kitchen_v3');
  assert.equal(requests[0][0].priority, 'high');
  assert.equal(requests[0][0].data.recipientUserId, 'user-0');
  assert.equal(requests[2][4].data.recipientUserId, 'user-204');
  assert.equal(typeof requests[0][0].data.notificationId, 'string');
  assert.equal(f.calls.find[0].where.user.cafeId, 'cafe-a');
});

test('Expo failed tickets and receipts remove only invalid push tokens', async (context) => {
  const f = fixture([{ pushToken: 'ExpoPushToken[dead]', pushProvider: 'EXPO', userId: 'user-a' }]);
  context.mock.method(global, 'fetch', async () => ({ ok: true, json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) }));
  await f.service.notifyUser('user-a', { title: 'Test', body: 'Test' });
  assert.deepEqual(f.calls.removed[0].where.pushToken.in, ['ExpoPushToken[dead]']);
  f.service.expoReceipts.set('receipt-a', { token: 'ExpoPushToken[expired]', at: Date.now() - 120_000 });
  global.fetch = async () => ({ ok: true, json: async () => ({ data: { 'receipt-a': { status: 'error', details: { error: 'DeviceNotRegistered' } } } }) });
  await f.service.checkExpoReceipts();
  assert.equal(f.calls.removed[1].where.pushToken, 'ExpoPushToken[expired]');
  assert.equal(f.service.expoReceipts.size, 0);
});

test('registration atomically clears rotated installation tokens and binds cafe/account', async () => {
  const f = fixture();
  await f.service.registerDevice('user-new', { pushToken: 'ExpoPushToken[new]', platform: 'android', deviceId: 'device-a' });
  assert.deepEqual(f.calls.removed[0].where, { deviceId: 'device-a', pushProvider: 'EXPO', pushToken: { not: 'ExpoPushToken[new]' } });
  assert.equal(f.calls.upserts[0].update.userId, 'user-new');
  assert.equal(f.calls.upserts[0].update.cafeId, 'cafe-a');
  await f.service.unregisterDevice('user-old', 'ExpoPushToken[new]');
  assert.deepEqual(f.calls.removed[1].where, { userId: 'user-old', pushToken: 'ExpoPushToken[new]' });
});

test('invalid Expo token is rejected before database registration', async () => {
  const f = fixture();
  await assert.rejects(() => f.service.registerDevice('user-a', { pushToken: 'invalid', platform: 'android' }));
  assert.equal(f.calls.upserts.length, 0);
});

test('temporary Expo send failure retries before accepting the ticket', async (context) => {
  const f = fixture([{ pushToken: 'ExpoPushToken[valid]', pushProvider: 'EXPO', userId: 'user-a' }]);
  let attempts = 0;
  context.mock.method(global, 'fetch', async () => {
    attempts++;
    return attempts === 1 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok', id: 'ticket-a' }] }) };
  });
  await f.service.notifyUser('user-a', { title: 'Test', body: 'Test' });
  assert.equal(attempts, 2);
  assert.equal(f.service.expoReceipts.has('ticket-a'), true);
});

test('station cancellation push uses the same suppression and event identity as realtime', () => {
  const { OrdersService } = require('../src/orders/orders.service.ts');
  const service = Object.create(OrdersService.prototype);
  const sent = [];
  const realtime = [];
  service.events = { emitToKitchen: (event, payload) => realtime.push(payload), emitToAdmin: () => {} };
  service.push = { notifyRole: (role, payload, cafeId) => { sent.push({ role, payload, cafeId }); return Promise.resolve(); } };
  service.emitStatusChanged({ id: 'order-a', orderNumber: '0001', status: 'cancelled', waiterId: null, cafeId: 'cafe-a', updatedAt: new Date('2026-10-10T17:00:00.000Z') }, { suppressStations: { bar: true } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].role, 'KITCHEN');
  assert.equal(sent[0].cafeId, 'cafe-a');
  assert.equal(sent[0].payload.notificationId, 'kitchen-status:order-a:2026-10-10T17:00:00.000Z:kitchen');
  assert.equal(sent[0].payload.body, realtime[0].voice.text);
});
