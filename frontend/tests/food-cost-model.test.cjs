const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, '../src/features/admin/pages/food-cost-model.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const model = {};
new Function('exports', code.outputText)(model);
const { aggregateFoodCostMetrics, foodCostInsights, percentChange, projectFoodCostBasket, projectFoodCostPrice } = model;

function metrics(quantity, gross, revenue, cost, tax) {
  return {
    quantity, gross, revenue, cost, tax, margin: cost == null || tax == null ? null : revenue - cost - tax,
    foodCostPercent: model.foodCostPercent(cost, revenue),
  };
}

function fixture() {
  const latte = {
    id: 'coffee-latte', dishId: 'latte', variantId: null, name: 'Латте', categoryId: 'coffee', category: 'Кофе',
    catalogKind: 'recipe', isSet: false, price: 100, priceBasis: 250, priceUnit: 'ml', active: true,
    current: metrics(4.5, 450, 360, 180, 36), previous: metrics(6, 600, 540, 180, 54),
    ingredients: [{ id: 'milk', name: 'Молоко', unit: 'л', currentCost: 90, previousCost: 90 }],
  };
  const espresso = {
    ...latte, id: 'coffee-espresso', dishId: 'espresso', name: 'Эспрессо', price: 100, priceBasis: 1, priceUnit: 'pcs',
    current: metrics(10, 1000, 1000, 200, 100), previous: metrics(10, 1000, 1000, 200, 100), ingredients: [],
  };
  const pie = {
    ...espresso, id: 'pie-small', dishId: 'pie', variantId: 'small', name: 'Пирог · Малый', categoryId: 'pastry', category: 'Выпечка',
    current: metrics(10, 1000, 1000, 800, 0), previous: metrics(10, 1000, 1000, 700, 0),
  };
  const positions = [latte, espresso, pie];
  const report = {
    asOf: '2026-11-24T12:00:00Z',
    current: { from: '2026-11-11', to: '2026-11-20', days: [], totals: aggregateFoodCostMetrics(positions.map(({ current }) => current)) },
    previous: { from: '2026-11-01', to: '2026-11-10', days: [], totals: aggregateFoodCostMetrics(positions.map(({ previous }) => previous)) },
    positions,
    ingredients: [{
      id: 'milk', name: 'Молоко', unit: 'л', prices: [],
      current: { quantity: 2, cost: 90, purchasePrice: 60 }, previous: { quantity: 3, cost: 90, purchasePrice: 40 },
    }],
  };
  return { report, latte, espresso, pie };
}

test('uses weighted price units and adjusts for retained discounts and taxes in the 30-day projection', () => {
  const { report, latte } = fixture();
  const result = projectFoodCostPrice(report, latte.id, 120);
  assert.equal(result.position.revenue, 432);
  assert.equal(result.position.cost, 180);
  assert.equal(result.position.tax, 43.2);
  assert.equal(result.position.margin, 208.8);
  assert.equal(result.position.foodCostPercent, 100 * 180 / 432);
  assert.ok(Math.abs(result.position.monthlyMargin - 626.4) < 0.000001);
  assert.ok(Math.abs(result.position.monthlyMarginChange - 194.4) < 0.000001);
  assert.equal(result.category.foodCostPercent, 100 * 380 / 1432);
  assert.equal(result.business.foodCostPercent, 100 * 1180 / 2432);
});

test('combines price changes across positions and categories exactly once', () => {
  const { report, latte, pie } = fixture();
  const result = projectFoodCostBasket(report, { [latte.id]: 120, [pie.id]: 90, obsolete: 50 });
  assert.deepEqual(Object.keys(result.positions), [latte.id, pie.id]);
  assert.equal(result.categories.coffee.revenue, 1432);
  assert.equal(result.categories.pastry.revenue, 900);
  assert.equal(result.business.revenue, 2332);
  assert.equal(result.business.foodCostPercent, 100 * 1180 / 2332);
  assert.ok(Math.abs(result.business.monthlyMarginChange - 3 * (72 - 7.2 - 100)) < 0.000001);
});

test('reprices the observed quantity from the new menu price when historical receipts show a different sticker price', () => {
  const { report, latte } = fixture();
  latte.price = 80;
  const free = projectFoodCostPrice(report, latte.id, 0);
  assert.equal(free.position.revenue, 0);
  assert.equal(free.position.tax, 0);
  assert.equal(free.position.foodCostPercent, null);
  assert.equal(free.position.margin, -180);
  assert.equal(projectFoodCostPrice(report, latte.id, 110).position.revenue, 396);
  assert.equal(foodCostInsights(report, 40).recommendations.find(({ positionId }) => positionId === latte.id).newPrice, 125);
});

test('keeps missing costs unknown and suppresses a ratio for zero revenue', () => {
  const { report, latte, espresso } = fixture();
  latte.current.cost = null;
  latte.current.margin = null;
  latte.current.foodCostPercent = null;
  report.current.totals.cost = null;
  report.current.totals.margin = null;
  const result = projectFoodCostPrice(report, latte.id, 50);
  assert.equal(result.position.revenue, 180);
  assert.equal(result.position.cost, null);
  assert.equal(result.position.foodCostPercent, null);
  assert.equal(result.position.monthlyMarginChange, null);
  assert.equal(result.category.foodCostPercent, null);
  assert.equal(result.business.foodCostPercent, null);
  assert.equal(projectFoodCostPrice(report, espresso.id, 0).position.foodCostPercent, null);
  assert.equal(projectFoodCostPrice(report, espresso.id, -5), null);
  assert.equal(foodCostInsights(report).drivers.some(({ kind }) => kind === 'composition'), false);
  assert.equal(percentChange(100, 0), null);
  assert.equal(percentChange(5, -10), 150);
});

test('produces data-backed drivers and applies the given target with explicit scenarios', () => {
  const { report, latte, pie, espresso } = fixture();
  const { drivers, recommendations } = foodCostInsights(report, 40);
  assert.deepEqual(drivers.map(({ kind }) => kind), ['ingredients', 'mix', 'composition']);
  assert.match(drivers[0].text, /Молоко — 40 с → 60 с за л/);
  assert.match(drivers[2].text, /с 15 с до 20 с/);
  const price = recommendations.find(({ positionId }) => positionId === latte.id);
  assert.equal(price.newPrice, 125);
  assert.equal(projectFoodCostPrice(report, latte.id, price.newPrice).position.foodCostPercent, 40);
  assert.equal(recommendations.find(({ positionId }) => positionId === pie.id).newPrice, 200);
  assert.equal(recommendations.find(({ kind }) => kind === 'purchase').monthlyMarginChange, 120);
  assert.equal(recommendations.find(({ kind }) => kind === 'promotion').positionId, espresso.id);
  assert.match(recommendations.find(({ kind }) => kind === 'promotion').text, /20%/);
});

test('avoids ingredient price and recipe comparisons when prior evidence is absent', () => {
  const { report } = fixture();
  const zero = metrics(0, 0, 0, 0, 0);
  for (const row of report.positions) row.previous = zero;
  report.previous.totals = zero;
  report.ingredients[0].previous.purchasePrice = null;
  const { drivers, recommendations } = foodCostInsights(report);
  assert.deepEqual(drivers.map(({ kind }) => kind), ['mix']);
  assert.doesNotMatch(drivers[0].text, /прошлом периоде/);
  assert.equal(recommendations.some(({ kind }) => kind === 'purchase'), false);
});
