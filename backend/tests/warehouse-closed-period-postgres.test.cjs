require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { ProcessingService } = require('../src/warehouse/processing.ts');
const { PreparationProductionService } = require('../src/warehouse/preparation-production.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: closed inventory counts protect reversals without blocking unrelated products or warehouses', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Closed period ' + randomUUID() } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = { id: randomUUID(), cafeId: cafe.id, name: 'Owner', role: 'OWNER' };
      const ingredients = new IngredientsService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const docs = new WarehouseDocumentsService(db);
      const processing = new ProcessingService(db);
      const [main] = (await locations.list(cafe.id)).locations;
      const bar = await locations.save(cafe.id, 'Bar');
      const milk = await ingredients.create({ name: 'Milk', unit: 'pcs', stock: 10, avgCost: 2 });
      const count = (warehouseId, ingredientId, quantity) => docs.create(owner, {
        kind: 'inventory', mode: 'partial', warehouseId, items: [{ ingredientId, quantity }], finalize: 'post',
      });
      const stock = async (id, warehouseId = main.id) => (await ingredients.findAll({ warehouseId })).find((row) => row.id === id).stock;

      const first = await count(main.id, milk.id, 8);
      const second = await count(main.id, milk.id, 7);
      const movementsBefore = await db.stockMovement.findMany({ where: { ingredientId: milk.id }, orderBy: { id: 'asc' } });
      assert.match((await docs.get(first.id)).reversalBlockedReason, /инвентаризация/);
      await assert.rejects(docs.reverse(owner, first.id, 'Wrong old count', first.revision), /инвентаризация/);
      assert.equal(await stock(milk.id), 7, 'an older count must not change the newer physical result');
      assert.deepEqual(await db.stockMovement.findMany({ where: { ingredientId: milk.id }, orderBy: { id: 'asc' } }), movementsBefore);
      await docs.reverse(owner, second.id, 'Undo last count', second.revision);
      await docs.reverse(owner, first.id, 'Undo earlier count', first.revision);
      assert.equal(await stock(milk.id), 10);

      const transfer = await docs.create(owner, { kind: 'transfer', warehouseId: main.id, destinationWarehouseId: bar.id,
        items: [{ ingredientId: milk.id, quantity: 2 }], finalize: 'post' });
      const noDifference = await count(bar.id, milk.id, 2);
      assert.equal(await db.stockMovement.count({ where: { sourceId: noDifference.id } }), 0);
      await assert.rejects(docs.reverse(owner, transfer.id, 'Destination already counted', transfer.revision), /инвентаризация/);
      assert.deepEqual([await stock(milk.id), await stock(milk.id, bar.id)], [8, 2]);

      const flour = await ingredients.create({ name: 'Flour', unit: 'pcs', stock: 10, avgCost: 3 });
      const waste = await docs.create(owner, { kind: 'writeoff', reason: 'damage', warehouseId: main.id,
        items: [{ ingredientId: flour.id, quantity: 1 }], finalize: 'post' });
      await count(main.id, milk.id, 8);
      await count(bar.id, flour.id, 0);
      assert.equal((await docs.get(waste.id)).reversalBlockedReason, undefined);
      await docs.reverse(owner, waste.id, 'Unrelated counts do not close this product', waste.revision);
      assert.equal(await stock(flour.id), 10);

      const skipped = await ingredients.create({ name: 'Excluded from count', unit: 'pcs', stock: 5, avgCost: 1 });
      const partial = await docs.create(owner, { kind: 'inventory', mode: 'partial', warehouseId: main.id,
        items: [{ ingredientId: flour.id, quantity: 10 }], finalize: 'post' });
      await count(main.id, skipped.id, 4);
      await docs.reverse(owner, partial.id, 'Skipped products do not belong to this count', partial.revision);
      assert.equal(await stock(skipped.id), 4);

      const purchased = await ingredients.create({ name: 'Purchased', unit: 'pcs' });
      const receipt = await new PurchasesService(db).create({ supplier: 'Supplier', warehouseId: main.id, complete: true,
        items: [{ ingredientId: purchased.id, quantity: 5, unit: 'pcs', purchasePrice: 3 }] });
      const returned = await docs.create(owner, { kind: 'supplier_return', warehouseId: main.id, sourcePurchaseId: receipt.id,
        items: [{ ingredientId: purchased.id, quantity: 1 }], finalize: 'post' });
      await count(main.id, purchased.id, 4);
      await assert.rejects(docs.reverse(owner, returned.id, 'Already counted', returned.revision), /инвентаризация/);
      assert.equal(await stock(purchased.id), 4);
      assert.equal((await docs.get(returned.id)).revision, returned.revision);

      const output = await ingredients.create({ name: 'Output', unit: 'pcs' });
      const batch = await processing.create(owner, { complete: true,
        inputs: [{ ingredientId: flour.id, warehouseId: main.id, quantity: 2, unit: 'pcs' }],
        outputs: [{ ingredientId: output.id, warehouseId: bar.id, quantity: 2, unit: 'pcs', costSharePercent: 100 }],
      });
      await count(bar.id, output.id, 2);
      assert.match((await processing.findOne(batch.id)).reversalBlockedReason, /инвентаризация/);
      await assert.rejects(processing.reverse(owner, batch.id, { note: 'Counted output', revision: batch.revision }), /инвентаризация/);
      assert.deepEqual([await stock(flour.id), await stock(output.id, bar.id)], [8, 2]);
      assert.equal((await processing.findOne(batch.id)).revision, batch.revision);

      const production = new PreparationProductionService(db);
      const preparation = await production.saveCard({ name: 'Preparation', unit: 'pcs', mode: 'stocked', outputQuantity: 1, outputUnit: 'pcs',
        items: [{ ingredientId: flour.id, quantity: 1, unit: 'pcs' }] });
      const produced = await production.produce(preparation.id, { quantity: 2, unit: 'pcs', warehouseId: main.id }, owner);
      await count(main.id, preparation.id, 2);
      const productionMoves = await db.stockMovement.count({ where: { sourceId: produced.id } });
      assert.match((await production.batch(produced.id)).reversalBlockedReason, /инвентаризация/);
      await assert.rejects(production.reverse(produced.id, 'Already counted', owner), /инвентаризация/);
      assert.deepEqual([await stock(flour.id), await stock(preparation.id)], [6, 2]);
      assert.equal(await db.stockMovement.count({ where: { sourceId: produced.id } }), productionMoves);
      assert.equal((await production.batch(produced.id)).reversedAt, null);
    });
  } finally {
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.processingDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.preparationBatch.deleteMany({ where: { cafeId: cafe.id } });
    await db.preparationRecipe.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});

test('PostgreSQL: processing calendar periods use warehouse midnight and include every matching document', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Processing periods ' + randomUUID() } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const actor = { createdById: randomUUID(), createdByName: 'Owner', cafeId: cafe.id };
      const boundaries = [
        { id: randomUUID(), date: new Date('2025-01-01T17:59:59.999Z'), note: 'Before' },
        { id: randomUUID(), date: new Date('2025-01-01T18:00:00.000Z'), note: 'First moment' },
        { id: randomUUID(), date: new Date('2025-01-02T17:59:59.999Z'), note: 'Last moment' },
        { id: randomUUID(), date: new Date('2025-01-02T18:00:00.000Z'), note: 'After' },
      ];
      await db.processingDocument.createMany({ data: [
        ...boundaries.map((row) => ({ ...actor, ...row })),
        ...Array.from({ length: 501 }, () => ({ ...actor, date: new Date('2025-01-02T12:00:00.000Z') })),
      ] });
      const service = new ProcessingService(db);
      const rows = await service.list({ from: '2025-01-02', to: '2025-01-02' });
      assert.equal(rows.length, 503, 'a selected period must not silently drop documents after a fixed limit');
      assert.ok(rows.some((row) => row.id === boundaries[1].id));
      assert.ok(rows.some((row) => row.id === boundaries[2].id));
      assert.ok(!rows.some((row) => row.id === boundaries[0].id || row.id === boundaries[3].id));
      assert.equal((await service.list()).length, 505);
      assert.deepEqual((await service.list({ from: '2025-01-02T00:00:00+06:00', to: '2025-01-02T00:00:00+06:00' })).map((row) => row.id), [boundaries[1].id],
        'explicit timestamp clients retain their exact instant');
      await assert.rejects(service.list({ from: '2025-02-30' }), /некорректная дата/);
      await assert.rejects(service.list({ from: '2025-01-03', to: '2025-01-02' }), /Начало периода/);
    });
  } finally {
    await db.processingDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
