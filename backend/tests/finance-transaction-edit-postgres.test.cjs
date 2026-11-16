require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { FinanceService } = require('../src/finance/finance.service.ts');

const databaseUrl = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || !new URL(databaseUrl).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

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
    await db.cashShift.create({ data: { cafeId, accountId: drawer.id, openedById: owner.id, openingAmount: 0 } });
    await assert.rejects(finance.editTransaction(owner, transfer.id, {
      kind: 'income', accountId: drawer.id, amount: 60,
    }), { status: 409 });
    await finance.reverseTransaction(owner, income.id, 'Проверка');
    await assert.rejects(finance.editTransaction(owner, income.id, {
      kind: 'income', accountId: source.id, amount: 1,
    }), { status: 409 });
    await check([70, 60, 0]);
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
