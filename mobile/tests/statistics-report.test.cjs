const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/screens/admin/StatisticsReport.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(canExport = true, showCosts = true) {
  const slots = [];
  let cursor = 0;
  const exports = [];
  const module = { exports: {} };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (value) => { slots[i] = value; }];
    },
    useRef(initial) {
      const i = cursor++;
      return slots[i] ??= { current: initial };
    },
    useEffect() {},
  };
  const dependencies = {
    react,
    'react-native': { StyleSheet: { create: (style) => style }, useWindowDimensions: () => ({ width: 411 }) },
    'expo-print': {},
    '@/components/themed': { View: 'View', ScrollView: 'Scroll' },
    '@/components/typography': { Text: 'Text', TextInput: 'TextInput' },
    '@/components/FastPressable': { FastPressable: 'Pressable' },
    '@/components/PwaIcon': { PwaIcon: 'Icon' },
    '@/components/Select': { Select: 'Select' },
    '@/components/ui': { Button: 'Button' },
    '@/hooks/useColumnPreference': { useColumnPreference: (_key, defaults) => [defaults, () => {}] },
    '@/hooks/usePermissions': { usePermissions: () => ({
      canAction: (key) => key === 'exportReports' ? canExport : showCosts,
      canSection: () => showCosts,
    }) },
    '@/lib/api': { apiError: String },
    '@/lib/i18n': { useT: () => (value) => value },
    '@/theme': { colors: {}, radius: {}, spacing: { lg: 16 } },
    '@/utils/warehouseBalance': { balanceMoney: (value) => `${value} с` },
    './nativePrintLifecycle': {},
    './print': { shareCsvText: async (filename, body) => exports.push({ filename, body }) },
    './WarehouseMultiSelect': { WarehouseMultiSelect: 'Filter' },
  };
  vm.runInNewContext(compiled, { module, exports: module.exports, AbortController, require: (name) => dependencies[name] });
  function render(view, data) {
    cursor = 0;
    return module.exports.StatisticsReport({ view, data, periodLabel: 'Неделя' });
  }
  function nodes(tree) {
    if (Array.isArray(tree)) return tree.flatMap(nodes);
    return tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
  }
  const find = (tree, type, title) => nodes(tree).find((node) => node.type === type && (node.props.title ?? node.props.label) === title);
  return { render, find, exports };
}

test('products export follows the category filter and protects product names in spreadsheets', async () => {
  const app = setup();
  const products = [
    { id: 'meal', name: '=Menu', categoryId: 'food', category: 'Блюда', quantity: 2, gross: 100, discount: 20, revenue: 80, profit: null },
    { id: 'drink', name: 'Чай', categoryId: 'drinks', category: 'Напитки', quantity: 3, gross: 90, discount: 0, revenue: 90, profit: 55 },
  ];
  const tree = app.render('products', { products });
  app.find(tree, 'Filter', 'Категории').props.onChange(['food']);
  app.find(app.render('products', { products }), 'Button', 'Экспорт CSV').props.onPress();
  await new Promise(setImmediate);
  const output = app.exports[0].body;
  assert.match(output, /"\x27=Menu"/);
  assert.doesNotMatch(output, /Чай/);
  assert.match(output, /"Итого";"—";"—";"2";"100 с";"20 с";"80 с";"—"/);
});

test('category totals preserve unknown historical cost and obey export permissions', async () => {
  const categories = [
    { id: 'food', name: 'Блюда', quantity: 2, revenue: 100, cost: 40, profit: 60 },
    { id: 'drink', name: 'Напитки', quantity: 1, revenue: 50, cost: null, profit: null },
  ];
  const restricted = setup(false);
  assert.equal(restricted.find(restricted.render('categories', { categories }), 'Button', 'Экспорт CSV'), undefined);
  const app = setup();
  app.find(app.render('categories', { categories }), 'Button', 'Экспорт CSV').props.onPress();
  await new Promise(setImmediate);
  assert.match(app.exports[0].body, /"Итого";"3";"—";"150 с";"—";"—"/);
  const noCosts = setup(true, false);
  noCosts.find(noCosts.render('categories', { categories }), 'Button', 'Экспорт CSV').props.onPress();
  await new Promise(setImmediate);
  assert.doesNotMatch(noCosts.exports[0].body, /Себестоимость|Прибыль|Food cost/);
  assert.match(noCosts.exports[0].body, /"Итого";"3";"150 с"/);
});

test('filtering by payment method shows the amount and omits whole-day check counts', async () => {
  const app = setup();
  const data = { payments: [
    { date: '2026-11-16', orders: 2, cash: 50, card: 100, qr: 30, other: 0, total: 180 },
    { date: '2026-11-15', orders: 1, cash: 0, card: 70, qr: 0, other: 0, total: 70 },
  ] };
  app.find(app.render('payments', data), 'Select', 'Оплаты').props.onChange('cash');
  app.find(app.render('payments', data), 'Button', 'Экспорт CSV').props.onPress();
  await new Promise(setImmediate);
  const output = app.exports[0].body;
  assert.match(output, /^"Дата";"Наличные"/);
  assert.doesNotMatch(output, /Чеки|70 с|100 с|180 с/);
  assert.match(output, /"Итого";"50 с"/);
});
