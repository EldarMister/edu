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

test('PostgreSQL: deleting a transaction category moves historical entries and retains balances and child categories', {
  skip: !databaseUrl,
}, async () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  const cafe = await db.cafe.create({ data: { name: 'Category removal ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    const [owner, admin] = await Promise.all(['OWNER', 'ADMIN'].map((role) => db.user.create({
      data: { role, cafeId, name: role, phone: randomUUID(), passwordHash: 'fixture' },
    })));
    const trail = [];
    const finance = new FinanceService(db, { log: async (entry) => { trail.push(entry); } });
    const parent = await finance.createCategory(owner, { name: 'Общая', kind: 'both' });
    const category = await finance.createCategory(owner, { name: 'Старая', kind: 'both', parentId: parent.id, userIds: [admin.id] });
    const child = await finance.createCategory(owner, { name: 'Подкатегория', kind: 'expense', parentId: category.id });
    const badReplacement = await finance.createCategory(owner, { name: 'Коммунальные услуги', kind: 'expense' });
    const replacement = await finance.createCategory(owner, { name: 'Перенесённые операции', kind: 'both' });
    const account = await finance.createAccount(owner, { name: 'Проверка', type: 'noncash', openingBalance: 100 });
    const income = await finance.post(admin, {
      requestKey: randomUUID(), kind: 'income', accountId: account.id, categoryId: category.id, amount: 20,
    });
    const expense = await finance.post(owner, {
      requestKey: randomUUID(), kind: 'expense', accountId: account.id, categoryId: category.id, amount: 35,
    });

    const before = await finance.overview(owner, {});
    const removal = await finance.categoryRemoval(owner, category.id);
    assert.equal(removal.entryCount, 2);
    assert.equal(removal.childCount, 1);
    assert.ok(removal.replacementIds.includes(replacement.id));
    assert.ok(!removal.replacementIds.includes(badReplacement.id));
    assert.ok(!removal.replacementIds.includes(category.id));
    await assert.rejects(finance.deleteCategory(admin, category.id, replacement.id), { status: 403 });
    await assert.rejects(finance.deleteCategory(owner, category.id), { status: 409 });
    await assert.rejects(finance.deleteCategory(owner, category.id, badReplacement.id), { status: 400 });
    assert.deepEqual(await finance.deleteCategory(owner, category.id, replacement.id), { id: category.id, moved: 2 });
    const after = await finance.overview(owner, {});
    assert.equal(after.accounts.find(({ id }) => id === account.id).balance, 85);
    assert.deepEqual(after.flow, before.flow);
    assert.equal(after.categories.find(({ id }) => id === child.id).parentId, parent.id);
    assert.deepEqual(after.categories.find(({ id }) => id === replacement.id).userIds, []);
    assert.equal((await finance.access(admin)).allowed, false);
    for (const id of [income.id, expense.id]) {
      const original = before.entries.find((entry) => entry.id === id);
      assert.deepEqual(after.entries.find((entry) => entry.id === id), { ...original, categoryId: replacement.id });
    }
    assert.deepEqual(trail[0].metadata, { moved: 2, children: 1, replacementId: replacement.id });
    assert.deepEqual(await finance.deleteCategory(owner, badReplacement.id), { id: badReplacement.id, moved: 0 });
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.financeCategory.updateMany({ where: { cafeId }, data: { parentId: null } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
