require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { validate } = require('class-validator');
const { FinanceService, buildCashFlow } = require('../src/finance/finance.service.ts');
const { FinanceAccountCreateDto, FinanceCategoryCreateDto } = require('../src/finance/finance.dto.ts');
const { OrdersService } = require('../src/orders/orders.service.ts');

const dec = (value) => new Prisma.Decimal(value);
const date = (value) => new Date(value);
const owner = { id: 'owner', cafeId: 'cafe', role: 'OWNER' };
const admin = { id: 'admin', cafeId: 'cafe', role: 'ADMIN', positionId: 'bookkeeper' };

test('split payments reject a one-cent mismatch and fractions smaller than a cent before writing', async () => {
  const orders = {
    prisma: {
      order: { findUnique: async () => ({ status: 'served', finalAmount: dec(1) }) },
      $transaction: () => assert.fail('invalid payment must not write'),
    },
    ensureAllActiveItemsServed: () => {},
  };
  const pay = (amounts) => OrdersService.prototype.markPaid.call(orders, 'order', owner, 'mixed', [
    { method: 'cash', amount: amounts[0] }, { method: 'qr', amount: amounts[1] },
  ]);
  await assert.rejects(pay([0.5, 0.49]), /Сумма частей оплаты/);
  await assert.rejects(pay([0.495, 0.505]), /с точностью до двух знаков/);
});

test('changing a paid order status requires the administrator refund permission', async () => {
  const paid = { status: 'paid', paymentStatus: 'paid', updatedAt: new Date(), items: [] };
  const orders = {
    prisma: {
      order: { findUnique: async () => paid },
      $transaction: (fn) => fn({ $queryRaw: async () => [{ id: 'order' }], order: { findUniqueOrThrow: async () => paid } }),
    },
    tableStatusForOrderStatus: () => 'free',
    itemStatusForManualOrderStatus: () => 'cancelled',
    cancellationReason: () => 'Проверка',
  };
  await assert.rejects(OrdersService.prototype.adminUpdateStatus.call(orders, 'order', {
    ...admin, permissions: { sections: {}, actions: { refundChecks: false } },
  }, 'cancelled', 'Проверка'), (error) => error.getStatus() === 403);
});

test('cash flow uses business dates, includes openings once and cancels internal transfers for all accounts', () => {
  const from = date('2026-11-14T18:00:00Z'), to = date('2026-11-17T18:00:00Z');
  const accounts = [{ createdAt: date('2026-11-01T00:00:00Z'), openingBalance: dec(50) },
    { createdAt: date('2026-11-15T18:10:00Z'), openingBalance: dec(20) }];
  const entries = [
    { occurredAt: date('2026-11-15T17:59:00Z'), amount: dec(150), kind: 'sale' },
    { occurredAt: date('2026-11-15T18:00:00Z'), amount: dec(-25.5), kind: 'refund' },
    { occurredAt: date('2026-11-16T04:00:00Z'), amount: dec(-40), kind: 'transfer' },
    { occurredAt: date('2026-11-16T04:00:00Z'), amount: dec(40), kind: 'transfer' },
  ];
  assert.deepEqual(buildCashFlow(accounts, dec(-10), entries, from, to, false), {
    opening: 40, income: 170, expense: 25.5, closing: 184.5,
    days: [
      { date: '2026-11-15', income: 150, expense: 0, net: 150, balance: 190 },
      { date: '2026-11-16', income: 20, expense: 25.5, net: -5.5, balance: 184.5 },
    ],
  });
  const perAccount = buildCashFlow(accounts.slice(0, 1), dec(0), entries.slice(0, 3), from, to, true);
  assert.equal(perAccount.expense, 65.5);
  assert.equal(perAccount.closing, 134.5);
});

test('creation DTOs require the name', async () => {
  assert.ok((await validate(Object.assign(new FinanceAccountCreateDto(), { type: 'cash' }))).some(({ property }) => property === 'name'));
  assert.ok((await validate(Object.assign(new FinanceCategoryCreateDto(), { kind: 'income' }))).some(({ property }) => property === 'name'));
});

test('delegated employee cannot post income or expense outside an explicitly granted category', async () => {
  let permissionWhere;
  const service = new FinanceService({ $transaction: (fn) => fn({
    $queryRaw: async () => [],
    financeCategory: { findFirst: async ({ where }) => { permissionWhere = where; return null; } },
  }) });
  const input = { kind: 'expense', amount: 12, accountId: 'drawer', requestKey: randomUUID() };
  await assert.rejects(service.post(admin, input), (error) => error.getStatus() === 403);
  await assert.rejects(service.post(admin, { ...input, categoryId: 'materials' }), (error) => error.getStatus() === 403);
  assert.deepEqual(permissionWhere, {
    cafeId: 'cafe', id: 'materials', OR: [{ userIds: { has: 'admin' } }, { positionIds: { has: 'bookkeeper' } }],
  });
  await assert.rejects(service.post(admin, { ...input, kind: 'transfer', destinationAccountId: 'bank' }), (error) => error.getStatus() === 403);
});

test('transfer appends equal and opposite entries and an identical retry does not append again', async () => {
  const entries = [];
  const service = new FinanceService({ $transaction: (fn) => fn({
    $queryRaw: async () => [],
    financeAccount: { findFirst: async ({ where }) => { assert.equal(where.cafeId, 'cafe'); return { id: where.id }; } },
    cashShift: { findFirst: async ({ where }) => where.accountId === 'drawer' ? { id: 'shift', openedAt: date('2026-01-01T00:00:00Z') } : null },
    financeEntry: {
      findFirst: async ({ where }) => entries.find((entry) => entry.sourceKey === where.sourceKey),
      create: async ({ data }) => {
        const row = { ...data, categoryId: data.categoryId ?? null, id: String(entries.length + 1) };
        entries.push(row);
        return row;
      },
    },
  }) });
  const input = { kind: 'transfer', amount: 100.1, accountId: 'drawer', destinationAccountId: 'bank', requestKey: randomUUID() };
  await service.post(owner, input);
  await service.post(owner, input);
  assert.deepEqual(entries.map(({ accountId, amount, cashShiftId }) => [accountId, Number(amount), cashShiftId]), [
    ['drawer', -100.1, 'shift'], ['bank', 100.1, undefined],
  ]);
  await assert.rejects(service.post(owner, { ...input, amount: 100.2 }), (error) => error.getStatus() === 409);
});

test('partial salary is payable only up to outstanding accrual', async () => {
  const entries = [];
  const service = new FinanceService({ $transaction: (fn) => fn({
    $queryRaw: async () => [],
    financeAccount: { findFirst: async () => ({ id: 'bank' }) },
    salaryAccrual: { findFirst: async () => ({ amount: dec(120) }) },
    cashShift: { findFirst: async () => null },
    financeEntry: {
      findFirst: async ({ where }) => entries.find((entry) => entry.sourceKey === where.sourceKey),
      aggregate: async () => ({ _sum: { amount: entries.reduce((sum, row) => sum.add(row.amount), dec(0)) } }),
      create: async ({ data }) => { entries.push(data); return data; },
    },
  }) });
  const input = { accountId: 'bank', amount: 100, requestKey: randomUUID() };
  await service.paySalary(owner, 'accrual', input);
  await service.paySalary(owner, 'accrual', input);
  await assert.rejects(service.paySalary(owner, 'accrual', { ...input, amount: 21, requestKey: randomUUID() }), (error) => error.getStatus() === 400);
  const last = await service.paySalary(owner, 'accrual', { ...input, amount: 20, requestKey: randomUUID() });
  assert.equal(Number(last.amount), -20);
  assert.equal(entries.length, 2);
});
