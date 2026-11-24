require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { ValidationPipe } = require('@nestjs/common');
const { FoodCostAnalysisController, FoodCostAnalysisService } = require('../src/warehouse/food-cost-analysis.ts');
const { FoodCostReportQuery } = require('../src/warehouse/reports.dto.ts');
const { WarehouseReportsService } = require('../src/warehouse/reports.service.ts');
const { WarehouseReportsController } = require('../src/warehouse/reports.controller.ts');
const { writeFoodCostWorkbook } = require('../src/warehouse/food-cost-xlsx.ts');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}
const period = { from: '2026-11-16', to: '2026-11-22' };

test('food cost report and workbook require cost visibility, and workbook requires export access', async () => {
  const controller = new WarehouseReportsController({ foodCost: async () => assert.fail('forbidden data must not be loaded') });
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.sections.warehouse = true;
  permissions.actions.warehouseCosts = false;
  const actor = { role: 'ADMIN', permissions };
  const analysis = new FoodCostAnalysisController({});
  assert.throws(() => controller.foodCost(period, actor), { status: 403 });
  assert.throws(() => analysis.analyze(period, actor), { status: 403 });
  assert.throws(() => analysis.availability(actor), { status: 403 });
  permissions.actions.warehouseCosts = true;
  permissions.actions.exportReports = false;
  await assert.rejects(controller.exportFoodCost({ ...period, tab: 'ingredients' }, {}, actor), { status: 403 });
});

test('optional food cost AI sends only anonymized aggregates on request and deduplicates same-café work', async (t) => {
  const envNames = ['FOOD_COST_OPENAI_API_KEY', 'FOOD_COST_OPENAI_MODEL'];
  const previousEnv = envNames.map((name) => process.env[name]);
  t.after(() => envNames.forEach((name, index) => {
    const value = previousEnv[index];
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }));
  for (const name of envNames) delete process.env[name];
  const totals = { revenue: 100, gross: 120, cost: 30, margin: 67, foodCostPercent: 30, tax: 3, quantity: 4 };
  const metrics = { quantity: 1, cost: 30, purchasePrice: 50, hidden: 'customer-record' };
  const report = {
    current: { ...period, totals },
    previous: { from: '2026-11-09', to: '2026-11-15', totals: { ...totals, revenue: 80 } },
    positions: [{ id: 'private-dish-id', name: 'Кофе секретного меню', category: 'Секретная категория', categoryId: 'private-category-id',
      current: totals, previous: totals, ingredients: [{
        id: 'private-ingredient-id', name: 'Секретное молоко', currentCost: 15, previousCost: 12,
      }] }],
    ingredients: [{ id: 'private-ingredient-id', name: 'Секретное молоко', unit: 'л',
      current: metrics, previous: { ...metrics, purchasePrice: 40 } }],
    rawCustomers: ['customer-record'],
  };
  const requests = [];
  let fail = false;
  t.mock.method(globalThis, 'fetch', async (endpoint, init) => {
    requests.push(JSON.parse(init.body));
    assert.equal(endpoint, 'https://api.openai.com/v1/responses');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer local-fixture-key');
    assert.equal(init.signal.aborted, false);
    if (fail) return new Response('private provider error', { status: 429 });
    return Response.json({ status: 'completed', output: [{ type: 'reasoning' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Проверьте D01 (C01) и I01.' }] }] });
  });

  let loads = 0;
  const service = new FoodCostAnalysisService({ foodCost: async () => { loads++; return report; } });
  const controller = new FoodCostAnalysisController(service);
  const permissions = getDefaultPermissionsByRole('ADMIN');
  permissions.sections.warehouse = true;
  permissions.actions.warehouseCosts = true;
  permissions.readOnlySections = ['warehouse'];
  const actor = { cafeId: 'analysis-tenant', role: 'ADMIN', permissions };
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const body = { type: 'body', metatype: FoodCostReportQuery };
  await assert.rejects(pipe.transform({ ...period, model: 'client-model' }, body), /Bad Request/);
  const input = await pipe.transform(period, body);
  await assert.rejects(controller.analyze(input, actor), { status: 403 });
  await runWithTenant({ cafeId: actor.cafeId }, async () => {
    assert.deepEqual(controller.availability(actor), { available: false });
    await assert.rejects(controller.analyze(input, actor), { status: 503 });
    process.env[envNames[0]] = 'local-fixture-key';
    assert.deepEqual(controller.availability(actor), { available: false });
    process.env[envNames[1]] = 'fixture-model';
    assert.deepEqual(controller.availability(actor), { available: true });
    assert.equal(loads, 0);
    const [one, two] = await Promise.all([controller.analyze(input, actor), controller.analyze(input, actor)]);
    assert.deepEqual(one, { text: 'Проверьте Кофе секретного меню (Секретная категория) и Секретное молоко.' });
    assert.deepEqual(two, one);
    assert.equal(loads, 1);
    assert.equal(requests.length, 1);
    const [{ model, store, input: sentInput, max_output_tokens: maxTokens }] = requests;
    assert.equal(model, 'fixture-model');
    assert.equal(store, false);
    assert.equal(maxTokens, 1100);
    assert.doesNotMatch(sentInput, /секретн|private-|customer-record/i);
    const bundle = JSON.parse(sentInput);
    assert.equal(bundle.current.cost, 30);
    assert.equal(bundle.positions[0].code, 'D01');
    assert.equal(bundle.positions[0].components[0].code, bundle.ingredients[0].code);
    fail = true;
    await assert.rejects(controller.analyze(input, actor), (error) =>
      error.status === 502 && !error.message.includes('private provider error'));
    fail = false;
    assert.deepEqual(await controller.analyze(input, actor), one);
    const empty = new FoodCostAnalysisService({ foodCost: async () => ({ ...report, positions: [], ingredients: [] }) });
    await assert.rejects(empty.analyze(actor.cafeId, input), { status: 422 });
    assert.equal(requests.length, 3);
  });
});

test('PostgreSQL food cost report reconciles periods, weighted sales, refunds, taxes, and receipt prices', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafes = await Promise.all(['Food cost', 'Other cafe'].map((name) => db.cafe.create({ data: { name: `${name} ${randomUUID()}` } })));
  const service = new WarehouseReportsService(db);
  async function purchase(ingredientId, postedAt, quantityBase, total, status = 'completed') {
    return db.purchase.create({ data: { supplier: 'Поставщик', date: new Date('2026-10-25T12:00:00Z'), stockPostedAt: new Date(postedAt), status,
      items: { create: { ingredientId, quantityBase, quantity: quantityBase / 1000, total, purchasePrice: total / (quantityBase / 1000) } } } });
  }
  try {
    await runWithTenant({ cafeId: cafes[1].id }, async () => {
      const item = await db.ingredient.create({ data: { name: 'Ингредиент другого кафе', unitType: 'volume', displayUnit: 'l' } });
      await purchase(item.id, '2026-11-16T08:00:00Z', 1000, 9999);
    });
    await runWithTenant({ cafeId: cafes[0].id }, async () => {
      const hall = await db.hall.create({ data: { name: 'Hall' } });
      const table = await db.table.create({ data: { hallId: hall.id, number: 1 } });
      const category = await db.category.create({ data: { name: 'Напитки', prepStation: 'bar' } });
      const milk = await db.ingredient.create({ data: { name: 'Молоко', unitType: 'volume', displayUnit: 'l' } });
      const drink = await db.dish.create({ data: { categoryId: category.id, name: 'Молочный коктейль', price: 120,
        isWeighted: true, weightedMeasure: 'volume', weightedPriceBase: 1000 } });
      await purchase(milk.id, '2026-11-15T17:59:59.999Z', 2000, 200);
      await purchase(milk.id, '2026-11-15T18:00:00Z', 1000, 90);
      await purchase(milk.id, '2026-11-16T07:00:00Z', 3000, 330);
      await purchase(milk.id, '2026-11-16T08:00:00Z', 1000, 9999, 'cancelled');

      async function sale({ at, weight, price, quantity = 1, refundedQuantity = 0, serviceCharge = 0, cost, tax }) {
        const order = await db.order.create({ data: {
          tableId: table.id, orderNumber: randomUUID(), status: 'paid', paymentStatus: 'paid', closedAt: new Date(at),
          finalAmount: quantity * price + serviceCharge, serviceChargeAmount: serviceCharge,
          refundedAmount: refundedQuantity * (price + serviceCharge / quantity),
          items: { create: { dishId: drink.id, dishNameSnapshot: drink.name, dishVariantNameSnapshot: weight + ' мл',
            weightGrams: weight, status: 'served', quantity, refundedQuantity, priceSnapshot: price, finalPrice: quantity * price } },
        }, include: { items: true } });
        const [{ id: orderItemId }] = order.items;
        if (tax) await db.orderTax.create({ data: { orderId: order.id, taxId: 'fixture-tax', name: 'Налог', rate: 10, type: 'turnover',
          salesAmount: price * quantity, amount: tax, itemAmounts: { [orderItemId]: price * quantity }, soldAt: new Date(at) } });
        const base = { ingredientId: milk.id, sourceType: 'order', sourceId: order.id, orderItemId,
          costAtMoment: cost, costKnown: true, createdAt: new Date(at) };
        await db.stockMovement.create({ data: { ...base, type: 'sale', beforeStock: 10000,
          change: -weight * quantity, afterStock: 10000 - weight * quantity } });
        if (refundedQuantity) await db.stockMovement.create({ data: { ...base, type: 'return', saleLineId: orderItemId,
          beforeStock: 10000 - weight * quantity, change: weight * refundedQuantity, afterStock: 10000 - weight * (quantity - refundedQuantity) } });
      }
      await sale({ at: '2026-11-15T17:59:59.999Z', weight: 500, price: 60, cost: 0.06 });
      await sale({ at: '2026-11-15T18:00:00Z', weight: 250, price: 30, cost: 0.02, tax: 3 });
      await sale({ at: '2026-11-17T11:00:00Z', weight: 500, price: 60, cost: 0.025, quantity: 2, refundedQuantity: 1, serviceCharge: 10 });
      await sale({ at: '2026-11-22T18:00:00Z', weight: 250, price: 30, cost: 0.02 });

      const report = await service.foodCost(period);
      assert.deepEqual([report.previous.from, report.previous.to], ['2026-11-09', '2026-11-15']);
      assert.equal(report.current.days.length, 7);
      assert.equal(report.previous.days.at(-1).date, '2026-11-15');
      assert.deepEqual(report.current.totals,
        { quantity: 0.75, gross: 90, revenue: 90, cost: 17.5, tax: 3, margin: 69.5, foodCostPercent: 19.4444 });
      assert.deepEqual(report.previous.totals,
        { quantity: 0.5, gross: 60, revenue: 60, cost: 30, tax: 0, margin: 30, foodCostPercent: 50 });
      const { readProfitLoss } = require('../src/finance/profit-loss.ts');
      const pnl = async () => {
        const data = await db.$transaction((tx) => readProfitLoss(tx, cafes[0].id, {
          from: new Date('2026-11-16T00:00:00+06:00'), to: new Date('2026-11-23T00:00:00+06:00'),
        }));
        return Object.fromEntries(data.rows.map((row) => [row.label, row.value]));
      };
      const profit = await pnl();
      assert.deepEqual([profit['Доходы'], profit['Продажи товаров и техкарт'], profit['Обслуживание'], profit['Себестоимость продаж'],
        profit['Налог (10%)'], profit['Прибыль после налогообложения']], [95, 90, 5, 17.5, 3, 74.5]);
      assert.equal(report.positions.length, 1, 'orders with different measures are grouped into one weighted menu item');
      const [position] = report.positions;
      assert.deepEqual([position.name, position.price, position.priceBasis, position.priceUnit, position.category], [drink.name, 120, 1000, 'ml', 'Напитки']);
      assert.deepEqual(position.ingredients[0], {
        id: milk.id, name: milk.name, unit: 'л', currentCost: 17.5, previousCost: 30, currentUnitCost: 23.3333, previousUnitCost: 60,
      });
      assert.deepEqual(report.ingredients.map(({ id, current, previous, prices }) => ({ id, current, previous, prices })), [{
        id: milk.id, current: { quantity: 0.75, cost: 17.5, purchasePrice: 105 },
        previous: { quantity: 0.5, cost: 30, purchasePrice: 100 },
        prices: [{ date: '2026-11-15', price: 100 }, { date: '2026-11-16', price: 105 }],
      }]);
      const workbook = XLSX.read(writeFoodCostWorkbook(report, { tab: 'ingredients', search: ' МОЛОКО ' }), { type: 'buffer' });
      const [row] = XLSX.utils.sheet_to_json(workbook.Sheets['Ингредиенты']);
      assert.equal(row['Стоимость расхода'], 17.5);
      assert.equal(row['Закупочная цена тек. периода'], 105);
      const unmatched = XLSX.read(writeFoodCostWorkbook(report, { tab: 'positions', search: 'Нет такой позиции' }), { type: 'buffer' });
      assert.deepEqual(XLSX.utils.sheet_to_json(unmatched.Sheets['Позиции']), []);
      const early = await db.ingredient.create({ data: { name: 'Поставка в полночь', unitType: 'volume', displayUnit: 'l' } });
      await purchase(early.id, '2026-11-08T18:00:00Z', 1000, 80);
      await assert.rejects(service.foodCost({ from: '2026-02-30', to: '2026-05-30' }), { status: 400 });

      const product = await db.dish.create({ data: { categoryId: category.id, name: 'Морс', price: 40, catalogKind: 'goods' } });
      const variant = await db.dishVariant.create({ data: { dishId: product.id, name: 'Большой', price: 75 } });
      await db.order.create({ data: { tableId: table.id, orderNumber: randomUUID(), status: 'paid', paymentStatus: 'paid',
        closedAt: new Date('2026-11-18T10:00:00Z'), finalAmount: 70,
        items: { create: { dishId: product.id, dishVariantId: variant.id, dishNameSnapshot: product.name, dishVariantNameSnapshot: variant.name,
          status: 'served', quantity: 1, priceSnapshot: 70, finalPrice: 70 } } } });
      const incomplete = await service.foodCost(period);
      const variantRow = incomplete.positions.find(({ variantId }) => variantId === variant.id);
      assert.equal(variantRow.price, 75);
      assert.equal(variantRow.current.cost, null);
      assert.equal(variantRow.catalogKind, 'goods');
      assert.equal(incomplete.current.totals.revenue, 160);
      assert.equal(incomplete.current.totals.cost, null);
      assert.equal(incomplete.current.totals.margin, null);
      assert.equal(incomplete.ingredients.find((row) => row.id === early.id).previous.purchasePrice, 80);
      assert.equal((await pnl())['Прибыль после налогообложения'], null);
    });
  } finally {
    for (const { id: cafeId } of cafes) {
      await db.stockMovement.deleteMany({ where: { cafeId } });
      await db.order.deleteMany({ where: { cafeId } });
      await db.purchase.deleteMany({ where: { cafeId } });
      await db.dish.deleteMany({ where: { cafeId } });
      await db.table.deleteMany({ where: { cafeId } });
      await db.hall.deleteMany({ where: { cafeId } });
      await db.category.deleteMany({ where: { cafeId } });
      await db.ingredient.deleteMany({ where: { cafeId } });
      await db.cafe.delete({ where: { id: cafeId } });
    }
    await db.$disconnect();
  }
});
