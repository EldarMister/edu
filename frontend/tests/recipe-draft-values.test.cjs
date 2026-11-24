const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const filename = resolve(__dirname, '../src/features/admin/pages/warehouse/recipe-draft-values.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const draft = {};
new Function('exports', code.outputText)(draft);
const { grossFromLoss, lossFromAmounts, netFromLoss, parsePieceWeightGrams, pieceNetWeight, preparationYieldBase,
  recipePreviewItems, supportsProcessing, validRecipeRows } = draft;

const potato = { ingredientId: 'potato', name: 'Картофель', unit: 'g', unitType: 'mass', amount: 200, netAmount: 160,
  lossPercent: 20, warehouseId: 'kitchen' };

test('gross and net can be the basis of the same 20% processing loss', () => {
  assert.equal(grossFromLoss(160, 20, 0), 200);
  assert.equal(netFromLoss(200, 20), 160);
  assert.equal(grossFromLoss(0, 100, 200), 200);
  assert.equal(validRecipeRows([potato]), true);
  assert.equal(validRecipeRows([{ ...potato, lossPercent: 100 }]), false);
  assert.equal(validRecipeRows([{ ...potato, netAmount: 201 }]), false);
  assert.equal(validRecipeRows([{ ...potato, netAmount: 0, lossPercent: 100 }]), true);
});

test('automatic processing belongs to mass while same-unit manual net can express a volume loss', () => {
  assert.equal(supportsProcessing('mass'), true);
  assert.equal(supportsProcessing('volume'), false);
  assert.equal(supportsProcessing('count'), false);
  const water = { ...potato, unitType: 'volume', unit: 'ml', amount: 150, netAmount: 135, lossPercent: lossFromAmounts(150, 135) };
  assert.equal(water.lossPercent, 10);
  assert.equal(validRecipeRows([water]), true);
});

test('an unsaved portion preview scales net proportionally and preserves an excluded line as zero', () => {
  const rows = [{ ...potato, variantAmounts: { smaller: 100, excluded: 0, saved: 50 } }];
  assert.deepEqual(recipePreviewItems(rows, ['saved'], 'smaller'), [{ ingredientId: 'potato', warehouseId: 'kitchen',
    unit: 'g', amount: 100, netAmount: 80, lossPercent: 20, variantAmounts: { saved: 50 } }]);
  const [excluded] = recipePreviewItems(rows, ['saved'], 'excluded');
  assert.equal(excluded.amount, 0);
  assert.equal(excluded.netAmount, 0);
  assert.equal(rows[0].amount, 200);
  assert.equal(rows[0].netAmount, 160);
});

test('per-piece grams accept a decimal comma, clear with a blank, and validate persisted precision', () => {
  assert.equal(parsePieceWeightGrams(''), null);
  assert.equal(parsePieceWeightGrams('55,125'), 55.125);
  assert.equal(parsePieceWeightGrams('99999999999.999'), 99_999_999_999.999);
  for (const invalid of ['0', '0.0001', '-1', '1.2345', '100000000000', '1e2']) {
    assert.equal(parsePieceWeightGrams(invalid), undefined);
  }
});

test('net grams use the net piece count and preserve an explicit zero', () => {
  assert.equal(pieceNetWeight(2.5, 40), 100);
  assert.equal(pieceNetWeight(0, 40), 0);
  assert.equal(pieceNetWeight(null, 40), null);
  assert.equal(pieceNetWeight(2.5, null), null);
});

test('preparation yield combines weighted pieces and mass and requires measured output for unknown conversions', () => {
  const mass = { unitType: 'mass', unitFactor: 1_000, netAmount: 0.16 };
  const pieces = { unitType: 'count', unitFactor: 1, netAmount: 2, pieceWeightGrams: 50 };
  const volume = { unitType: 'volume', unitFactor: 1_000, netAmount: 0.3 };
  assert.equal(preparationYieldBase('mass', [mass, pieces]), 260);
  assert.equal(preparationYieldBase('mass', [mass, { ...pieces, pieceWeightGrams: null }]), null);
  assert.equal(preparationYieldBase('mass', [mass, volume]), null);
  assert.equal(preparationYieldBase('mass', [mass, { ...pieces, netAmount: 0, pieceWeightGrams: null }]), 160);
  assert.equal(preparationYieldBase('count', [pieces]), 2);
  assert.equal(preparationYieldBase('volume', [volume]), 300);
});
