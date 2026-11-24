require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Prisma } = require('@prisma/client');
const { calculatePayroll, payrollMonth, payrollReport, payrollPeriodReport, payrollPeriods, payrollWorkTime } = require('../src/finance/payroll.ts');
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
    user: { findMany: async () => [{ id: 'waiter', name: 'Сотрудник', role: 'WAITER', isActive: true,
      position: { id: 'position', name: 'Новая должность' } }] },
    employeeSalaryRate: { findMany: async ({ where }) => {
      const month = where.effectiveDay.lte.slice(0, 7);
      const november = month === '2026-11';
      return [{ userId: 'waiter', positionId: 'old-position', positionName: 'Официант', effectiveDay: month + '-01',
        hourly: november ? 100 : 200, perShift: 10, monthly: november ? 3000 : 6200, personalPercent: 5, shiftPercent: 10 }];
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
  assert.equal(row.position, 'Официант');
  assert.deepEqual(row.ratesByMonth.map(({ month, rates }) => [month, rates.hourly, rates.monthly]), [
    ['2026-11', 100, 3000], ['2026-12', 200, 6200],
  ]);
});

test('payroll rejects invalid dates and periods that touch more than twelve months', () => {
  assert.throws(() => payrollPeriods('2026-02-30', '2026-03-01'), /некорректная дата/);
  assert.throws(() => payrollPeriods('2026-10-03', '2026-10-02'), /Начало периода/);
  assert.throws(() => payrollPeriods('2026-01-01', '2027-01-01'), /12 календарных месяцев/);
});

test('payroll shows the actual sales bases for fixed-rate staff even when no commission is configured', async () => {
  const worker = { id: 'waiter', name: 'Сотрудник', role: 'WAITER', isActive: true, position: {
    id: 'position', name: 'Официант', salaryRates: [{ effectiveDay: '2026-11-01', hourly: 100,
      perShift: 0, monthly: 0, personalPercent: 0, shiftPercent: 0 }],
  } };
  const orders = [
    ['2026-11-30T09:00:00+06:00', worker.id, 30],
    ['2026-11-30T11:00:00+06:00', worker.id, 75],
    ['2026-11-30T11:30:00+06:00', 'other', 150],
    ['2026-11-30T12:00:00+06:00', null, 50],
  ].map(([date, waiterId, amount]) => ({
    closedAt: new Date(date), waiterId, finalAmount: new Prisma.Decimal(amount),
  }));
  const db = {
    user: { findMany: async () => [worker] },
    employeeSalaryRate: { findMany: async () => worker.position.salaryRates.map((rate) => ({
      ...rate, userId: worker.id, positionId: worker.position.id, positionName: worker.position.name,
    })) },
    salaryAccrual: { findMany: async () => [] },
    waiterShift: { findMany: async () => [{
      waiterId: worker.id, ...shift('2026-11-30T10:00:00+06:00', '2026-11-30T12:00:00+06:00'),
    }] },
    order: { findMany: async () => orders },
  };
  const { staff: [row] } = await payrollPeriodReport(db, 'cafe', '2026-11-30', '2026-11-30');
  assert.equal(row.personalSales, 105);
  assert.equal(row.shiftSales, 225);
  assert.equal(row.personalCommission, 0);
  assert.equal(row.shiftCommission, 0);
  assert.equal(row.estimate, 200);
});

test('a departed employee can receive final salary, and a bonus does not consume base salary', async () => {
  const rate = { userId: 'departed', effectiveDay: '2026-10-01', positionId: 'removed-position', positionName: 'Официант',
    hourly: 100, perShift: 0, monthly: 0, personalPercent: 0, shiftPercent: 0 };
  const db = {
    user: { findMany: async () => [{ id: 'departed', name: 'Анна', role: 'WAITER', isActive: false,
      position: { id: 'new-position', name: 'Управляющий' } }] },
    employeeSalaryRate: { findMany: async () => [rate] },
    salaryAccrual: { findMany: async () => [
      { id: 'base', userId: 'departed', month: '2026-11', amount: new Prisma.Decimal(50), supplemental: false, payments: [] },
      { id: 'bonus', userId: 'departed', month: '2026-11', amount: new Prisma.Decimal(80), supplemental: true,
        payments: [{ amount: new Prisma.Decimal(-30) }] },
    ] },
    waiterShift: { findMany: async () => [{ waiterId: 'departed',
      ...shift('2026-11-02T10:00:00+06:00', '2026-11-02T12:00:00+06:00') }] },
    order: { findMany: async () => [] },
  };
  const { staff: [row] } = await payrollReport(db, 'cafe', '2026-11');
  assert.equal(row.positionId, 'removed-position');
  assert.equal(row.position, 'Официант');
  assert.equal(row.estimate, 200);
  assert.equal(row.baseAccrued, 50);
  assert.equal(row.supplementalAccrued, 80);
  assert.equal(row.available, 150);
  assert.equal(row.accrued, 130);
  assert.equal(row.paid, 30);
  assert.equal(row.due, 100);
});

test('base salary and bonus requests cannot reuse the same idempotency key', async () => {
  const input = { userId: 'worker', month: '2026-11', amount: 100, requestKey: 'same', supplemental: true };
  const service = new FinanceService({ $transaction: (action) => action({
    $queryRaw: async () => [],
    salaryAccrual: { findFirst: async () => ({ ...input, amount: new Prisma.Decimal(100), calculation: null, note: null }) },
  }) });
  const actor = { id: 'owner', role: 'OWNER', cafeId: 'cafe' };
  assert.equal((await service.accrue(actor, input)).supplemental, true);
  await assert.rejects(service.accrue(actor, { ...input, supplemental: false }), { status: 409 });
  await assert.rejects(service.accrueCalculated(actor, input), { status: 400 });
});

test('payroll applies rates at local midnight and attributes overlapping sales and partial returns to the correct bases', async () => {
  const employees = ['opener', 'receiver'].map((id) => ({ id, name: id, role: 'WAITER', isActive: true, position: null }));
  const prior = { effectiveDay: '2026-11-01', hourly: 100, perShift: 10, monthly: 3000, personalPercent: 5, shiftPercent: 10 };
  const rates = [
    { ...prior, userId: 'opener', categoryRates: [{ categoryId: 'food', personalPercent: 0 }] },
    { ...prior, userId: 'receiver', personalPercent: 0 },
    { ...prior, userId: 'opener', effectiveDay: '2026-11-15', hourly: 200, monthly: 6000, personalPercent: 10, shiftPercent: 15 },
  ];
  const orders = [{
    id: 'discounted', orderNumber: '1', closedAt: new Date('2026-11-14T23:30:00+06:00'),
    finalAmount: 90, refundedAmount: 9, waiterId: 'receiver', payrollOpenedById: 'opener',
    items: [
      { id: 'food-line', payrollCategoryId: 'food', finalPrice: 60, quantity: 1 },
      { id: 'drink-line', payrollCategoryId: 'drinks', finalPrice: 40, quantity: 1 },
    ],
    refunds: [{ items: [{ itemId: 'food-line', amount: '9.00' }] }],
  }, {
    id: 'overnight', orderNumber: '2', closedAt: new Date('2026-11-15T00:30:00+06:00'),
    finalAmount: 100, waiterId: 'receiver', payrollOpenedById: 'opener',
  }];
  const db = {
    user: { findMany: async () => employees },
    employeeSalaryRate: { findMany: async () => rates },
    salaryAccrual: { findMany: async () => [] },
    waiterShift: { findMany: async () => [
      { id: 'a', waiterId: 'opener', ...shift('2026-11-14T22:00:00+06:00', '2026-11-15T02:00:00+06:00') },
      { id: 'b', waiterId: 'receiver', ...shift('2026-11-14T23:00:00+06:00', '2026-11-15T03:00:00+06:00') },
    ] },
    order: { findMany: async () => orders },
    category: { findMany: async () => [{ id: 'food', name: 'Кухня' }, { id: 'drinks', name: 'Напитки' }] },
  };
  const { staff: [opener, receiver] } = await payrollReport(db, 'cafe', '2026-11', undefined, undefined, true);
  assert.equal(opener.hourlyPay, 600);
  assert.equal(opener.shiftPay, 10);
  assert.equal(opener.monthlyPay, 300);
  assert.equal(opener.personalCommission, 11.8);
  assert.equal(opener.shiftCommission, 23.1);
  assert.equal(opener.estimate, 944.9);
  assert.equal(opener.rateIntervals[0].sales.find((sale) => sale.kind === 'personalPercent' && sale.categoryId === 'food').base, 45);
  assert.equal(receiver.personalSales, 0);
  assert.equal(receiver.shiftSales, 181);
  assert.equal(receiver.shiftCommission, 18.1);
});
