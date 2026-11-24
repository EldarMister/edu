const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const source = readFileSync(resolve(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {};
  new Function('exports', 'require', compiled.outputText)(exports, (name) => dependencies[name] ?? require(name));
  return exports;
}

test('customized native cart separates exclusions, merges identical choices and submits catalog ids', async () => {
  const { useCart, linePrice } = load('store/cart.ts');
  const sent = [];
  const { useCreateOrder } = load('services/api/waiter.ts', {
    '@tanstack/react-query': { useMutation: (input) => input, useQueryClient: () => ({}) },
    '@/lib/api': { api: { post: async (route, body) => { sent.push({ route, body }); return { data: {} }; } } },
  });
  const dish = { id: 'sandwich', price: '150', discountType: 'none' };
  const variant = { id: 'large', price: '175' };
  const choices = [{ optionId: 'extra-sauce', name: 'Соус', quantity: 2, price: 15 }];
  const withoutOnion = { modifierSelections: choices, excludedIngredientIds: ['onion'], excludedIngredientNames: ['Лук'] };
  useCart.getState().add(dish, variant, withoutOnion);
  useCart.getState().add(dish, variant, withoutOnion);
  useCart.getState().add(dish, variant, { modifierSelections: choices });
  const lines = useCart.getState().lines;
  assert.deepEqual(lines.map(({ quantity }) => quantity), [2, 1]);
  assert.equal(linePrice(lines[0]), 410);
  assert.equal(linePrice(lines[1]), 205);
  await useCreateOrder().mutationFn({ tableId: 'table', idempotencyKey: 'key', lines });
  assert.equal(sent[0].route, '/orders');
  assert.deepEqual(sent[0].body.items[0].modifierSelections, [{ optionId: 'extra-sauce', quantity: 2 }]);
  assert.deepEqual(sent[0].body.items[0].excludedIngredientIds, ['onion']);
  assert.equal('excludedIngredientNames' in sent[0].body.items[0], false);
});

test('weighted native modifier price uses the serving quantity and the regular dish discount', () => {
  const { linePrice } = load('store/cart.ts');
  const line = { dish: { price: '500', isWeighted: true, weightedPriceBase: 1000, discountType: 'percent', discountValue: '10' },
    weightGrams: 250, quantity: 2, modifierSelections: [{ optionId: 'extra', name: 'Добавка', quantity: 1, price: 25 }] };
  assert.equal(linePrice(line), 270);
});
