const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.join(__dirname, '../src/screens/admin/dishDraft.ts');
const compiled = new Module(file, module);
compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { initialDishPrice, dishVariantPayload } = compiled.exports;

test('editing a weighted dish retains its base price and existing fixed-size variants', () => {
  const variant = { id: 'portion', name: 'Порция', price: '250', stock: '8', unit: 'шт' };
  const dish = { price: '50.00', isWeighted: true, variants: [variant] };
  assert.equal(initialDishPrice(dish), '50');
  const update = dishVariantPayload({ unit: 'г', variants: [variant] });
  assert.equal(update.trackInventory, undefined);
  assert.equal(update.stock, undefined);
  assert.equal(update.unit, 'г');
  assert.equal(update.initialStock, undefined);
  assert.deepEqual(update.variants, [{ id: 'portion', name: 'Порция', price: 250, unit: 'шт' }]);
});

test('variants omit balances and preserve the identity of existing variants', () => {
  const update = dishVariantPayload({ unit: 'шт', variants: [
    { id: 'old', name: 'Старый', price: '10', stock: '0', unit: 'шт' },
    { name: 'Новый', price: '15', stock: '4', unit: 'шт' },
  ] });
  assert.equal(update.trackInventory, undefined);
  assert.equal(update.variants[0].id, 'old');
  assert.equal(update.variants[0].stock, undefined);
  assert.equal(update.variants[0].initialStock, undefined);
  assert.equal(update.variants[1].name, 'Новый');
  assert.equal(update.variants[1].initialStock, undefined);
  assert.equal(update.stock, undefined);
});

test('ordinary variant dishes omit base price and creation leaves inventory to stock documents', () => {
  assert.equal(initialDishPrice({ price: '100', isWeighted: false, variants: [{}] }), '');
  assert.equal(initialDishPrice(null), '');
  const create = dishVariantPayload({ unit: 'шт', variants: [] });
  assert.equal(create.trackInventory, undefined);
  assert.equal(create.initialStock, undefined);
  assert.deepEqual(create.variants, []);
});
