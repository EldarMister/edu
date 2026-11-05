const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  } });
  return module.exports;
}
const policy = load('src/lib/order-permissions.ts');
const { orderToCartLines } = load('src/utils/orderCart.ts', { '@/lib/order-permissions': policy });
const dish = { id: 'tea', name: 'Чай', variants: [], price: '100', discountType: 'none', discountValue: '0' };
const item = (id, status = 'new', extra = {}) => ({ id, dishId: dish.id, status, quantity: 2, comment: 'Без сахара', ...extra });
const order = (items, extra = {}) => ({ id: 'order-1', status: 'cooking', items, payments: [], ...extra });
const plain = value => JSON.parse(JSON.stringify(value));

function cartHarness() {
  return load('src/store/cart.ts', {
    zustand: require('zustand'),
    '@/utils/format': { dishUnitPrice: price => Number(price) },
    '@/utils/set': { calcSetPrice: price => Number(price) },
  }).useCart;
}

test('mixed-stage orders expose edit if any item is editable but cancel only when every live item is allowed', () => {
  const mixed = order([item('cooking', 'cooking'), item('ready', 'ready'), item('cancelled', 'cancelled')]);
  assert.equal(policy.waiterOrderPermission(mixed, 'edit').allowed, true);
  assert.equal(policy.waiterOrderPermission(mixed, 'cancel').allowed, false);
  const granted = { ...policy.DEFAULT_WAITER_PERMISSIONS, ready: { edit: true, cancel: true } };
  assert.equal(policy.waiterOrderPermission(mixed, 'cancel', granted).allowed, true);
  assert.equal(policy.waiterOrderPermission({ ...mixed, payments: [{ amount: '25' }] }, 'edit', granted).allowed, false);
  assert.equal(policy.waiterOrderPermission({ ...mixed, payments: [{ amount: '25' }] }, 'cancel', granted).allowed, false);
});

test('picked-up and payment stages use owner policies instead of the old three editable statuses', () => {
  const policies = { ...policy.DEFAULT_WAITER_PERMISSIONS, picked_up: { edit: true, cancel: true }, waiting_payment: { edit: true, cancel: false } };
  assert.equal(policy.waiterOrderPermission(order([item('a', 'served')], { status: 'picked_up' }), 'edit', policies).allowed, true);
  const waiting = order([item('a', 'served')], { status: 'waiting_payment' });
  assert.equal(policy.waiterOrderPermission(waiting, 'edit', policies).allowed, true);
  assert.equal(policy.waiterOrderPermission(waiting, 'cancel', policies).allowed, false);
});

test('editing preserves separate same-dish identities, comments, and each stage restriction', () => {
  const lines = orderToCartLines(order([item('one', 'new'), item('two', 'ready')]), [dish]);
  assert.deepEqual(plain(lines.map(line => [line.orderItemId, line.lineId, line.comment, line.editAllowed, line.cancelAllowed])), [
    ['one', 'edit-one', 'Без сахара', true, true], ['two', 'edit-two', 'Без сахара', false, false],
  ]);
  const store = cartHarness();
  store.getState().replaceLines(lines);
  store.getState().add(dish);
  assert.deepEqual(plain(store.getState().lines.map(line => [line.orderItemId, line.quantity])), [['one', 2], ['two', 2], [undefined, 1]].map(row => row.map(value => value === undefined ? null : value)));
});

test('editing refuses a deleted live dish instead of silently cancelling it on save', () => {
  assert.equal(orderToCartLines(order([item('valid'), item('deleted', 'new', { dishId: 'missing' })]), [dish]).length, 0);
  assert.equal(orderToCartLines(order([item('valid'), item('deleted', 'cancelled', { dishId: 'missing' })]), [dish]).length, 1);
});

test('set edit preserves line identity, comment, quantity and customised components', () => {
  const set = { ...dish, isSet: true, setComponents: [{ id: 'def', dish, quantity: 1, removable: true, replaceable: false }] };
  const lines = orderToCartLines(order([item('set', 'new', { setComponents: [{ id: 'component', originalDishId: dish.id, originalNameSnapshot: dish.name, quantity: 1, action: 'removed' }] })]), [set]);
  assert.equal(lines[0].orderItemId, 'set');
  assert.equal(lines[0].comment, 'Без сахара');
  assert.equal(lines[0].set.components[0].action, 'removed');
});

test('cart store rejects forbidden decrease/removal/metadata changes, including bulk takeaway', () => {
  const store = cartHarness();
  store.getState().replaceLines([
    { dish, quantity: 2, editAllowed: false, cancelAllowed: false },
    { dish, quantity: 2, editAllowed: true, cancelAllowed: false },
  ]);
  store.getState().setQuantity(0, 3);
  store.getState().setQuantity(0, 0);
  store.getState().setComment(0, 'forbidden');
  store.getState().setTakeaway(0, true);
  store.getState().remove(0);
  store.getState().setQuantity(1, 1);
  store.getState().remove(1);
  store.getState().setAllTakeaway(true);
  assert.deepEqual(plain(store.getState().lines.map(line => [line.quantity, line.comment ?? null, line.takeaway ?? null])), [[2, null, null], [2, null, true]]);
  store.getState().setQuantity(1, 3);
  assert.equal(store.getState().lines[1].quantity, 3);
});

test('edit API submits original item ids, audit reason and explicitly cleared order comment', async () => {
  const calls = [];
  const api = load('src/services/api/waiter.ts', {
    '@tanstack/react-query': { useMutation: options => options, useQuery() {}, useQueryClient: () => ({}) },
    '@/lib/api': { api: { patch: async (url, body) => { calls.push({ url, body }); return { data: {} }; } } },
  });
  await api.useEditOrder().mutationFn({ orderId: 'order-1', comment: '  ', reason: 'Изменение состава заказа', lines: orderToCartLines(order([item('one'), item('two')]), [dish]) });
  assert.equal(calls[0].url, '/orders/order-1');
  assert.equal(calls[0].body.comment, '');
  assert.equal(calls[0].body.reason, 'Изменение состава заказа');
  assert.deepEqual(plain(calls[0].body.items.map(line => line.id)), ['one', 'two']);
});

test('switching tables restores edit mode and never submits edited lines as additions', () => {
  const store = cartHarness();
  const first = { id: 'table-a', number: 1 };
  const second = { id: 'table-b', number: 2 };
  store.getState().startEditing(first, { id: 'order-a', orderNumber: '1' }, orderToCartLines(order([item('one')]), [dish]));
  store.getState().selectTable(second);
  store.getState().add(dish);
  store.getState().selectTable(first, 'order-a');
  assert.equal(store.getState().editingOrderId, 'order-a');
  assert.equal(store.getState().lines[0].orderItemId, 'one');
  store.getState().selectTable(second);
  assert.equal(store.getState().editingOrderId, null);
  assert.equal(store.getState().lines.length, 1);
  store.getState().selectTable(first, 'different-order');
  assert.equal(store.getState().lines.length, 0);
  assert.equal(store.getState().editingOrderId, null);
});

test('draft transfer cannot move items already assigned to an order', () => {
  const store = cartHarness();
  store.getState().startEditing({ id: 'table-a', number: 1 }, { id: 'order-a', orderNumber: '1' }, orderToCartLines(order([item('one')]), [dish]));
  store.getState().moveDraftTo({ id: 'table-b', number: 2 });
  assert.equal(store.getState().tableId, 'table-a');
  assert.equal(store.getState().editingOrderId, 'order-a');
});

test('hidden draft comments stay hidden when switching tables and moving a draft', () => {
  const store = cartHarness();
  const first = { id: 'table-a', number: 1 };
  const second = { id: 'table-b', number: 2 };
  store.getState().selectTable(first);
  store.getState().setOrderComment('Не отправлять');
  store.getState().setCommentOpen(false);
  store.getState().selectTable(second);
  store.getState().selectTable(first);
  assert.equal(store.getState().comment, 'Не отправлять');
  assert.equal(store.getState().commentOpen, false);
  store.getState().moveDraftTo(second);
  assert.equal(store.getState().commentOpen, false);
});


test('submitted cart snapshot is locked synchronously and failure restores editing without data loss', () => {
  const store = cartHarness();
  store.getState().selectTable({ id: 'table-a', number: 1 });
  store.getState().add(dish);
  store.getState().setOrderComment('keep');
  const snapshot = store.getState().lines;
  assert.equal(store.getState().beginSubmission('table-a'), true);
  assert.equal(store.getState().beginSubmission('table-a'), false);
  store.getState().add(dish);
  store.getState().setQuantity(0, 3);
  store.getState().setOrderComment('replace');
  store.getState().clear();
  store.getState().moveDraftTo({ id: 'table-b', number: 2 });
  assert.equal(store.getState().tableId, 'table-a');
  assert.equal(store.getState().lines, snapshot);
  assert.equal(store.getState().comment, 'keep');
  store.getState().endSubmission('table-a', snapshot);
  store.getState().add(dish);
  assert.equal(store.getState().lines[0].quantity, 2);
});

test('successful table A submission does not clear the currently edited table B', () => {
  const store = cartHarness();
  store.getState().selectTable({ id: 'table-a', number: 1 });
  store.getState().add(dish);
  const submitted = store.getState().lines;
  store.getState().beginSubmission('table-a');
  store.getState().selectTable({ id: 'table-b', number: 2 });
  store.getState().add(dish);
  store.getState().setOrderComment('table B');
  const next = store.getState().lines;
  assert.equal(store.getState().completeSubmission('table-a', submitted, 'order-a'), true);
  store.getState().endSubmission('table-a', submitted);
  assert.equal(store.getState().tableId, 'table-b');
  assert.equal(store.getState().lines, next);
  assert.equal(store.getState().comment, 'table B');
  assert.equal(store.getState().carts['table-a'], undefined);
});

test('successful create keeps returned order identity for the next addition', () => {
  const store = cartHarness();
  store.getState().selectTable({ id: 'table-a', number: 1 });
  store.getState().add(dish);
  const snapshot = store.getState().lines;
  store.getState().beginSubmission('table-a');
  assert.equal(store.getState().completeSubmission('table-a', snapshot, 'new-order'), true);
  store.getState().endSubmission('table-a', snapshot);
  store.getState().add(dish);
  assert.equal(store.getState().activeOrderId, 'new-order');
  assert.equal(store.getState().lines.length, 1);
});

test('a previous session response cannot clear or unlock a new submission on the same table', () => {
  const store = cartHarness();
  const table = { id: 'table-a', number: 1 };
  store.getState().selectTable(table);
  store.getState().add(dish);
  const old = store.getState().lines;
  store.getState().beginSubmission(table.id);
  store.getState().resetAll();
  store.getState().selectTable(table);
  store.getState().add(dish);
  const current = store.getState().lines;
  store.getState().beginSubmission(table.id);
  assert.equal(store.getState().completeSubmission(table.id, old, 'old-order'), false);
  store.getState().endSubmission(table.id, old);
  assert.equal(store.getState().pendingTables[table.id], current);
  assert.equal(store.getState().lines, current);
  assert.equal(store.getState().activeOrderId, null);
});
