const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.join(__dirname, '../src/screens/admin/dishDraft.ts');
const compiled = new Module(file, module);
compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { initialDishPrice, dishInventoryPayload } = compiled.exports;

test('editing a weighted dish retains its base price and existing fixed-size variants', () => {
  const variant = { id: 'portion', name: 'Порция', price: '250', stock: '8', unit: 'шт' };
  const dish = { price: '50.00', isWeighted: true, variants: [variant] };
  assert.equal(initialDishPrice(dish), '50');
  const update = dishInventoryPayload({ isEdit: true, priceValue: Number(initialDishPrice(dish)), stock: '1200', unit: 'г', variants: [variant] });
  assert.equal(update.trackInventory, true);
  assert.equal(update.stock, 1200);
  assert.equal(update.unit, 'г');
  assert.equal(update.initialStock, undefined);
  assert.deepEqual(update.variants, [{ id: 'portion', name: 'Порция', price: 250, stock: 8, initialStock: undefined, unit: 'шт' }]);
});

test('new variants initialize stock while existing variants preserve their identity', () => {
  const update = dishInventoryPayload({ isEdit: true, stock: '', unit: 'шт', variants: [
    { id: 'old', name: 'Старый', price: '10', stock: '0', unit: 'шт' },
    { name: 'Новый', price: '15', stock: '4', unit: 'шт' },
  ] });
  assert.equal(update.trackInventory, true);
  assert.equal(update.variants[0].stock, 0);
  assert.equal(update.variants[0].initialStock, undefined);
  assert.equal(update.variants[1].initialStock, 4);
  assert.equal(update.stock, undefined);
});

test('ordinary variant dishes omit base price; new base-only dishes initialize inventory', () => {
  assert.equal(initialDishPrice({ price: '100', isWeighted: false, variants: [{}] }), '');
  assert.equal(initialDishPrice(null), '');
  const create = dishInventoryPayload({ isEdit: false, priceValue: 100, stock: '0', unit: 'шт', variants: [] });
  assert.equal(create.trackInventory, true);
  assert.equal(create.initialStock, 0);
  assert.deepEqual(create.variants, []);
});
