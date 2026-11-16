require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CashShiftsModule } = require('../src/cash-shifts/cash-shifts.module.ts');
const { resolvePermissions } = require('../src/common/permissions.ts');
const { projectWorkspaceUser } = require('../src/common/workspace-access.ts');
const Controller = Reflect.getMetadata('controllers', CashShiftsModule)[0];
const identity = { id: 'actor', role: 'ADMIN', cafeId: 'cafe', name: 'Actor', phone: '0' };

test('cash shift admin finance view overrides cashier actions, while the terminal permission remains independent', async () => {
  let calls = 0;
  const controller = new Controller(new Proxy({}, { get: () => () => { calls++; return {}; } }));
  const actor = (level, action = false) => ({ ...identity, workspace: 'admin', permissions: resolvePermissions('ADMIN', {
    terminalAccess: true, sections: { finance: level !== 'none' },
    readOnlySections: level === 'view' ? ['finance'] : [], actions: { financeCashShifts: action },
  }) });
  const reads = [
    (user) => controller.list(user, {}), (user) => controller.movements(user, 'shift'),
    (user) => controller.operationCategories(user),
  ];
  const writes = [
    (user) => controller.open(user, { amount: 10 }),
    (user) => controller.close(user, { shiftId: 'shift', amount: 10, expectedAmount: 10 }),
    (user) => controller.createOperation(user, 'shift', {}),
    (user) => controller.updateOperation(user, 'shift', 'entry', {}),
    (user) => controller.deleteOperation(user, 'shift', 'entry'),
    (user) => controller.correctCashCount(user, 'shift', { openingAmount: 10 }),
  ];
  for (const action of [false, true]) {
    const viewer = actor('view', action);
    for (const read of reads) read(viewer);
    const before = calls;
    for (const write of writes) await assert.rejects(async () => write(viewer), { status: 403 });
    assert.equal(calls, before);
  }
  for (const full of [actor('full'), actor('none', true)]) {
    for (const read of reads) read(full);
    for (const write of writes) write(full);
  }
  const terminal = projectWorkspaceUser(actor('view', true), 'terminal');
  assert.equal(terminal.role, 'WAITER');
  controller.open(terminal, { amount: 10 });
  controller.close(terminal, { shiftId: 'shift', amount: 10, expectedAmount: 10 });
  controller.createOperation(terminal, 'shift', {});
  for (const read of reads) await assert.rejects(async () => read(actor('none')), { status: 403 });
});
