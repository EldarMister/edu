require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Prisma } = require('@prisma/client');
const { calculatePayroll, payrollMonth, payrollWorkTime } = require('../src/finance/payroll.ts');
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
