const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '../src/screens/admin/DishRecipeFields.tsx');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
});
const moduleContext = { exports: {} };
vm.runInNewContext(compiled.outputText, {
  module: moduleContext, exports: moduleContext.exports,
  require(name) {
    if (name === 'react-native') return { StyleSheet: { create: (value) => value } };
    if (name === '@/theme') return { colors: {}, spacing: {} };
    return {};
  },
}, { filename: file });
const { initialDishRecipe, dishRecipePayload, hasRemovedVariantAmounts } = moduleContext.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

test('preserves recipe metadata, loss, accounting warehouse and existing variant amounts when editing', () => {
  const saved = {
    ingredientId: 'raw', name: 'Рис', amount: 320, baseAmount: 300,
    amountUnit: 'g', unitType: 'mass', netAmount: 240, lossPercent: 20,
    processingMethod: 'boiling', fromCommonWarehouse: false, warehouseId: 'kitchen',
    variantAmounts: { large: 480, removed: 90 }, avgCost: 2,
  };
  const draft = initialDishRecipe([saved], {
    instructions: 'Варить 10 минут', outputQuantity: 240, outputUnit: 'г', photoUrl: 'https://example.test/photo',
  });
  draft.lines[0].variantAmounts.new = '350,25';
  assert.equal(hasRemovedVariantAmounts(draft, ['large', 'new']), true);
  assert.deepEqual(plain(dishRecipePayload(draft, ['large', 'new'])), {
    payload: {
      items: [{
        ingredientId: 'raw', amount: 300, unit: 'g', netAmount: 240, lossPercent: 20,
        processingMethod: 'boiling', fromCommonWarehouse: false, warehouseId: 'kitchen',
        variantAmounts: { large: 480, new: 350.25 },
      }],
      metadata: { instructions: 'Варить 10 минут', outputQuantity: 240, outputUnit: 'г', photoUrl: 'https://example.test/photo' },
    },
  });
});

test('rejects invalid gross and net before submitting a recipe or its associated dish', () => {
  const draft = initialDishRecipe([{
    ingredientId: 'raw', name: 'Рис', amount: 300, amountUnit: 'g', unitType: 'mass', netAmount: 310,
  }]);
  assert.match(dishRecipePayload(draft, []).error, /нетто/);
  draft.lines[0].net = null;
  assert.equal(dishRecipePayload(draft, []).payload.items[0].netAmount, null);
  draft.lines[0].gross = '';
  assert.match(dishRecipePayload(draft, []).error, /брутто/);
});

test('keeps a variant-only recipe line and clears optional recipe output when blanked', () => {
  const draft = initialDishRecipe([{
    ingredientId: 'extra', name: 'Добавка', amount: 0, amountUnit: 'g', unitType: 'mass',
    netAmount: 0, variantAmounts: { large: 20 },
  }], { instructions: 'Старый текст', outputQuantity: 300, outputUnit: 'г' });
  draft.outputQuantity = '';
  draft.outputUnit = '';
  draft.instructions = '';
  const { payload } = plain(dishRecipePayload(draft, ['large']));
  assert.deepEqual(payload.metadata, { instructions: '' });
  assert.equal(payload.items[0].amount, 0);
  assert.deepEqual(payload.items[0].variantAmounts, { large: 20 });
  assert.match(dishRecipePayload(draft, []).error, /брутто/);
});
