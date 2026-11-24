const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const filename = resolve(__dirname, '../src/features/admin/pages/warehouse/recipe-draft-values.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const draft = {};
new Function('exports', code.outputText)(draft);
const { grossFromLoss, netFromLoss, recipePreviewItems, validRecipeRows } = draft;

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
