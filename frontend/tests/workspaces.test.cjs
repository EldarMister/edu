const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, requireMock = require) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', name), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: requireMock });
  return exports;
}
const { getDefaultPermissionsByRole, ...permissionExports } = load('permissions.ts');
const { accessForUser, canOpenWorkspace, homeForUser, workspaceForPath, workspacePermissions, workspaceRole } = load('workspaces.ts',
  (name) => name === './permissions' ? { getDefaultPermissionsByRole, ...permissionExports } : require(name));
const employee = (role, permissions, access) => ({ id: 'employee', name: 'Employee', phone: '+996700111222', role, permissions, access });

test('terminal and administration access are independent for every combination', () => {
  for (const terminalAccess of [false, true]) for (const adminAccess of [false, true]) {
    const permissions = getDefaultPermissionsByRole('ADMIN');
    permissions.terminalAccess = terminalAccess;
    permissions.adminAccess = adminAccess;
    const user = employee('ADMIN', permissions);
    assert.equal(canOpenWorkspace(user, 'terminal'), terminalAccess);
    assert.equal(canOpenWorkspace(user, 'admin'), adminAccess);
    assert.equal(canOpenWorkspace(user, 'warehouse'), adminAccess, 'stored warehouse rights alone do not enable administration');
    assert.equal(homeForUser(user), adminAccess ? '/admin' : terminalAccess ? '/waiter' : '/access-denied');
  }
  const revoked = employee('WAITER', undefined, { terminal: false, admin: false, production: null });
  assert.equal(canOpenWorkspace(revoked, 'terminal'), false, 'fresh server access overrides legacy role defaults');
  assert.equal(homeForUser(revoked), '/access-denied');
});

test('disabled or read-only administration sections do not disable an authorized terminal', () => {
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.terminalAccess = true;
  permissions.sections.orders = false;
  permissions.sections.menu = false;
  permissions.readOnlySections = ['staff', 'checks'];
  permissions.actions.financeCashShifts = true;
  const user = employee('ADMIN', permissions);
  const stored = JSON.stringify(user);
  const administration = workspacePermissions(user, 'admin');
  const terminal = workspacePermissions(user, 'terminal');
  assert.equal(administration.sections.orders, false);
  assert.ok(administration.readOnlySections.includes('staff'));
  assert.equal(terminal.sections.orders, true);
  assert.equal(terminal.sections.menu, true);
  assert.equal(terminal.sections.tables, true);
  assert.equal(terminal.sections.staff, false);
  assert.equal(terminal.sections.finance, false);
  assert.equal(terminal.actions.editMenu, false);
  assert.equal(terminal.actions.refundChecks, false);
  assert.equal(terminal.actions.financeCashShifts, true);
  assert.equal(terminal.readOnlySections, undefined);
  assert.equal(workspaceRole(user, 'terminal'), 'WAITER');
  assert.equal(JSON.stringify(user), stored, 'switching workspace cannot rewrite the account or its permissions');
});

test('owner terminal projection keeps cashier boundaries and preserves owner identity', () => {
  const user = employee('OWNER');
  assert.deepEqual({ ...accessForUser(user) }, { terminal: true, admin: true, production: null });
  assert.equal(workspaceRole(user, 'admin'), 'OWNER');
  assert.equal(workspaceRole(user, 'terminal'), 'WAITER');
  const terminal = workspacePermissions(user, 'terminal');
  for (const section of ['staff', 'settings', 'warehouse', 'finance', 'checks']) assert.equal(terminal.sections[section], false, section);
  assert.equal(terminal.actions.manageStaff, false);
  assert.equal(terminal.actions.financeCashShifts, true);
  assert.equal(terminal.actions.closeShift, true);
  assert.equal(user.role, 'OWNER');
  assert.equal(homeForUser(user), '/owner');
});

test('legacy sessions retain the original workplace defaults without capability fields', () => {
  const expected = {
    WAITER: { terminal: true, admin: false, production: null, home: '/waiter' },
    ADMIN: { terminal: false, admin: true, production: null, home: '/admin' },
    OWNER: { terminal: true, admin: true, production: null, home: '/owner' },
    KITCHEN: { terminal: false, admin: false, production: 'kitchen', home: '/kitchen' },
    BAR: { terminal: false, admin: false, production: 'bar', home: '/bar' },
  };
  for (const [role, { home, ...access }] of Object.entries(expected)) {
    const legacyPermissions = getDefaultPermissionsByRole(role);
    delete legacyPermissions.terminalAccess;
    delete legacyPermissions.adminAccess;
    for (const permissions of [undefined, legacyPermissions]) {
      const user = employee(role, permissions);
      assert.deepEqual({ ...accessForUser(user) }, access, role);
      assert.equal(homeForUser(user), home, role);
    }
  }
});

test('production keeps read-only warehouse access without granting the administration panel', () => {
  for (const role of ['KITCHEN', 'BAR']) {
    const permissions = getDefaultPermissionsByRole(role);
    permissions.sections.warehouse = true;
    permissions.readOnlySections = ['warehouse'];
    permissions.actions.warehouseReceive = true;
    permissions.actions.warehouseCosts = true;
    permissions.actions.financeCashShifts = true;
    const user = employee(role, permissions);
    assert.equal(canOpenWorkspace(user, 'admin'), false);
    assert.equal(canOpenWorkspace(user, 'terminal'), false);
    assert.equal(canOpenWorkspace(user, 'warehouse'), true);
    assert.equal(canOpenWorkspace(user, role === 'BAR' ? 'kitchen' : 'bar'), false);
    const production = workspacePermissions(user, 'production');
    assert.equal(production.sections.orders, true);
    assert.equal(production.sections.warehouse, true);
    assert.deepEqual(Array.from(production.readOnlySections), ['warehouse']);
    assert.equal(production.actions.warehouseReceive, false);
    assert.equal(production.actions.warehouseCosts, true);
    assert.equal(production.actions.financeCashShifts, false);
    assert.equal(production.sections.staff, false);
    assert.equal(workspaceRole(user, 'production'), role);
  }
});

test('request workspace follows the selected interface for mixed and production accounts', () => {
  const mixed = employee('ADMIN', { ...getDefaultPermissionsByRole('ADMIN'), terminalAccess: true });
  assert.equal(workspaceForPath('/waiter/history', mixed), 'terminal');
  assert.equal(workspaceForPath('/admin/staff', mixed), 'admin');
  assert.equal(workspaceForPath('/kitchen', mixed), 'admin');
  assert.equal(workspaceForPath('/warehouse', mixed), 'admin');
  const production = employee('BAR', { ...getDefaultPermissionsByRole('BAR'), adminAccess: true, terminalAccess: true });
  assert.equal(workspaceForPath('/bar', production), 'production');
  assert.equal(workspaceForPath('/warehouse/recipes', production), 'production');
  assert.equal(workspaceForPath('/admin/menu', production), 'admin');
  assert.equal(workspaceForPath('/waiter', production), 'terminal');
});
