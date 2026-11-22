require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { ensureCollectionAccount } = require('../src/finance/finance-ledger.ts');

const databaseUrl = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || !new URL(databaseUrl).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: account trash hides the archived side, preserves the active side and restores its balance', {
  skip: !databaseUrl,
}, async () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const cafe = await db.cafe.create({ data: { name: 'Account trash ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    const [owner, admin] = await Promise.all(['OWNER', 'ADMIN'].map((role) => db.user.create({
      data: { role, cafeId, name: role, phone: randomUUID(), passwordHash: 'fixture' },
    })));
    const trail = [];
    const service = new FinanceService(db, { log: async (event) => { trail.push(event); } });
    const source = await service.createAccount(owner, { name: 'Тестовые наличные', type: 'cash', openingBalance: 100 });
    const destination = await service.createAccount(owner, { name: 'Тестовый банк', type: 'noncash', openingBalance: 20 });
    const post = (kind, accountId, amount, destinationAccountId) => service.post(owner, {
      requestKey: randomUUID(), kind, accountId, amount, destinationAccountId,
    });
    const income = await post('income', source.id, 70);
    const expense = await post('expense', source.id, 30);
    const transfer = await post('transfer', source.id, 40, destination.id);
    const checkBalance = (overview, id, balance) => assert.equal(overview.accounts.find((account) => account.id === id)?.balance, balance);
    const collection = await db.$transaction((tx) => ensureCollectionAccount(tx, cafeId));
    const original = await service.overview(owner, {});
    checkBalance(original, source.id, 100);
    checkBalance(original, destination.id, 60);
    const cashFlowTotals = ({ flow: { opening, income, expense, transfers, closing } }) =>
      ({ opening, income, expense, transfers, closing });
    assert.deepEqual(cashFlowTotals(original), { opening: 120, income: 70, expense: 30, transfers: 0, closing: 160 });
    assert.deepEqual(cashFlowTotals(await service.overview(owner, { accountId: source.id })),
      { opening: 100, income: 70, expense: 30, transfers: -40, closing: 100 });

    const primary = original.accounts.find((account) => account.isDefault);
    await assert.rejects(service.archiveAccount(owner, primary.id), { status: 409 });
    await assert.rejects(service.archiveAccount(owner, collection.id), { status: 409 });
    await assert.rejects(service.archiveAccount(admin, destination.id), { status: 403 });
    await assert.rejects(service.trashedAccounts(admin), { status: 403 });
    await assert.rejects(service.archiveAccount({ ...owner, cafeId: randomUUID() }, destination.id), { status: 404 });

    await service.archiveAccount(owner, destination.id);
    await service.archiveAccount(owner, destination.id);
    const archivedDestination = await service.overview(owner, {});
    checkBalance(archivedDestination, source.id, 100);
    checkBalance(archivedDestination, destination.id, undefined);
    assert.deepEqual(cashFlowTotals(archivedDestination), { opening: 100, income: 70, expense: 30, transfers: -40, closing: 100 });
    const outgoing = archivedDestination.entries.find(({ id }) => id === transfer.id);
    assert.equal(outgoing.amount, -40);
    assert.equal(outgoing.counterpartyName, destination.name);
    assert.equal(outgoing.counterpartyArchived, true);
    assert.equal(outgoing.reversible, false);
    assert.equal(outgoing.detailsEditable, false);
    assert.equal(archivedDestination.entries.filter(({ accountId }) => accountId === destination.id).length, 0);
    const [trash] = await service.trashedAccounts(owner);
    assert.equal(trash.id, destination.id);
    assert.equal(trash.balance, 60);
    assert.ok(trash.archivedAt instanceof Date);
    await assert.rejects(post('income', destination.id, 10), { status: 404 });
    await assert.rejects(post('transfer', source.id, 10, destination.id), { status: 404 });
    await assert.rejects(service.reverseTransaction(owner, transfer.id, 'Проверка'), { status: 404 });
    await service.restoreAccount(owner, destination.id);
    await service.restoreAccount(owner, destination.id);

    await service.archiveAccount(owner, source.id);
    const archivedSource = await service.overview(owner, {});
    checkBalance(archivedSource, destination.id, 60);
    assert.deepEqual(cashFlowTotals(archivedSource), { opening: 20, income: 0, expense: 0, transfers: 40, closing: 60 });
    const incoming = archivedSource.entries.find(({ accountId, kind }) => accountId === destination.id && kind === 'transfer');
    assert.ok(incoming);
    assert.equal(incoming.amount, 40);
    assert.equal(incoming.counterpartyName, source.name);
    assert.equal(incoming.counterpartyArchived, true);
    assert.ok(!archivedSource.entries.some(({ id }) => id === income.id || id === expense.id));
    assert.equal((await service.trashedAccounts(owner))[0].balance, 100);
    await service.restoreAccount(owner, source.id);
    const restored = await service.overview(owner, {});
    checkBalance(restored, source.id, 100);
    checkBalance(restored, destination.id, 60);
    assert.deepEqual(restored.entries, original.entries);
    assert.deepEqual(restored.flow, original.flow);
    assert.deepEqual(trail.map(({ actionType }) => actionType), [
      'FINANCE_ACCOUNT_ARCHIVED', 'FINANCE_ACCOUNT_RESTORED', 'FINANCE_ACCOUNT_ARCHIVED', 'FINANCE_ACCOUNT_RESTORED',
    ]);

    await service.archiveAccount(owner, destination.id);
    await db.financeAccount.update({ where: { id: destination.id }, data: { archivedAt: new Date(Date.now() - 31 * 86400000) } });
    assert.deepEqual(await service.trashedAccounts(owner), []);
    await assert.rejects(service.restoreAccount(owner, destination.id), { status: 409 });
    assert.equal(await db.financeEntry.count({ where: { cafeId } }), 4);
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});

test('PostgreSQL: an unbound account can change type without changing its transactions or balance', {
  skip: !databaseUrl,
}, async () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const { id: cafeId } = await db.cafe.create({ data: { name: 'Account type ' + randomUUID() } });
  try {
    const owner = await db.user.create({ data: { cafeId, role: 'OWNER', name: 'Owner', phone: randomUUID(), passwordHash: 'fixture' } });
    const service = new FinanceService(db, { log: async () => {} });
    const spare = await service.createAccount(owner, { name: 'Дополнительный счёт', type: 'noncash', openingBalance: 100 });
    const transaction = await service.post(owner, { requestKey: randomUUID(), kind: 'expense', accountId: spare.id, amount: 20 });
    const original = await service.overview(owner, {});
    const drawer = original.accounts.find(({ type, isDefault }) => type === 'cash' && isDefault);
    const safe = await db.$transaction((tx) => ensureCollectionAccount(tx, cafeId));
    for (const id of [drawer.id, safe.id]) await assert.rejects(service.updateAccount(owner, id, { type: 'noncash' }), { status: 409 });

    await service.updateAccount(owner, spare.id, { type: 'cash', isDefault: true });
    const updated = await service.overview(owner, {});
    const account = updated.accounts.find(({ id }) => id === spare.id);
    assert.equal(account.type, 'cash');
    assert.equal(account.isDefault, true);
    assert.equal(account.balance, 80);
    assert.equal(updated.accounts.find(({ id }) => id === drawer.id).isDefault, false);
    assert.equal(updated.accounts.find(({ type, isDefault }) => type === 'noncash' && isDefault).id,
      original.accounts.find(({ type, isDefault }) => type === 'noncash' && isDefault).id);
    assert.deepEqual(updated.entries.find(({ id }) => id === transaction.id), original.entries.find(({ id }) => id === transaction.id));

    await db.cashShift.create({ data: { cafeId, accountId: drawer.id, openedById: owner.id, openingAmount: 0 } });
    const withShift = await service.overview(owner, {});
    assert.equal(withShift.accounts.find(({ id }) => id === drawer.id).hasCashShifts, true);
    await assert.rejects(service.updateAccount(owner, drawer.id, { type: 'noncash' }), { status: 409 });
    assert.equal((await service.updateAccount(owner, drawer.id, { name: 'Резервная касса' })).type, 'cash');
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
