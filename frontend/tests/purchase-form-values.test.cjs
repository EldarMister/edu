const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Run the actual form helpers without adding a second application build.
function loadTypeScript(filename) {
  const module = { exports: {} };
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  new Function('require', 'module', 'exports', outputText)(
    (id) => id.startsWith('.') ? loadTypeScript(resolve(dirname(filename), `${id}.ts`)) : require(id),
    module,
    module.exports,
  );
  return module.exports;
}

const values = loadTypeScript(resolve(__dirname, '../src/features/admin/pages/warehouse/purchase-form-values.ts'));
const balances = loadTypeScript(resolve(__dirname, '../src/features/admin/pages/warehouse/balance-format.ts'));
const invoices = loadTypeScript(resolve(__dirname, '../src/features/admin/pages/warehouse/invoice-import-values.ts'));

test('invoice review only selects unique active products and compatible units', () => {
  const flour = { id: 'flour', name: 'Мука', unitType: 'mass', isActive: true };
  const rows = invoices.invoiceRows([
    { name: 'Мука пшеничная', unit: 'кг', quantity: 2, price: 14, total: 32 },
    { name: 'Мука', unit: 'мешок', quantity: 1, price: 42, total: null },
    { name: 'Упаковка', unit: 'шт.', quantity: 1, price: 0, total: 0 },
    { name: 'Соус', unit: 'кг', quantity: 1, price: 30, total: 30 },
  ], [flour, { ...flour, name: 'Соус', preparationMode: 'virtual' }]);
  assert.equal(rows[0].ingredientId, flour.id);
  assert.equal(rows[0].unit, 'kg');
  assert.equal(rows[0].sourcePrice, 14);
  assert.equal(rows[0].price, '16');
  assert.equal(rows[1].unit, '');
  assert.equal(rows[2].ingredientId, '');
  assert.equal(rows[2].price, '0');
  assert.equal(rows[3].ingredientId, '');
  assert.equal(invoices.invoiceRows([{ name: 'Мука', unit: 'кг', quantity: 1, price: 14, total: 14 }],
    [flour, { ...flour, id: 'duplicate' }])[0].ingredientId, '');
});

test('input VAT follows the discounted amounts of taxable lines only', () => {
  assert.equal(values.purchaseTaxTotal([{ amount: 100, rate: 3 }], 0), 3);
  assert.equal(values.purchaseTaxTotal([{ amount: 30, rate: 0 }, { amount: 70, rate: 3 }], 10), 1.89);
});

test('invoice preview reuses only one matching VAT rate and never re-taxes the gross amount', () => {
  const line = { name: 'Мука', unit: 'кг', quantity: 2, price: 100, total: 200,
    tax: { rate: 3, amount: 6, totalWithTax: 206, needsReview: false } };
  const options = [{ id: 'input-tax', rate: '3.00' }];
  const [row] = invoices.invoiceRows([line], [], options);
  assert.equal(row.taxId, 'input-tax');
  assert.equal(row.taxReview, false);
  assert.equal(row.price, '100');
  assert.equal(row.total, '200');
  assert.equal(values.purchaseRowTotal(row) + values.purchaseTaxTotal([{ amount: 200, rate: 3 }], 0), 206);
  for (const taxes of [[], [...options, { id: 'another', rate: 3 }]]) {
    const [ambiguous] = invoices.invoiceRows([line], [], taxes);
    assert.equal(ambiguous.taxId, null);
    assert.equal(ambiguous.taxReview, true);
  }
});

test('balance valuation uses the precise base-unit price and preserves unknown costs', () => {
  assert.equal(balances.balanceValue({ stock: 22, avgCost: 46.59, stockBase: 22000, avgCostBase: 0.04659091 }), 1025);
  assert.equal(balances.balanceValue({ stock: 17, avgCost: 30.88, stockBase: 17000, avgCostBase: 0.03088235 }), 525);
  assert.equal(balances.balanceValue({ stock: 17, avgCost: null, stockBase: 17000, avgCostBase: null }), null);
  assert.equal(balances.balanceValue({ stock: 0, avgCost: null, stockBase: 0, avgCostBase: null }), 0);
});

test('an invoice total of 10 for three units stays exact after the reverse price calculation', () => {
  const price = values.purchasePriceFromTotal('3', '10');
  assert.equal(price, '3.33333333');
  assert.equal(values.purchaseRowTotal({ quantity: '3', price, total: '10' }), 10);
  assert.equal(values.purchaseRowTotal({ quantity: '4', price }), 13.33);
});

test('price follows kg, g, a 5 kg package, and a product-specific 25 kg sack', () => {
  const rice = { displayUnit: 'kg', purchaseUnits: [{ name: 'Мешок', factor: 25 }] };
  const packages = [{ id: 'five-kg', unit: 'kg', quantity: 5 }];
  const kg = values.purchaseUnitFactor('kg', rice, packages);
  assert.equal(values.convertPurchasePrice('20', kg, values.purchaseUnitFactor('g', rice, packages)), '0.02');
  assert.equal(values.convertPurchasePrice('20', kg, values.purchaseUnitFactor('package:five-kg', rice, packages)), '100');
  assert.equal(values.convertPurchasePrice('20', kg, values.purchaseUnitFactor('pack:0', rice, packages)), '500');
  assert.equal(values.convertPurchasePrice('100', 5000, kg), '20');
});

test('previous-price comparison accepts zero and skips incomplete fields', () => {
  const rise = values.purchasePriceChange('125', '100');
  assert.deepEqual(rise, { difference: 25, ratio: 0.25 });
  assert.deepEqual(values.purchasePriceChange('0', '100'), { difference: -100, ratio: -1 });
  assert.deepEqual(values.purchasePriceChange('125', '0'), { difference: 125, ratio: null });
  assert.equal(values.purchasePriceChange('125', ''), null);
  assert.equal(values.formatPurchaseUnitPrice('0.0125'), '0,0125 с');
  assert.equal(values.formatPurchaseUnitPrice('0.0125', true), '0.0125');
});

test('archived package snapshots retain their original unit conversion', () => {
  const factor = values.purchaseUnitFactor('package:old', undefined, [], { packageId: 'old', packageFactor: 2000 });
  assert.equal(values.convertPurchasePrice('60', factor, values.purchaseUnitFactor('l')), '30');
  assert.equal(values.convertPurchasePrice('60', undefined, 1000), '');
});

test('free goods remain explicit zero, and incomplete values remain empty', () => {
  assert.equal(values.purchasePriceFromTotal('2', '0'), '0');
  assert.equal(values.purchaseRowTotalText({ quantity: '2', price: '0' }), '0.00');
  assert.equal(values.purchaseRowTotalText({ quantity: '2', price: '' }), '');
  assert.equal(values.purchasePriceFromTotal('0', '10'), '');
});

test('invoice lines are rounded individually before a supplier discount', () => {
  const subtotal = [
    { quantity: '1', price: '1.005' },
    { quantity: '2', price: '0.1' },
  ].reduce((sum, row) => sum + values.purchaseRowTotal(row), 0);
  assert.equal(values.roundPurchaseMoney(subtotal), 1.21);
  assert.equal(values.roundPurchaseMoney(subtotal - 0.21), 1);
});

test('four-decimal quantities use the same three-decimal quantity for total and reverse price', () => {
  assert.equal(values.purchaseRowTotal({ quantity: '1.2345', price: '100' }), 123.50);
  assert.equal(values.purchasePriceFromTotal('1.2345', '123.50'), '100');
  assert.equal(values.purchaseRowTotal({ quantity: '1.2344', price: '100' }), 123.40);
  assert.equal(values.roundPurchaseQuantity(0.0004), 0);
  assert.equal(values.purchasePriceFromTotal('0.0004', '1'), '');
});

test('a saved 5 kg package is not reinterpreted after the directory package becomes 10 kg', () => {
  const packages = [{ id: 'rice-bag', unit: 'kg', quantity: 10 }];
  const snapshot = { packageId: 'rice-bag', packageFactor: 5000 };
  const savedFactor = values.purchaseUnitFactor('package:rice-bag', undefined, packages, snapshot);
  assert.equal(savedFactor, 5000);
  assert.equal(values.convertPurchasePrice('100', savedFactor, values.purchaseUnitFactor('kg')), '20');
  assert.equal(values.purchaseUnitFactor('package:rice-bag', undefined, packages), 10000);
});

test('reselecting preserves invoice values and switching products clears the old tax', () => {
  const row = { key: 'line', ingredientId: 'rice', quantity: '2', unit: 'package:rice-bag', price: '125', total: '250', taxId: 'rice-tax' };
  assert.equal(values.selectPurchaseProduct(row, { id: 'rice', displayUnit: 'kg', avgCost: 20 }), row);
  const switched = values.selectPurchaseProduct(row, { id: 'water', displayUnit: 'l', avgCost: 30 });
  assert.deepEqual(switched, { key: 'line', ingredientId: 'water', quantity: '1', unit: 'l', price: '', total: undefined, taxId: null });
});

test('a stock average never silently becomes a supplier invoice price', () => {
  const row = values.selectPurchaseProduct({ ingredientId: '', quantity: '', unit: 'pcs', price: '' }, { id: 'rice', displayUnit: 'kg', avgCost: 42 });
  assert.equal(row.price, '');
  assert.equal(values.purchaseRowTotalText(row), '');
});
