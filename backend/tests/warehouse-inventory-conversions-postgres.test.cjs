require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');
const { PreparationProductionService } = require('../src/warehouse/preparation-production.ts');
const { ProcessingService } = require('../src/warehouse/processing.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { RecipesService } = require('../src/warehouse/recipes.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehouseReportsService } = require('../src/warehouse/reports.service.ts');
const { OrdersService } = require('../src/orders/orders.service.ts');
const { SettingsService } = require('../src/settings/settings.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

async function inventoryScenario(verify) {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Inventory conversions ' + randomUUID() } });
  const scope = { cafeId: cafe.id };
  try {
    await runWithTenant(scope, async () => {
      const owner = await db.user.create({ data: { name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'test' } });
      const ingredients = new IngredientsService(db);
      const events = new Proxy({}, { get: () => () => {} });
      const locations = new WarehouseLocationsService(db, events);
      const documents = new WarehouseDocumentsService(db);
      const purchases = new PurchasesService(db);
      const production = new PreparationProductionService(db);
      const processing = new ProcessingService(db);
      const reports = new WarehouseReportsService(db);
      const main = (await locations.list(cafe.id)).locations.find((location) => location.isDefault);
      const bar = await locations.save(cafe.id, 'Bar');
      const ingredient = (name, extra = {}) => ingredients.create({ name, unit: 'pcs', ...extra });
      const line = (item, quantity, warehouse = main) => ({ ingredientId: item.id, quantity, unit: 'pcs', warehouseId: warehouse.id });
      const receive = (item, quantity, purchasePrice, warehouse = main) => purchases.create({
        supplier: 'Test supplier', warehouseId: warehouse.id, complete: true,
        items: [{ ingredientId: item.id, quantity, purchasePrice, unit: 'pcs' }],
      });
      const count = (item, quantity) => documents.create(owner, {
        kind: 'inventory', mode: 'partial', warehouseId: main.id, finalize: 'post', items: [{ ingredientId: item.id, quantity }],
      });
      const repost = (opened, item, quantity) => documents.update(owner, opened.id, {
        revision: opened.revision, finalize: 'post', items: [{ ingredientId: item.id, quantity }],
      });
      const balance = async (item, warehouse = main) => {
        const found = (await ingredients.findAll({ warehouseId: warehouse.id })).find(({ id }) => id === item.id);
        return [found.stock, found.avgCost, found.valuationKnown];
      };
      const recipe = (raw, quantity) => ({ outputQuantity: 2, outputUnit: 'pcs', mode: 'stocked', items: [line(raw, quantity)] });
      const preparation = (name, raw, quantity = 4) => production.saveCard({ name, unit: 'pcs', ...recipe(raw, quantity) });
      const produce = (item) => production.produce(item.id, { quantity: 2, unit: 'pcs', warehouseId: main.id }, owner);
      const movements = (sourceId) => db.stockMovement.findMany({ where: { sourceId }, orderBy: { id: 'asc' } });

      await verify({
        db, owner, main, bar, events, ingredient, line, receive, count, repost, balance, recipe, preparation,
        produce, movements, documents, production, processing, reports,
      });
    });
  } finally {
    await db.auditLog.deleteMany({ where: scope });
    await db.financeEntry.deleteMany({ where: scope });
    await db.order.deleteMany({ where: scope });
    await db.dish.deleteMany({ where: scope });
    await db.table.deleteMany({ where: scope });
    await db.hall.deleteMany({ where: scope });
    await db.category.deleteMany({ where: scope });
    await db.settings.deleteMany({ where: scope });
    await db.warehouseDocument.deleteMany({ where: scope });
    await db.processingDocument.deleteMany({ where: scope });
    await db.preparationBatch.deleteMany({ where: scope });
    await db.preparationRecipe.deleteMany({ where: scope });
    await db.stockMovement.deleteMany({ where: scope });
    await db.purchase.deleteMany({ where: scope });
    await db.ingredient.deleteMany({ where: scope });
    await db.user.deleteMany({ where: scope });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
}

function verifyInventory(label, verify) {
  test('PostgreSQL: ' + label, { skip: !url }, () => inventoryScenario(verify));
}

verifyInventory('reprices a batch and two processing outputs through a warehouse transfer and a paid sale', async ({
  db, owner, main, bar, events, ingredient, line, receive, count, repost, balance, recipe, preparation,
  produce, movements, documents, production, processing, reports,
}) => {
  const raw = await ingredient('Raw dough');
  const packaging = await ingredient('Packaging', { stock: 4, avgCost: 10, warehouseId: bar.id });
  const cooked = await preparation('Cooked dough', raw);
  const bread = await ingredient('Bread', { stock: 1, avgCost: 10 });
  const crumbs = await ingredient('Crumbs', { stock: 2, avgCost: 5, warehouseId: bar.id });
  await receive(raw, 12, 10);
  const countBeforeProduction = await count(raw, 12);
  await receive(raw, 12, 30);
  const produced = await produce(cooked);
  assert.equal(produced.totalCost, 80);
  const processed = await processing.create(owner, { complete: true,
    inputs: [line(cooked, 2), line(packaging, 2, bar)],
    outputs: [{ ...line(bread, 3), costSharePercent: 75 }, { ...line(crumbs, 2, bar), costSharePercent: 25 }],
  });
  assert.equal(processed.totalCost, 100);
  const transfer = await documents.create(owner, { kind: 'transfer', warehouseId: main.id, destinationWarehouseId: bar.id,
    items: [{ ingredientId: bread.id, quantity: 1 }], finalize: 'post' });
  const newestCount = await count(raw, 18);
  assert.equal(newestCount.items[0].expected, 20);

  const settings = new SettingsService(db, { log: async () => {} }, events);
  await settings.ensure();
  const shift = await db.waiterShift.create({ data: { waiterId: owner.id } });
  const hall = await db.hall.create({ data: { name: 'Sale room' } });
  const table = await db.table.create({ data: { hallId: hall.id, number: 1 } });
  const category = await db.category.create({ data: { name: 'Bakery', prepStation: 'none' } });
  const dish = await db.dish.create({ data: { name: 'Bread portion', categoryId: category.id, price: 90, prepStation: 'none' } });
  await new RecipesService(db).updateSettings(dish.id, { stockIngredientId: bread.id, stockAmount: 1, stockUnit: 'pcs' });
  const orders = new OrdersService(db, events, { shiftForTerminalOrder: async () => shift }, {
    notifyRole: async () => {}, notifyUser: async () => {}, notifyWaiter: async () => {},
  }, settings, { recalculateDishes: async () => {} }, { log: async () => {} }, new IngredientStockService());
  const check = await orders.create(owner, { tableId: table.id, items: [{ dishId: dish.id, quantity: 1 }] });
  if (check.status === 'ready') await orders.served(check.id, owner.id);
  await orders.markPaid(check.id, owner, 'cash');
  assert.equal((await reports.report({ view: 'sales' })).salesPerformance.actualCost, 21.25);
  assert.deepEqual(await balance(bread), [2, 21.25, true]);

  // Subsequent recipe edits must not rewrite the material quantities in a posted batch.
  await production.saveRecipe(cooked.id, recipe(raw, 9));
  const tracked = [produced.id, processed.id, transfer.id, check.id];
  const originalLegs = await Promise.all(tracked.map(movements));
  const opened = await documents.reopen(owner, countBeforeProduction.id, countBeforeProduction.revision);
  assert.equal((await production.batch(produced.id)).totalCost, 80);
  assert.deepEqual(await balance(bread), [2, 21.25, true]);
  const corrected = await repost(opened, raw, 4);
  assert.equal(corrected.id, countBeforeProduction.id);
  assert.equal((corrected.countedAt ?? corrected.postedAt).getTime(), opened.countedAt.getTime());
  assert.equal(corrected.reopenedAt, null);
  assert.equal(corrected.items[0].difference, -8);

  const batch = await production.batch(produced.id);
  assert.deepEqual([batch.quantity, batch.totalCost, batch.unitCost], [2, 100, 50]);
  assert.deepEqual(batch.items.actual.map(({ ingredientId, quantity, costAtMoment, cost }) =>
    [ingredientId, quantity, Number(costAtMoment), Number(cost)]), [[raw.id, 4, 25, 100]]);
  assert.equal((await production.getRecipe(cooked.id)).items[0].quantity, 9);
  const converted = await processing.findOne(processed.id);
  assert.equal(converted.totalCost, 120);
  assert.equal(converted.hasUnknownCost, false);
  assert.deepEqual(converted.inputs.map(({ lineCost, unitCost }) => [lineCost, unitCost]), [[100, 50], [20, 10]]);
  assert.deepEqual(converted.outputs.map(({ lineCost, unitCost, costSharePercent }) =>
    [lineCost, unitCost, costSharePercent]), [[90, 30, 75], [30, 15, 25]]);
  assert.deepEqual(await balance(raw), [18, 25, true]);
  assert.deepEqual(await balance(bread), [2, 25, true]);
  assert.deepEqual(await balance(bread, bar), [1, 25, true]);
  assert.deepEqual(await balance(crumbs, bar), [4, 10, true]);
  assert.deepEqual(await balance(packaging, bar), [2, 10, true]);
  const later = (await documents.get(newestCount.id)).items[0];
  assert.deepEqual([later.expected, later.quantity, later.difference], [12, 18, 6]);
  assert.equal((await reports.report({ view: 'sales' })).salesPerformance.actualCost, 25);
  for (const [item, warehouse, amount, unitCost, value] of [[raw, main, 18, 25, 450], [bread, main, 2, 25, 50], [bread, bar, 1, 25, 25], [crumbs, bar, 4, 10, 40]]) {
    const report = await reports.report({ view: 'movement_summary', ingredientId: item.id, warehouseId: warehouse.id });
    const row = report.rows[0];
    assert.deepEqual([row.closingQuantity, row.closingAvgCost, row.closingValue], [amount, unitCost, value]);
  }
  const resultLegs = await Promise.all(tracked.map(movements));
  const immutable = (groups) => groups.map((group) => group.map(({ id, ingredientId, warehouseId, change, createdAt }) =>
    [id, ingredientId, warehouseId, Number(change), createdAt]));
  assert.deepEqual(immutable(resultLegs), immutable(originalLegs), 'replay keeps conversion, transfer and sale legs and quantities');
});

verifyInventory('rejects a shortage at production time and keeps the opened revision and ledger intact', async ({
  db, ingredient, count, repost, balance, preparation, produce, movements, documents, production, owner,
}) => {
  const raw = await ingredient('Shortage raw', { stock: 12, avgCost: 10 });
  const cooked = await preparation('Shortage cooked', raw);
  const initial = await count(raw, 12);
  const produced = await produce(cooked);
  const oldLegs = await movements(produced.id);
  const opened = await documents.reopen(owner, initial.id, initial.revision);
  await assert.rejects(repost(opened, raw, 3), /недостаточно|отрицательн/iu);
  const retained = await documents.get(initial.id);
  assert.equal(retained.revision, opened.revision);
  assert.equal(retained.status, 'draft');
  assert.equal(retained.items[0].quantity, 12);
  assert.deepEqual(await movements(produced.id), oldLegs);
  assert.equal((await production.batch(produced.id)).totalCost, 40);
  assert.deepEqual(await balance(raw), [8, 10, true]);
  assert.deepEqual(await balance(cooked), [2, 20, true]);
  assert.equal(await db.auditLog.count({ where: { entityId: initial.id, actionType: 'WAREHOUSE_INVENTORY_REPOSTED' } }), 0);
  await repost(opened, raw, 5);
  assert.deepEqual(await balance(raw), [1, 10, true]);
});

verifyInventory('rolls back a repost when a downstream production output is locked and succeeds after release', async ({
  db, owner, ingredient, receive, count, repost, balance, preparation, produce, movements, documents, production,
}) => {
  const raw = await ingredient('Locked output raw');
  const cooked = await preparation('Locked output', raw);
  await receive(raw, 12, 10);
  const initial = await count(raw, 12);
  await receive(raw, 12, 30);
  const produced = await produce(cooked);
  const originalLegs = await movements(produced.id);
  const opened = await documents.reopen(owner, initial.id, initial.revision);

  let acquired;
  let release;
  const ready = new Promise((resolve) => { acquired = resolve; });
  const done = new Promise((resolve) => { release = resolve; });
  const lock = db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${cooked.id} AND cafe_id = ${owner.cafeId} FOR UPDATE`;
    assert.equal(rows.length, 1);
    acquired();
    await done;
  }, { timeout: 10000 });
  try {
    await Promise.race([ready, lock]);
    await assert.rejects(repost(opened, raw, 4), { status: 409, message: /связанные остатки изменяются/iu });
  } finally {
    release();
    await lock;
  }
  const unchanged = await documents.get(initial.id);
  assert.equal(unchanged.status, 'draft');
  assert.equal(unchanged.revision, opened.revision);
  assert.equal(unchanged.items[0].quantity, 12);
  assert.equal(await db.auditLog.count({ where: { entityId: initial.id, actionType: 'WAREHOUSE_INVENTORY_REPOSTED' } }), 0);
  assert.deepEqual(await movements(produced.id), originalLegs);
  assert.deepEqual(await balance(raw), [20, 20, true]);
  assert.deepEqual(await balance(cooked), [2, 40, true]);

  assert.equal((await repost(opened, raw, 4)).status, 'posted');
  assert.equal((await production.batch(produced.id)).totalCost, 100);
  assert.deepEqual(await balance(raw), [12, 25, true]);
  assert.deepEqual(await balance(cooked), [2, 50, true]);
});

verifyInventory('a zero count followed by a priced receipt fixes unknown valuation through both conversions', async ({
  ingredient, line, receive, count, repost, balance, preparation, produce, documents, production, processing, owner,
}) => {
  const raw = await ingredient('Unpriced raw', { stock: 12 });
  const cooked = await preparation('Unpriced cooked', raw);
  const output = await ingredient('Unpriced output');
  const initial = await count(raw, 12);
  await receive(raw, 12, 30);
  const produced = await produce(cooked);
  assert.equal(produced.costKnown, false);
  assert.equal(produced.totalCost, null);
  const processed = await processing.create(owner, { complete: true, inputs: [line(cooked, 2)], outputs: [line(output, 3)] });
  assert.equal(processed.hasUnknownCost, true);
  assert.deepEqual(await balance(output), [3, null, false]);
  await repost(await documents.reopen(owner, initial.id, initial.revision), raw, 0);
  assert.equal((await production.batch(produced.id)).totalCost, 120);
  const converted = await processing.findOne(processed.id);
  assert.equal(converted.hasUnknownCost, false);
  assert.deepEqual([converted.totalCost, converted.outputs[0].unitCost], [120, 40]);
  assert.deepEqual(await balance(output), [3, 40, true]);
});

verifyInventory('an already reversed processing and production chain remains reversed after repricing', async ({
  ingredient, line, receive, count, repost, balance, preparation, produce, movements, documents, production, processing, owner,
}) => {
  const raw = await ingredient('Reversed raw');
  const cooked = await preparation('Reversed cooked', raw);
  const output = await ingredient('Reversed output');
  await receive(raw, 12, 10);
  const initial = await count(raw, 12);
  await receive(raw, 12, 30);
  const produced = await produce(cooked);
  const converted = await processing.create(owner, { complete: true, inputs: [line(cooked, 2)], outputs: [line(output, 4)] });
  await processing.reverse(owner, converted.id, { revision: converted.revision, note: 'Incorrect processing' });
  await production.reverse(produced.id, 'Incorrect production', owner);

  await repost(await documents.reopen(owner, initial.id, initial.revision), raw, 4);
  const updatedBatch = await production.batch(produced.id);
  const updatedProcessing = await processing.findOne(converted.id);
  assert.ok(updatedBatch.reversedAt);
  assert.equal(updatedBatch.totalCost, 100);
  assert.equal(updatedProcessing.status, 'reversed');
  assert.equal(updatedProcessing.totalCost, 100);
  for (const [document, values] of [[produced, [25, 50]], [converted, [25, 50]]]) {
    const legs = await movements(document.id);
    assert.equal(legs.length, 4);
    assert.deepEqual(legs.filter(({ type }) => type === 'cancel').map(({ costAtMoment }) => Number(costAtMoment)).sort((a, b) => a - b), values);
  }
  assert.deepEqual(await balance(raw), [16, 25, true]);
  assert.deepEqual(await balance(cooked), [0, null, false]);
  assert.deepEqual(await balance(output), [0, null, false]);
});
