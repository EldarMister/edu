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

const { changeWriteoffPackage, changeWriteoffUnit, emptyWriteoffLine, recordedWriteoffAmounts, sameWriteoffSource, writeoffDraftLines, writeoffFormKey, writeoffLineInput, writeoffPreviewPlan } = loadTypeScript(
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

test('changing display unit preserves the actual writeoff amount and invalidates its recipe preview', () => {
  const row = { ...writeoffDraftLines([snapshot])[0], kind: 'ingredient', sourceId: 'rice', unit: 'g', quantity: '250' };
  const changed = changeWriteoffUnit(row, 'kg');
  assert.equal(changed.quantity, '0.25');
  assert.equal(changed.unit, 'kg');
  assert.equal(changeWriteoffUnit(changed, 'g').quantity, '250');
  assert.equal(changeWriteoffUnit({ ...row, unit: 'ml', quantity: '750' }, 'l').quantity, '0.75');
  assert.equal(changeWriteoffUnit(row, 'pcs'), row);
  assert.equal(changeWriteoffUnit({ ...row, quantity: '' }, 'kg').quantity, '');
  assert.equal(changeWriteoffUnit({ ...row, quantity: '0' }, 'kg').quantity, '0');
  const saved = { ...snapshot, kind: 'ingredient', sourceId: 'rice', unitCode: 'g', quantity: 250 };
  assert.equal(sameWriteoffSource(changed, saved), false);
  assert.equal(writeoffPreviewPlan([changed], [saved]).inputs[0].recipeSignature, undefined);
});

test('saved packaging retains its trusted reference while changing quantity or refreshing the recipe', () => {
  const packed = { ...snapshot, packageId: 'half-portion', packageName: 'Полпорции', packageUnit: 'pcs', packageQuantity: 0.5, packageFactor: 0.5 };
  const [row] = writeoffDraftLines([packed]);
  assert.equal(sameWriteoffSource(row, packed), true);
  assert.equal(writeoffLineInput(row).packageSnapshotLineId, packed.sourceLineId);
  const changed = { ...row, quantity: '3' };
  const input = writeoffPreviewPlan([changed], [packed], true).inputs[0];
  assert.equal(input.packageId, 'half-portion');
  assert.equal(input.packageSnapshotLineId, packed.sourceLineId);
  assert.equal(input.recipeSignature, undefined);
  assert.equal('packageFactor' in input, false, 'only the server decides physical conversion');
});

test('explicitly switching packages uses the current catalogue and supports fractional dish portions', () => {
  const [row] = writeoffDraftLines([{ ...snapshot, packageId: 'pack', packageName: 'Old', packageUnit: 'pcs', packageQuantity: 6, packageFactor: 6 }]);
  const changed = changeWriteoffPackage(row, { id: 'half', name: 'Полпорции', unit: 'pcs', quantity: 0.5, isActive: true });
  assert.equal(changed.quantity, row.quantity);
  assert.equal(changed.packageFactor, 0.5);
  assert.equal(changed.packageSnapshotLineId, undefined);
  assert.equal(writeoffLineInput(changed).packageId, 'half');
  assert.notEqual(writeoffFormKey([changed]), writeoffFormKey([row]));
  assert.equal(changeWriteoffPackage(row, { id: 'kg', name: 'Мешок', unit: 'kg', quantity: 5, isActive: true }), row);
  assert.equal(changeWriteoffPackage(row, { id: 'old', name: 'Архив', unit: 'pcs', quantity: 2, isActive: false }), row);
});

test('removing a saved package converts its physical amount without reading the changed catalogue', () => {
  const [row] = writeoffDraftLines([{ ...snapshot, kind: 'ingredient', sourceId: 'flour', unitCode: 'kg', quantity: 3,
    packageId: 'bag', packageName: 'Old half kilo', packageUnit: 'kg', packageQuantity: 0.5, packageFactor: 500 }]);
  const unpacked = changeWriteoffUnit(row, 'kg');
  assert.equal(unpacked.quantity, '1.5');
  assert.equal(unpacked.packageId, undefined);
  assert.equal(unpacked.packageSnapshotLineId, undefined);
  assert.equal(changeWriteoffUnit(row, 'g').quantity, '1500');
});

test('posted amounts survive detail edits but cannot price new stock inputs or a new operation context', () => {
  const rows = writeoffDraftLines([snapshot]);
  const document = { sourceLines: [snapshot], items: [] };
  assert.equal(recordedWriteoffAmounts(document, rows, false).get('line-1'), 40);
  assert.equal(recordedWriteoffAmounts(document, [{ ...rows[0], details: 'Уточнили причину' }, emptyWriteoffLine()], false).get('line-1'), 40);
  assert.equal(recordedWriteoffAmounts(document, [{ ...rows[0], quantity: '3' }], false), null);
  assert.equal(recordedWriteoffAmounts(document, [{ ...rows[0], sourceId: 'tea' }], false), null);
  assert.equal(recordedWriteoffAmounts(document, rows, true), null);
  assert.equal(recordedWriteoffAmounts(document, [], false), null);
});

test('legacy withdrawals display the saved absolute amount and preserve unknown cost', () => {
  const item = { ingredientId: 'rice', name: 'Рис', quantity: 0.25, unit: 'кг', value: -25 };
  const [row] = writeoffDraftLines([], [item]);
  assert.equal(recordedWriteoffAmounts({ items: [item] }, [row], false).get(row.sourceLineId), 25);
  assert.equal(recordedWriteoffAmounts({ items: [{ ...item, value: null }] }, [row], false).get(row.sourceLineId), null);
  assert.equal(recordedWriteoffAmounts({ items: [item] }, [{ ...row, unit: 'g', quantity: '250' }], false), null);
});
