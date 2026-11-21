const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

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

const { documentQuantityError, documentQuantityInUnit, documentQuantityValue, documentStockShortages, documentUnitCost,
  returnableQuantityInUnit } = loadTypeScript(
  resolve(__dirname, '../src/features/admin/pages/warehouse/stock-document-form.ts'),
);

test('an uncounted inventory line remains null and is distinct from a counted zero', () => {
  assert.equal(documentQuantityError('', true), undefined);
  assert.equal(documentQuantityValue(''), null);
  assert.equal(documentQuantityValue('  '), null);
  assert.equal(documentQuantityError('0', true), undefined);
  assert.equal(documentQuantityValue('0'), 0);
});

test('a selected writeoff or transfer line cannot be silently removed by clearing quantity', () => {
  assert.ok(documentQuantityError('', false));
  assert.ok(documentQuantityError('0', false));
  assert.ok(documentQuantityError('-1', false));
  assert.ok(documentQuantityError('Infinity', false));
  assert.equal(documentQuantityError('0.125', false), undefined);
});

test('a supplier return limit follows the saved row unit even when the catalogue display unit changes', () => {
  const remainingBase = 2500;
  const kilograms = returnableQuantityInUnit(remainingBase, 'кг');
  const grams = returnableQuantityInUnit(remainingBase, 'g');
  assert.equal(kilograms, 2.5);
  assert.equal(grams, 2500);
  assert.equal(documentQuantityError('2.5', false, kilograms), undefined);
  assert.ok(documentQuantityError('2.501', false, kilograms));
  assert.equal(documentQuantityError('2500', false, grams), undefined);
  assert.ok(documentQuantityError('2501', false, grams));
  assert.equal(returnableQuantityInUnit(12, 'шт.'), 12);
  assert.equal(returnableQuantityInUnit(2500, 'unknown'), undefined);
});

test('writeoff and transfer shortages combine lines in the warehouse base unit', () => {
  const catalog = [{ id: 'rice', name: 'Рис', unit: 'кг', stockBase: 1000 }];
  assert.deepEqual(documentStockShortages(catalog, [
    { ingredientId: 'rice', quantity: 700, unit: 'g' },
    { ingredientId: 'rice', quantity: 0.5, unit: 'кг' },
    { ingredientId: 'rice', quantity: null, unit: 'кг' },
    { ingredientId: 'rice', quantity: 200, unit: 'мл' },
  ]), [{ ingredientId: 'rice', name: 'Рис', unit: 'кг', available: 1, requested: 1.2, deficit: 0.2 }]);
  assert.deepEqual(documentStockShortages(catalog, [{ ingredientId: 'rice', quantity: 1, unit: 'kg' }]), []);
});

test('copied quantities and draft costing preserve the saved physical unit', () => {
  assert.equal(documentQuantityInUnit(0.25, 'кг', 'g'), 250);
  assert.equal(documentQuantityInUnit(0.25, 'кг', 'мл'), undefined);
  assert.equal(documentUnitCost('кг', 0.11), 110);
  assert.equal(documentUnitCost('г', 0.11), 0.11);
  assert.equal(documentUnitCost('кг', null), null);
});
