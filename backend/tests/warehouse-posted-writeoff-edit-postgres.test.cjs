require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Prisma, PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { readProfitLoss } = require('../src/finance/profit-loss.ts');
const { postStockMovement } = require('../src/warehouse/stock-posting.ts');
const { lockIngredients } = require('../src/warehouse/stock-lock.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

async function fixture(run) {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Posted write-off edit ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = await db.user.create({ data: { name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'unused' } });
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const [mainLocation] = (await locations.list(cafe.id)).locations;
      const main = { ...mainLocation, cafeId: cafe.id };
      const bar = { ...(await locations.save(cafe.id, 'Bar')), cafeId: cafe.id };
      const docs = new WarehouseDocumentsService(db);
      const ingredients = new IngredientsService(db);
      const first = new Date(Date.now() - 60_000);
      const timestamp = (seconds) => new Date(+first + seconds * 1000);
      async function receive(warehouse, ingredient, quantity, price, seconds) {
        return db.$transaction(async (tx) => {
          await lockIngredients(tx, [ingredient.id]);
          return postStockMovement(tx, {
            ingredientId: ingredient.id, warehouse, change: new Prisma.Decimal(quantity),
            cost: new Prisma.Decimal(price), costKnown: true, valuation: 'average',
            movement: { createdAt: timestamp(seconds), type: 'correction', sourceType: 'manual',
              sourceId: ingredient.id, comment: 'Начальный остаток' },
          });
        });
      }
      const stock = async (warehouse, ingredient) =>
        (await ingredients.findOne(ingredient.id)).balances.find(({ warehouseId }) => warehouseId === warehouse.id).stock;
      await run({ db, cafe, owner, main, bar, docs, ingredients, receive, stock, timestamp });
    });
  } finally {
    await db.auditLog.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.warehouseDocumentItem.deleteMany({ where: { cafeId: cafe.id } });
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.writeoffReason.deleteMany({ where: { cafeId: cafe.id } });
    await db.warehouseStock.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.warehouse.deleteMany({ where: { cafeId: cafe.id } });
    await db.settings.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
}

test('PostgreSQL: posted write-off edits replace the original stock withdrawal and reprice downstream movements and P&L', { skip: !url }, async () => {
  await fixture(async ({ db, cafe, owner, main, bar, docs, ingredients, receive, stock, timestamp }) => {
    const flour = await ingredients.create({ name: 'Flour', unit: 'kg' });
    const sugar = await ingredients.create({ name: 'Sugar', unit: 'kg' });
    await receive(main, flour, 10_000, '0.01', 0);
    await receive(main, sugar, 4_000, '0.02', 0);
    await receive(bar, flour, 5_000, '0.007', 0);
    const original = await docs.create(owner, { kind: 'writeoff', warehouseId: main.id, effectiveAt: timestamp(10).toISOString(),
      reason: 'damage', note: 'Первичный документ', finalize: 'post',
      items: [{ ingredientId: flour.id, quantity: 2 }, { ingredientId: sugar.id, quantity: 1 }] });
    await receive(main, flour, 10_000, '0.03', 20);
    const later = await docs.create(owner, { kind: 'writeoff', warehouseId: main.id, effectiveAt: timestamp(30).toISOString(),
      reason: 'damage', finalize: 'post', items: [{ ingredientId: flour.id, quantity: 1 }] });
    assert.equal(later.items[0].unitCost.toFixed(2), '21.11');
    const expense = await docs.saveWriteoffReason({ name: 'Тестовый расход', expense: true });
    const replacement = { revision: original.revision, warehouseId: bar.id, effectiveAt: timestamp(15).toISOString(),
      writeoffReasonId: expense.id, note: 'Исправленный документ', items: [{ ingredientId: flour.id, quantity: 3 }] };

    await assert.rejects(docs.editPostedWriteoff({ ...owner, role: 'ADMIN' }, original.id, replacement), /нет разрешения/i);
    const updated = await docs.editPostedWriteoff(owner, original.id, replacement);
    assert.equal(updated.id, original.id);
    assert.equal(updated.status, 'posted');
    assert.equal(updated.revision, original.revision + 1);
    assert.equal(+updated.postedAt, +original.postedAt);
    assert.equal(+updated.effectiveAt, +timestamp(15));
    assert.equal(updated.warehouseId, bar.id);
    assert.equal(updated.note, replacement.note);
    assert.equal(updated.reasonLabel, expense.label);
    assert.equal(updated.items[0].unitCost, 7);
    assert.deepEqual([await stock(main, flour), await stock(main, sugar), await stock(bar, flour)], [19, 4, 2]);
    assert.equal((await docs.get(later.id)).items[0].unitCost, 20);
    const movements = await db.stockMovement.findMany({ where: { sourceId: original.id } });
    assert.deepEqual(movements.map((movement) => [movement.ingredientId, movement.warehouseId, +movement.change, movement.reason]),
      [[flour.id, bar.id, -3000, expense.id]]);
    const report = await readProfitLoss(db, cafe.id, { from: timestamp(0), to: timestamp(45) });
    assert.equal(report.rows.find(({ label }) => label === 'Списания на расходы').value, 21);
    assert.equal(report.rows.find(({ label }) => label === 'Складские списания').value, 20);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: original.id, actionType: 'WAREHOUSE_WRITEOFF_EDITED' } });
    assert.equal(audit.oldValue.items.length, 2);
    assert.equal(audit.metadata.originalMovements.length, 2);
    assert.deepEqual(audit.metadata.insertedMovementIds, [movements[0].id]);
    await assert.rejects(docs.editPostedWriteoff(owner, original.id, replacement), /Документ уже изменился/);

    const beforeFailure = await docs.get(updated.id);
    await assert.rejects(docs.editPostedWriteoff(owner, updated.id, { revision: updated.revision, note: 'Превышение остатка',
      items: [{ ingredientId: flour.id, quantity: 6 }] }), /недостаточно запаса/);
    assert.deepEqual(await docs.get(updated.id), beforeFailure);
    assert.deepEqual(await db.stockMovement.findMany({ where: { sourceId: original.id } }), movements);
    assert.equal(await stock(bar, flour), 2);
  });
});

test('PostgreSQL: posted write-off edit locks revisions and honors reopened inventory periods', { skip: !url }, async () => {
  await fixture(async ({ db, owner, main, bar, docs, ingredients, receive, stock, timestamp }) => {
    const product = await ingredients.create({ name: 'Coffee', unit: 'pcs' });
    await receive(main, product, 10, 2, 0);
    await receive(bar, product, 10, 3, 0);
    const writeoff = await docs.create(owner, { kind: 'writeoff', warehouseId: main.id, effectiveAt: timestamp(10).toISOString(),
      finalize: 'post', items: [{ ingredientId: product.id, quantity: 2 }] });
    const [first, second] = await Promise.allSettled(['Первый', 'Второй'].map((note) =>
      docs.editPostedWriteoff(owner, writeoff.id, { revision: writeoff.revision, note })));
    assert.equal([first, second].filter(({ status }) => status === 'fulfilled').length, 1);
    assert.match([first, second].find(({ status }) => status === 'rejected').reason.message, /Документ уже изменился/);
    const revision = writeoff.revision + 1;
    assert.equal(await db.stockMovement.count({ where: { sourceId: writeoff.id } }), 1);
    assert.equal(await stock(main, product), 8);
    const count = (location, quantity) => docs.create(owner, { kind: 'inventory', mode: 'partial', warehouseId: location.id,
      finalize: 'post', items: [{ ingredientId: product.id, quantity }] });
    const barCount = await count(bar, 10);
    await assert.rejects(docs.editPostedWriteoff(owner, writeoff.id, { revision, warehouseId: bar.id }), /инвентаризация/);
    assert.deepEqual([await stock(main, product), await stock(bar, product)], [8, 10]);
    const mainCount = await count(main, 8);
    await assert.rejects(docs.editPostedWriteoff(owner, writeoff.id, { revision, note: 'Закрытый период' }), /закрытому инвентаризационному периоду/);
    await docs.reopen(owner, mainCount.id, mainCount.revision);
    await docs.reopen(owner, barCount.id, barCount.revision);
    const edited = await docs.editPostedWriteoff(owner, writeoff.id, {
      revision, warehouseId: bar.id, items: [{ ingredientId: product.id, quantity: 3 }],
    });
    assert.equal(edited.items[0].unitCost, 3);
    assert.equal(edited.items[0].expected, 10);
    assert.deepEqual([await stock(main, product), await stock(bar, product)], [8, 10], 'replay holds the reported physical counts fixed');
    const reopenedMain = await docs.get(mainCount.id);
    const reopenedBar = await docs.get(barCount.id);
    assert.equal(reopenedMain.items[0].expected, 10);
    assert.equal(reopenedBar.items[0].expected, 7);
    await docs.update(owner, mainCount.id, { revision: reopenedMain.revision, finalize: 'post' });
    await docs.update(owner, barCount.id, { revision: reopenedBar.revision, finalize: 'post' });
    const saved = await docs.get(edited.id);
    assert.equal(saved.status, 'posted');
    assert.deepEqual([await stock(main, product), await stock(bar, product)], [8, 10]);
  });
});

test('PostgreSQL: metadata and details edits preserve stock when the original product is no longer in the catalogue', { skip: !url }, async () => {
  await fixture(async ({ db, owner, main, docs, ingredients, receive, stock, timestamp }) => {
    const product = await ingredients.create({ name: 'Discontinued product', unit: 'pcs' });
    await receive(main, product, 10, 2, 0);
    const legacy = await docs.create(owner, { kind: 'writeoff', warehouseId: main.id, effectiveAt: timestamp(10).toISOString(),
      finalize: 'post', items: [{ ingredientId: product.id, quantity: 2 }] });
    const input = { sourceLineId: randomUUID(), kind: 'ingredient', sourceId: product.id, quantity: 1, unit: 'pcs' };
    const composition = await docs.writeoffPreview({ warehouseId: main.id, effectiveAt: timestamp(20).toISOString(), sourceLines: [input] });
    const sourceLine = { ...input, recipeSignature: composition.sourceLines[0].recipeSignature };
    const posted = await docs.create(owner, { kind: 'writeoff', warehouseId: main.id, effectiveAt: timestamp(20).toISOString(),
      finalize: 'post', sourceLines: [sourceLine] });
    const originalMovements = await db.stockMovement.findMany({ where: { sourceId: { in: [legacy.id, posted.id] } }, orderBy: { id: 'asc' } });
    await db.ingredient.update({ where: { id: product.id }, data: { isActive: false } });

    const metadata = await docs.editPostedWriteoff(owner, legacy.id, { revision: legacy.revision, reason: 'damage', note: 'Уточнение' });
    assert.equal(metadata.note, 'Уточнение');
    assert.equal(metadata.reason, 'damage');
    assert.equal(metadata.sourceLines, undefined);
    const details = await docs.editPostedWriteoff(owner, posted.id, {
      revision: posted.revision, sourceLines: [{ ...sourceLine, details: 'Уточнение позиции' }],
    });
    assert.equal(details.sourceLines[0].details, 'Уточнение позиции');
    assert.equal(details.sourceLines[0].recipeSignature, sourceLine.recipeSignature);
    assert.equal(await stock(main, product), 7);
    const savedMovements = await db.stockMovement.findMany({ where: { sourceId: { in: [legacy.id, posted.id] } }, orderBy: { id: 'asc' } });
    const effects = (rows) => rows.map(({ id, createdAt, change, costAtMoment }) => ({ id, createdAt, change, costAtMoment }));
    assert.deepEqual(effects(savedMovements), effects(originalMovements));
  });
});

test('PostgreSQL: archived write-offs are visible, excluded from P&L, and restore at most once', { skip: !url }, async () => {
  await fixture(async ({ db, cafe, owner, main, docs, ingredients, receive, stock, timestamp }) => {
    const product = await ingredients.create({ name: 'Bottles', unit: 'pcs' });
    await receive(main, product, 10, 2, 0);
    const issued = await docs.create(owner, { kind: 'writeoff', warehouseId: main.id, effectiveAt: timestamp(10).toISOString(),
      finalize: 'post', reason: 'damage', note: 'Archived mismatch', items: [{ ingredientId: product.id, quantity: 10 }] });
    const original = await db.stockMovement.findFirstOrThrow({ where: { sourceId: issued.id } });
    const period = { from: timestamp(0), to: timestamp(45) };
    assert.equal(await stock(main, product), 0);
    assert.equal((await readProfitLoss(db, cafe.id, period)).rows.find(({ label }) => label === 'Складские списания').value, 20);
    await docs.removeWriteoff(owner, issued.id, issued.revision);
    assert.equal(await stock(main, product), 10);
    assert.equal((await docs.list(main.id, 'writeoff', 'Archived mismatch')).length, 0);
    const [deleted] = await docs.list(main.id, 'writeoff', 'Archived mismatch', undefined, true);
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.id, issued.id);
    assert.equal(deleted.status, 'reversed');
    assert.equal((await docs.get(issued.id, false, undefined, true)).items[0].quantity, 10);
    assert.equal((await readProfitLoss(db, cafe.id, period)).rows.find(({ label }) => label === 'Складские списания'), undefined);
    await assert.rejects(docs.restoreWriteoff({ ...owner, role: 'ADMIN' }, deleted.id, deleted.revision), /нет разрешения/i);
    const attempts = await Promise.allSettled([
      docs.restoreWriteoff(owner, deleted.id, deleted.revision), docs.restoreWriteoff(owner, deleted.id, deleted.revision),
    ]);
    assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
    const restored = attempts.find(({ status }) => status === 'fulfilled').value;
    assert.equal(restored.id, issued.id);
    assert.equal(restored.status, 'posted');
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.revision, deleted.revision + 1);
    assert.equal(+restored.effectiveAt, +issued.effectiveAt);
    assert.equal(await stock(main, product), 0);
    const after = await db.stockMovement.findMany({ where: { sourceId: issued.id } });
    assert.deepEqual(after.map(({ id, type, change }) => [id, type, +change]), [[original.id, 'writeoff', -10]]);
    assert.equal((await readProfitLoss(db, cafe.id, period)).rows.find(({ label }) => label === 'Складские списания').value, 20);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: issued.id, actionType: 'WAREHOUSE_WRITEOFF_RESTORED' } });
    assert.equal(audit.metadata.removedReversals.length, 1);
  });
});

test('PostgreSQL: restoring respects closed periods, legacy evidence, and prior storno state', { skip: !url }, async () => {
  await fixture(async ({ db, owner, main, docs, ingredients, receive, stock, timestamp }) => {
    const product = await ingredients.create({ name: 'Archival remainder', unit: 'pcs' });
    await receive(main, product, 10, 2, 0);
    const post = (seconds) => docs.create(owner, { kind: 'writeoff', warehouseId: main.id,
      effectiveAt: timestamp(seconds).toISOString(), finalize: 'post', items: [{ ingredientId: product.id, quantity: 2 }] });
    const issue = await post(10);
    await docs.removeWriteoff(owner, issue.id, issue.revision);
    const deleted = await docs.get(issue.id, false, undefined, true);
    const count = await docs.create(owner, { kind: 'inventory', mode: 'partial', warehouseId: main.id, finalize: 'post',
      items: [{ ingredientId: product.id, quantity: 10 }] });
    await assert.rejects(docs.restoreWriteoff(owner, deleted.id, deleted.revision), /инвентаризация/);
    assert.deepEqual(await docs.get(issue.id, false, undefined, true), deleted);
    assert.equal(await stock(main, product), 10);
    await docs.reopen(owner, count.id, count.revision);
    const restored = await docs.restoreWriteoff(owner, deleted.id, deleted.revision);
    assert.equal(restored.status, 'posted');
    assert.equal(await stock(main, product), 10, 'a reopened count retains the physical quantity');
    const adjustedCount = await docs.get(count.id);
    assert.equal(adjustedCount.items[0].expected, 8);
    await docs.update(owner, count.id, { revision: adjustedCount.revision, finalize: 'post' });

    const now = await docs.create(owner, { kind: 'writeoff', warehouseId: main.id, finalize: 'post',
      items: [{ ingredientId: product.id, quantity: 2 }] });
    const manual = await docs.reverse(owner, now.id, 'Удаление списания', now.revision);
    await docs.removeWriteoff(owner, manual.id, manual.revision);
    const hiddenManual = await docs.get(manual.id, false, undefined, true);
    const shownManual = await docs.restoreWriteoff(owner, manual.id, hiddenManual.revision);
    assert.equal(shownManual.status, 'reversed', 'manual reversal is not undone even if its text matches the legacy delete note');
    assert.equal(await stock(main, product), 10);

    const legacy = await docs.create(owner, { kind: 'writeoff', warehouseId: main.id, finalize: 'post',
      items: [{ ingredientId: product.id, quantity: 1 }] });
    await docs.removeWriteoff(owner, legacy.id, legacy.revision);
    await db.stockMovement.updateMany({ where: { sourceId: legacy.id, type: 'cancel' }, data: { reason: 'reversal' } });
    const hiddenLegacy = await docs.get(legacy.id, false, undefined, true);
    assert.equal((await docs.restoreWriteoff(owner, legacy.id, hiddenLegacy.revision)).status, 'posted');
    assert.equal(await stock(main, product), 9);
    const legacyRestored = await docs.get(legacy.id);
    await docs.removeWriteoff(owner, legacy.id, legacyRestored.revision);
    await db.stockMovement.updateMany({ where: { sourceId: legacy.id, type: 'cancel' }, data: { reason: 'reversal' } });
    await db.auditLog.deleteMany({ where: { entityId: legacy.id, actionType: 'WAREHOUSE_WRITEOFF_DELETED' } });
    const ambiguous = await docs.get(legacy.id, false, undefined, true);
    await assert.rejects(docs.restoreWriteoff(owner, legacy.id, ambiguous.revision), /Не удалось подтвердить/);
    assert.deepEqual(await docs.get(legacy.id, false, undefined, true), ambiguous);
    assert.equal(await stock(main, product), 10);
  });
});
