const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/screens/admin/menuModifiersDraft.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const moduleUnderTest = { exports: {} };
vm.runInNewContext(outputText, { exports: moduleUnderTest.exports });
const { initialModifiersDraft, modifierDraftPayload } = moduleUnderTest.exports;

test('modifier editing preserves identifiers, stock routing and per-option limits', () => {
  const saved = {
    allowIngredientExclusions: true,
    groups: [{ id: 'mix', name: 'Добавки', minSelections: 0, maxSelections: null, sortOrder: 2, options: [
      { id: 'cheese', name: 'Сыр', price: 20, amount: 35, unit: 'g', ingredientId: 'ingredient', warehouseId: 'kitchen', maxQuantity: 2, isActive: true },
    ] }],
  };
  const draft = initialModifiersDraft(saved);
  draft.groups[0].options[0].price = '22,50';
  const result = JSON.parse(JSON.stringify(modifierDraftPayload(draft))).value;
  assert.deepEqual(result, {
    ...saved,
    groups: [{ ...saved.groups[0], options: [{ ...saved.groups[0].options[0], price: 22.5 }] }],
  });
});

test('required groups need available capacity and linked ingredients need consumption', () => {
  const draft = initialModifiersDraft({
    allowIngredientExclusions: false,
    groups: [{ name: 'Размер', minSelections: 1, maxSelections: 1, options: [{ name: 'Большой', price: 0, isActive: false }] }],
  });
  assert.match(modifierDraftPayload(draft).error, /недостаточно/);
  const option = draft.groups[0].options[0];
  option.isActive = true;
  option.ingredientId = 'ingredient';
  option.unit = 'g';
  assert.match(modifierDraftPayload(draft).error, /расход/);
  option.amount = '25';
  assert.equal(modifierDraftPayload(draft).value.groups[0].options[0].amount, 25);
});
