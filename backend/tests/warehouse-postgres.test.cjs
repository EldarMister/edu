require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { MovementsService } = require('../src/warehouse/movements.service.ts');
const { WarehouseOverviewService } = require('../src/warehouse/overview.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: warehouse purchasing, correction and transfer are scoped and consistent', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafes = [];
  try {
    const cafe = await db.cafe.create({ data: { name: `Warehouse API ${randomUUID()}` } });
    cafes.push(cafe.id);
    const foreign = await db.cafe.create({ data: { name: `Warehouse API ${randomUUID()}` } });
    cafes.push(foreign.id);
    const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
    const ingredients = new IngredientsService(db);
    const movements = new MovementsService(db);
    const overview = new WarehouseOverviewService(db);
    const purchases = new PurchasesService(db);

    const { warehouseId, ingredientId } = await runWithTenant({ cafeId: cafe.id }, async () => {
      const main = (await locations.list(cafe.id)).locations[0];
      assert.equal(main.isDefault, true);
      const bar = await locations.save(cafe.id, 'Напитки');
      assert.equal(bar.isDefault, false);
      await assert.rejects(locations.save(cafe.id, 'напитки'), /уже существует/);

      const cola = await ingredients.create({ name: 'Кола', unit: 'pcs', stock: 20, avgCost: 4 });
      const onlyBar = await ingredients.create({ name: 'Тоник', unit: 'pcs', stock: 3, avgCost: 2, warehouseId: bar.id });
      assert.equal(onlyBar.stock, 3);
      assert.equal((await ingredients.findAll({ warehouseId: main.id, search: 'Тоник' }))[0].stock, 0);
      await locations.transfer({ ingredientId: cola.id, fromWarehouseId: main.id, toWarehouseId: bar.id, quantity: 10, unit: 'pcs' });
      await assert.rejects(locations.transfer({
        ingredientId: cola.id, fromWarehouseId: main.id, toWarehouseId: bar.id, quantity: 11, unit: 'pcs',
      }), /недостаточно/);

      const purchase = await purchases.create({
        supplier: 'Поставщик', warehouseId: bar.id, items: [{ ingredientId: cola.id, quantity: 10, total: 60 }],
      });
      const completions = await Promise.allSettled([purchases.complete(purchase.id), purchases.complete(purchase.id)]);
      assert.deepEqual(completions.map((entry) => entry.status).sort(), ['fulfilled', 'rejected']);
      await assert.rejects(purchases.update(purchase.id, { warehouseId: main.id }), /проведённой закупке/);

      await Promise.all([
        ingredients.adjust(cola.id, { mode: 'add', quantity: 1, unit: 'pcs', warehouseId: bar.id }),
        ingredients.adjust(cola.id, { mode: 'add', quantity: 1, unit: 'pcs', warehouseId: bar.id }),
      ]);
      const [commonCola] = await ingredients.findAll({ warehouseId: main.id, search: 'Кола' });
      const [barCola] = await ingredients.findAll({ warehouseId: bar.id, search: 'Кола' });
      const [allCola] = await ingredients.findAll({ search: 'Кола' });
      assert.deepEqual([commonCola.stock, barCola.stock, allCola.stock], [10, 22, 32]);
      assert.deepEqual([commonCola.avgCost, barCola.avgCost, allCola.avgCost], [4, 5, 4.69]);
      assert.equal((await overview.getOverview({ warehouseId: bar.id })).stockValue, 116);
      assert.equal((await overview.getOverview({})).stockValue, 156);
      assert.equal((await purchases.findAll({ warehouseId: bar.id }))[0].warehouseId, bar.id);
      assert.deepEqual(await purchases.findAll({ warehouseId: main.id }), []);
      const journal = await movements.findAll({ ingredientId: cola.id });
      assert.equal(journal.filter((entry) => entry.type === 'purchase').length, 1);
      assert.equal(journal.filter((entry) => entry.warehouseId === bar.id).length, 4);
      assert.equal(journal.filter((entry) => entry.warehouseId === main.id).length, 1);
      assert.equal((await ingredients.remove(cola.id)).deactivated, true);
      assert.equal((await movements.findAll({ ingredientId: cola.id })).length, 5);
      return { warehouseId: bar.id, ingredientId: cola.id };
    });

    await runWithTenant({ cafeId: foreign.id }, async () => {
      assert.deepEqual((await locations.list(foreign.id)).locations.map((location) => location.isDefault), [true]);
      await assert.rejects(ingredients.findAll({ warehouseId }), /Склад не найден/);
      await assert.rejects(ingredients.adjust(ingredientId, { mode: 'set', quantity: 1, unit: 'pcs' }), /Сырьё не найдено/);
      await assert.rejects(purchases.findAll({ warehouseId }), /Склад не найден/);
      await assert.rejects(movements.findAll({ warehouseId }), /Склад не найден/);
    });
  } finally {
    for (const cafeId of cafes) {
      await db.stockMovement.deleteMany({ where: { cafeId } });
      await db.purchase.deleteMany({ where: { cafeId } });
      await db.ingredient.deleteMany({ where: { cafeId } });
      await db.cafe.delete({ where: { id: cafeId } });
    }
    await db.$disconnect();
  }
});
