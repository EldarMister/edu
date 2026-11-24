const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const filename = resolve(__dirname, '../src/features/admin/pages/product-sales-report.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const report = {};
new Function('exports', code.outputText)(report);
const { groupProductSales } = report;

const sold = {
  id: 'double-a', productKey: 'espresso', variantKey: 'double', baseName: 'Эспрессо', name: 'Эспрессо · Двойной',
  categoryId: 'coffee', category: 'Кофе', waiterId: 'a', waiter: 'Официант А',
  quantity: 2, gross: 200, discount: 20, revenue: 180, cost: 60, profit: 100, costBasis: 60, profitBasis: 100,
};
const otherWaiter = { ...sold, id: 'double-b', waiterId: 'b', waiter: 'Официант Б', quantity: 1,
  gross: 100, discount: 0, revenue: 100, cost: 20, profit: 70, costBasis: 20, profitBasis: 70 };
const single = { ...otherWaiter, id: 'single-b', variantKey: 'single', name: 'Эспрессо · Одинарный',
  gross: 60, revenue: 60, cost: 10, profit: 48, costBasis: 10, profitBasis: 48 };

test('product rows aggregate quantities, discounts and weighted food cost across waiters and variants', () => {
  const items = [sold, otherWaiter, single];
  const [row] = groupProductSales(items, false, false);
  assert.deepEqual([row.name, row.quantity, row.gross, row.discount, row.revenue, row.cost, row.profit],
    ['Эспрессо', 4, 360, 20, 340, 90, 218]);
  assert.deepEqual([row.averagePrice, row.averageCost, row.foodCost, row.markup], [85, 22.5, 9000 / 340, 21800 / 90]);
  assert.deepEqual(groupProductSales(items, true, false).map(({ name, quantity }) => [name, quantity]),
    [['Эспрессо · Двойной', 3], ['Эспрессо · Одинарный', 1]]);
  assert.deepEqual(groupProductSales(items, false, true).map(({ waiterId, quantity }) => [waiterId, quantity]), [['a', 2], ['b', 2]]);
  assert.equal(sold.quantity, 2);
});

test('unknown costs and sub-cent warehouse values survive grouping', () => {
  const priced = { ...sold, cost: 0, costBasis: 0.004, profitBasis: 140.996 };
  const second = { ...priced, id: 'second', waiterId: 'b' };
  const [pricedTotal] = groupProductSales([priced, second], false, false);
  assert.equal(pricedTotal.cost, 0.008);
  const [incomplete] = groupProductSales([priced, { ...second, cost: null, costBasis: null, profit: null, profitBasis: null }], false, false);
  assert.deepEqual([incomplete.quantity, incomplete.cost, incomplete.averageCost, incomplete.foodCost, incomplete.markup], [4, null, null, null, null]);
});
