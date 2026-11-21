const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => imports[name] ?? require(name) });
  return exports;
}
const format = load('../src/lib/format.ts');
const { useCart, cartLineKey, cartTotals } = load('../src/features/waiter/cart.ts', { '@/lib/format': format });
const dish = { id: 'pizza', name: 'Pizza', price: '500', discountType: 'none', discountValue: '0' };
const cheese = { modifierSelections: [{ optionId: 'cheese', name: 'Cheese', quantity: 2, price: 50 }], excludedIngredientIds: ['onion'], excludedIngredientNames: ['Onion'] };

test('different selections remain distinct while identical choices merge and totals include add-ons', () => {
  useCart.getState().selectTable('modifiers'); useCart.getState().clear();
  useCart.getState().add(dish, undefined, undefined, cheese);
  useCart.getState().add(dish, undefined, undefined, cheese);
  useCart.getState().add(dish);
  const { lines } = useCart.getState();
  assert.equal(lines.length, 2); assert.equal(lines[0].quantity, 2);
  assert.notEqual(cartLineKey(lines[0]), cartLineKey(lines[1]));
  assert.equal(cartTotals(lines).final, 1700);
});

test('weighted add-on charge is per portion and customizations survive table draft switching', () => {
  useCart.getState().selectTable('weighted'); useCart.getState().clear();
  useCart.getState().add({ ...dish, isWeighted: true, weightedPriceBase: 100 }, undefined, 250, cheese);
  assert.equal(cartTotals(useCart.getState().lines).final, 1350);
  useCart.getState().selectTable('other'); useCart.getState().selectTable('weighted');
  assert.equal(useCart.getState().lines[0].modifierSelections[0].quantity, 2);
});

test('editing composition preserves existing order line identity and respects stage restrictions', () => {
  useCart.getState().selectTable('edit');
  useCart.getState().replaceLines([{ dish, quantity: 3, lineId: 'existing', orderItemId: 'server-line', ...cheese }, { dish, quantity: 1, lineId: 'locked', cancelAllowed: false, ...cheese }], '');
  useCart.getState().setLineModifiers('existing', { modifierSelections: [], excludedIngredientIds: [], excludedIngredientNames: [] });
  useCart.getState().setLineModifiers('locked', { modifierSelections: [] });
  const { lines } = useCart.getState();
  assert.equal(lines[0].orderItemId, 'server-line'); assert.equal(lines[0].quantity, 3);
  assert.equal(lines[0].modifierSelections.length, 0); assert.equal(lines[1].modifierSelections.length, 1);
});
