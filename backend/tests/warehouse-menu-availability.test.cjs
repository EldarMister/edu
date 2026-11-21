require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { DishesService } = require('../src/dishes/dishes.service.ts');
const { AdminWarehouseService } = require('../src/admin/warehouse.service.ts');
const { WarehouseOverviewService } = require('../src/warehouse/overview.service.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Use an isolated local test database');

test('menu availability reads only the configured warehouse and ignores legacy stock; variant gaps remain visible', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Menu stock ${randomUUID()}` } });
  const foreign = await db.cafe.create({ data: { name: `Other menu ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const main = await db.warehouse.create({ data: { name: 'Основной', isDefault: true } });
      const bar = await db.warehouse.create({ data: { name: 'Бар' } });
      await db.stationWarehouse.create({ data: { stationId: 'bar', warehouseId: bar.id } });
      const category = await db.category.create({ data: { name: 'Напитки', prepStation: 'bar' } });
      const ingredient = await db.ingredient.create({ data: { name: 'Напиток', kind: 'beverage', unitType: 'count', displayUnit: 'pcs', stock: 100, avgCost: 5 } });
      await db.warehouseStock.create({ data: { warehouseId: bar.id, ingredientId: ingredient.id, stock: 1, avgCost: 7 } });
      const dish = await db.dish.create({ data: { name: 'Двойной напиток', price: 30, categoryId: category.id, stockIngredientId: ingredient.id, stockAmount: 2, trackInventory: true, stock: 999 } });
      const variantDish = await db.dish.create({ data: { name: 'Размеры', price: 20, categoryId: category.id,
        variants: { create: [{ name: 'Настроен', price: 20, stockIngredientId: ingredient.id, stockAmount: 1, stock: 999 }, { name: 'Не настроен', price: 30, stock: 999 }] } } });
      const publicRows = await new DishesService(db).findAll({});
      const direct = publicRows.find((row) => row.id === dish.id);
      assert.equal(direct.stock, 0, 'one unit in bar cannot fulfill two; main stock is not available to bar');
      assert.equal(direct.trackInventory, true);
      assert.equal('stockAmount' in direct, false);
      assert.equal('avgCost' in direct, false);
      await db.dish.update({ where: { id: dish.id }, data: { isWeighted: true } });
      assert.equal((await new DishesService(db).findAll({})).find((row) => row.id === dish.id).stock, 0.5, 'a fractional weighted portion must not be marked sold out');
      await db.dish.update({ where: { id: dish.id }, data: { isWeighted: false } });
      const variants = publicRows.find((row) => row.id === variantDish.id).variants;
      assert.equal(variants.find((row) => row.name === 'Настроен').stock, 1);
      assert.equal(variants.find((row) => row.name === 'Не настроен').stock, null);
      const compat = await new AdminWarehouseService(db).getItems();
      assert.equal(compat.find((row) => row.id === dish.id).stock, direct.stock);
      const overview = await new WarehouseOverviewService(db).getOverview({ warehouseId: main.id });
      assert.equal(overview.missingRecipeCount, 1);
      assert.equal(overview.missingRecipeConfigurations[0].name, 'Размеры · Не настроен');
      await runWithTenant({ cafeId: foreign.id }, async () => assert.equal((await new DishesService(db).findAll({})).length, 0));
    });
  } finally {
    await db.dish.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.category.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.deleteMany({ where: { id: { in: [cafe.id, foreign.id] } } });
    await db.$disconnect();
  }
});
