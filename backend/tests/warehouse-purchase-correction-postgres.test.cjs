require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { WarehouseReportsService } = require('../src/warehouse/reports.service.ts');
const { postStockMovement } = require('../src/warehouse/stock-posting.ts');
const { lockIngredients } = require('../src/warehouse/stock-lock.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} ~= ${expected}`);

async function fixture(run) {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Purchase corrections ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const warehouse = { ...(await locations.list(cafe.id)).locations[0], cafeId: cafe.id };
      const ingredients = new IngredientsService(db);
      const purchases = new PurchasesService(db);
      const docs = new WarehouseDocumentsService(db);
      const actor = await db.user.create({ data: { name: 'Correction owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'unused' } });
      await run({ db, cafe, locations, warehouse, ingredients, purchases, docs, actor });
    });
  } finally {
    await db.auditLog.deleteMany({ where: { cafeId: cafe.id } });
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
}

test('PostgreSQL: completed purchase corrections adjust quantity/value atomically and preserve original evidence', { skip: !url }, async () => fixture(async ({ db, warehouse, locations, ingredients, purchases, actor }) => {
  const ingredient = await ingredients.create({ name: 'Correction bottle', unit: 'pcs', stock: 2, avgCost: 5 });
  let purchase = await purchases.create({ supplier: 'Supplier', warehouseId: warehouse.id, complete: true,
    items: [{ ingredientId: ingredient.id, quantity: 10, purchasePrice: 10 }] }, actor);
  const original = await db.stockMovement.findMany({ where: { sourceId: purchase.id } });
  assert.equal(purchase.canCorrectStock, true);
  assert.equal(new Date(purchase.postedAt).getTime(), original[0].createdAt.getTime());
  purchase = await purchases.update(purchase.id, { expectedUpdatedAt: purchase.updatedAt.toISOString(),
    items: [{ ingredientId: ingredient.id, quantity: 12, purchasePrice: 20 }] }, actor);
  let balance = await db.ingredient.findUnique({ where: { id: ingredient.id } });
  assert.equal(Number(balance.stock), 14);
  near(Number(balance.stock.mul(balance.avgCost)), 250);
  assert.deepEqual(await db.stockMovement.findMany({ where: { id: { in: original.map((row) => row.id) } } }), original);
  assert.equal(purchase.corrections.length, 1);
  assert.equal(purchase.corrections[0].before.totalAmount, 100);
  assert.equal(purchase.corrections[0].after.totalAmount, 240);
  assert.equal(purchase.corrections[0].actorName, actor.name);
  const oldVersion = purchase.updatedAt.toISOString();
  purchase = await purchases.update(purchase.id, { expectedUpdatedAt: oldVersion,
    items: [{ ingredientId: ingredient.id, quantity: 12, purchasePrice: 30 }], discount: 12 }, actor);
  balance = await db.ingredient.findUnique({ where: { id: ingredient.id } });
  assert.equal(Number(balance.stock), 14);
  near(Number(balance.stock.mul(balance.avgCost)), 358);
  await assert.rejects(purchases.update(purchase.id, { expectedUpdatedAt: oldVersion, note: 'Stale overwrite' }), /изменилась/);
  assert.equal((await purchases.findOne(purchase.id)).corrections.length, 2);
  const other = await locations.save(actor.cafeId, 'Receiving warehouse');
  purchase = await purchases.update(purchase.id, { expectedUpdatedAt: purchase.updatedAt.toISOString(), warehouseId: other.id }, actor);
  balance = await db.ingredient.findUnique({ where: { id: ingredient.id } });
  assert.equal(Number(balance.stock), 2);
  near(Number(balance.avgCost), 5);
  const transferred = await db.warehouseStock.findUnique({ where: { warehouseId_ingredientId: { warehouseId: other.id, ingredientId: ingredient.id } } });
  assert.equal(Number(transferred.stock), 12);
  near(Number(transferred.stock.mul(transferred.avgCost)), 348);
  assert.equal(purchase.corrections.length, 3);
  assert.equal((await db.auditLog.count({ where: { entityId: purchase.id } })), 3);
}));

test('PostgreSQL: historical receipt edits reprice downstream consumption and net signed quantities in the same report', { skip: !url }, async () => fixture(async ({ db, cafe, warehouse, ingredients, purchases, actor }) => {
  const ingredient = await ingredients.create({ name: 'Consumed bottle', unit: 'pcs' });
  const purchase = await purchases.create({ supplier: 'Supplier', complete: true, items: [{ ingredientId: ingredient.id, quantity: 10, purchasePrice: 10 }] }, actor);
  const original = await db.stockMovement.findFirstOrThrow({ where: { sourceId: purchase.id, type: 'purchase' } });
  const sale = await db.$transaction(async (tx) => {
    await lockIngredients(tx, [ingredient.id]);
    return postStockMovement(tx, { ingredientId: ingredient.id, warehouse, change: new Prisma.Decimal(-2),
      movement: { type: 'sale', sourceType: 'order', sourceId: randomUUID(), createdAt: new Date(+original.createdAt + 10) } });
  });
  let detail = await purchases.findOne(purchase.id);
  assert.equal(detail.canCorrectStock, true);
  assert.equal(detail.historicalStockCorrection, true);
  assert.equal(detail.correctionBlockedReason, null);
  const edit = (quantity, purchasePrice, expectedUpdatedAt = detail.updatedAt.toISOString()) => purchases.update(purchase.id, {
    expectedUpdatedAt, items: [{ ingredientId: ingredient.id, quantity, purchasePrice }],
  }, actor);
  const readSale = async () => db.stockMovement.findUniqueOrThrow({ where: { id: sale.movement.id } });
  detail = await edit(10, 20);
  assert.equal(Number((await readSale()).costAtMoment), 20, 'price-only edits reprice the later physical sale');
  assert.equal(await db.stockMovement.count({ where: { sourceId: purchase.id, type: 'correction', change: 0 } }), 1);
  detail = await purchases.update(purchase.id, { expectedUpdatedAt: detail.updatedAt.toISOString(), note: 'Corrected invoice comment' }, actor);
  assert.equal(detail.historicalStockCorrection, true);
  detail = await edit(12, 20);
  const reports = new WarehouseReportsService(db);
  const summary = async () => (await reports.report({ view: 'movement_summary', ingredientId: ingredient.id, warehouseId: warehouse.id })).rows[0];
  assert.deepEqual([(await summary()).incomingQuantity, (await summary()).closingQuantity], [12, 10]);
  const stale = detail.updatedAt.toISOString();
  detail = await edit(9, 30);
  assert.equal(detail.corrections.length, 4);
  await assert.rejects(edit(8, 30, stale), /изменилась/);
  const row = await summary();
  assert.deepEqual([row.incomingQuantity, row.outgoingQuantity, row.closingQuantity, row.closingValue], [9, 2, 7, 210]);
  const movementGroups = (await reports.report({ view: 'movements', ingredientId: ingredient.id, warehouseId: warehouse.id })).movementGroups;
  const receiptGroup = movementGroups.find((group) => group.sourceType === 'purchase');
  assert.equal(receiptGroup.direction, 'incoming');
  assert.deepEqual([receiptGroup.quantity, receiptGroup.averageCost], [9, 30]);
  assert.equal(movementGroups.some((group) => group.direction === 'outgoing' && group.sourceType === 'purchase'), false);
  assert.deepEqual(await db.stockMovement.findUniqueOrThrow({ where: { id: original.id } }), original);
  await assert.rejects(edit(1, 30), /недостаточно/);
  assert.equal((await purchases.findOne(purchase.id)).totalAmount, 270, 'failed replay rolls the edited invoice back');
  assert.equal(Number((await readSale()).costAtMoment), 30);

  const another = await purchases.create({ supplier: 'Same timestamp', effectiveAt: original.createdAt.toISOString(), complete: true,
    items: [{ ingredientId: ingredient.id, quantity: 3, purchasePrice: 12 }] }, actor);
  assert.equal(Number((await readSale()).costAtMoment), 25.5, 'subsequent replay consumes the prior signed corrections in order');
  assert.equal((await summary()).incomingQuantity, 12);
  assert.equal((await purchases.findOne(another.id)).stockPostedAt.getTime() >= +original.createdAt, true);
  assert.match((await purchases.findOne(purchase.id)).correctionBlockedReason, /совпадает время/);
  await assert.rejects(edit(8, 30), /совпадает время/);
  await runWithTenant({ cafeId: randomUUID() }, async () => await assert.rejects(edit(9, 30), /не найдена/));
}));

test('PostgreSQL: current price-only receipt correction contributes invoice value without moving stock', { skip: !url }, async () => fixture(async ({ db, warehouse, ingredients, purchases, actor }) => {
  const ingredient = await ingredients.create({ name: 'Price only', unit: 'pcs' });
  const original = await purchases.create({ supplier: 'Supplier', complete: true,
    items: [{ ingredientId: ingredient.id, quantity: 10, purchasePrice: 10 }] }, actor);
  const updated = await purchases.update(original.id, { expectedUpdatedAt: original.updatedAt.toISOString(),
    items: [{ ingredientId: ingredient.id, quantity: 10, purchasePrice: 20 }] }, actor);
  assert.equal(updated.historicalStockCorrection, false);
  const reports = new WarehouseReportsService(db);
  const options = { ingredientId: ingredient.id, warehouseId: warehouse.id };
  const purchasesReport = await reports.report({ ...options, view: 'purchases' });
  assert.equal(purchasesReport.totalCost, 200);
  assert.equal(purchasesReport.rows.find((row) => row.type === 'correction').totalCost, 100);
  const { movementGroups: [group] } = await reports.report({ ...options, view: 'movements' });
  assert.deepEqual([group.direction, group.quantity, group.averageCost, group.count], ['incoming', 10, 20, 1]);
  const { rows: [balance] } = await reports.report({ ...options, view: 'movement_summary' });
  assert.deepEqual([balance.incomingQuantity, balance.outgoingQuantity, balance.closingQuantity, balance.closingValue], [10, 0, 10, 200]);
}));

test('PostgreSQL: return limits aggregate duplicate receipt lines, exclude drafts/reversals and follow display units', { skip: !url }, async () => fixture(async ({ db, warehouse, ingredients, purchases, docs, actor }) => {
  const ingredient = await ingredients.create({ name: 'Return flour', unit: 'kg' });
  const purchase = await purchases.create({ supplier: 'Supplier', complete: true, discount: 25, items: [
    { ingredientId: ingredient.id, quantity: 2, unit: 'kg', purchasePrice: 100 },
    { ingredientId: ingredient.id, quantity: 500, unit: 'g', purchasePrice: 0.1 },
  ] }, actor);
  const makeReturn = (quantity, finalize) => docs.create(actor, { kind: 'supplier_return', warehouseId: warehouse.id,
    sourcePurchaseId: purchase.id, items: [{ ingredientId: ingredient.id, quantity }], finalize });
  await makeReturn(0.2);
  const returned = await makeReturn(0.5, 'post');
  let row = (await purchases.findOne(purchase.id)).returnableItems[0];
  assert.equal(row.receivedQuantity, 2.5);
  assert.equal(row.returnedQuantity, 0.5);
  assert.equal(row.remainingQuantity, 2);
  assert.equal(row.remainingQuantityBase, 2000);
  assert.equal(row.unitCode, 'kg');
  await db.ingredient.update({ where: { id: ingredient.id }, data: { displayUnit: 'g' } });
  row = (await purchases.findOne(purchase.id)).returnableItems[0];
  assert.equal(row.remainingQuantity, 2000);
  assert.equal(row.unit, 'г');
  await docs.reverse(actor, returned.id, 'Return cancelled', returned.revision);
  assert.equal((await purchases.findOne(purchase.id)).returnableItems[0].remainingQuantity, 2500);
}));

test('PostgreSQL: last purchase prices use invoices, warehouse/tenant scope and do not substitute weighted cost', { skip: !url }, async () => fixture(async ({ db, cafe, locations, warehouse, ingredients, purchases }) => {
  const ingredient = await ingredients.create({ name: 'Last price flour', unit: 'kg', stock: 10, avgCost: 1 });
  const earlier = new Date(Date.now() - 86400000).toISOString();
  const purchase = await purchases.create({ supplier: 'Invoice supplier', date: earlier, complete: true, discount: 25, items: [
    { ingredientId: ingredient.id, quantity: 2, unit: 'kg', purchasePrice: 100 },
    { ingredientId: ingredient.id, quantity: 500, unit: 'g', purchasePrice: 0.1 },
  ] });
  const bar = await locations.save(cafe.id, 'Price bar');
  const barPurchase = await purchases.create({ supplier: 'Bar supplier', warehouseId: bar.id, complete: true, discount: 30,
    items: [{ ingredientId: ingredient.id, quantity: 1, unit: 'kg', purchasePrice: 300 },
      { ingredientId: ingredient.id, quantity: 500, unit: 'g', purchasePrice: 0.18 }] });
  await purchases.create({ supplier: 'Draft ignored', items: [{ ingredientId: ingredient.id, quantity: 1, purchasePrice: 999 }] });
  const mainPrice = (await purchases.lastPrices({ ingredientIds: ingredient.id, warehouseId: warehouse.id }))[0];
  assert.equal(mainPrice.unitPrice, 100);
  assert.equal(mainPrice.purchaseId, purchase.id);
  assert.equal(mainPrice.date.toISOString(), earlier);
  assert.equal((await purchases.lastPrices({ ingredientIds: ingredient.id }))[0].purchaseId, barPurchase.id);
  assert.equal((await purchases.lastPrices({ ingredientIds: ingredient.id, excludePurchaseId: barPurchase.id }))[0].unitPrice, 100);
  await purchases.create({ supplier: 'Old invoice entered later', effectiveAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    warehouseId: warehouse.id, complete: true, items: [{ ingredientId: ingredient.id, quantity: 1, unit: 'kg', purchasePrice: 999 }] });
  const latestSupply = (await ingredients.supplies(ingredient.id, {})).rows[0];
  assert.equal(latestSupply.purchaseId, barPurchase.id);
  assert.equal(latestSupply.unitPrice, 240);
  assert.equal((await ingredients.findOne(ingredient.id)).lastPurchasePrice, 240,
    'the card uses the newest invoice by operation date and all of its discounted lines');
  await runWithTenant({ cafeId: randomUUID() }, async () => assert.deepEqual(await purchases.lastPrices({ ingredientIds: ingredient.id }), []));
  await assert.rejects(purchases.lastPrices({ ingredientIds: Array.from({ length: 101 }, (_, i) => `id${i}`).join(',') }), /100/);
}));

test('PostgreSQL: future invoice cannot post and concurrent correction cannot apply twice', { skip: !url }, async () => fixture(async ({ db, ingredients, purchases }) => {
  const ingredient = await ingredients.create({ name: 'Concurrent purchase item', unit: 'pcs' });
  const future = new Date(Date.now() + 3600000).toISOString();
  const draft = await purchases.create({ supplier: 'Future', date: future, items: [{ ingredientId: ingredient.id, quantity: 1, purchasePrice: 1 }] });
  await assert.rejects(purchases.complete(draft.id), /будущем/);
  await assert.rejects(purchases.create({ supplier: 'Future', date: future, complete: true, items: [{ ingredientId: ingredient.id, quantity: 1, purchasePrice: 1 }] }), /будущем/);
  const purchase = await purchases.create({ supplier: 'Current', complete: true, items: [{ ingredientId: ingredient.id, quantity: 10, purchasePrice: 2 }] });
  const dto = { expectedUpdatedAt: purchase.updatedAt.toISOString(), items: [{ ingredientId: ingredient.id, quantity: 12, purchasePrice: 3 }] };
  const results = await Promise.allSettled([purchases.update(purchase.id, dto), purchases.update(purchase.id, dto)]);
  assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
  assert.equal(Number((await db.ingredient.findUnique({ where: { id: ingredient.id } })).stock), 12);
  assert.equal((await purchases.findOne(purchase.id)).corrections.length, 1);
}));

test('PostgreSQL: zero-difference inventory and a receipt covering negative stock are correction boundaries', { skip: !url }, async () => fixture(async ({ db, warehouse, ingredients, purchases, docs, actor }) => {
  const ingredient = await ingredients.create({ name: 'Counted receipt', unit: 'pcs' });
  const purchase = await purchases.create({ supplier: 'Counted', complete: true,
    items: [{ ingredientId: ingredient.id, quantity: 10, purchasePrice: 5 }] });
  const count = await docs.create(actor, { kind: 'inventory', mode: 'partial', warehouseId: warehouse.id,
    items: [{ ingredientId: ingredient.id, quantity: 10 }], finalize: 'post' });
  assert.equal(await db.stockMovement.count({ where: { sourceId: count.id } }), 0, 'zero discrepancy has no ledger movement');
  assert.match((await purchases.findOne(purchase.id)).correctionBlockedReason, /инвентаризация/);
  await assert.rejects(purchases.update(purchase.id, { expectedUpdatedAt: purchase.updatedAt.toISOString(),
    items: [{ ingredientId: ingredient.id, quantity: 11, purchasePrice: 5 }] }), /инвентаризация/);
  const missing = await ingredients.create({ name: 'Negative opening', unit: 'pcs' });
  await db.$transaction(async (tx) => {
    await lockIngredients(tx, [missing.id]);
    await postStockMovement(tx, { ingredientId: missing.id, warehouse, change: new Prisma.Decimal(-2), allowNegative: true,
      movement: { type: 'sale', sourceType: 'order', sourceId: randomUUID() } });
  });
  const covering = await purchases.create({ supplier: 'Covering', complete: true,
    items: [{ ingredientId: missing.id, quantity: 5, purchasePrice: 10 }] });
  assert.equal(covering.canCorrectStock, false);
  assert.match(covering.correctionBlockedReason, /отрицательный/);
  await assert.rejects(purchases.update(covering.id, { expectedUpdatedAt: covering.updatedAt.toISOString(),
    items: [{ ingredientId: missing.id, quantity: 6, purchasePrice: 10 }] }), /отрицательный/);
  assert.equal((await purchases.update(covering.id, { expectedUpdatedAt: covering.updatedAt.toISOString(), note: 'Metadata only' })).note, 'Metadata only');
}));

test('PostgreSQL: relocating fractional mass leaves no rounding stock value and foreign tenant cannot correct', { skip: !url }, async () => fixture(async ({ db, cafe, locations, ingredients, purchases }) => {
  const ingredient = await ingredients.create({ name: 'Fractional receipt', unit: 'kg' });
  const purchase = await purchases.create({ supplier: 'Fractional', complete: true,
    items: [{ ingredientId: ingredient.id, quantity: 3.333, unit: 'kg', total: 3.33 }] });
  await runWithTenant({ cafeId: randomUUID() }, async () => {
    await assert.rejects(purchases.findOne(purchase.id), /не найдена/);
    await assert.rejects(purchases.update(purchase.id, { expectedUpdatedAt: purchase.updatedAt.toISOString(), note: 'Foreign' }), /не найдена/);
  });
  const destination = await locations.save(cafe.id, 'Fractional destination');
  await purchases.update(purchase.id, { expectedUpdatedAt: purchase.updatedAt.toISOString(), warehouseId: destination.id });
  const source = await db.ingredient.findUnique({ where: { id: ingredient.id } });
  assert.equal(Number(source.stock), 0);
  const target = await db.warehouseStock.findUnique({ where: { warehouseId_ingredientId: { warehouseId: destination.id, ingredientId: ingredient.id } } });
  assert.equal(Number(target.stock), 3333);
  near(Number(target.stock.mul(target.avgCost)), 3.33);
  const ledger = await db.stockMovement.findMany({ where: { ingredientId: ingredient.id } });
  near(Number(ledger.reduce((sum, row) => sum.add(row.change.mul(row.costAtMoment)).add(row.valuationAdjustment), new Prisma.Decimal(0))), 3.33);
}));

test('PostgreSQL: a transaction started before the receipt but waiting on its lock gets a later posting time', { skip: !url }, async () => fixture(async ({ db, warehouse, ingredients, purchases }) => {
  const ingredient = await ingredients.create({ name: 'Waiting transaction', unit: 'pcs' });
  const draft = await purchases.create({ supplier: 'Lock timing', items: [{ ingredientId: ingredient.id, quantity: 10, purchasePrice: 2 }] });
  let started, allowLock, attempting;
  const startedSignal = new Promise((resolve) => { started = resolve; });
  const lockGate = new Promise((resolve) => { allowLock = resolve; });
  const attemptSignal = new Promise((resolve) => { attempting = resolve; });
  let transactionStartedAt;
  const waiting = db.$transaction(async (tx) => {
    transactionStartedAt = (await tx.$queryRaw`SELECT now() AS at`)[0].at;
    started();
    await lockGate;
    attempting();
    await lockIngredients(tx, [ingredient.id]);
    return postStockMovement(tx, { ingredientId: ingredient.id, warehouse, change: new Prisma.Decimal(-1),
      movement: { type: 'sale', sourceType: 'order', sourceId: randomUUID() } });
  });
  await startedSignal;
  await db.$transaction(async (tx) => {
    await purchases.lockPurchase(tx, draft.id);
    await lockIngredients(tx, [ingredient.id]);
    allowLock();
    await attemptSignal;
    const stored = await tx.purchase.findUnique({ where: { id: draft.id }, include: { items: true } });
    await purchases.completePurchase(tx, stored);
  });
  const consumption = (await waiting).movement;
  const detail = await purchases.findOne(draft.id);
  assert.ok(transactionStartedAt < detail.postedAt, 'waiting transaction really began before posting');
  assert.ok(consumption.createdAt >= detail.postedAt, 'posting uses wall clock after the ingredient lock');
  assert.equal(detail.historicalStockCorrection, consumption.createdAt > detail.postedAt,
    'consumption must enter historical replay unless the two timestamps are indistinguishable');
}));
