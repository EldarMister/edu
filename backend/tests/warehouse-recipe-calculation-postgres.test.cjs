require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { RecipePreviewController } = require('../src/warehouse/recipes.controller.ts');
const { RecipesService } = require('../src/warehouse/recipes.service.ts');
const { RecipeExportController } = require('../src/warehouse/recipe-export.controller.ts');
const { PreparationProductionService } = require('../src/warehouse/preparation-production.ts');
const { redactWarehouseCosts } = require('../src/warehouse/warehouse-cost.interceptor.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: recipe preview, saved card, and costing list use the same warehouse and Decimal calculation', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Recipe calculation ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    await runWithTenant({ cafeId }, async () => {
      const recipes = new RecipesService(db);
      const previewController = new RecipePreviewController(recipes);
      const [main, bar] = await Promise.all([
        db.warehouse.create({ data: { name: 'Общий склад кафе', isDefault: true } }),
        db.warehouse.create({ data: { name: 'Склад бара' } }),
      ]);
      await db.stationWarehouse.create({ data: { stationId: 'bar', warehouseId: bar.id } });
      await db.settings.create({ data: { taxesEnabled: true } });
      const vat = await db.menuTax.create({ data: { name: 'НДС', rate: 20, type: 'vat' } });
      const category = await db.category.create({ data: { name: 'Напитки', prepStation: 'bar', taxId: vat.id } });
      const milk = await db.ingredient.create({ data: { name: 'Молоко', unitType: 'volume', displayUnit: 'l', stock: 1000,
        avgCost: 0.1, valuationKnown: true } });
      await db.warehouseStock.create({ data: { warehouseId: bar.id, ingredientId: milk.id, stock: 1000, avgCost: 0.2, valuationKnown: true } });
      const cup = await db.ingredient.create({ data: { name: 'Стакан', kind: 'consumable', stock: 10, avgCost: 5, valuationKnown: true } });
      const dish = await db.dish.create({ data: { name: 'Латте', price: 120, categoryId: category.id, variants: { create: [
        { name: 'Большой', price: 180 }, { name: 'Пустой', price: 0 },
      ] } }, include: { variants: true } });
      const large = dish.variants.find(({ name }) => name === 'Большой');
      const empty = dish.variants.find(({ name }) => name === 'Пустой');
      const items = [{ ingredientId: milk.id, amount: 0.2, unit: 'l', netAmount: 0.19,
        variantAmounts: { [large.id]: 0.3, [empty.id]: 0 } },
      { ingredientId: cup.id, amount: 1, unit: 'pcs', fromCommonWarehouse: true, variantAmounts: { [empty.id]: 0 } }];

      const preview = await recipes.preview({ dishId: dish.id, items });
      assert.deepEqual([preview.foodCost, preview.ingredientCost, preview.packagingCost, preview.foodCostPercent, preview.taxAmount,
        preview.marginAmount, preview.markupPercent], [45, 40, 5, 37.5, 20, 55, 122.22]);
      const milkCost = preview.items.find(({ ingredientId }) => ingredientId === milk.id);
      assert.deepEqual([milkCost.amount, milkCost.netAmount, milkCost.avgCost, milkCost.lineCost, milkCost.warehouseName], [0.2, 0.19, 200, 40, bar.name]);
      assert.deepEqual(preview.output, { amount: 190, unit: 'ml' });
      assert.equal(preview.items.find(({ ingredientId }) => ingredientId === cup.id).warehouseName, main.name);
      const smallNorm = await recipes.preview({ dishId: dish.id, items: [{ ingredientId: milk.id, amount: 0.02, unit: 'ml' }] });
      assert.deepEqual([smallNorm.compositionFoodCost, smallNorm.compositionCostForScaling, smallNorm.items[0].lineCostForScaling], [0, 0.004, 0.004]);
      assert.equal(await db.recipeItem.count({ where: { dishId: dish.id } }), 0, 'preview does not save rows');
      assert.equal(await db.stockMovement.count(), 0, 'preview does not post stock');

      const firstDraft = await recipes.saveDraft(dish.id, { expectedVersion: 1, items, metadata: { outputQuantity: 0.25, outputUnit: 'л' } });
      assert.equal(firstDraft.recipe.foodCost, preview.foodCost);
      assert.deepEqual(firstDraft.recipe.output, { amount: 0.25, unit: 'l' });
      const largeCard = await recipes.getByDish(dish.id, large.id);
      assert.equal(largeCard.foodCost, 65);
      assert.equal(largeCard.items.find(({ ingredientId }) => ingredientId === milk.id).netAmount, 0.285);
      assert.deepEqual(largeCard.output, { amount: 285, unit: 'ml' });
      const zero = await recipes.getByDish(dish.id, empty.id);
      assert.deepEqual([zero.costKnown, zero.foodCost, zero.foodCostPercent, zero.markupPercent, zero.marginAmount, zero.marginPercent],
        [true, 0, null, null, 0, null]);
      assert.equal(zero.output, null, 'the manual base output does not apply to an empty variant');

      const fromMain = await recipes.preview({ dishId: dish.id, prepStation: 'kitchen', items });
      assert.equal(fromMain.foodCost, 25);
      const inheritance = await recipes.preview({ dishId: dish.id, prepStation: null, taxExempt: true,
        items: items.map((row) => row.ingredientId === milk.id ? { ...row, warehouseId: main.id } : row) });
      assert.deepEqual([inheritance.taxAmount, inheritance.foodCost, inheritance.marginAmount], [0, 25, 95]);

      const unfinished = await db.ingredient.create({ data: { name: 'Старая заготовка', isPrepared: true, preparationMode: 'virtual' } });
      const incomplete = await recipes.preview({ dishId: dish.id, items: [{ ingredientId: unfinished.id, amount: 1 }] });
      assert.deepEqual([incomplete.foodCost, incomplete.compositionCostForScaling, incomplete.missingCosts], [null, null, [unfinished.name]]);
      await db.recipeItem.create({ data: { dishId: dish.id, ingredientId: unfinished.id, amount: 1 } });
      assert.deepEqual((await recipes.getByDish(dish.id)).missingCosts, [unfinished.name]);
      await db.recipeItem.deleteMany({ where: { dishId: dish.id, ingredientId: unfinished.id } });
      const output = await db.ingredient.create({ data: { name: 'Выпуск латте', kind: 'prepared_dish', isPrepared: true, preparationMode: 'stocked' } });
      await db.warehouseStock.create({ data: { warehouseId: bar.id, ingredientId: output.id, stock: 3, avgCost: 55, valuationKnown: true } });
      const stocked = await recipes.preview({ dishId: dish.id, producedStockIngredientId: output.id, items });
      assert.deepEqual([stocked.foodCost, stocked.productionCost, stocked.compositionFoodCost, stocked.stockItem.warehouseName, stocked.stockItem.kind],
        [55, 55, 45, bar.name, 'prepared_dish']);

      const summary = await recipes.costSummary({ search: 'Латте', categoryId: category.id, limit: 1 });
      assert.equal(summary.total, 1);
      assert.equal(summary.rows.find(({ variantId }) => variantId === large.id).foodCost, 65);
      assert.deepEqual((await recipes.costSummary({ search: 'Латте', offset: 1, limit: 1 })).rows, []);
      await db.dish.update({ where: { id: dish.id }, data: { isActive: false } });
      assert.equal((await recipes.costSummary({ search: 'Латте' })).total, 0);
      assert.equal((await recipes.costSummary({ dishIds: dish.id })).rows.length, 2);
      const set = await db.dish.create({ data: { name: 'Набор', categoryId: category.id, price: 250, isSet: true,
        setComponents: { create: { dishId: dish.id, dishVariantId: large.id, quantity: 2 } } } });
      const savedSet = await recipes.getByDish(set.id);
      assert.deepEqual([savedSet.foodCost, savedSet.components[0].variantName, savedSet.components[0].foodCost], [130, 'Большой', 130]);
      assert.equal((await recipes.preview({ dishId: set.id, items: [] })).foodCost, 130);

      assert.throws(() => previewController.preview({ dishId: dish.id, items }, { role: 'ADMIN', permissions: { sections: { warehouse: false } } }), { status: 403 });
      const readOnly = await previewController.preview({ dishId: dish.id, items }, { role: 'ADMIN', permissions: { sections: { warehouse: true }, readOnlySections: ['warehouse'] } });
      const masked = redactWarehouseCosts(readOnly);
      assert.deepEqual([masked.foodCost, masked.marginAmount, masked.markupPercent, masked.productionCost, masked.items[0].avgCost,
        masked.compositionCostForScaling, masked.items[0].lineCostForScaling], [null, null, null, null, null, null, null]);
      assert.equal(masked.items[0].warehouseName, bar.name);

      await recipes.saveDraft(dish.id, { expectedVersion: firstDraft.recipe.version,
        items: [{ ...items[0], measuredNetWeightGrams: 210 }, items[1]] });
      await db.preparationRecipe.create({ data: { ingredientId: output.id, outputAmount: 400, outputUnit: 'kg', items: { create: [{
        ingredientId: milk.id, amount: 200, unit: 'l', netAmount: 190, measuredNetWeightGrams: 210,
      }] } } });
      const exportController = new RecipeExportController(recipes, new PreparationProductionService(db));
      const readOnlyMenu = { role: 'ADMIN', permissions: { sections: { menu: true, warehouse: true },
        actions: { exportReports: true, warehouseCosts: false }, readOnlySections: ['menu', 'warehouse'] } };
      const download = async (dto, actor = { role: 'OWNER' }) => {
        const headers = {};
        let buffer;
        await exportController.exportRecipes(dto, actor, { setHeader: (key, value) => { headers[key] = value; }, send: (data) => { buffer = data; } });
        assert.match(headers['Content-Disposition'], /attachment/);
        return XLSX.read(buffer, { type: 'buffer' });
      };
      const selection = { kind: 'recipes', ids: [set.id, randomUUID(), dish.id, dish.id], includeComposition: true };
      await assert.rejects(download(selection, { role: 'ADMIN', permissions: { sections: { menu: true } } }), { status: 403 });
      const listed = await download(selection);
      assert.deepEqual(listed.SheetNames, ['Техкарты', 'Состав']);
      const headerRows = XLSX.utils.sheet_to_json(listed.Sheets['Техкарты']);
      assert.deepEqual(headerRows.map((row) => row['Название']), ['Набор', 'Латте', 'Латте']);
      const details = XLSX.utils.sheet_to_json(listed.Sheets['Состав']);
      assert.equal(details[0]['Компонент'], 'Латте · Большой');
      const measured = details.find((row) => row['Вариант'] === 'Большой' && row['Компонент'] === 'Молоко');
      assert.deepEqual(['Брутто', 'Ед. брутто', 'Нетто', 'Ед. нетто', 'Нетто в ед. брутто', 'Склад списания', 'Себестоимость строки, сом']
        .map((field) => measured[field]), [0.3, 'л', 315, 'г', 0.285, 'Склад бара', 60]);
      assert.deepEqual((await download({ ...selection, includeComposition: false })).SheetNames, ['Техкарты']);

      const hiddenCosts = await download(selection, readOnlyMenu);
      const [safeHeadings] = XLSX.utils.sheet_to_json(hiddenCosts.Sheets['Состав'], { header: 1 });
      assert.ok(!safeHeadings.includes('Себестоимость строки, сом'));
      const preparations = await download({ kind: 'preparations', ids: [output.id, milk.id], includeComposition: true });
      const prep = XLSX.utils.sheet_to_json(preparations.Sheets['Полуфабрикаты']);
      assert.deepEqual(prep.map((row) => [row['Название'], row['Выход'], row['Ед. выхода']]), [['Выпуск латте', 0.4, 'кг']]);
      const [prepRow] = XLSX.utils.sheet_to_json(preparations.Sheets['Состав']);
      assert.deepEqual([prepRow['Брутто'], prepRow['Нетто'], prepRow['Ед. нетто']], [0.2, 210, 'г']);
      assert.equal(await db.stockMovement.count(), 0, 'workbook export does not post stock');
    });
  } finally {
    await db.dish.deleteMany({ where: { cafeId } });
    await db.category.deleteMany({ where: { cafeId } });
    await db.menuTax.deleteMany({ where: { cafeId } });
    await db.warehouseStock.deleteMany({ where: { cafeId } });
    await db.stationWarehouse.deleteMany({ where: { cafeId } });
    await db.warehouse.deleteMany({ where: { cafeId } });
    await db.preparationRecipe.deleteMany({ where: { cafeId } });
    await db.ingredient.deleteMany({ where: { cafeId } });
    await db.settings.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
