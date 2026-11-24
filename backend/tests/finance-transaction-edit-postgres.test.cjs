require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { profitLossWorkbook } = require('../src/finance/profit-loss.ts');

const databaseUrl = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || !new URL(databaseUrl).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('P&L uses the business date, separates supply payments and omits voided and disabled categories', {
  skip: !databaseUrl,
}, async () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { id: cafeId } = await db.cafe.create({ data: { name: 'P&L ' + randomUUID() } });
  const finance = new FinanceService(db, { log: async () => {} });
  try {
    const owner = await db.user.create({ data: { role: 'OWNER', cafeId, name: 'QA', phone: randomUUID(), passwordHash: 'test' } });
    const account = await finance.createAccount(owner, { name: 'Банк', type: 'noncash' });
    const proceeds = await finance.createCategory(owner, { name: 'Аренда зала', kind: 'income' });
    const expenses = await finance.createCategory(owner, { name: 'Обслуживание', kind: 'expense' });
    const excluded = await finance.createCategory(owner, { name: 'Исключено', kind: 'expense', showInProfitLoss: false });
    const supplies = await finance.createCategory(owner, { name: 'Поставки', kind: 'expense' });
    const february = '2026-02-01T00:01:00+06:00';
    const post = (kind, amount, category, extra = {}) => finance.post(owner, { requestKey: randomUUID(), accountId: account.id,
      occurredAt: february, dealDate: '2026-01-31', kind, amount, categoryId: category.id, ...extra });
    const income = await post('income', 100, proceeds);
    const rent = await post('expense', 14, expenses);
    await post('expense', 50, excluded);
    const cancelled = await post('income', 200, proceeds);
    await finance.reverseTransaction(owner, cancelled.id, 'Ошибка ввода');
    await assert.rejects(post('expense', 1, expenses, { dealDate: '2026-02-30' }), { status: 400 });
    assert.equal(income.occurredAt.toISOString(), '2026-01-31T18:01:00.000Z');
    assert.equal(income.dealDate.toISOString().slice(0,10), '2026-01-31');
    const purchase = await db.purchase.create({ data: { cafeId, date: new Date('2026-01-31T12:00:00+06:00'),
      status: 'completed', supplier: 'Поставщик', totalAmount: 20 } });
    await db.financeEntry.create({ data: { cafeId, accountId: account.id, actorId: owner.id, kind: 'expense',
      amount: -20, occurredAt: new Date(february), purchaseId: purchase.id, categoryId: supplies.id } });
    const jan = { from: '2026-01-31', to: '2026-01-31' };
    const values = (report) => Object.fromEntries(report.rows.filter((row) => !row.detail).map((row) => [row.label, row.value]));
    const report = await finance.profitLoss(owner, jan);
    assert.equal(values(report)['Доходы'], 100);
    assert.equal(values(report)['Расходы'], 34);
    assert.equal(values(report)['Прибыль после налогообложения'], 66);
    assert.ok(!report.rows.some((row) => row.label === excluded.name));
    const XLSX = require('xlsx');
    const sheet = XLSX.read(profitLossWorkbook(report, jan.from, jan.to)).Sheets['P&L'];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    assert.deepEqual(rows.find(([name]) => name === 'Прибыль после налогообложения'), ['Прибыль после налогообложения', 66, 66]);
    await finance.updateCategory(owner, supplies.id, { showInProfitLoss: false });
    assert.equal(values(await finance.profitLoss(owner, jan))['Расходы'], 14);
    await finance.editTransaction(owner, rent.id, { kind: 'expense', accountId: account.id, categoryId: expenses.id, amount: 16 });
    assert.equal(values(await finance.profitLoss(owner, jan))['Расходы'], 16);
    await finance.editTransaction(owner, rent.id, { kind: 'expense', accountId: account.id, categoryId: expenses.id, amount: 16, dealDate: null });
    assert.equal(values(await finance.profitLoss(owner, { from: '2026-02-01', to: '2026-02-01' }))['Расходы'], 16);
    assert.equal(values(await finance.profitLoss(owner, jan))['Расходы'], 0);
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.purchase.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});

test('PostgreSQL: editing a manual transaction updates the account, journal and both transfer legs in place', {
  skip: !databaseUrl,
}, async () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const cafe = await db.cafe.create({ data: { name: 'Transaction edit ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    const [owner, admin] = await Promise.all(['OWNER', 'ADMIN'].map((role) => db.user.create({
      data: { role, cafeId, name: role, phone: randomUUID(), passwordHash: 'fixture' },
    })));
    const trail = [];
    const finance = new FinanceService(db, { log: async (entry) => { trail.push(entry); } });
    const source = await finance.createAccount(owner, { name: 'Исходный счёт', type: 'noncash', openingBalance: 100 });
    const destination = await finance.createAccount(owner, { name: 'Получатель', type: 'noncash' });
    const replacement = await finance.createAccount(owner, { name: 'Новый получатель', type: 'noncash' });
    const category = await finance.createCategory(owner, { name: 'Операции', kind: 'both', userIds: [admin.id] });
    const expenseCategory = await finance.createCategory(owner, { name: 'Расходы', kind: 'expense' });
    const post = (values) => finance.post(owner, { requestKey: randomUUID(), ...values });
    const income = await post({ kind: 'income', accountId: source.id, categoryId: category.id, amount: 70 });
    const expense = await post({ kind: 'expense', accountId: source.id, categoryId: category.id, amount: 25 });
    const transfer = await post({ kind: 'transfer', accountId: source.id, destinationAccountId: destination.id, amount: 40 });
    const receiving = await db.financeEntry.findFirstOrThrow({ where: { cafeId, sourceKey: transfer.sourceKey + ':in' } });
    const check = async (expected) => {
      const snapshot = await finance.overview(owner, {});
      assert.deepEqual([source, destination, replacement].map((account) => snapshot.accounts.find(({ id }) => id === account.id).balance), expected);
      assert.equal(snapshot.flow.closing, expected.reduce((total, balance) => total + balance, 0));
      return snapshot;
    };
    const before = await check([105, 40, 0]);
    assert.equal(before.entries.find(({ id }) => id === expense.id).detailsEditable, true);
    assert.equal(before.entries.find(({ id }) => id === receiving.id).detailsEditable, true);

    const editExpense = { kind: 'expense', accountId: source.id, categoryId: category.id, amount: 30, note: 'Уточнение' };
    await assert.rejects(finance.editTransaction(admin, expense.id, editExpense), { status: 403 });
    assert.equal((await finance.editTransaction(owner, expense.id, editExpense)).id, expense.id);
    const after = await check([100, 40, 0]);
    assert.equal(after.entries.find(({ id }) => id === expense.id).amount, -30);
    assert.equal(after.flow.expense, 30);
    assert.equal((await finance.editTransaction(owner, expense.id, editExpense)).occurredAt.toISOString(), expense.occurredAt.toISOString());
    assert.equal(trail.length, 1);
    assert.equal(trail[0].oldValue.amount, '-25');
    assert.equal(trail[0].newValue.amount, '-30');

    const at = new Date(Date.now() - 60000).toISOString();
    assert.equal((await finance.editTransaction(owner, receiving.id, {
      kind: 'transfer', accountId: source.id, destinationAccountId: replacement.id, amount: 55, occurredAt: at,
    })).id, transfer.id);
    await check([85, 0, 55]);
    const moved = await db.financeEntry.findUniqueOrThrow({ where: { id: receiving.id } });
    assert.equal(moved.accountId, replacement.id);
    assert.equal(moved.amount.toNumber(), 55);
    assert.equal(moved.occurredAt.toISOString(), at);
    assert.equal((await db.financeEntry.findUniqueOrThrow({ where: { id: transfer.id } })).occurredAt.toISOString(), at);

    await assert.rejects(finance.editTransaction(owner, transfer.id, {
      kind: 'income', accountId: destination.id, categoryId: expenseCategory.id, amount: 60,
    }), { status: 400 });
    await check([85, 0, 55]);
    await finance.editTransaction(owner, transfer.id, { kind: 'income', accountId: destination.id, amount: 60 });
    assert.equal(await db.financeEntry.count({ where: { id: receiving.id } }), 0);
    await check([140, 60, 0]);

    const drawer = await db.financeAccount.findFirstOrThrow({ where: { cafeId, isDefault: true, type: 'cash' } });
    const openedAt = new Date(Date.now() - 120_000);
    const shift = await db.cashShift.create({ data: { cafeId, accountId: drawer.id, openedAt, openedById: owner.id, openingAmount: 0 } });
    await assert.rejects(finance.editTransaction(owner, transfer.id, {
      kind: 'income', accountId: drawer.id, amount: 60,
    }), { status: 409 });
    await finance.reverseTransaction(owner, income.id, 'Проверка');
    await assert.rejects(finance.editTransaction(owner, income.id, {
      kind: 'income', accountId: source.id, amount: 1,
    }), { status: 409 });
    await check([70, 60, 0]);
    const closedAt = new Date(Date.now() - 60_000);
    await db.cashShift.update({ where: { id: shift.id }, data: { closedAt, closedById: owner.id } });
    await assert.rejects(post({
      kind: 'income', accountId: drawer.id, amount: 80, occurredAt: openedAt.toISOString(),
    }), { status: 409 });
    await assert.rejects(post({
      kind: 'transfer', accountId: source.id, destinationAccountId: drawer.id, amount: 40, occurredAt: openedAt.toISOString(),
    }), { status: 409 });
    await check([70, 60, 0]);
    const current = await post({ kind: 'income', accountId: drawer.id, amount: 15, occurredAt: closedAt.toISOString() });
    assert.equal(current.cashShiftId, null);
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
