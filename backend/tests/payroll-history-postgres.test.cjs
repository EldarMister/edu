require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { syncEmployeeSalary } = require('../src/finance/employee-salary.ts');
const { currentPayrollMonth, payrollReport } = require('../src/finance/payroll.ts');
const { FinanceService } = require('../src/finance/finance.service.ts');

const databaseUrl = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || !new URL(databaseUrl).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('PostgreSQL: salary history survives reassignment and deletion, final settlement and bonuses stay separate', {
  skip: !databaseUrl,
}, async () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const cafe = await db.cafe.create({ data: { name: 'Payroll history ' + randomUUID() } });
  const cafeId = cafe.id;
  const currentMonth = currentPayrollMonth();
  const previous = new Date(currentMonth + '-01T00:00:00Z');
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  const previousMonth = previous.toISOString().slice(0, 7);
  try {
    const owner = await db.user.create({ data: { cafeId, name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'fixture' } });
    const oldPosition = await db.staffPosition.create({ data: { cafeId, name: 'Официант тест', role: 'WAITER', permissions: {} } });
    const newPosition = await db.staffPosition.create({ data: { cafeId, name: 'Старший официант', role: 'WAITER', permissions: {} } });
    for (const [positionId, hourly] of [[oldPosition.id, 100], [newPosition.id, 200]]) {
      await db.staffPositionSalaryRate.create({ data: { cafeId, positionId, effectiveDay: previousMonth + '-01', hourly } });
    }
    const worker = await db.user.create({ data: {
      cafeId, name: 'Сотрудник', role: 'WAITER', phone: randomUUID(), passwordHash: 'fixture', positionId: oldPosition.id,
    } });
    await syncEmployeeSalary(db, cafeId, [worker.id], previousMonth + '-01');
    for (const month of [previousMonth, currentMonth]) {
      await db.waiterShift.create({ data: {
        cafeId, waiterId: worker.id, status: 'closed',
        startedAt: new Date(month + '-01T10:00:00+06:00'), endedAt: new Date(month + '-01T12:00:00+06:00'),
      } });
    }
    await db.user.update({ where: { id: worker.id }, data: { positionId: newPosition.id, isActive: false } });
    await syncEmployeeSalary(db, cafeId, [worker.id], currentMonth + '-02');
    await db.waiterShift.create({ data: {
      cafeId, waiterId: worker.id, status: 'closed',
      startedAt: new Date(currentMonth + '-02T10:00:00+06:00'), endedAt: new Date(currentMonth + '-02T12:00:00+06:00'),
    } });
    await db.staffPosition.delete({ where: { id: oldPosition.id } });
    const oldReport = await payrollReport(db, cafeId, previousMonth);
    const oldRow = oldReport.staff.find(({ userId }) => userId === worker.id);
    assert.equal(oldRow.position, 'Официант тест');
    assert.equal(oldRow.positionId, oldPosition.id);
    assert.equal(oldRow.estimate, 200);
    assert.equal(oldRow.available, 200);

    const finance = new FinanceService(db, { log: async () => {} });
    await finance.accrueCalculated(owner, { userId: worker.id, month: previousMonth, amount: 200, requestKey: randomUUID() });
    await finance.accrue(owner, { userId: worker.id, month: currentMonth, amount: 50, supplemental: true, requestKey: randomUUID() });
    const before = (await payrollReport(db, cafeId, currentMonth)).staff.find(({ userId }) => userId === worker.id);
    assert.equal(before.estimate, 600);
    assert.equal(before.available, 600);
    assert.equal(before.supplementalAccrued, 50);
    const base = await finance.accrueCalculated(owner, { userId: worker.id, month: currentMonth, amount: 600, requestKey: randomUUID() });
    const account = await db.financeAccount.create({ data: { cafeId, name: 'Банк', type: 'noncash' } });
    await finance.paySalary(owner, base.id, { accountId: account.id, amount: 100, requestKey: randomUUID() });
    const after = (await payrollReport(db, cafeId, currentMonth)).staff.find(({ userId }) => userId === worker.id);
    assert.equal(after.available, 0);
    assert.equal(after.accrued, 650);
    assert.equal(after.paid, 100);
    assert.equal(after.due, 550);
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.waiterShift.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
