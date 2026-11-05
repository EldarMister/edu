require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWaiterOrderPermissions, validateWaiterOrderPermissions, waiterItemStage, aggregateOrderStatus } = require('../src/orders/order-policy.ts');

test('default waiter policy retains existing early-stage permissions and independently validates cancel/edit', () => {
  const policy = normalizeWaiterOrderPermissions(null);
  assert.deepEqual(policy.cooking, { cancel: true, edit: true });
  assert.deepEqual(policy.ready, { cancel: false, edit: false });
  policy.cooking.cancel = false;
  assert.deepEqual(validateWaiterOrderPermissions(policy).cooking, { cancel: false, edit: true });
  assert.throws(() => validateWaiterOrderPermissions({ cooking: { cancel: true } }));
  assert.throws(() => validateWaiterOrderPermissions({ ...policy, paid: { cancel: true, edit: true } }));
});

test('mixed orders use each line stage; collection/payment stages override only appropriate lines', () => {
  assert.equal(waiterItemStage('cooking', 'ready'), 'ready');
  assert.equal(waiterItemStage('cooking', 'new'), 'sent_to_kitchen');
  assert.equal(waiterItemStage('picked_up', 'ready'), 'picked_up');
  assert.equal(waiterItemStage('picked_up', 'cooking'), 'cooking');
  assert.equal(waiterItemStage('waiting_payment', 'served'), 'waiting_payment');
});

test('readiness is aggregated across active positions without losing partial or cancelled state', () => {
  const state = (...statuses) => aggregateOrderStatus(statuses.map(status => ({ status })));
  assert.equal(state('ready', 'cooking', 'new'), 'cooking');
  assert.equal(state('served', 'ready', 'cancelled'), 'ready');
  assert.equal(state('served', 'served'), 'served');
  assert.equal(state('cancelled', 'rejected'), 'cancelled');
  assert.equal(state('rejected'), 'rejected');
});
