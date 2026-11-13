require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { tenantPrismaMiddleware, runWithTenant } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { WarehouseReportsService } = require('../src/warehouse/reports.service.ts');
const { WarehouseOverviewService } = require('../src/warehouse/overview.service.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('PostgreSQL: catalog, reports and overview use one balance snapshot across an atomic concurrent transfer', { skip: !url }, async t => {
  const db = new PrismaClient({ datasourceUrl: url }); db.$use(tenantPrismaMiddleware);
  let afterIngredientRead;
  db.$use(async (params, next) => {
    const result = await next(params);
    if (afterIngredientRead && params.model === 'Ingredient' && ['findMany', 'findFirst', 'findUnique'].includes(params.action)) {
      const transfer = afterIngredientRead; afterIngredientRead = null;
      await transfer();
    }
    return result;
  });
  const cafe = await db.cafe.create({ data: { name: 'Read snapshot ' + randomUUID() } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const actor = { id: randomUUID(), name: 'Owner', role: 'OWNER', cafeId: cafe.id };
      const items = new IngredientsService(db), locations = new WarehouseLocationsService(db, { emitBroadcast() {} }), docs = new WarehouseDocumentsService(db);
      const reports = new WarehouseReportsService(db), overview = new WarehouseOverviewService(db);
      const main = (await locations.list(cafe.id)).locations[0], bar = await locations.save(cafe.id, 'Second warehouse');
      let itemCount = 0;
      for (const endpoint of ['list', 'card', 'report', 'overview']) await t.test(endpoint, async () => {
        const item = await items.create({ name: 'Snapshot ' + endpoint, unit: 'pcs', stock: 10, avgCost: 5, lowStockThreshold: 15 });
        itemCount++;
        const document = await docs.create(actor, { kind: 'transfer', warehouseId: main.id, destinationWarehouseId: bar.id, items: [{ ingredientId: item.id, quantity: 10 }] });
        const submitted = await docs.submit(actor, document.id, document.revision);
        // Commit the entire move between the default ingredient read and the
        // other warehouse read. No partial transfer is ever visible in the DB.
        afterIngredientRead = () => docs.approve(actor, document.id, submitted.revision);
        if (endpoint === 'report') {
          const view = await reports.report({ view: 'balances', ingredientId: item.id });
          assert.equal(view.rows.reduce((sum, row) => sum + row.quantity, 0), 10);
          assert.equal(view.totalCost, 50);
        } else if (endpoint === 'overview') {
          const view = await overview.getOverview({});
          assert.equal(view.itemCount, itemCount);
          assert.equal(view.lowStockCount, itemCount);
          assert.equal(view.outOfStockCount, 0);
          assert.equal(view.unknownCostCount, 0);
          assert.equal(view.stockValue, itemCount * 50);
          assert.equal(view.lowStockItems.find(row => row.id === item.id).stock, 10);
        } else {
          const view = endpoint === 'list' ? (await items.findAll({ search: item.name })).find(row => row.id === item.id) : await items.findOne(item.id);
          assert.equal(view.stock, 10);
          assert.equal(view.avgCost, 5);
          if (endpoint === 'card') assert.equal(view.balances.reduce((sum, row) => sum + row.stock, 0), 10);
        }
        assert.equal(afterIngredientRead, null, 'The concurrent transfer must actually run inside the read');
        const latest = await items.findOne(item.id);
        assert.equal(latest.stock, 10);
        assert.equal(latest.balances.find(row => row.warehouseId === bar.id).stock, 10);
      });
    });
  } finally {
    afterIngredientRead = null;
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
