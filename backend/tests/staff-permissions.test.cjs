require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Reflector } = require('@nestjs/core');
const { validate } = require('class-validator');
const { plainToInstance } = require('class-transformer');
const { randomUUID } = require('node:crypto');
const { CreateStaffDto } = require('../src/admin/dto.ts');
const { CatalogController } = require('../src/admin/catalog.controller.ts');
const { StaffController } = require('../src/admin/staff.controller.ts');
const { TablesController } = require('../src/tables/tables.controller.ts');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
const { getDefaultPermissionsByRole, resolvePermissions } = require('../src/common/permissions.ts');
const { SettingsController } = require('../src/settings/settings.controller.ts');
const { OrdersController } = require('../src/orders/orders.controller.ts');
const { ReceiptPrintsController } = require('../src/receipt-prints/receipt-prints.controller.ts');
const { StaffShiftsController } = require('../src/waiter-shifts/staff-shifts.controller.ts');
const { canManagePosition } = require('../src/admin/staff-access.ts');

const guard = new PermissionsGuard(new Reflector());
function context(controller, method, permissions, requestMethod = 'GET') {
  return { getHandler: () => controller.prototype[method], getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ method: requestMethod, user: { role: 'ADMIN', permissions } }) }) };
}

test('view-only sections remain readable but reject direct writes and preserve independent work time', () => {
  const raw = getDefaultPermissionsByRole('ADMIN');
  raw.sections.settings = true;
  raw.actions.manageStaff = true;
  raw.readOnlySections = ['orders', 'tables', 'settings', 'staff', 'checks', 'warehouse'];
  const permissions = resolvePermissions('ADMIN', raw);
  assert.equal(permissions.actions.warehouseCosts, true);
  assert.equal(permissions.actions.warehouseReceive, false);
  assert.equal(permissions.actions.manageStaff, false);
  for (const [controller, read, write] of [[SettingsController, 'get', 'update'],
    [CatalogController, 'halls', 'createHall'], [StaffController, 'list', 'setCashHanded'],
    [OrdersController, 'findOne', 'cancel']]) {
    assert.equal(guard.canActivate(context(controller, read, permissions)), true);
    assert.throws(() => guard.canActivate(context(controller, write, permissions, 'POST')), { status: 403 });
  }
  const actor = { role: 'ADMIN', permissions };
  const prints = new ReceiptPrintsController({
    listPending: () => [],
    approve: () => assert.fail('view-only manager tried to approve a receipt'),
  });
  assert.deepEqual(prints.list(actor), []);
  assert.throws(() => prints.approve(actor, 'request'), { status: 403 });
  assert.equal(guard.canActivate(context(StaffShiftsController, 'start', permissions, 'POST')), true);
  assert.equal(resolvePermissions('OWNER', raw).readOnlySections, undefined);
});

test('manager with view-only warehouse cannot grant a position full warehouse access', () => {
  const actorPermissions = getDefaultPermissionsByRole('ADMIN');
  actorPermissions.actions.manageStaff = true;
  actorPermissions.readOnlySections = ['warehouse'];
  const child = getDefaultPermissionsByRole('KITCHEN');
  child.sections.warehouse = true;
  const actor = { role: 'ADMIN', permissions: actorPermissions };
  assert.equal(canManagePosition(actor, { role: 'KITCHEN', permissions: child }), false);
  child.readOnlySections = ['warehouse'];
  assert.equal(canManagePosition(actor, { role: 'KITCHEN', permissions: child }), true);
});

test('staff DTO accepts a concrete position without a separately chosen role', async () => {
  const dto = plainToInstance(CreateStaffDto, { name: 'Сотрудник', phone: '+996700111222', password: 'password', positionId: randomUUID() });
  assert.deepEqual(await validate(dto), []);
});

test('legacy menu writes honor editMenu while menu browsing remains available', () => {
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.actions.editMenu = false;
  for (const method of ['createCategory', 'reorderCategories', 'moveCategoryDishes', 'updateCategory', 'deleteCategory',
    'createDish', 'updateDish', 'deleteDish', 'createSet', 'updateSet', 'deleteSet']) {
    assert.throws(() => guard.canActivate(context(CatalogController, method, permissions)), { status: 403 }, method);
  }
  assert.equal(guard.canActivate(context(CatalogController, 'categories', permissions)), true);
});

test('staff writes require their action and the parent section together', () => {
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.actions.manageStaff = false;
  permissions.actions.closeShift = false;
  for (const method of ['create', 'update', 'remove', 'positions', 'setCashHanded', 'updateShiftHistory', 'closeShiftHistory']) {
    assert.throws(() => guard.canActivate(context(StaffController, method, permissions)), { status: 403 }, method);
  }
  assert.equal(guard.canActivate(context(StaffController, 'list', permissions)), true);
  permissions.actions.closeShift = true;
  assert.equal(guard.canActivate(context(StaffController, 'setCashHanded', permissions)), true);
  assert.equal(guard.canActivate(context(StaffController, 'closeShiftHistory', permissions)), true);
  assert.throws(() => guard.canActivate(context(StaffController, 'updateShiftHistory', permissions)), { status: 403 });
  permissions.actions.manageStaff = true;
  assert.equal(guard.canActivate(context(StaffController, 'create', permissions)), true);
  permissions.sections.staff = false;
  assert.throws(() => guard.canActivate(context(StaffController, 'create', permissions)), { status: 403 });
});

test('direct table mutations honor the table section permission', () => {
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.sections.tables = false;
  for (const method of ['close', 'move', 'transfer']) {
    assert.throws(() => guard.canActivate(context(TablesController, method, permissions)), { status: 403 }, method);
  }
});
