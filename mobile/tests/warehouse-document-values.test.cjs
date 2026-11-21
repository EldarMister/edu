const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    if (name === 'expo-crypto') return require('node:crypto');
    if (name === '@/services/api/warehouseUnits') return load('services/api/warehouseUnits.ts');
    throw new Error(`Unexpected runtime dependency: ${name}`);
  }});
  return module.exports;
}
const counts = load('utils/warehouseDocumentForm.ts');
const form = load('utils/warehouseWriteoffForm.ts');
const plain = (value) => JSON.parse(JSON.stringify(value));

test('partial count draft preserves selected uncounted rows and an explicit zero', () => {
  const draft = counts.documentQuantities([{ ingredientId: 'rice', value: '' }, { ingredientId: 'oil', value: '0' }, { ingredientId: 'milk', value: ' 1,25 ' }], true);
  assert.deepEqual(plain(draft.items), [{ ingredientId: 'rice', quantity: null }, { ingredientId: 'oil', quantity: 0 }, { ingredientId: 'milk', quantity: 1.25 }]);
  assert.equal(draft.valid, true);
  assert.equal(draft.canSubmit, false);
  assert.equal(draft.counted, 2);
  assert.equal(counts.documentQuantities([{ ingredientId: 'oil', value: '0' }], true).canSubmit, true);
});

test('clearing a saved count remains null; invalid values and empty submissions never finalize', () => {
  assert.equal(counts.documentQuantity('   '), null);
  for (const value of ['-1', 'Infinity', '1e3', '2..3', 'abc']) assert.equal(counts.documentQuantities([{ ingredientId: 'x', value }], true).valid, false, value);
  assert.equal(counts.documentQuantities([], true).canSubmit, false);
  assert.equal(counts.documentQuantities([{ ingredientId: 'x', value: '0' }], false).valid, false);
});

test('registry uses accounting date, then posting, then creation date', () => {
  const doc = { createdAt: 'created', postedAt: 'posted', effectiveAt: 'effective', countedAt: 'counted' };
  assert.equal(counts.documentOperationDate(doc), 'counted');
  assert.equal(counts.documentOperationDate({ ...doc, countedAt: null }), 'effective');
  assert.equal(counts.documentOperationDate({ ...doc, countedAt: null, effectiveAt: null }), 'posted');
});

const saved = { sourceLineId: 'line', kind: 'ingredient', sourceId: 'rice', name: 'Рис', quantity: 2, unit: 'мешок', unitCode: 'kg',
  packageId: 'pack', packageName: 'Мешок', packageQuantity: 25, packageUnit: 'kg', packageFactor: 25000, recipeSignature: 'saved-recipe', parts: [], total: 120 };

test('saved archived package keeps its snapshot and unchanged recipe signature', () => {
  const rows = form.writeoffDraftLines([saved]);
  assert.equal(rows[0].packageSnapshotLineId, saved.sourceLineId);
  assert.equal(rows[0].packageFactor, 25000);
  const plan = form.writeoffPreviewPlan(rows, [saved]);
  assert.equal(plan.needed, false);
  assert.equal(plan.inputs[0].recipeSignature, 'saved-recipe');
  assert.equal(plan.inputs[0].packageSnapshotLineId, 'line');
  const changed = form.writeoffPreviewPlan([{ ...rows[0], quantity: '3' }], [saved]);
  assert.equal(changed.needed, true);
  assert.equal(changed.inputs[0].recipeSignature, undefined);
  assert.equal(changed.inputs[0].packageSnapshotLineId, 'line');
});

test('switching saved package to units retains physical quantity and drops package identity', () => {
  const row = form.writeoffDraftLines([saved])[0];
  const kilograms = form.changeWriteoffUnit(row, 'kg');
  assert.equal(kilograms.quantity, '50');
  assert.equal(kilograms.packageId, undefined);
  assert.equal(kilograms.packageSnapshotLineId, undefined);
  const grams = form.changeWriteoffUnit(kilograms, 'g');
  assert.equal(grams.quantity, '50000');
  assert.equal(form.changeWriteoffUnit(grams, 'l'), grams);
});

test('decimal comma input and duplicate products keep independent source identities', () => {
  const row = { ...form.writeoffDraftLines([saved])[0], quantity: '1,5' };
  assert.equal(form.writeoffLineInput(row).quantity, 1.5);
  assert.notEqual(form.emptyWriteoffLine().sourceLineId, form.emptyWriteoffLine().sourceLineId);
  const legacy = form.writeoffDraftLines([], [{ ingredientId: 'milk', name: 'Молоко', unit: 'л', quantity: 0.5 }]);
  assert.equal(legacy[0].unit, 'l');
  assert.equal(legacy[0].quantity, '0.5');
});
