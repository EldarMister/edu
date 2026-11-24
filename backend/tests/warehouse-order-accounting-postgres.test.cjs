require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const { tenantPrismaMiddleware, runWithTenant } = require('../src/tenant/tenant-context.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { postStockMovement } = require('../src/warehouse/stock-posting.ts');
const { lockIngredients } = require('../src/warehouse/stock-lock.ts');
const { MenuModifiersService } = require('../src/warehouse/menu-modifiers.ts');
const { WarehouseReportsService } = require('../src/warehouse/reports.service.ts');
const { RecipesService } = require('../src/warehouse/recipes.service.ts');
const { PreparationProductionService } = require('../src/warehouse/preparation-production.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { OrdersService } = require('../src/orders/orders.service.ts');
const { SettingsService } = require('../src/settings/settings.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('PostgreSQL: unified stock covers direct sales, recipes, production, stages and concurrency', { skip: !url }, async t => {
  const db = new PrismaClient({ datasourceUrl: url }); db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Unified accounting ' + randomUUID() } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = await db.user.create({ data: { name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'test' } });
      const shift = await db.waiterShift.create({ data: { waiterId: owner.id } });
      const hall = await db.hall.create({ data: { name: 'Test hall' } });
      const category = await db.category.create({ data: { name: 'Kitchen', prepStation: 'kitchen' } });
      const events = new Proxy({}, { get: () => () => {} }), audit = { log: async () => {} };
      const settings = new SettingsService(db, audit, events);
      await settings.ensure();
      await settings.update({ allowNegativeIngredientStock: false }, owner);
      const stock = new IngredientStockService(), recipes = new RecipesService(db), ingredients = new IngredientsService(db);
      const preparation = new PreparationProductionService(db), locations = new WarehouseLocationsService(db, events);
      const main = (await locations.list(cafe.id)).locations.find(w => w.isDefault);
      const bar = await locations.save(cafe.id, 'Бар');
      const orders = new OrdersService(db, events, { shiftForTerminalOrder: async () => shift }, { notifyRole: async () => {}, notifyUser: async () => {}, notifyWaiter: async () => {} }, settings, { recalculateDishes: async () => {} }, audit, stock);
      let tableNumber = 100;
      const order = async (items) => {
        const table = await db.table.create({ data: { hallId: hall.id, number: tableNumber++ } });
        return orders.create(owner, { tableId: table.id, items, idempotencyKey: randomUUID() });
      };
      const dish = (name, extra = {}) => db.dish.create({ data: { name, categoryId: category.id, price: 300, ...extra } });
      const balance = async (id, warehouseId) => Number(warehouseId && warehouseId !== main.id ? (await db.warehouseStock.findUniqueOrThrow({ where: { warehouseId_ingredientId: { warehouseId, ingredientId: id } } })).stock : (await db.ingredient.findUniqueOrThrow({ where: { id } })).stock);

      await t.test('three bottled products consume exactly three; duplicate events do not consume again', async () => {
        const cola = await ingredients.create({ name: 'Кола', unit: 'pcs', kind: 'beverage', stock: 10, avgCost: 40 });
        const menu = await dish('Кола бутылка', { prepStation: 'none' });
        await recipes.updateSettings(menu.id, { stockIngredientId: cola.id, stockAmount: 1, stockUnit: 'pcs' });
        const ticket = await order([{ dishId: menu.id, quantity: 3 }]);
        assert.equal(await balance(cola.id), 7);
        await Promise.all([db.$transaction(tx => stock.applyDishSale(tx, ticket.id, ticket.items)), db.$transaction(tx => stock.applyDishSale(tx, ticket.id, ticket.items))]);
        assert.equal(await balance(cola.id), 7);
        assert.equal(await db.stockMovement.count({ where: { sourceId: ticket.id, type: 'sale' } }), 1);
        await orders.cancelOrder(ticket.id, owner, 'Бутылки возвращены до выдачи');
        assert.equal(await balance(cola.id), 10);
        assert.equal((await recipes.getByDish(menu.id)).foodCost, 40);
      });

      await t.test('weight per piece derives recipe yield and preserves fractional piece supply, cost and debit', async () => {
        const request = { name: 'Яйцо для расчёта выхода', unit: 'pcs', pieceWeightGrams: 54.3,
          initialSupply: { warehouseId: main.id, quantity: 2.5, unitPrice: 20, requestKey: randomUUID() } };
        const egg = await ingredients.create(request, owner);
        assert.equal((await ingredients.create(request, owner)).id, egg.id);
        assert.deepEqual([egg.unitType, egg.pieceWeightGrams, await balance(egg.id)], ['count', 54.3, 2.5]);
        await assert.rejects(ingredients.create({ name: 'Вес штуки для литра', unit: 'l', pieceWeightGrams: 50 }), /штучных/);
        await assert.rejects(ingredients.update(egg.id, { pieceWeightGrams: 0 }), /больше нуля/);
        const flour = await ingredients.create({ name: 'Мука для расчёта выхода', unit: 'g', stock: 1000, avgCost: 0.1 });
        const unweighed = await ingredients.create({ name: 'Штучное без веса', unit: 'pcs' });
        const menu = await dish('Выпечка с половинкой яйца');
        const items = [{ ingredientId: egg.id, amount: 0.5, unit: 'pcs' }, { ingredientId: flour.id, amount: 100, netAmount: 75, unit: 'g' }];
        const [piece] = (await recipes.preview({ dishId: menu.id, items })).items;
        assert.deepEqual([piece.amount, piece.netAmount, piece.pieceWeightGrams, piece.netWeightGrams, piece.lineCost], [0.5, 0.5, 54.3, 27.15, 10]);
        const saved = await recipes.saveDraft(menu.id, { expectedVersion: 1, items });
        assert.deepEqual(saved.recipe.output, { amount: 102.15, unit: 'g' });
        assert.equal(saved.recipe.foodCost, 20);
        assert.deepEqual((await recipes.costSummary({ dishIds: menu.id })).rows[0].output, saved.recipe.output);
        assert.equal((await recipes.preview({ dishId: menu.id, items: [...items, { ingredientId: unweighed.id, amount: 1 }] })).output, null);
        assert.deepEqual((await recipes.preview({ dishId: menu.id, items: [items[0], { ingredientId: unweighed.id, amount: 1 }] })).output,
          { amount: 1.5, unit: 'pcs' });
        assert.deepEqual((await recipes.preview({ dishId: menu.id, items, metadata: { outputQuantity: 95, outputUnit: 'г' } })).output,
          { amount: 95, unit: 'g' });

        const ticket = await order([{ dishId: menu.id, quantity: 1 }]);
        const debit = await db.stockMovement.findFirstOrThrow({ where: { sourceId: ticket.id, ingredientId: egg.id, type: 'sale' } });
        assert.equal(Number(debit.change), -0.5);
        assert.equal(await balance(egg.id), 2);
        await ingredients.update(egg.id, { pieceWeightGrams: null });
        assert.equal((await recipes.getByDish(menu.id)).output, null);
        await orders.cancelOrder(ticket.id, owner, 'Проверка возврата половинки');
        assert.equal(await balance(egg.id), 2.5);
        assert.equal(Number((await db.stockMovement.findUniqueOrThrow({ where: { id: debit.id } })).change), -0.5);
      });

      await t.test('measured gram yield for liquid uses explicit measurements and keeps stock and cost in ml', async () => {
        const milk = await ingredients.create({ name: 'Молоко с измеренным выходом', unit: 'l', stock: 2, avgCost: 200 });
        const coffee = await ingredients.create({ name: 'Кофе для измеренного выхода', unit: 'g', stock: 1000, avgCost: 1 });
        const weightedPiece = await ingredients.create({ name: 'Порционная добавка', unit: 'pcs', pieceWeightGrams: 20, stock: 10, avgCost: 2 });
        const menu = await dish('Молочный напиток с измеренным выходом');
        const large = await db.dishVariant.create({ data: { dishId: menu.id, name: 'Большой', price: 350 } });
        const liquid = { ingredientId: milk.id, amount: 0.15, netAmount: 0.12, unit: 'l', variantAmounts: { [large.id]: 0.3 } };
        const solids = { ingredientId: coffee.id, amount: 8, unit: 'g' };
        const measured = { ...liquid, measuredNetWeightGrams: 210 };
        const oldPreview = await recipes.preview({ dishId: menu.id, items: [liquid, solids] });
        assert.deepEqual([oldPreview.output, oldPreview.items[0].netAmount, oldPreview.items[0].netWeightGrams], [null, 0.12, null]);
        const preview = await recipes.preview({ dishId: menu.id, items: [measured, solids, { ingredientId: weightedPiece.id, amount: 0.5, unit: 'pcs' }] });
        assert.deepEqual([preview.output, preview.items[0].netAmount, preview.items[0].netWeightGrams, preview.items[0].lineCost],
          [{ amount: 228, unit: 'g' }, 0.12, 210, 30]);
        const water = await ingredients.create({ name: 'Вода без измерения', unit: 'ml' });
        const missingWeight = await recipes.preview({ dishId: menu.id, items: [measured, solids, { ingredientId: water.id, amount: 50, unit: 'ml' }] });
        assert.equal(missingWeight.output, null);
        const saved = await recipes.saveDraft(menu.id, { expectedVersion: 1, items: [measured, solids] });
        assert.deepEqual(saved.recipe.output, { amount: 218, unit: 'g' });
        const variant = await recipes.getByDish(menu.id, large.id);
        const measuredRow = variant.items.find(({ ingredientId }) => ingredientId === milk.id);
        assert.deepEqual([variant.output, variant.foodCost, measuredRow.amount, measuredRow.netAmount, measuredRow.measuredNetWeightGrams, measuredRow.netWeightGrams],
          [{ amount: 428, unit: 'g' }, 68, 0.3, 0.24, 210, 420]);
        const sold = await order([{ dishId: menu.id, variantId: large.id, quantity: 1 }]);
        const debit = await db.stockMovement.findFirstOrThrow({ where: { sourceId: sold.id, ingredientId: milk.id, type: 'sale' } });
        assert.deepEqual([Number(debit.change), Number(debit.costAtMoment), debit.recipeSnapshot.measuredNetWeightGrams, await balance(milk.id)],
          [-300, 0.2, '210', 1700]);

        const id = saved.recipe.items.find(({ ingredientId }) => ingredientId === milk.id).id;
        const readWeight = (recipe) => recipe.items.find(({ ingredientId }) => ingredientId === milk.id).measuredNetWeightGrams;
        assert.equal(readWeight(await recipes.updateItem(id, { amount: 150, unit: 'ml' })), 210);
        assert.equal(readWeight(await recipes.updateItem(id, { amount: 150, unit: 'ml', measuredNetWeightGrams: 0 })), 0);
        const zero = await recipes.preview({ dishId: menu.id, items: [liquid] });
        assert.deepEqual([zero.output, zero.items[0].netWeightGrams], [{ amount: 0, unit: 'g' }, 0]);
        const cleared = await recipes.updateItem(id, { amount: 150, unit: 'ml', measuredNetWeightGrams: null });
        assert.deepEqual([readWeight(cleared), cleared.output, cleared.items.find(({ ingredientId }) => ingredientId === milk.id).netAmount], [null, null, 120]);
        assert.equal((await db.stockMovement.findUniqueOrThrow({ where: { id: debit.id } })).recipeSnapshot.measuredNetWeightGrams, '210');
        await assert.rejects(recipes.preview({ dishId: menu.id, items: [{ ...solids, measuredNetWeightGrams: 8 }] }), /объёмных/);
        await assert.rejects(recipes.preview({ dishId: menu.id, items: [{ ...liquid, amount: 0, netAmount: 0, measuredNetWeightGrams: 1 }] }), /брутто больше нуля/);
        await assert.rejects(recipes.preview({ dishId: menu.id, items: [{ ...liquid, measuredNetWeightGrams: 0.0001 }] }), /точностью/);

        const prep = await preparation.create({ name: 'Молочная заготовка с взвешенным выходом', unit: 'g' });
        const prepRow = { ingredientId: milk.id, quantity: 150, unit: 'ml', netAmount: 120 };
        const savePrep = (row) => preparation.saveRecipe(prep.id, { outputQuantity: 210, outputUnit: 'g', items: [row] });
        await savePrep({ ...prepRow, measuredNetWeightGrams: 210 });
        const prepAfterOmit = await savePrep(prepRow);
        assert.deepEqual([prepAfterOmit.items[0].quantity, prepAfterOmit.items[0].netAmount, prepAfterOmit.items[0].netWeightGrams,
          prepAfterOmit.outputQuantity, prepAfterOmit.totalCost], [150, 120, 210, 210, 30]);
        const batch = await preparation.produce(prep.id, { quantity: 420, unit: 'g' }, owner);
        assert.deepEqual([batch.totalCost, batch.items.recipe[0].measuredNetWeightGrams, await balance(milk.id), await balance(prep.id)], [60, '210', 1400, 420]);
        const prepZero = await savePrep({ ...prepRow, measuredNetWeightGrams: 0 });
        assert.equal(prepZero.items[0].measuredNetWeightGrams, 0);
        const prepClear = await savePrep({ ...prepRow, measuredNetWeightGrams: null });
        assert.equal(prepClear.items[0].netWeightGrams, null);
        assert.equal((await preparation.batch(batch.id)).items.recipe[0].measuredNetWeightGrams, '210');
      });

      await t.test('three 200 ml drinks consume 600 ml at the bar and three cups from main', async () => {
        const liquid = await ingredients.create({ name: 'Лимонад', unit: 'l', kind: 'beverage', stock: 2, avgCost: 60, warehouseId: bar.id });
        const cup = await ingredients.create({ name: 'Стакан', unit: 'pcs', kind: 'consumable', stock: 20, avgCost: 3 });
        const menu = await dish('Лимонад 200', { prepStation: 'bar' });
        await locations.route(owner, 'bar', bar.id);
        await recipes.addItem(menu.id, { ingredientId: liquid.id, amount: 200, unit: 'ml' });
        await recipes.addItem(menu.id, { ingredientId: cup.id, amount: 1, fromCommonWarehouse: true });
        const cost = await recipes.getByDish(menu.id);
        assert.deepEqual([cost.foodCost, cost.packagingCost], [15, 3]);
        await order([{ dishId: menu.id, quantity: 3 }]);
        assert.deepEqual([await balance(liquid.id, bar.id), await balance(cup.id)], [1400, 17]);
      });

      await t.test('existing menu variants bind directly to their own stock item without a synthetic recipe', async () => {
        const small = await ingredients.create({ name: 'Кола 0.5 л', unit: 'pcs', stock: 10, avgCost: 30 });
        const large = await ingredients.create({ name: 'Кола 1 л', unit: 'pcs', stock: 10, avgCost: 50 });
        const menu = await dish('Кола размер');
        const a = await db.dishVariant.create({ data: { dishId: menu.id, name: '0.5 л', price: 60 } });
        const b = await db.dishVariant.create({ data: { dishId: menu.id, name: '1 л', price: 100 } });
        await recipes.updateSettings(menu.id, { variantId: a.id, stockIngredientId: small.id, stockAmount: 1, stockUnit: 'pcs' });
        await recipes.updateSettings(menu.id, { variantId: b.id, stockIngredientId: large.id, stockAmount: 1, stockUnit: 'pcs' });
        await order([{ dishId: menu.id, variantId: a.id, quantity: 2 }, { dishId: menu.id, variantId: b.id, quantity: 3 }]);
        assert.deepEqual([await balance(small.id), await balance(large.id)], [8, 7]);
        assert.equal(await db.recipeItem.count({ where: { dishId: menu.id } }), 0);
        assert.deepEqual([(await recipes.getByDish(menu.id, a.id)).foodCost, (await recipes.getByDish(menu.id, b.id)).foodCost], [30, 50]);
      });

      await t.test('production uses actual yield, records a batch and does not consume raw material again on sale', async () => {
        const rice = await ingredients.create({ name: 'Рис сухой', unit: 'kg', stock: 10, avgCost: 80 });
        const cooked = await preparation.create({ name: 'Рис готовый', unit: 'kg' });
        await preparation.saveRecipe(cooked.id, { outputQuantity: 5, outputUnit: 'kg', mode: 'stocked', items: [{ ingredientId: rice.id, quantity: 2, unit: 'kg' }] });
        const requestKey = randomUUID();
        const input = { quantity: 5, unit: 'kg', plannedQuantity: 5, warehouseId: main.id, requestKey, batchNumber: 'R-001', expiresAt: new Date(Date.now() + 86400000).toISOString() };
        const [a, b] = await Promise.all([preparation.produce(cooked.id, input, owner), preparation.produce(cooked.id, input, owner)]);
        assert.equal(a.batchId, b.batchId);
        await assert.rejects(preparation.produce(cooked.id, { ...input, quantity: 6 }, owner), /другим составом|другим количеством/);
        for (const changed of [{ batchNumber: 'R-002' }, { plannedQuantity: 6 }, { items: [{ ingredientId: rice.id, quantity: 3, unit: 'kg' }] }, { expiresAt: new Date(Date.now() + 172800000).toISOString() }]) await assert.rejects(preparation.produce(cooked.id, { ...input, ...changed }, owner), /другим составом/);
        assert.deepEqual([a.actualQuantity, a.totalCost, a.unitCost], [5, 160, 32]);
        assert.deepEqual([await balance(rice.id), await balance(cooked.id)], [8000, 5000]);
        const menu = await dish('Рис порция');
        await recipes.addItem(menu.id, { ingredientId: cooked.id, amount: 100, unit: 'g' });
        await order([{ dishId: menu.id, quantity: 1 }]);
        assert.deepEqual([await balance(rice.id), await balance(cooked.id)], [8000, 4900]);
        assert.equal((await preparation.batch(a.batchId)).batchNumber, 'R-001');
        const actual = await preparation.produce(cooked.id, { quantity: 4.5, plannedQuantity: 5, unit: 'kg', items: [{ ingredientId: rice.id, quantity: 2.1, unit: 'kg' }], requestKey: randomUUID() }, owner);
        assert.deepEqual([actual.totalCost, actual.yieldDifference], [168, -0.5]);
        assert.equal(await balance(rice.id), 5900);
        await assert.rejects(preparation.saveRecipe(cooked.id, { outputQuantity: 5, outputUnit: 'kg', mode: 'virtual', items: [{ ingredientId: rice.id, quantity: 2, unit: 'kg' }] }), /Сначала израсходуйте/);
      });

      await t.test('virtual recipes expand recursively, reject indirect cycles and cannot be produced', async () => {
        const tomato = await ingredients.create({ name: 'Томат', unit: 'kg', stock: 10, avgCost: 100 });
        const sauce = await preparation.create({ name: 'Соус без остатка', unit: 'kg' });
        const base = await preparation.create({ name: 'Основа без остатка', unit: 'kg' });
        await preparation.saveRecipe(base.id, { mode: 'virtual', outputQuantity: 1, outputUnit: 'kg', items: [{ ingredientId: tomato.id, quantity: 2, unit: 'kg' }] });
        await preparation.saveRecipe(sauce.id, { mode: 'virtual', outputQuantity: 1, outputUnit: 'kg', items: [{ ingredientId: base.id, quantity: 0.5, unit: 'kg' }] });
        await assert.rejects(preparation.saveRecipe(base.id, { mode: 'virtual', outputQuantity: 1, outputUnit: 'kg', items: [{ ingredientId: sauce.id, quantity: 1, unit: 'kg' }] }), /циклическую/);
        await assert.rejects(preparation.produce(sauce.id, { quantity: 1, unit: 'kg' }), /раскрывается/);
        const menu = await dish('Блюдо с соусом');
        await recipes.addItem(menu.id, { ingredientId: sauce.id, amount: 100, unit: 'g' });
        assert.equal((await recipes.getByDish(menu.id)).foodCost, 10);
        await order([{ dishId: menu.id, quantity: 3 }]);
        assert.deepEqual([await balance(tomato.id), await balance(sauce.id), await balance(base.id)], [9700, 0, 0]);
      });

      await t.test('production reversal preserves the original batch, reverses values once and rejects consumed output', async () => {
        const raw = await ingredients.create({ name: 'Сырьё сторно', unit: 'kg', stock: 10, avgCost: 100 });
        const output = await preparation.create({ name: 'Заготовка сторно', unit: 'kg' });
        await preparation.saveRecipe(output.id, { outputQuantity: 5, outputUnit: 'kg', items: [{ ingredientId: raw.id, quantity: 2, unit: 'kg' }] });
        const batch = await preparation.produce(output.id, { quantity: 5, unit: 'kg', requestKey: randomUUID() }, owner);
        const [a, b] = await Promise.all([preparation.reverse(batch.id, 'Ошибка выпуска', owner), preparation.reverse(batch.id, 'Повтор', owner)]);
        assert.ok(a.reversedAt); assert.equal(a.reverseReason, b.reverseReason);
        assert.deepEqual([await balance(raw.id), await balance(output.id)], [10000, 0]);
        assert.equal(await db.stockMovement.count({ where: { sourceId: batch.id, type: 'cancel' } }), 2);
        const consumedBatch = await preparation.produce(output.id, { quantity: 5, unit: 'kg', requestKey: randomUUID() }, owner);
        const menu = await dish('Проданная заготовка');
        await recipes.addItem(menu.id, { ingredientId: output.id, amount: 100, unit: 'g' });
        await order([{ dishId: menu.id, quantity: 1 }]);
        await assert.rejects(preparation.reverse(consumedBatch.id, 'Позднее сторно', owner), /недостаточно/i);
        assert.deepEqual([await balance(raw.id), await balance(output.id)], [8000, 4900]);
        assert.equal((await preparation.batch(consumedBatch.id)).reversedAt, null);
      });

      await t.test('existing set substitutions and removed components share recipe stock and component cancellations', async () => {
        const rawA = await ingredients.create({ name: 'Компонент A сырьё', unit: 'pcs', stock: 20, avgCost: 5 });
        const rawB = await ingredients.create({ name: 'Компонент B сырьё', unit: 'pcs', stock: 20, avgCost: 8 });
        const a = await dish('Компонент A'), b = await dish('Компонент B'), combo = await dish('Сет', { isSet: true });
        await recipes.addItem(a.id, { ingredientId: rawA.id, amount: 2 });
        await recipes.addItem(b.id, { ingredientId: rawB.id, amount: 3 });
        await db.setComponent.create({ data: { setId: combo.id, dishId: a.id, quantity: 1 } });
        await db.setComponent.create({ data: { setId: combo.id, dishId: b.id, quantity: 1 } });
        const ticket = await order([{ dishId: combo.id, quantity: 2, setComponents: [
          { originalDishId: a.id, finalDishId: b.id, action: 'replaced' }, { originalDishId: b.id, action: 'removed' },
        ] }]);
        assert.deepEqual([await balance(rawA.id), await balance(rawB.id)], [20, 14]);
        const liveComponent = ticket.items[0].setComponents.find(component => component.action === 'replaced');
        await orders.kitchenRejectItems(ticket.id, [], owner.id, 'Нет компонента', undefined, 'kitchen', [liveComponent.id]);
        assert.deepEqual([await balance(rawA.id), await balance(rawB.id)], [20, 20]);
        assert.equal(await db.stockMovement.count({ where: { sourceId: ticket.id, type: 'return' } }), 1);
      });

      await t.test('weighted sales use the existing menu weight basis without another quantity system', async () => {
        const raw = await ingredients.create({ name: 'Салат на вес', unit: 'kg', stock: 2, avgCost: 120, kind: 'prepared_dish' });
        const menu = await dish('Салат 100 г', { isWeighted: true, weightedPriceBase: 100 });
        await recipes.updateSettings(menu.id, { stockIngredientId: raw.id, stockAmount: 100, stockUnit: 'g' });
        await order([{ dishId: menu.id, weightGrams: 350, quantity: 2 }]);
        assert.equal(await balance(raw.id), 1300);
      });

      await t.test('variant norms and immutable history use original quantity, version, warehouse and cost', async () => {
        const cheese = await ingredients.create({ name: 'Сыр', unit: 'kg', stock: 10, avgCost: 400 });
        const menu = await dish('Пицца');
        const large = await db.dishVariant.create({ data: { dishId: menu.id, name: 'Большая двойной сыр', price: 800 } });
        const recipe = await recipes.addItem(menu.id, { ingredientId: cheese.id, amount: 100, unit: 'g', netAmount: 90, lossPercent: 10, variantAmounts: { [large.id]: 250 } });
        assert.equal((await recipes.getByDish(menu.id, large.id)).foodCost, 100);
        const ticket = await order([{ dishId: menu.id, variantId: large.id, quantity: 2 }]);
        const movement = await db.stockMovement.findFirstOrThrow({ where: { sourceId: ticket.id, type: 'sale' } });
        assert.equal(Number(movement.change), -500);
        await recipes.updateItem(recipe.items[0].id, { amount: 200, unit: 'g', variantAmounts: { [large.id]: 350 } });
        await new PurchasesService(db).create({ supplier: 'Сырная поставка', complete: true, items: [{ ingredientId: cheese.id, quantity: 1, unit: 'kg', purchasePrice: 400 }] });
        await orders.cancelOrder(ticket.id, owner, 'До приготовления');
        assert.equal(await balance(cheese.id), 11000);
        const unchanged = await db.stockMovement.findUniqueOrThrow({ where: { id: movement.id } });
        assert.deepEqual(unchanged.recipeSnapshot, movement.recipeSnapshot);
        assert.equal(Number(unchanged.change), -500);
        assert.ok((await recipes.revisions(menu.id)).some(revision => revision.version === recipe.version));
      });

      await t.test('cooked partial and full cancellations record loss without replenishing or consuming twice', async () => {
        const flour = await ingredients.create({ name: 'Мука', unit: 'kg', stock: 5, avgCost: 80 });
        const menu = await dish('Булочка');
        await recipes.addItem(menu.id, { ingredientId: flour.id, amount: 100, unit: 'g' });
        const ticket = await order([{ dishId: menu.id, quantity: 3 }]);
        await db.orderItem.update({ where: { id: ticket.items[0].id }, data: { status: 'cooking' } });
        const reduced = await orders.editOrder(ticket.id, owner, [{ id: ticket.items[0].id, dishId: menu.id, quantity: 2 }], undefined, 'Сгорела одна порция');
        const cancelled = reduced.items.find(item => item.status === 'cancelled');
        await db.$transaction(tx => stock.restoreDishSale(tx, ticket.id, [{ ...cancelled, sourceLineId: ticket.items[0].id, sourceStatus: 'cooking' }], 'Повтор события'));
        await orders.cancelOrder(ticket.id, owner, 'Гость отменил готовящееся блюдо');
        assert.equal(await balance(flour.id), 4700);
        const losses = await db.stockMovement.findMany({ where: { sourceId: ticket.id, type: 'writeoff' } });
        assert.equal(losses.length, 2);
        assert.equal(losses.reduce((sum, row) => sum + Number(row.recipeSnapshot.lossQuantity), 0), 300);
        assert.equal(losses.reduce((sum, row) => sum + Number(row.change), 0), 0);
        assert.ok(losses.every(row => row.recipeSnapshot.reason));
        assert.equal(await db.stockMovement.count({ where: { sourceId: ticket.id, type: 'return' } }), 0);
      });

      await t.test('partial ready splits retain stock origin and each cancelled part has its own loss', async () => {
        const raw = await ingredients.create({ name: 'Сырьё частичная готовность', unit: 'pcs', stock: 10, avgCost: 5 });
        const menu = await dish('Частично готовое');
        await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 1 });
        const ticket = await order([{ dishId: menu.id, quantity: 3 }]);
        await db.orderItem.update({ where: { id: ticket.items[0].id }, data: { status: 'cooking' } });
        const ready = await orders.kitchenReadyItems(ticket.id, [ticket.items[0].id], owner.id, 'kitchen', [], [{ itemId: ticket.items[0].id, quantity: 1 }]);
        const readyLine = ready.items.find(item => item.status === 'ready');
        assert.equal(readyLine.stockSourceLineId, ticket.items[0].id);
        await orders.cancelOrder(ticket.id, owner, 'Отмена всех порций');
        const losses = await db.stockMovement.findMany({ where: { sourceId: ticket.id, type: 'writeoff' } });
        assert.equal(losses.reduce((sum, row) => sum + Number(row.recipeSnapshot.lossQuantity), 0), 3);
        assert.equal(await balance(raw.id), 7);
      });

      await t.test('one ingredient in a recipe can consume from two warehouses with distinct costs', async () => {
        const raw = await ingredients.create({ name: 'Двойной маршрут', unit: 'pcs', stock: 20, avgCost: 4 });
        await db.$transaction(async tx => {
          await lockIngredients(tx, [raw.id]);
          await postStockMovement(tx, { ingredientId: raw.id, warehouse: await tx.warehouse.findUniqueOrThrow({ where: { id: bar.id } }), change: new Prisma.Decimal(20), cost: new Prisma.Decimal(7), costKnown: true, valuation: 'average', movement: { type: 'purchase', sourceType: 'manual', sourceId: randomUUID() } });
        });
        const virtual = await preparation.create({ name: 'Вложенный маршрут', unit: 'pcs' });
        await preparation.saveRecipe(virtual.id, { mode: 'virtual', outputQuantity: 1, outputUnit: 'pcs', items: [{ ingredientId: raw.id, quantity: 1, unit: 'pcs' }] });
        const menu = await dish('Два склада');
        await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 1, fromCommonWarehouse: true });
        await recipes.addItem(menu.id, { ingredientId: virtual.id, amount: 1, warehouseId: bar.id });
        assert.equal((await recipes.getByDish(menu.id)).foodCost, 11);
        const ticket = await order([{ dishId: menu.id, quantity: 2 }]);
        assert.deepEqual([await balance(raw.id), await balance(raw.id, bar.id)], [18, 18]);
        assert.equal(await db.stockMovement.count({ where: { sourceId: ticket.id, type: 'sale' } }), 2);
        await orders.cancelOrder(ticket.id, owner, 'До приготовления');
        assert.deepEqual([await balance(raw.id), await balance(raw.id, bar.id)], [20, 20]);
      });

      await t.test('two simultaneous orders for the last item have one winner and no lost update', async () => {
        const raw = await ingredients.create({ name: 'Последняя бутылка', unit: 'pcs', stock: 1, avgCost: 10 });
        const menu = await dish('Последняя продажа');
        await recipes.updateSettings(menu.id, { stockIngredientId: raw.id, stockAmount: 1, stockUnit: 'pcs' });
        const results = await Promise.allSettled([order([{ dishId: menu.id, quantity: 1 }]), order([{ dishId: menu.id, quantity: 1 }])]);
        assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
        assert.equal(await balance(raw.id), 0);
        assert.equal(await db.stockMovement.count({ where: { ingredientId: raw.id, type: 'sale' } }), 1);
      });

      await t.test('a concurrent recipe edit and sale record one consistent recipe version and quantity', async () => {
        const raw = await ingredients.create({ name: 'Конкурентная рецептура', unit: 'pcs', stock: 100, avgCost: 7 });
        const menu = await dish('Конкурентная продажа');
        const before = await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 1 });
        const [ticket, after] = await Promise.all([
          order([{ dishId: menu.id, quantity: 1 }]), recipes.updateItem(before.items[0].id, { amount: 2 }),
        ]);
        const movement = await db.stockMovement.findFirstOrThrow({ where: { sourceId: ticket.id, type: 'sale' } });
        const version = movement.recipeSnapshot.recipeVersion;
        assert.ok(version === before.version || version === after.version);
        assert.equal(Number(movement.change), version === before.version ? -1 : -2);
        assert.equal(Number(movement.recipeSnapshot.amount), Math.abs(Number(movement.change)));
      });

      await t.test('explicit negative stock uses retained average cost and partial returns can reduce a deficit', async () => {
        const raw = await ingredients.create({ name: 'Разрешенный минус', unit: 'pcs', stock: 1, avgCost: 25 });
        const menu = await dish('Минус по настройке');
        await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 1 });
        await settings.update({ allowNegativeIngredientStock: true }, owner);
        try {
          const ticket = await order([{ dishId: menu.id, quantity: 3 }]);
          assert.equal(await balance(raw.id), -2);
          assert.equal(ticket.ingredientStockWarnings[0].kind, 'shortage');
          const movement = await db.stockMovement.findFirstOrThrow({ where: { sourceId: ticket.id, type: 'sale' } });
          assert.equal(Number(movement.costAtMoment), 25);
          await orders.editOrder(ticket.id, owner, [{ id: ticket.items[0].id, dishId: menu.id, quantity: 2 }], undefined, 'Одна порция отменена');
          assert.equal(await balance(raw.id), -1);
          await orders.cancelOrder(ticket.id, owner, 'Отмена остатка');
          assert.equal(await balance(raw.id), 1);
        } finally { await settings.update({ allowNegativeIngredientStock: false }, owner); }
      });

      await t.test('unconfigured dishes return an explicit accounting warning and unknown costs stay visible', async () => {
        const menu = await dish('Не настроено');
        const ticket = await order([{ dishId: menu.id, quantity: 1 }]);
        assert.equal(ticket.ingredientStockWarnings[0].kind, 'unconfigured');
        assert.equal((await recipes.getByDish(menu.id)).accountingConfigured, false);
        const raw = await ingredients.create({ name: 'Без цены', unit: 'pcs', stock: 2 });
        await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 1 });
        assert.deepEqual((await recipes.getByDish(menu.id)).missingCosts, ['Без цены']);
      });

      await t.test('large pizza with extra cheese and excluded onion prices and consumes snapshots, not comments', async () => {
        const cheese = await ingredients.create({ name: 'Сыр добавки', unit: 'kg', stock: 10, avgCost: 400 });
        const onion = await ingredients.create({ name: 'Лук исключение', unit: 'kg', stock: 2, avgCost: 40 });
        const menu = await dish('Пицца с добавками');
        const large = await db.dishVariant.create({ data: { dishId: menu.id, name: 'Большая', price: 500 } });
        await recipes.addItem(menu.id, { ingredientId: cheese.id, amount: 100, unit: 'g', variantAmounts: { [large.id]: 150 } });
        await recipes.addItem(menu.id, { ingredientId: onion.id, amount: 30, unit: 'g' });
        const modifiers = new MenuModifiersService(db);
        const config = await modifiers.save(menu.id, { allowIngredientExclusions: true, groups: [{ name: 'Добавки', maxSelections: 2, options: [{ name: 'Сыр', price: 50, ingredientId: cheese.id, amount: 50, unit: 'g', maxQuantity: 2 }] }] });
        const option = config.groups[0].options[0];
        const ticket = await order([{ dishId: menu.id, variantId: large.id, quantity: 2, modifierSelections: [{ optionId: option.id, quantity: 2 }], excludedIngredientIds: [onion.id], comment: 'Это произвольный комментарий' }]);
        assert.equal(Number(ticket.items[0].priceSnapshot), 600); assert.equal(Number(ticket.items[0].finalPrice), 1200);
        assert.deepEqual([await balance(cheese.id), await balance(onion.id)], [9500, 2000]);
        assert.equal(ticket.items[0].modifierSelections[0].name, 'Сыр'); assert.deepEqual(ticket.items[0].excludedIngredientNames, ['Лук исключение']);
        await db.$transaction(tx => stock.applyDishSale(tx, ticket.id, ticket.items));
        assert.equal(await balance(cheese.id), 9500);
        const movement = await db.stockMovement.findFirstOrThrow({ where: { sourceId: ticket.id, type: 'sale' } });
        assert.equal(movement.recipeSnapshot.parts.find(part => part.kind === 'modifier').modifier.amount, '50');
        await modifiers.save(menu.id, { allowIngredientExclusions: false, groups: [] });
        await recipes.updateItem((await recipes.getByDish(menu.id)).items.find(row => row.ingredientId === cheese.id).id, { amount: 1, unit: 'g' });
        await orders.editOrder(ticket.id, owner, [{ id: ticket.items[0].id, dishId: menu.id, variantId: large.id, quantity: 1, modifierSelections: [{ optionId: option.id, quantity: 2 }], excludedIngredientIds: [onion.id] }], undefined, 'Одна пицца отменена');
        assert.equal(await balance(cheese.id), 9750);
        await orders.cancelOrder(ticket.id, owner, 'Остальное до готовки');
        assert.equal(await balance(cheese.id), 10000); assert.equal(await balance(onion.id), 2000);
        assert.ok((await recipes.revisions(menu.id)).some(row => row.snapshot.modifierGroups?.length));
      });

      await t.test('modifier validation rejects foreign options, forbidden exclusions, repeats and required selections', async () => {
        const raw = await ingredients.create({ name: 'Начинка валидация', unit: 'pcs', stock: 10, avgCost: 5 });
        const menu = await dish('Обязательная добавка'); await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 1 });
        const config = await new MenuModifiersService(db).save(menu.id, { allowIngredientExclusions: false, groups: [{ name: 'Соус', minSelections: 1, maxSelections: 1, options: [{ name: 'Соус', price: 10, ingredientId: raw.id, amount: 1 }] }] });
        const optionId = config.groups[0].options[0].id;
        for (const extra of [{}, { modifierSelections: [{ optionId: randomUUID(), quantity: 1 }] }, { modifierSelections: [{ optionId, quantity: 2 }] }, { modifierSelections: [{ optionId, quantity: 1 }, { optionId, quantity: 1 }] }, { modifierSelections: [{ optionId, quantity: 1 }], excludedIngredientIds: [raw.id] }]) await assert.rejects(order([{ dishId: menu.id, quantity: 1, ...extra }]));
        assert.equal(await balance(raw.id), 10);
      });

      await t.test('weighted dishes consume modifier amounts per portion and prepared cancellation records their losses', async () => {
        const raw = await ingredients.create({ name: 'Весовой продукт добавки', unit: 'kg', stock: 2, avgCost: 100 });
        const packageItem = await ingredients.create({ name: 'Упаковка добавки', unit: 'pcs', stock: 10, avgCost: 5 });
        const menu = await dish('Весовое с коробкой', { isWeighted: true, weightedPriceBase: 100 });
        await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 100, unit: 'g' });
        const config = await new MenuModifiersService(db).save(menu.id, { allowIngredientExclusions: false, groups: [{ name: 'Упаковать', options: [{ name: 'Коробка', price: 10, ingredientId: packageItem.id, amount: 1 }] }] });
        const ticket = await order([{ dishId: menu.id, weightGrams: 250, quantity: 2, modifierSelections: [{ optionId: config.groups[0].options[0].id, quantity: 1 }] }]);
        assert.deepEqual([await balance(raw.id), await balance(packageItem.id)], [1500, 8]);
        assert.equal(Number(ticket.items[0].priceSnapshot), 760);
        await db.orderItem.update({ where: { id: ticket.items[0].id }, data: { status: 'cooking' } });
        await orders.cancelOrder(ticket.id, owner, 'Клиент отказался после готовки');
        assert.deepEqual([await balance(raw.id), await balance(packageItem.id)], [1500, 8]);
        const losses = await db.stockMovement.findMany({ where: { sourceId: ticket.id, type: 'writeoff' } });
        assert.equal(losses.length, 2); assert.ok(losses.every(row => Number(row.change) === 0));
      });

      await t.test('deleting the final recipe never reactivates legacy dish or variant balances', async () => {
        const raw = await ingredients.create({ name: 'Удаляемая рецептура', unit: 'pcs', stock: 10, avgCost: 5 });
        const menu = await dish('Старая dish.stock', { trackInventory: true, stock: 7 });
        const recipe = await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 1 });
        await recipes.removeItem(recipe.items[0].id);
        const ticket = await order([{ dishId: menu.id, quantity: 3 }]);
        assert.equal(ticket.ingredientStockWarnings[0].kind, 'unconfigured');
        assert.equal((await db.dish.findUniqueOrThrow({ where: { id: menu.id } })).stock, 7);
        await orders.cancelOrder(ticket.id, owner, 'Отмена');
        assert.equal((await db.dish.findUniqueOrThrow({ where: { id: menu.id } })).stock, 7); assert.equal(await balance(raw.id), 10);
      });

      await t.test('an unconfigured or fully excluded sale cannot acquire a future recipe on retry or reopening', async () => {
        const raw = await ingredients.create({ name: 'Поздняя техкарта', unit: 'pcs', stock: 10, avgCost: 15 });
        const missing = await dish('Пока без рецептуры');
        const ticket = await order([{ dishId: missing.id, quantity: 1 }]);
        assert.equal((await db.orderItem.findUniqueOrThrow({ where: { id: ticket.items[0].id } })).stockAccountingSnapshot.consumed, false);
        await recipes.addItem(missing.id, { ingredientId: raw.id, amount: 2 });
        await db.$transaction(tx => stock.applyDishSale(tx, ticket.id, ticket.items));
        await db.$transaction(tx => stock.applyDishSale(tx, ticket.id, ticket.items, true));
        assert.equal(await balance(raw.id), 10);
        const excluded = await dish('Всё исключено');
        await recipes.addItem(excluded.id, { ingredientId: raw.id, amount: 1 });
        await new MenuModifiersService(db).save(excluded.id, { allowIngredientExclusions: true, groups: [] });
        const empty = await order([{ dishId: excluded.id, quantity: 1, excludedIngredientIds: [raw.id] }]);
        const newRaw = await ingredients.create({ name: 'Новый ингредиент позже', unit: 'pcs', stock: 5, avgCost: 25 });
        await recipes.addItem(excluded.id, { ingredientId: newRaw.id, amount: 1 });
        await db.$transaction(tx => stock.applyDishSale(tx, empty.id, empty.items, true));
        assert.equal(await balance(raw.id), 10); assert.equal(await balance(newRaw.id), 5);
        const next = await order([{ dishId: missing.id, quantity: 1 }]);
        assert.equal(await balance(raw.id), 8); assert.ok(next.items.length);
      });

      await t.test('processing methods retain gross/net norms and instructions while stock always consumes gross', async () => {
        const raw = await ingredients.create({ name: 'Обработка брутто нетто', unit: 'kg', stock: 2, avgCost: 100 });
        await db.ingredient.update({ where: { id: raw.id }, data: { processingLosses: { cleaning: 30 } } });
        const menu = await dish('Чищенный продукт');
        const recipe = await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 100, unit: 'g', processingMethod: 'cleaning' });
        assert.deepEqual([recipe.items[0].amount, recipe.items[0].netAmount, recipe.items[0].lossPercent, recipe.items[0].processingMethod], [100, 70, 30, 'cleaning']);
        await order([{ dishId: menu.id, quantity: 1 }]); assert.equal(await balance(raw.id), 1900);
        const output = await preparation.create({ name: 'Чищенная заготовка', unit: 'kg' });
        const prep = await preparation.saveRecipe(output.id, { outputQuantity: 70, outputUnit: 'g', instructions: 'Очистить и охладить', items: [{ ingredientId: raw.id, quantity: 100, unit: 'g', processingMethod: 'cleaning' }] });
        assert.equal(prep.instructions, 'Очистить и охладить'); assert.equal(prep.items[0].netAmount, 70);
        const batch = await preparation.produce(output.id, { quantity: 140, unit: 'g' }, owner);
        assert.equal(await balance(raw.id), 1700); assert.equal(batch.totalCost, 20); assert.equal(batch.items.recipeInstructions, 'Очистить и охладить');
      });

      await t.test('ordered processing stages, net anchors and cooked weight gain preserve gross stock accounting', async () => {
        const rice = await ingredients.create({ name: 'Рис для многоступенчатой обработки', unit: 'kg', stock: 4, avgCost: 100,
          processingLosses: { cleaning: 20, boiling: -100, frying: 40 } });
        const stages = [{ method: 'cleaning', lossPercent: 20 }, { method: 'frying', lossPercent: 25 }];
        const menu = await dish('Крупа с двумя этапами');
        const staged = { ingredientId: rice.id, amount: 1000, unit: 'g', processingBasis: 'gross', processingStages: stages };
        const preview = await recipes.preview({ dishId: menu.id, items: [staged] });
        assert.deepEqual(preview.items[0].processingStageResults.map(({ inputAmount, outputAmount }) => [inputAmount, outputAmount]), [[1000, 800], [800, 600]]);
        assert.deepEqual([preview.items[0].netAmount, preview.items[0].lossPercent, preview.foodCost], [600, 40, 100]);
        const saved = await recipes.saveDraft(menu.id, { expectedVersion: 1, items: [staged] });
        assert.deepEqual(saved.recipe.output, { amount: 600, unit: 'g' });
        assert.deepEqual(saved.recipe.items[0].processingStages, stages);
        const sold = await order([{ dishId: menu.id, quantity: 1 }]);
        const [debit] = await db.stockMovement.findMany({ where: { sourceId: sold.id } });
        assert.equal(await db.stockMovement.count({ where: { sourceId: sold.id } }), 1);
        assert.deepEqual([Number(debit.change), Number(debit.costAtMoment), await balance(rice.id)], [-1000, 0.1, 3000]);
        assert.deepEqual(debit.recipeSnapshot.processingStages, stages);

        const variantMenu = await dish('Порция с точной нормой по этапам');
        const variant = await db.dishVariant.create({ data: { dishId: variantMenu.id, name: 'Большая', price: 200 } });
        await recipes.addItem(variantMenu.id, { ...staged, amount: 0.003, variantAmounts: { [variant.id]: 10 } });
        const variantRecipe = await recipes.getByDish(variantMenu.id, variant.id);
        assert.deepEqual([variantRecipe.items[0].amount, variantRecipe.items[0].netAmount, variantRecipe.items[0].lossPercent,
          variantRecipe.items[0].processingStageResults[1].outputAmount], [10, 6, 40, 6]);

        const netMenu = await dish('Норма по нетто');
        const net = await recipes.addItem(netMenu.id, { ingredientId: rice.id, amount: 200, netAmount: 200, unit: 'g', processingBasis: 'net', processingMethod: 'cleaning' });
        assert.deepEqual([net.items[0].amount, net.items[0].netAmount, net.foodCost], [250, 200, 25]);
        const netSale = await order([{ dishId: netMenu.id, quantity: 1 }]);
        assert.equal(Number((await db.stockMovement.findFirstOrThrow({ where: { sourceId: netSale.id, type: 'sale' } })).change), -250);

        const grown = await recipes.preview({ dishId: menu.id, items: [{ ingredientId: rice.id, amount: 300, unit: 'g', processingStages: null,
          processingBasis: 'gross', processingMethod: 'boiling' }] });
        assert.deepEqual([grown.items[0].amount, grown.items[0].netAmount, grown.items[0].lossPercent, grown.foodCost], [300, 600, -100, 30]);
        const manual = await recipes.updateItem(saved.recipe.items[0].id, { amount: 0.3, netAmount: 0.42, unit: 'kg', processingStages: stages });
        assert.deepEqual([manual.items[0].amount, manual.items[0].netAmount, manual.items[0].lossPercent, manual.items[0].processingBasis], [0.3, 0.42, -40, 'manual']);
        const cached = await recipes.updateItem(saved.recipe.items[0].id, { amount: 0.6, unit: 'kg' });
        assert.equal(cached.items[0].netAmount, 0.84, 'editing gross without a replacement net preserves the stored manual ratio');
        await ingredients.update(rice.id, { processingLosses: { boiling: -40 } });
        assert.equal((await recipes.getByDish(netMenu.id)).items[0].amount, 250);
        assert.equal(Number((await db.stockMovement.findUniqueOrThrow({ where: { id: debit.id } })).change), -1000);

        const prep = await preparation.create({ name: 'Разваренный рис', unit: 'kg' });
        const gain = [{ method: 'boiling', lossPercent: -100 }];
        const cooked = await preparation.saveRecipe(prep.id, { outputQuantity: 600, outputUnit: 'g',
          items: [{ ingredientId: rice.id, quantity: 300, unit: 'g', processingBasis: 'gross', processingStages: gain }] });
        assert.deepEqual([cooked.items[0].quantity, cooked.items[0].netAmount, cooked.totalCost], [300, 600, 30]);
        const batch = await preparation.produce(prep.id, { quantity: 600, unit: 'g' }, owner);
        assert.equal(batch.totalCost, 30);
        assert.deepEqual(batch.items.recipe[0].processingStages, gain);
        assert.deepEqual([await balance(rice.id), await balance(prep.id)], [2450, 600]);
      });

      await t.test('unknown opening valuation stays unknown after a paid receipt and through production and sale', async () => {
        const raw = await ingredients.create({ name: 'Сырьё неизвестная стоимость', unit: 'kg', stock: 1 });
        await db.$transaction(async tx => {
          await lockIngredients(tx, [raw.id]);
          await postStockMovement(tx, { ingredientId: raw.id, warehouse: { ...main, cafeId: cafe.id }, change: new Prisma.Decimal(1000), cost: new Prisma.Decimal(0.1), costKnown: true, valuation: 'average', movement: { type: 'purchase', sourceType: 'manual', sourceId: randomUUID() } });
        });
        const menu = await dish('Неполная оценка'); await recipes.addItem(menu.id, { ingredientId: raw.id, amount: 100, unit: 'g' });
        const recipe = await recipes.getByDish(menu.id);
        assert.equal(recipe.costKnown, false); assert.deepEqual(recipe.missingCosts, ['Сырьё неизвестная стоимость']); assert.equal(recipe.foodCost, null);
        const ticket = await order([{ dishId: menu.id, quantity: 1 }]);
        const movement = await db.stockMovement.findFirstOrThrow({ where: { sourceId: ticket.id, type: 'sale' } }); assert.equal(movement.costKnown, false);
        await orders.cancelOrder(ticket.id, owner, 'Вернуть до приготовления');
        assert.equal((await db.ingredient.findUniqueOrThrow({ where: { id: raw.id } })).valuationKnown, false);
        const output = await preparation.create({ name: 'Заготовка неполная оценка', unit: 'kg' });
        await preparation.saveRecipe(output.id, { outputQuantity: 1, outputUnit: 'kg', items: [{ ingredientId: raw.id, quantity: 1, unit: 'kg' }] });
        const batch = await preparation.produce(output.id, { quantity: 1, unit: 'kg' }, owner);
        assert.equal(batch.costKnown, false); assert.equal((await db.ingredient.findUniqueOrThrow({ where: { id: output.id } })).valuationKnown, false);
      });

      await t.test('margin recognizes explicit zero consumption and detects an unconfigured component inside a partially costed set', async () => {
        const raw = await ingredients.create({ name: 'Покрытие маржи сырьё', unit: 'pcs', stock: 10, avgCost: 5 });
        const excluded = await dish('Известный нулевой расход'); await recipes.addItem(excluded.id, { ingredientId: raw.id, amount: 1 });
        await new MenuModifiersService(db).save(excluded.id, { allowIngredientExclusions: true, groups: [] });
        const zero = await order([{ dishId: excluded.id, quantity: 2, excludedIngredientIds: [raw.id] }]);
        await orders.kitchenReadyItems(zero.id, [zero.items[0].id], owner.id, 'kitchen', [], [{ itemId: zero.items[0].id, quantity: 1 }]);
        assert.equal((await db.orderItem.findMany({ where: { orderId: zero.id } })).filter((item) => item.stockAccountingSnapshot?.consumed === false).length, 2);
        await db.order.update({ where: { id: zero.id }, data: { status: 'paid', paymentStatus: 'paid', closedAt: new Date() } });
        const reports = new WarehouseReportsService(db);
        const first = (await reports.report({ view: 'sales' })).salesPerformance;
        assert.equal(first.complete, true); assert.equal(first.actualCost, 0); assert.equal(first.missingCostLines, 0);
        const configured = await dish('Настроенный компонент'), missing = await dish('Ненастроенный компонент'), combo = await dish('Частично настроенный сет', { isSet: true });
        await recipes.addItem(configured.id, { ingredientId: raw.id, amount: 1 });
        await db.setComponent.createMany({ data: [{ setId: combo.id, dishId: configured.id, quantity: 1 }, { setId: combo.id, dishId: missing.id, quantity: 1 }] });
        const ticket = await order([{ dishId: combo.id, quantity: 1 }]);
        const item = await db.orderItem.findUniqueOrThrow({ where: { id: ticket.items[0].id } });
        assert.equal(item.stockAccountingSnapshot.consumed, true); assert.equal(item.stockAccountingSnapshot.warnings.length, 1);
        await db.order.update({ where: { id: ticket.id }, data: { status: 'paid', paymentStatus: 'paid', closedAt: new Date() } });
        const second = (await reports.report({ view: 'sales' })).salesPerformance;
        assert.equal(second.complete, false); assert.equal(second.missingCostLines, 1); assert.equal(second.grossMargin, null);
      });

      await t.test('paid-check margin excludes fully returned unknown cost, retains partial unknown cost and separates cooked losses', async () => {
        const known = await ingredients.create({ name: 'Известная цена остатка', unit: 'pcs', stock: 10, avgCost: 5 });
        const unknown = await ingredients.create({ name: 'Неизвестная цена отмены', unit: 'pcs', stock: 10 });
        const good = await dish('Оплаченная известная позиция'), extra = await dish('Отменяемая неизвестная позиция');
        await recipes.addItem(good.id, { ingredientId: known.id, amount: 1 });
        await recipes.addItem(extra.id, { ingredientId: unknown.id, amount: 1 });
        const reports = new WarehouseReportsService(db);
        const closeAndReport = async (ticket, date) => {
          await db.order.update({ where: { id: ticket.id }, data: { status: 'paid', paymentStatus: 'paid', closedAt: new Date(date + 'T12:00:00Z') } });
          return (await reports.report({ view: 'sales', from: date, to: date })).salesPerformance;
        };
        const full = await order([{ dishId: good.id, quantity: 1 }, { dishId: extra.id, quantity: 2 }]);
        await orders.cancelReadyItem(full.id, full.items.find(item => item.dishId === extra.id).id, owner, 'До приготовления');
        const fullSummary = await closeAndReport(full, '2030-01-01');
        assert.equal(fullSummary.complete, true); assert.equal(fullSummary.actualCost, 5); assert.equal(fullSummary.unknownPriceLines, 0);
        const partial = await order([{ dishId: good.id, quantity: 1 }, { dishId: extra.id, quantity: 2 }]);
        await orders.editOrder(partial.id, owner, partial.items.map(item => ({ id: item.id, dishId: item.dishId, quantity: 1 })), undefined, 'Уменьшение');
        const partialSummary = await closeAndReport(partial, '2030-01-02');
        assert.equal(partialSummary.complete, false); assert.equal(partialSummary.actualCost, null); assert.equal(partialSummary.unknownPriceLines, 1);
        const cooked = await order([{ dishId: good.id, quantity: 1 }, { dishId: extra.id, quantity: 2 }]);
        const cancelled = cooked.items.find(item => item.dishId === extra.id);
        await db.orderItem.update({ where: { id: cancelled.id }, data: { status: 'cooking' } });
        await orders.cancelReadyItem(cooked.id, cancelled.id, owner, 'После приготовления');
        const cookedSummary = await closeAndReport(cooked, '2030-01-03');
        assert.equal(cookedSummary.complete, true); assert.equal(cookedSummary.actualCost, 5); assert.equal(cookedSummary.unknownPriceLines, 0);
        const loss = await db.stockMovement.findFirstOrThrow({ where: { sourceId: cooked.id, type: 'writeoff' } });
        assert.equal(Number(loss.change), 0); assert.equal(loss.costKnown, false);
      });

      await t.test('paid goods refund restores only the direct part of a shared stock movement after quantity correction', async () => {
        const goods = await ingredients.create({ name: 'Товар с добавкой из того же остатка', unit: 'pcs', stock: 20, avgCost: 10 });
        const replacement = await ingredients.create({ name: 'Новый остаток товара после продажи', unit: 'pcs', stock: 20, avgCost: 40 });
        const menu = await dish('Прямая продажа с общей добавкой', { prepStation: 'kitchen' });
        await recipes.updateSettings(menu.id, { stockIngredientId: goods.id, stockAmount: 2, stockUnit: 'pcs' });
        const modifiers = new MenuModifiersService(db);
        const config = await modifiers.save(menu.id, { allowIngredientExclusions: false, groups: [{ name: 'Дополнительно',
          options: [{ name: 'Из того же остатка', price: 5, ingredientId: goods.id, amount: 1 }] }] });
        const selection = { dishId: menu.id, modifierSelections: [{ optionId: config.groups[0].options[0].id, quantity: 1 }] };
        const ticket = await order([{ ...selection, quantity: 3 }]);
        const item = ticket.items[0];
        const sale = await db.stockMovement.findFirstOrThrow({ where: { sourceId: ticket.id, type: 'sale' } });
        assert.deepEqual([Number(sale.change), sale.recipeSnapshot.parts.map(({ kind, amount }) => [kind, amount]), await balance(goods.id)],
          [-9, [['direct', '6'], ['modifier', '3']], 11]);

        await orders.editOrder(ticket.id, owner, [{ ...selection, id: item.id, quantity: 2 }], undefined, 'Сняли одну порцию до приготовления');
        assert.equal(await balance(goods.id), 14);
        await db.order.update({ where: { id: ticket.id }, data: { status: 'paid', paymentStatus: 'paid', closedAt: new Date() } });
        await recipes.updateSettings(menu.id, { stockIngredientId: replacement.id, stockAmount: 4, stockUnit: 'pcs' });
        await modifiers.save(menu.id, { allowIngredientExclusions: false, groups: [] });

        const refund = (id) => db.$transaction((tx) => stock.restockPaidGoods(tx, ticket.id, id, [{ item, quantity: 1 }], 'Вернули товар'));
        const first = randomUUID(), second = randomUUID();
        assert.deepEqual(await Promise.all([refund(first), refund(first)]), [true, true]);
        assert.equal(await balance(goods.id), 16);
        assert.equal(await refund(second), true);
        assert.equal(await refund(randomUUID()), false);
        assert.deepEqual([await balance(goods.id), await balance(replacement.id)], [18, 20]);
        const returns = await db.stockMovement.findMany({ where: { sourceId: ticket.id, type: 'return' }, orderBy: { change: 'asc' } });
        assert.deepEqual(returns.map((row) => [Number(row.change), row.saleLineId, Number(row.costAtMoment)]), [[2, item.id, 10], [2, item.id, 10], [3, item.id, 10]]);
        assert.deepEqual((await db.stockMovement.findUniqueOrThrow({ where: { id: sale.id } })).recipeSnapshot, sale.recipeSnapshot);
      });

      await t.test('paid goods refund honors the smaller latest debit when an adjusted order was reopened', async () => {
        const goods = await ingredients.create({ name: 'Товар переоткрытого чека', unit: 'pcs', stock: 20, avgCost: 10 });
        const menu = await dish('Переоткрытая прямая продажа', { prepStation: 'kitchen' });
        await recipes.updateSettings(menu.id, { stockIngredientId: goods.id, stockAmount: 2, stockUnit: 'pcs' });
        const config = await new MenuModifiersService(db).save(menu.id, { allowIngredientExclusions: false, groups: [{ name: 'Добавка',
          options: [{ name: 'Тот же остаток', price: 5, ingredientId: goods.id, amount: 1 }] }] });
        const selection = { dishId: menu.id, modifierSelections: [{ optionId: config.groups[0].options[0].id, quantity: 1 }] };
        const ticket = await order([{ ...selection, quantity: 3 }]);
        const item = ticket.items[0];
        await orders.editOrder(ticket.id, owner, [{ ...selection, id: item.id, quantity: 2 }], undefined, 'Уменьшили количество');
        await orders.cancelOrder(ticket.id, owner, 'Отменили до приготовления');
        await orders.adminUpdateStatus(ticket.id, owner, 'sent_to_kitchen');
        const sale = await db.stockMovement.findFirstOrThrow({ where: { sourceId: ticket.id, orderItemId: item.id, type: 'sale', saleCycle: 1 } });
        assert.deepEqual([Number(sale.change), sale.saleQuantity, sale.recipeSnapshot.parts.map(({ amount }) => amount)], [-6, 2, ['6', '3']]);
        const before = await balance(goods.id);
        await db.order.update({ where: { id: ticket.id }, data: { status: 'paid', paymentStatus: 'paid', closedAt: new Date() } });
        const refundId = randomUUID();
        assert.equal(await db.$transaction((tx) => stock.restockPaidGoods(tx, ticket.id, refundId, [{ item, quantity: 2 }], 'Возврат товара')), true);
        const credit = await db.stockMovement.findFirstOrThrow({ where: { orderItemId: refundId + ':' + item.id, type: 'return' } });
        assert.deepEqual([Number(credit.change), credit.saleCycle, await balance(goods.id)], [4, 1, before + 4]);
      });

      await t.test('recipe endpoints reject foreign ingredients and warehouses', async () => {
        const foreign = await db.cafe.create({ data: { name: 'Foreign recipe scope' } });
        try {
          const other = await runWithTenant({ cafeId: foreign.id }, () => ingredients.create({ name: 'Чужой', unit: 'pcs' }));
          const menu = await dish('Свое блюдо');
          await assert.rejects(recipes.updateSettings(menu.id, { stockIngredientId: other.id }), /не найден/);
          await assert.rejects(recipes.addItem(menu.id, { ingredientId: other.id, amount: 1 }), /не найдена/);
          await runWithTenant({ cafeId: foreign.id }, () => assert.rejects(recipes.getByDish(menu.id), /не найдено/));
        } finally {
          await runWithTenant({ cafeId: foreign.id }, async () => { await db.ingredient.deleteMany({ where: { cafeId: foreign.id } }); await db.cafe.delete({ where: { id: foreign.id } }); });
        }
      });
    });
  } finally {
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.preparationBatch.deleteMany({ where: { cafeId: cafe.id } });
    await db.order.deleteMany({ where: { cafeId: cafe.id } });
    await db.recipeRevision.deleteMany({ where: { cafeId: cafe.id } });
    await db.dish.deleteMany({ where: { cafeId: cafe.id } });
    await db.preparationRecipe.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.waiterShift.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.table.deleteMany({ where: { cafeId: cafe.id } });
    await db.hall.deleteMany({ where: { cafeId: cafe.id } });
    await db.category.deleteMany({ where: { cafeId: cafe.id } });
    await db.settings.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } }); await db.$disconnect();
  }
});
