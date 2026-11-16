require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Prisma } = require('@prisma/client');
const { calculatePayroll, payrollMonth, payrollPeriodReport, payrollPeriods, payrollWorkTime } = require('../src/finance/payroll.ts');
const { FinanceService } = require('../src/finance/finance.service.ts');

const shift = (start, end) => ({ startedAt: new Date(start), endedAt: end ? new Date(end) : null });

test('payroll clips work at Bishkek month boundaries, consolidates occupied time and ignores open shifts', () => {
  const month = payrollMonth('2026-11');
  const work = payrollWorkTime([
    shift('2026-10-31T23:00:00+06:00', '2026-11-01T01:00:00+06:00'),
    shift('2026-11-01T00:30:00+06:00', '2026-11-01T03:00:00+06:00'),
    shift('2026-11-03T00:00:00+06:00', '2026-11-03T02:00:00+06:00'),
    shift('2026-11-03T01:00:00+06:00', '2026-11-03T03:00:00+06:00'),
    shift('2026-11-05T00:00:00+06:00', null),
    shift('2026-12-01T00:00:00+06:00', '2026-12-01T03:00:00+06:00'),
  ], month);
  assert.equal(work.milliseconds, 6 * 3_600_000);
  assert.equal(work.days, 2);
  assert.equal(work.shifts, 3);
  const salary = calculatePayroll(
    { hourly: 100, perShift: 50, monthly: 3000, personalPercent: 5, shiftPercent: 2 },
    work, month.days, new Prisma.Decimal(1500), new Prisma.Decimal(3000),
  );
  assert.equal(salary.toFixed(2), '1085.00');
});

test('calculated and manual accruals cannot reuse each other’s request keys', async () => {
  const amount = new Prisma.Decimal(120);
  const actor = { id: 'owner', cafeId: 'cafe', role: 'OWNER' };
  const input = { userId: 'cashier', month: '2026-11', amount: 120, requestKey: 'test' };
  let calculation = null;
  const service = new FinanceService({
    $transaction: (action) => action({
      $queryRaw: async () => [],
      salaryAccrual: { findFirst: async () => ({ ...input, amount, note: null, calculation }) },
    }),
  });
  await assert.rejects(service.accrueCalculated(actor, input), (error) => error.getStatus() === 409);
  calculation = { estimate: 120 };
  const previous = await service.accrueCalculated(actor, input);
  assert.equal(previous.calculation.estimate, 120);
  await assert.rejects(service.accrue(actor, input), (error) => error.getStatus() === 409);
});

test('payroll report clips shifts and sales to a custom period and applies each month’s rates', async () => {
  const shifts = [
    shift('2026-11-29T10:00:00+06:00', '2026-11-29T12:00:00+06:00'),
    shift('2026-11-30T10:00:00+06:00', '2026-11-30T12:00:00+06:00'),
    shift('2026-12-01T10:00:00+06:00', '2026-12-01T13:00:00+06:00'),
    shift('2026-12-02T10:00:00+06:00', '2026-12-02T12:00:00+06:00'),
  ].map((entry) => ({ ...entry, waiterId: 'waiter' }));
  const orders = [
    ['2026-11-29T11:00:00+06:00', 'waiter', 1000],
    ['2026-11-30T11:00:00+06:00', 'waiter', 100],
    ['2026-11-30T11:30:00+06:00', 'other', 200],
    ['2026-12-01T12:00:00+06:00', 'waiter', 100],
    ['2026-12-01T14:00:00+06:00', 'other', 300],
    ['2026-12-02T11:00:00+06:00', 'waiter', 1000],
  ].map(([at, waiterId, finalAmount]) => ({ closedAt: new Date(at), waiterId, finalAmount: new Prisma.Decimal(finalAmount) }));
  const db = {
    user: { findMany: async ({ select }) => {
      const month = select.position.select.salaryRates.where.effectiveMonth.lte;
      const november = month === '2026-11';
      return [{ id: 'waiter', name: 'Сотрудник', role: 'WAITER', isActive: true, position: {
        id: 'position', name: 'Официант', salaryRates: [{ effectiveMonth: month, hourly: november ? 100 : 200,
          perShift: 10, monthly: november ? 3000 : 6200, personalPercent: 5, shiftPercent: 10 }],
      } }];
    } },
    salaryAccrual: { findMany: async () => [] },
    waiterShift: { findMany: async ({ where }) => shifts.filter(({ startedAt, endedAt }) =>
      startedAt < where.startedAt.lt && endedAt > where.endedAt.gt) },
    order: { findMany: async ({ where }) => orders.filter(({ closedAt }) =>
      closedAt >= where.closedAt.gte && closedAt < where.closedAt.lt) },
  };
  const { staff: [row] } = await payrollPeriodReport(db, 'cafe', '2026-11-30', '2026-12-01');
  assert.equal(row.hours, 5);
  assert.equal(row.shifts, 2);
  assert.equal(row.monthlyPay, 300);
  assert.equal(row.hourlyPay, 800);
  assert.equal(row.shiftPay, 20);
  assert.equal(row.personalCommission, 10);
  assert.equal(row.shiftCommission, 40);
  assert.equal(row.estimate, 1170);
});

test('payroll rejects invalid dates and periods that touch more than twelve months', () => {
  assert.throws(() => payrollPeriods('2026-02-30', '2026-03-01'), /некорректная дата/);
  assert.throws(() => payrollPeriods('2026-10-03', '2026-10-02'), /Начало периода/);
  assert.throws(() => payrollPeriods('2026-01-01', '2027-01-01'), /12 календарных месяцев/);
});
