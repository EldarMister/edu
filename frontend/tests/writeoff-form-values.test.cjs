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

const { emptyWriteoffLine, sameWriteoffSource, writeoffDraftLines, writeoffFormKey, writeoffLineInput, writeoffPreviewPlan } = loadTypeScript(
  resolve(__dirname, '../src/features/admin/pages/warehouse/writeoff-form-values.ts'),
);

const snapshot = Object.freeze({
  sourceLineId: 'line-1', kind: 'dish', sourceId: 'coffee', variantId: 'large', quantity: 2,
  unit: 'шт', unitCode: 'pcs', name: 'Капучино · большой', recipeSignature: 'saved-recipe',
  parts: Object.freeze([{ ingredientId: 'milk', name: 'Молоко', quantity: 0.4, unit: 'л', unitCode: 'l', unitCost: 100, total: 40 }]), total: 40,
});

test('reopening a draft retains its dish, variant, portion count and saved source-line identity', () => {
  const [row] = writeoffDraftLines([snapshot]);
  assert.equal(sameWriteoffSource(row, snapshot), true);
  assert.equal(sameWriteoffSource({ ...row, quantity: '2.0' }, snapshot), true);
  assert.deepEqual(writeoffLineInput(row), { sourceLineId: 'line-1', kind: 'dish', sourceId: 'coffee', variantId: 'large', quantity: 2, unit: 'pcs' });
  assert.equal(snapshot.recipeSignature, 'saved-recipe');
  assert.equal(snapshot.parts[0].quantity, 0.4);
});

test('changing portions, variant or unit requires a new recipe preview; clearing quantity cannot reuse an old snapshot', () => {
  const [row] = writeoffDraftLines([snapshot]);
  for (const patch of [{ quantity: '3' }, { quantity: '' }, { variantId: 'small' }, { unit: 'g' }, { sourceId: 'tea' }])
    assert.equal(sameWriteoffSource({ ...row, ...patch }, snapshot), false);
});

test('adding an untouched blank row does not mark the saved payload dirty', () => {
  const rows = writeoffDraftLines([snapshot]);
  assert.equal(writeoffFormKey(rows), writeoffFormKey([...rows, emptyWriteoffLine()]));
  assert.notEqual(writeoffFormKey(rows), writeoffFormKey([{ ...rows[0], quantity: '' }]));
});

test('legacy ingredient documents retain their saved unit and two dishes sharing an ingredient remain separate sources', () => {
  const [legacy] = writeoffDraftLines([], [{ ingredientId: 'rice', name: 'Рис', quantity: 0.25, unit: 'кг', expected: 5, difference: -0.25, value: -25, unitCost: 100 }]);
  assert.equal(legacy.kind, 'ingredient');
  assert.equal(legacy.sourceId, 'rice');
  assert.equal(legacy.unit, 'kg');
  assert.equal(legacy.quantity, '0.25');
  const rows = writeoffDraftLines([snapshot, { ...snapshot, sourceLineId: 'line-2', sourceId: 'latte', name: 'Латте' }]);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].sourceLineId, rows[1].sourceLineId);
  assert.deepEqual(rows.map((row) => row.sourceId), ['coffee', 'latte']);
});

test('editing one dish previews the whole form while preserving the recipe token of an untouched dish', () => {
  const snapshots = [snapshot, { ...snapshot, sourceLineId: 'line-2', sourceId: 'latte', recipeSignature: 'latte-recipe' }];
  const rows = writeoffDraftLines(snapshots);
  rows[0].quantity = '3';
  const plan = writeoffPreviewPlan(rows, snapshots);
  assert.equal(plan.needed, true);
  assert.equal(plan.inputs.length, 2);
  assert.equal(plan.inputs[0].recipeSignature, undefined);
  assert.equal(plan.inputs[1].recipeSignature, 'latte-recipe');
  assert.ok(writeoffPreviewPlan(rows, snapshots, true).inputs.every((line) => line.recipeSignature === undefined));
});

test('removing a saved row requires a new server total even when every remaining recipe is unchanged', () => {
  const snapshots = [snapshot, { ...snapshot, sourceLineId: 'line-2', sourceId: 'latte' }];
  const rows = writeoffDraftLines(snapshots);
  assert.equal(writeoffPreviewPlan(rows, snapshots).needed, false);
  assert.equal(writeoffPreviewPlan(rows.slice(0, 1), snapshots).needed, true);
  assert.deepEqual(writeoffPreviewPlan([], snapshots), { inputs: [], needed: false });
});
