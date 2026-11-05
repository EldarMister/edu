const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/order-permissions.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exportsBag = {};
vm.runInNewContext(code, { exports: exportsBag });
const { DEFAULT_WAITER_PERMISSIONS, waiterItemPermission, waiterOrderPermission, itemPermissionStage } = exportsBag;
const policy = () => JSON.parse(JSON.stringify(DEFAULT_WAITER_PERMISSIONS));
const order = (items, status = 'partially_ready') => ({ status, items, payments: [] });

test('editing and cancellation are independent for each dish stage', () => {
  const rules = policy(); rules.cooking = { cancel: false, edit: true };
  const item = { status: 'cooking' }; const current = order([item]);
  assert.equal(waiterItemPermission(current, item, 'edit', rules).allowed, true);
  assert.equal(waiterItemPermission(current, item, 'cancel', rules).allowed, false);
  assert.match(waiterItemPermission(current, item, 'cancel', rules).reason, /Готовится/);
});

test('one forbidden active dish prevents whole cancellation while allowed dishes stay individually cancellable', () => {
  const rules = policy(); rules.cooking.cancel = false;
  const current = order([{ status: 'new' }, { status: 'cooking' }, { status: 'cancelled' }]);
  assert.equal(waiterOrderPermission(current, 'cancel', rules).allowed, false);
  assert.equal(waiterItemPermission(current, current.items[0], 'cancel', rules).allowed, true);
  current.items[1].status = 'cancelled';
  assert.equal(waiterOrderPermission(current, 'cancel', rules).allowed, true);
});

test('fresh settings take effect without recreating the order and preparation is per item', () => {
  const rules = policy(); const current = order([{ status: 'ready' }, { status: 'new' }]);
  assert.equal(waiterItemPermission(current, current.items[0], 'cancel', rules).allowed, false);
  assert.equal(waiterItemPermission(current, current.items[1], 'cancel', rules).allowed, true);
  rules.ready.cancel = true;
  assert.equal(waiterOrderPermission(current, 'cancel', rules).allowed, true);
});

test('payment restrictions remain independent of all enabled cooking permissions', () => {
  const rules = policy(); for (const stage of Object.values(rules)) { stage.cancel = true; stage.edit = true; }
  for (const current of [{ ...order([{ status: 'ready' }]), payments: [{ amount: '10.00' }] }, order([{ status: 'new' }], 'paid')]) {
    assert.equal(waiterOrderPermission(current, 'cancel', rules).allowed, false);
    assert.equal(waiterOrderPermission(current, 'edit', rules).allowed, false);
    assert.match(waiterOrderPermission(current, 'edit', rules).reason, /возврат/);
  }
});

test('pickup stage applies only to ready or served dishes; newly added dishes retain initial stage', () => {
  const current = order([{ status: 'ready' }, { status: 'new' }], 'picked_up');
  assert.equal(itemPermissionStage(current, current.items[0]), 'picked_up');
  assert.equal(itemPermissionStage(current, current.items[1]), 'sent_to_kitchen');
});

test('cancelled/rejected positions and empty orders never offer operations', () => {
  for (const status of ['cancelled', 'rejected']) {
    const current = order([{ status }]);
    assert.equal(waiterItemPermission(current, current.items[0], 'edit').allowed, false);
    assert.equal(waiterOrderPermission(current, 'cancel').allowed, false);
  }
  assert.equal(waiterOrderPermission(order([]), 'edit').allowed, false);
});
