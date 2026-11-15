const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const moduleValue = { exports: {} };
const { outputText } = ts.transpileModule(readFileSync(resolve(__dirname, '../src/features/admin/pages/warehouse/inventory-workflow.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
new Function('require', 'module', 'exports', outputText)(require, moduleValue, moduleValue.exports);
const { inventoryScopeGroups, toggleInventoryScope, inventoryCountMatches, inventoryCountSummary, inventoryQuantity } = moduleValue.exports;

test('partial inventory groups distinguish physical preparations from goods and preserve categories', () => {
  const products = [
    { id: 'rice', name: 'Рис', kind: 'raw', category: 'Крупы' },
    { id: 'water', name: 'Вода', kind: 'beverage', category: 'Напитки', barcode: '12345' },
    { id: 'dough', name: 'Тесто', kind: 'preparation', category: 'Заготовки' },
    { id: 'bread', name: 'Хлеб', kind: 'goods' },
  ];
  const groups = inventoryScopeGroups(products);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [['rice'], ['dough'], ['water', 'bread']]);
  assert.equal(groups[2].categories.find((group) => group.name === 'Без категории').items[0].id, 'bread');
  assert.deepEqual(inventoryScopeGroups(products, 'напитки').flatMap((group) => group.items.map((item) => item.id)), ['water']);
  assert.deepEqual(inventoryScopeGroups(products, '12345').flatMap((group) => group.items.map((item) => item.id)), ['water']);
});

test('selecting or clearing a filtered category never clears hidden selections or adds duplicate ids', () => {
  assert.deepEqual(toggleInventoryScope(['rice', 'milk'], ['milk', 'water'], true), ['rice', 'milk', 'water']);
  assert.deepEqual(toggleInventoryScope(['rice', 'milk', 'water'], ['milk', 'water'], false), ['rice']);
  assert.deepEqual(toggleInventoryScope(['rice'], [], false), ['rice']);
});

test('counting zero is distinct from an uncounted row; shortage and surplus never cancel in the review totals', () => {
  const rows = [
    { quantity: null, difference: null, value: null },
    { quantity: 0, difference: -2, value: -200 },
    { quantity: 10, difference: 2, value: 200 },
    { quantity: 3, difference: 0, value: 0 },
  ];
  assert.deepEqual(inventoryCountSummary(rows), { total: 4, counted: 3, uncounted: 1, shortage: 1, surplus: 1, shortageValue: 200, surplusValue: 200 });
  assert.equal(inventoryCountMatches(rows[0], 'differences'), false);
  assert.equal(inventoryCountMatches(rows[1], 'uncounted'), false);
  assert.equal(inventoryCountMatches(rows[1], 'shortage'), true);
});

test('unknown valuation remains unknown and floating-point noise is not shown as a real discrepancy', () => {
  const result = inventoryCountSummary([{ quantity: 1, difference: -1, value: null }, { quantity: 0.3, difference: 5e-17, value: 0 }]);
  assert.equal(result.shortageValue, null);
  assert.equal(result.shortage, 1);
  assert.equal(result.surplus, 0);
});

test('small inventory discrepancies stay visible instead of rendering as zero', () => {
  assert.equal(inventoryQuantity(0.0001, 'кг', true), '+0,0001 кг');
  assert.equal(inventoryQuantity(-0.0001, 'кг', true), '−0,0001 кг');
  assert.equal(inventoryQuantity(-5e-17, 'кг', true), '0 кг');
  assert.equal(inventoryQuantity(1.0001, 'кг'), '1,0001 кг');
});
