require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { validate } = require('class-validator');
const { FinanceService, buildCashFlow, cashFlowAccountOpenings, cashFlowIncludesEntry } = require('../src/finance/finance.service.ts');
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

test('cash flow includes only transfers across the selected account boundary and retains per-account opening balances', () => {
  const from = date('2026-11-15T18:00:00Z');
  const scope = new Set(['drawer', 'bank']);
  const moves = [
    { kind: 'transfer', counterpartyAccountId: 'bank', amount: dec(-20), occurredAt: from },
    { kind: 'transfer', counterpartyAccountId: 'drawer', amount: dec(20), occurredAt: from },
    { kind: 'transfer', counterpartyAccountId: 'safe', amount: dec(-15), occurredAt: from },
    { kind: 'expense', counterpartyAccountId: null, amount: dec(-3.5), occurredAt: from },
  ];
  const accounts = [
    { id: 'drawer', createdAt: date('2026-10-01T00:00:00Z'), openingBalance: dec(50) },
    { id: 'bank', createdAt: from, openingBalance: dec(12) },
  ];
  const before = [
    { accountId: 'drawer', _sum: { amount: dec(-10) } },
    { accountId: 'bank', _sum: { amount: dec(8) } },
  ];
  assert.deepEqual(cashFlowAccountOpenings(accounts, before, from), { drawer: 40, bank: 8 });
  const report = buildCashFlow(accounts, dec(-2), moves.filter((entry) => cashFlowIncludesEntry(entry, scope)), from,
    date('2026-11-16T18:00:00Z'), true);
  assert.deepEqual({ opening: report.opening, income: report.income, expense: report.expense, closing: report.closing },
    { opening: 48, income: 12, expense: 18.5, closing: 41.5 });
  assert.equal(moves.filter((entry) => cashFlowIncludesEntry(entry, null)).length, 1);
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

test('only the author with category grants can edit her manual transaction metadata', async () => {
  let write;
  const trail = [];
  const entry = { id: 'entry', cafeId: 'cafe', actorId: admin.id, kind: 'expense', sourceKey: 'manual:example',
    amount: dec(-20), categoryId: 'old', note: 'Старый комментарий', cashShiftId: null };
  const service = new FinanceService({ $transaction: (fn) => fn({
    $queryRaw: async () => [],
    financeEntry: {
      findFirst: async ({ where }) => where.id === entry.id ? entry : null,
      update: async ({ where, data }) => { write = { where, data }; return { ...entry, ...data }; },
    },
    financeCategory: {
      findFirst: async ({ where }) => where.id === 'denied' || where.cafeId !== 'cafe' ? null : { kind: 'expense' },
    },
  }) }, { log: async (event) => { trail.push(event); } });
  await assert.rejects(service.updateTransaction({ ...admin, id: 'other' }, 'entry', { categoryId: 'new' }), { status: 403 });
  await assert.rejects(service.updateTransaction(admin, 'entry', { categoryId: 'denied' }), { status: 403 });
  await assert.rejects(service.updateTransaction(admin, 'entry', { categoryId: null }), { status: 403 });
  const next = await service.updateTransaction(admin, 'entry', { categoryId: 'new', note: '  Новый комментарий  ' });
  assert.deepEqual(write, { where: { id: 'entry', cafeId: 'cafe' }, data: { categoryId: 'new', note: 'Новый комментарий' } });
  assert.ok(next.amount.eq(entry.amount));
  assert.equal(trail.length, 1);
});

test('transfer reversal undoes both legs on the original accounts and retries without a new movement', async () => {
  const at = date('2026-11-16T02:00:00Z');
  const rows = [
    { id: 'out', cafeId: 'cafe', sourceKey: 'manual:pair', accountId: 'drawer', counterpartyAccountId: 'safe',
      kind: 'transfer', amount: dec(-40), occurredAt: at, cashShiftId: null },
    { id: 'in', cafeId: 'cafe', sourceKey: 'manual:pair:in', accountId: 'safe', counterpartyAccountId: 'drawer',
      kind: 'transfer', amount: dec(40), occurredAt: at, cashShiftId: null },
  ];
  const service = new FinanceService({ $transaction: (fn) => fn({
    $queryRaw: async () => [],
    cashShift: { findMany: async () => [] },
    financeEntry: {
      findFirst: async ({ where }) => rows.find(({ id, cafeId }) => id === where.id && cafeId === where.cafeId),
      findMany: async ({ where }) => rows.filter(({ cafeId, sourceKey }) => cafeId === where.cafeId && where.sourceKey.in.includes(sourceKey)),
      createMany: async ({ data }) => rows.push(...data),
    },
  }) });
  await assert.rejects(service.reverseTransaction(admin, 'out', 'Ошибка'), { status: 403 });
  const reversed = await service.reverseTransaction(owner, 'in', 'Ошибка');
  await service.reverseTransaction(owner, 'out', 'Ошибка');
  await assert.rejects(service.reverseTransaction(owner, 'out', 'Иная причина'), { status: 409 });
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(2).map((row) => [row.sourceKey, row.accountId, Number(row.amount), row.occurredAt]), [
    ['void:out', 'drawer', 40, at], ['void:in', 'safe', -40, at],
  ]);
  assert.equal(rows[2].createdAt, reversed.reversedAt);
});

test('automatic receipts and manual entries counted in a closed shift cannot be reversed in the general transaction list', async () => {
  let entry;
  const closed = { id: 'shift', accountId: 'drawer', openedAt: date('2026-11-16T00:00:00Z'), closedAt: date('2026-11-16T12:00:00Z') };
  const service = new FinanceService({ $transaction: (fn) => fn({
    $queryRaw: async () => [],
    cashShift: { findMany: async () => [closed] },
    financeEntry: {
      findFirst: async () => entry,
      findMany: async () => [],
      createMany: () => assert.fail('the ledger must remain unchanged'),
    },
  }) });
  entry = { kind: 'sale', sourceKey: 'sale:payment' };
  await assert.rejects(service.reverseTransaction(owner, 'entry', 'Ошибка'), { status: 400 });
  entry = { id: 'entry', accountId: 'drawer', cashShiftId: 'shift', kind: 'expense', sourceKey: 'manual:entry' };
  await assert.rejects(service.reverseTransaction(owner, 'entry', 'Ошибка'), { status: 409 });
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
