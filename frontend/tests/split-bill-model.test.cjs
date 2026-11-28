const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, '../src/features/waiter/splitBillModel.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const model = {};
new Function('exports', outputText)(model);

test('equal shares preserve the total down to the smallest payable unit', () => {
  const shares = model.splitAmounts(1390.01, 3);
  assert.deepEqual(shares, ['463.34', '463.34', '463.33']);
  assert.equal(model.validSplitAmounts(1390.01, shares.map(Number)), true);
  assert.equal(model.validSplitAmounts(0.05, [0.05, 0]), false);
});

test('editing a share adjusts the unpaid remainder and leaves marked payments alone', () => {
  const paid = [false, true, false];
  assert.deepEqual(model.adjustSplitAmount(['5', '5', '5'], 0, '2.33', paid, 15), ['2.33', '5', '7.67']);
  assert.deepEqual(model.adjustSplitAmount(['5', '5', '5'], 2, '4.99', paid, 15), ['5.01', '5', '4.99']);
});

test('separate checks keep an item on the source check and do not divide weighted lines', () => {
  const items = [
    { id: 'meal', status: 'served', quantity: 2 },
    { id: 'weight', status: 'served', quantity: 2, weightGrams: 500 },
  ];
  assert.deepEqual(model.splitItemSelection(items, { meal: '1' }), [{ itemId: 'meal', quantity: 1 }]);
  assert.equal(model.splitItemSelection(items, { weight: '1' }), null);
  assert.equal(model.splitItemSelection(items, { meal: '2', weight: '2' }), null);
});
