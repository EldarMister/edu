require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { CashShiftsService } = require('../src/cash-shifts/cash-shifts.module.ts');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { SettingsService } = require('../src/settings/settings.service.ts');
const { runWithTenant } = require('../src/tenant/tenant-context.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: cash collection follows the shift account snapshot and drawer closing retains only counted cash', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const cafe = await db.cafe.create({ data: { name: 'Collection routing ' + randomUUID() } });
  const otherCafe = await db.cafe.create({ data: { name: 'Other collection cafe ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    const owner = await db.user.create({
      data: { cafeId, role: 'OWNER', name: 'Owner', phone: randomUUID(), passwordHash: 'fixture' },
    });
    const audit = { log: async () => {} };
    const finance = new FinanceService(db, audit);
    const shifts = new CashShiftsService(db, audit, {});
    const settings = new SettingsService(db, audit, { emitBroadcast: () => {} });
    const save = (cashCollectionAccountId) => runWithTenant({ cafeId }, () => settings.update({ cashCollectionAccountId }, owner));
    const [safeA, safeB, otherSafe] = await Promise.all([
      finance.createAccount(owner, { type: 'cash', name: 'Внутренний сейф' }),
      finance.createAccount(owner, { type: 'cash', name: 'Сейф бухгалтерии' }),
      db.financeAccount.create({ data: { cafeId: otherCafe.id, type: 'cash', name: 'Чужой сейф' } }),
    ]);
    const defaultCash = await db.financeAccount.findFirstOrThrow({ where: { cafeId, type: 'cash', isDefault: true } });
    const bank = await db.financeAccount.findFirstOrThrow({ where: { cafeId, type: 'noncash', isDefault: true } });
    assert.deepEqual(new Set((await settings.collectionAccounts(cafeId)).map(({ id }) => id)), new Set([safeA.id, safeB.id]));
    for (const invalid of [otherSafe.id, defaultCash.id, bank.id]) {
      await assert.rejects(save(invalid), { status: 400 });
    }

    const balances = async () => {
      const accounts = (await finance.overview(owner, {})).accounts;
      return [defaultCash.id, safeA.id, safeB.id].map((id) => accounts.find((row) => row.id === id)?.balance);
    };
    await shifts.setting(cafeId, true);
    await save(safeA.id);
    const first = await shifts.open(cafeId, owner.id, 100);
    await save(safeB.id);
    await assert.rejects(finance.archiveAccount(owner, safeA.id), { status: 409 });
    await assert.rejects(finance.updateAccount(owner, safeB.id, { type: 'noncash' }), { status: 409 });
    await assert.rejects(finance.updateAccount(owner, safeB.id, { isDefault: true }), { status: 400 });

    const input = { kind: 'collection', amount: 70, requestKey: randomUUID() };
    const drop = await shifts.createOperation(cafeId, owner, first.id, input);
    assert.equal((await shifts.createOperation(cafeId, owner, first.id, input)).id, drop.id);
    assert.equal(drop.accountId, defaultCash.id);
    assert.equal(drop.counterpartyAccountId, safeA.id);
    assert.equal(drop.pendingCashShift, true);
    const incoming = await db.financeEntry.findFirstOrThrow({ where: { cafeId, sourceKey: drop.sourceKey + ':in' } });
    assert.deepEqual([incoming.accountId, incoming.counterpartyAccountId, Number(incoming.amount)], [safeA.id, defaultCash.id, 70]);
    const active = (await shifts.list(cafeId, true)).current;
    assert.deepEqual([active.collectionAccountName, active.collectionAmount, active.expectedAmount], [safeA.name, 70, 30]);
    assert.deepEqual(await balances(), [0, 0, 0]);

    const closing = { shiftId: first.id, amount: 28, expectedAmount: 30 };
    const closed = await shifts.close(cafeId, owner.id, closing);
    assert.deepEqual([closed.expectedAmount, closed.actualAmount, closed.difference], [30, 28, -2]);
    assert.deepEqual(await shifts.close(cafeId, owner.id, closing), closed);
    assert.deepEqual(await balances(), [28, 70, 0]);
    await shifts.updateOperation(cafeId, owner, first.id, drop.id, { kind: 'collection', amount: 69 });
    const details = await shifts.details(cafeId, first.id);
    assert.deepEqual([details.summary.collections, details.summary.expectedAmount, details.summary.actualAmount, details.summary.difference],
      [69, 31, 28, -3]);
    const outgoing = details.movements.find((row) => row.id === drop.id);
    assert.deepEqual([outgoing.collection, outgoing.counterpartyName], [true, safeA.name]);
    const history = (await shifts.list(cafeId, true)).history;
    assert.deepEqual([history[0].collectionAccountName, history[0].collectionAmount], [safeA.name, 69]);
    assert.deepEqual(await balances(), [28, 69, 0]);

    const second = await shifts.open(cafeId, owner.id, 28);
    const nextDrop = await shifts.createOperation(cafeId, owner, second.id, { kind: 'collection', amount: 5, requestKey: randomUUID() });
    assert.equal(nextDrop.counterpartyAccountId, safeB.id);
    await shifts.close(cafeId, owner.id, { shiftId: second.id, amount: 23, expectedAmount: 23 });
    assert.deepEqual(await balances(), [23, 69, 5]);

    const unusedSafe = await finance.createAccount(owner, { type: 'cash', name: 'Резервный сейф' });
    await save(unusedSafe.id);
    const third = await shifts.open(cafeId, owner.id, 23);
    await shifts.close(cafeId, owner.id, { shiftId: third.id, amount: 23, expectedAmount: 23 });
    await save(null);
    await assert.rejects(finance.archiveAccount(owner, unusedSafe.id), { status: 409 }, 'closed snapshot still allows a historical collection');
    await shifts.open(cafeId, owner.id, 23);
    assert.equal((await shifts.list(cafeId, true)).current.collectionAccountName, 'Сейф');
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.settings.deleteMany({ where: { cafeId } });
    await db.cafe.deleteMany({ where: { id: { in: [cafeId, otherCafe.id] } } });
    await db.$disconnect();
  }
});
