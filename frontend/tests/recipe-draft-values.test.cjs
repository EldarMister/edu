const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const filename = resolve(__dirname, '../src/features/admin/pages/warehouse/recipe-draft-values.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const draft = {};
new Function('exports', code.outputText)(draft);
const { displayedProcessingStages, grossFromLoss, lossFromAmounts, netFromLoss, parsePieceWeightGrams, pieceNetWeight,
  preparationYieldBase, processingQuantities, processingRetention, recipeDraftPayload, recipeDraftRows,
  recipePreviewItems, supportsProcessing, validMeasuredNetWeight, validRecipeRows } = draft;

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

test('ordered stages use the remaining weight and can calculate gross from a required net', () => {
  const stages = [{ method: 'cleaning', lossPercent: 20 }, { method: 'boiling', lossPercent: 25 }];
  const first = processingQuantities(1_000, 0, 'gross', processingRetention(stages.slice(0, 1)));
  assert.equal(first.netAmount, 800);
  assert.deepEqual(processingQuantities(1_000, 0, 'gross', processingRetention(stages)), { amount: 1_000, netAmount: 600 });
  assert.deepEqual(processingQuantities(0, 200, 'net', processingRetention(stages.slice(0, 1))), { amount: 250, netAmount: 200 });
  const [payload] = recipeDraftPayload([{ ...potato, processingStages: stages, processingBasis: 'gross' }]);
  assert.deepEqual(payload.processingStages, stages);
  assert.equal(payload.netAmount, undefined);
  assert.equal(payload.lossPercent, undefined);
});

test('cooking growth and measured yield preserve the stock charge', () => {
  const stages = [{ method: 'boiling', lossPercent: -100 }];
  assert.deepEqual(processingQuantities(500, 0, 'gross', processingRetention(stages)), { amount: 500, netAmount: 1_000 });
  assert.deepEqual(processingQuantities(500, 1_100, 'manual', processingRetention(stages)), { amount: 500, netAmount: 1_100 });
  const rice = { ...potato, amount: 500, netAmount: 1_100, processingStages: stages, processingBasis: 'manual' };
  assert.equal(validRecipeRows([rice]), true);
  assert.equal(validRecipeRows([{ ...rice, processingBasis: 'net', processingStages: [{ method: 'boiling', lossPercent: 100 }] }]), false);
  assert.equal(validRecipeRows([{ ...rice, processingStages: [{ method: 'boiling', lossPercent: -1_000 }] }]), false);
  const [variant] = recipePreviewItems([{ ...rice, variantAmounts: { half: 250 } }], [], 'half');
  assert.equal(variant.amount, 250);
  assert.equal(variant.netAmount, 550);
  assert.deepEqual(variant.processingStages, stages);
});

test('an empty API stage list keeps a saved single-method legacy rule and its explicit net', () => {
  const legacy = { ...potato, amountUnit: 'g', processingMethod: 'cleaning', processingStages: [], processingBasis: null };
  const [row] = recipeDraftRows([legacy]);
  assert.deepEqual(displayedProcessingStages(row), [{ method: 'cleaning', lossPercent: 20 }]);
  const [payload] = recipeDraftPayload([row]);
  assert.equal(payload.processingStages, undefined);
  assert.equal(payload.lossPercent, 20);
  assert.equal(payload.netAmount, 160);
});

test('copying a legacy non-mass recipe carries its measured yield and variant norm', () => {
  const legacy = { ...potato, unitType: 'volume', amountUnit: 'ml', netAmount: null, processingMethod: 'boiling', variantAmounts: { small: 100 } };
  const [copy] = recipeDraftRows([legacy], true);
  assert.equal(copy.netAmount, 160);
  assert.equal(copy.processingMethod, undefined);
  assert.deepEqual(copy.variantAmounts, { small: 100 });
  assert.equal(validRecipeRows([copy]), true);
  const [source] = recipeDraftRows([legacy]);
  assert.equal(source.processingMethod, 'boiling');
  assert.equal(source.netAmount, null);
});

test('measured liquid net grams stay separate from charge, legacy volume, and variant ratio', () => {
  const milk = { ingredientId: 'milk', name: 'Молоко', unit: 'ml', unitType: 'volume', amount: 150,
    netAmount: 135, measuredNetWeightGrams: 210, variantAmounts: { small: 75, excluded: 0 } };
  assert.equal(validRecipeRows([milk]), true);
  const [payload] = recipeDraftPayload([milk]);
  assert.equal(payload.amount, 150);
  assert.equal(payload.netAmount, 135);
  assert.equal(payload.measuredNetWeightGrams, 210);
  const [small] = recipePreviewItems([milk], [], 'small');
  assert.deepEqual([small.amount, small.netAmount, small.measuredNetWeightGrams], [75, 67.5, 105]);
  const [excluded] = recipePreviewItems([milk], [], 'excluded');
  assert.equal(excluded.measuredNetWeightGrams, 0);
  assert.equal(recipeDraftPayload([{ ...milk, measuredNetWeightGrams: null }])[0].measuredNetWeightGrams, null);
  assert.equal(validRecipeRows([{ ...milk, unitType: 'mass' }]), false);
  assert.equal(validMeasuredNetWeight(0), true);
  assert.equal(validMeasuredNetWeight(0.1234), false);
});

test('preparation can sum measured liquid, mass and weighted pieces in grams without assuming density', () => {
  const milk = { unitType: 'volume', unitFactor: 1, netAmount: 135, measuredNetWeightGrams: 210 };
  const coffee = { unitType: 'mass', unitFactor: 1, netAmount: 8 };
  const pieces = { unitType: 'count', unitFactor: 1, netAmount: 2, pieceWeightGrams: 40 };
  assert.equal(preparationYieldBase('mass', [milk, coffee, pieces]), 298);
  assert.equal(preparationYieldBase('volume', [milk]), 135);
  assert.equal(preparationYieldBase('mass', [{ ...milk, measuredNetWeightGrams: 0 }]), 0);
  assert.equal(preparationYieldBase('mass', [{ ...milk, measuredNetWeightGrams: null }, coffee]), null);
});
