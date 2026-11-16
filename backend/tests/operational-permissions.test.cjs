require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Reflector } = require('@nestjs/core');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
const { getDefaultPermissionsByRole, resolvePermissions } = require('../src/common/permissions.ts');
const { KitchenController } = require('../src/kitchen/kitchen.controller.ts');
const { PaymentsController } = require('../src/payments/payments.controller.ts');

const guard = new PermissionsGuard(new Reflector());
function actor(role = 'ADMIN', change = () => {}) {
  const permissions = getDefaultPermissionsByRole(role);
  change(permissions);
  return { id: 'actor', cafeId: null, role, permissions: resolvePermissions(role, permissions) };
}
function kitchenAccess(method, user, requestMethod = 'POST') {
  return guard.canActivate({
    getClass: () => KitchenController,
    getHandler: () => KitchenController.prototype[method],
    switchToHttp: () => ({ getRequest: () => ({ user, method: requestMethod }) }),
  });
}

test('kitchen alternate order endpoints honor manager none/view/full access', () => {
  const denied = actor('ADMIN', (p) => { p.sections.orders = false; });
  const view = actor('ADMIN', (p) => { p.readOnlySections = ['orders']; });
  for (const method of ['list', 'statistics']) {
    assert.throws(() => kitchenAccess(method, denied, 'GET'), { status: 403 }, method);
    assert.equal(kitchenAccess(method, view, 'GET'), true);
  }
  for (const method of ['accept', 'ready', 'rejectOrder', 'rejectItem', 'readyItem', 'readyItems', 'rejectItems']) {
    assert.throws(() => kitchenAccess(method, denied), { status: 403 }, method);
    assert.throws(() => kitchenAccess(method, view), { status: 403 }, method);
    for (const role of ['ADMIN', 'OWNER', 'KITCHEN', 'BAR']) {
      assert.equal(kitchenAccess(method, actor(role)), true, `${role}:${method}`);
    }
  }
});

test('manager stop-list access follows menu permissions while production roles retain their workplace', async () => {
  let writes = 0;
  const controller = new KitchenController({ getStopList: () => [], updateStopList: () => { writes += 1; return []; } }, {}, {});
  const denied = actor('ADMIN', (p) => { p.sections.menu = false; });
  const view = actor('ADMIN', (p) => { p.readOnlySections = ['menu']; });
  const noAction = actor('ADMIN', (p) => { p.actions.editMenu = false; });
  await assert.rejects(controller.stopList(denied), { status: 403 });
  await assert.rejects(controller.updateStopList(denied, { items: [] }), { status: 403 });
  await assert.rejects(controller.updateStopList(view, { items: [] }), { status: 403 });
  await assert.rejects(controller.updateStopList(noAction, { items: [] }), { status: 403 });
  assert.equal(writes, 0);
  assert.deepEqual(await controller.stopList(view), []);
  for (const role of ['ADMIN', 'OWNER', 'KITCHEN', 'BAR']) {
    assert.deepEqual(await controller.updateStopList(actor(role), { items: [] }), []);
  }
  assert.equal(writes, 4);
});

test('direct manager payment requires writable orders and checks, receipt needs checks read only', () => {
  let writes = 0;
  const controller = new PaymentsController({ pay: () => { writes += 1; return 'paid'; }, receipt: () => 'receipt' });
  const dto = { orderId: 'order', method: 'cash' };
  for (const section of ['orders', 'checks']) {
    const denied = actor('ADMIN', (p) => { p.sections[section] = false; });
    const view = actor('ADMIN', (p) => { p.readOnlySections = [section]; });
    assert.throws(() => controller.pay(denied, dto), { status: 403 });
    assert.throws(() => controller.pay(view, dto), { status: 403 });
  }
  assert.equal(writes, 0);
  assert.throws(() => controller.receipt(actor('ADMIN', (p) => { p.sections.checks = false; }), 'order'), { status: 403 });
  assert.equal(controller.receipt(actor('ADMIN', (p) => { p.readOnlySections = ['checks']; }), 'order'), 'receipt');
  for (const role of ['ADMIN', 'OWNER', 'WAITER']) {
    assert.equal(controller.pay(actor(role), dto), 'paid');
    assert.equal(controller.receipt(actor(role), 'order'), 'receipt');
  }
  assert.equal(writes, 3);
});
