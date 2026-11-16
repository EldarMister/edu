require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { CashShiftsService, CashShiftsModule } = require('../src/cash-shifts/cash-shifts.module.ts');
const { resolvePermissions } = require('../src/common/permissions.ts');
const { currentPayrollMonth } = require('../src/finance/payroll.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: finance full/view/limited access follows positions without granting employee-permission management', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const cafe = await db.cafe.create({ data: { name: 'Finance access ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    const [owner, admin, worker] = await Promise.all(['OWNER', 'ADMIN', 'WAITER'].map((role) => db.user.create({
      data: { cafeId, name: role, role, phone: randomUUID(), passwordHash: 'fixture' },
    })));
    const full = { ...admin, permissions: resolvePermissions('ADMIN', { sections: { finance: true } }) };
    const viewer = { ...admin, permissions: resolvePermissions('ADMIN', { sections: { finance: true }, readOnlySections: ['finance'] }) };
    const finance = new FinanceService(db, { log: async () => {} });
    const month = currentPayrollMonth();
    assert.equal((await finance.access(full)).level, 'full');
    assert.equal((await finance.access(viewer)).level, 'view');
    assert.equal((await finance.access(admin)).level, 'none');
    const account = await finance.createAccount(full, { name: 'Bank', type: 'noncash', openingBalance: 1000 });
    const second = await finance.createAccount(full, { name: 'Reserve', type: 'noncash' });
    const category = await finance.createCategory(full, { name: 'Expenses', kind: 'both' });
    await finance.updateCategory(full, category.id, { name: 'Operations' });
    await assert.rejects(async () => finance.updateCategory(full, category.id, { userIds: [admin.id] }), { status: 403 });
    await assert.rejects(async () => finance.createCategory(full, { name: 'Forbidden grant', kind: 'expense', userIds: [admin.id] }), { status: 403 });
    const income = await finance.post(full, { requestKey: randomUUID(), kind: 'income', accountId: account.id, amount: 50 });
    await finance.updateTransaction(full, income.id, { note: 'Allowed' });
    await finance.editTransaction(full, income.id, { kind: 'income', amount: 60, accountId: account.id, occurredAt: income.occurredAt.toISOString(), note: 'Edited' });
    await finance.post(full, { requestKey: randomUUID(), kind: 'transfer', accountId: account.id, destinationAccountId: second.id, amount: 10 });
    const accrual = await finance.accrue(full, { userId: worker.id, month, amount: 200, requestKey: randomUUID() });
    const payment = await finance.paySalary(full, accrual.id, { accountId: account.id, amount: 50, requestKey: randomUUID() });
    const overview = await finance.overview(viewer, {});
    assert.equal(overview.canViewAll, true);
    assert.equal(overview.canManage, false);
    assert.equal(overview.canEditPermissions, false);
    assert.ok(overview.accounts.every(({ balance }) => typeof balance === 'number'));
    assert.ok(overview.flow);
    assert.ok(overview.entries.every(({ editable, detailsEditable, reversible }) => !editable && !detailsEditable && !reversible));
    assert.equal((await finance.payroll(viewer, { month })).staff.find(({ userId }) => userId === worker.id).due, 150);
    assert.equal((await finance.salaryDetails(viewer, accrual.id)).paidAmount, 50);
    await finance.trashedAccounts(viewer);
    await finance.categoryRemoval(viewer, category.id);

    const denied = [
      () => finance.createAccount(viewer, { name: 'Denied', type: 'cash' }),
      () => finance.updateAccount(viewer, account.id, { openingBalance: 0 }),
      () => finance.archiveAccount(viewer, account.id), () => finance.restoreAccount(viewer, account.id),
      () => finance.createCategory(viewer, { name: 'Denied', kind: 'both' }),
      () => finance.updateCategory(viewer, category.id, { name: 'Denied' }), () => finance.deleteCategory(viewer, category.id),
      () => finance.post(viewer, { requestKey: randomUUID(), kind: 'expense', accountId: account.id, categoryId: category.id, amount: 1 }),
      () => finance.updateTransaction(viewer, income.id, { note: 'Denied' }),
      () => finance.editTransaction(viewer, income.id, { amount: 1, accountId: account.id, occurredAt: income.occurredAt.toISOString() }),
      () => finance.reverseTransaction(viewer, income.id, 'Denied'),
      () => finance.accrueCalculated(viewer, { userId: worker.id, month, requestKey: randomUUID() }),
      () => finance.accrue(viewer, { userId: worker.id, month, amount: 1, requestKey: randomUUID() }),
      () => finance.paySalary(viewer, accrual.id, { accountId: account.id, amount: 1, requestKey: randomUUID() }),
      () => finance.editSalary(viewer, accrual.id, { amount: 201, reason: 'Denied', revision: 0, requestKey: randomUUID() }),
      () => finance.editSalary(viewer, accrual.id, { reason: 'Denied', revision: 0, requestKey: randomUUID() }, true),
      () => finance.reverseSalary(viewer, accrual.id, payment.id, 'Denied'),
    ];
    const count = await db.financeEntry.count({ where: { cafeId } });
    for (const operation of denied) await assert.rejects(async () => operation(), { status: 403 });
    assert.equal(await db.financeEntry.count({ where: { cafeId } }), count);

    // Old category grants retain only the employee's own transactions and no balances or salary reports.
    await finance.updateCategory(owner, category.id, { userIds: [admin.id] });
    assert.equal((await finance.access(admin)).level, 'limited');
    const own = await finance.post(admin, { requestKey: randomUUID(), kind: 'expense', accountId: account.id, categoryId: category.id, amount: 2 });
    const limited = await finance.overview(admin, {});
    assert.equal(limited.canViewAll, false);
    assert.ok(limited.accounts.every(({ balance }) => balance === null));
    assert.deepEqual(limited.entries.map(({ id }) => id), [own.id]);
    await assert.rejects(finance.payroll(admin, { month }), { status: 403 });
    await assert.rejects(finance.post(admin, { requestKey: randomUUID(), kind: 'expense', accountId: account.id, amount: 1 }), { status: 403 });

    // A cashier role with independent admin access may be delegated a category too.
    await db.user.update({ where: { id: worker.id }, data: { permissions: { adminAccess: true } } });
    await finance.updateCategory(owner, category.id, { userIds: [admin.id, worker.id] });
    assert.ok((await finance.overview(owner, {})).employees.find(({ id }) => id === worker.id).adminAccess);
    await finance.reverseSalary(full, accrual.id, payment.id, 'Incorrect payment');
    await finance.editSalary(full, accrual.id, { amount: 210, reason: 'Correction', revision: 0, requestKey: randomUUID() });
    await finance.editSalary(full, accrual.id, { reason: 'Cancellation', revision: 1, requestKey: randomUUID() }, true);
    await finance.reverseTransaction(full, income.id, 'Incorrect income');
    assert.equal((await finance.salaryDetails(viewer, accrual.id)).paidAmount, 0);
    const shifts = new CashShiftsService(db, { log: async () => {} }, { emitToWaiter() {}, emitToAdmin() {} });
    const CashController = Reflect.getMetadata('controllers', CashShiftsModule)[0];
    const cash = new CashController(shifts);
    await shifts.setting(cafeId, true);
    await db.user.update({ where: { id: admin.id }, data: { permissions: full.permissions } });
    const shift = await cash.open({ ...full, workspace: 'admin' }, { amount: 100 });
    assert.equal((await cash.list(viewer, {})).current.id, shift.id);
    await assert.rejects(async () => cash.close(viewer, { shiftId: shift.id, amount: 100, expectedAmount: 100 }), { status: 403 });
    await cash.close(full, { shiftId: shift.id, amount: 100, expectedAmount: 100 });
    // The service's database recheck also honors finance readonly, even with the legacy action present.
    await db.user.update({ where: { id: admin.id }, data: { permissions: {
      ...viewer.permissions, terminalAccess: true, actions: { ...viewer.permissions.actions, financeCashShifts: true },
    } } });
    await assert.rejects(shifts.open(cafeId, admin.id, 100, 'admin'), { status: 403 });
    const terminalShift = await shifts.open(cafeId, admin.id, 100, 'terminal');
    assert.ok(terminalShift.id);
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.settings.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
