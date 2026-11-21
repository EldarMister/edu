const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const plain = (value) => JSON.parse(JSON.stringify(value));

function load(file, modules = {}, transform = (source) => source) {
  const source = transform(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'));
  const module = { exports: {} };
  const options = { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2022 };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: options }).outputText, {
    module, exports: module.exports,
    require(name) {
      if (name in modules) return modules[name];
      if (name === '@/services/api/warehouseUnits') return load('services/api/warehouseUnits.ts');
      if (name === '@/utils/warehouseTiming') return load('utils/warehouseTiming.ts');
      throw new Error('Unexpected module ' + name);
    },
  });
  return module.exports;
}

test('native production uses the current batch and atomic card routes', async () => {
  const calls = [];
  const data = { id: 'saved-batch' };
  const method = (name) => async (url, body) => {
    calls.push({ name, url, body }); return { data };
  };
  const api = load('services/api/warehouseProduction.ts', {
    '@tanstack/react-query': {
      useMutation: (options) => options,
      useQuery: (options) => options,
      useQueryClient: () => ({ invalidateQueries() {}, setQueryData() {} }),
    },
    '@/lib/api': { api: { get: method('GET'), post: method('POST'), put: method('PUT') } },
  });
  await api.useProductionJournal('stock').queryFn();
  await api.useProductionBatch('lot/1').queryFn();
  const { produce, reverse } = api.useProductionMutations();
  await produce.mutationFn({ id: 'rice', requestKey: 'safe-retry' });
  await reverse.mutationFn({ id: 'lot', reason: 'Ошибка' });
  await api.useSavePreparationCard().mutationFn({ name: 'Рис' });
  await api.useSavePreparationCard().mutationFn({ id: 'rice', expectedUpdatedAt: 'saved-version' });
  assert.deepEqual(plain(calls), [
    { name: 'GET', url: '/admin/warehouse/preparation/batches', body: { params: { warehouseId: 'stock' } } },
    { name: 'GET', url: '/admin/warehouse/preparation/batches/lot%2F1' },
    { name: 'POST', url: '/admin/warehouse/preparation/rice/batches', body: { requestKey: 'safe-retry' } },
    { name: 'POST', url: '/admin/warehouse/preparation/batches/lot/reverse', body: { reason: 'Ошибка' } },
    { name: 'POST', url: '/admin/warehouse/preparation/card', body: { name: 'Рис' } },
    { name: 'PUT', url: '/admin/warehouse/preparation/rice/card', body: { expectedUpdatedAt: 'saved-version' } },
  ]);
});

test('production retains the planned scale and unchanged ingredient norms on a retried unit conversion', async () => {
  const slots = [];
  const calls = [];
  const notifications = [];
  let index = 0;
  const recipe = {
    id: 'recipe', name: 'Заготовка', unitType: 'mass', mode: 'stocked', outputQuantity: 1, outputUnit: 'kg',
    items: [{ ingredientId: 'raw', name: 'Рис', quantity: 250, unit: 'g' }, { ingredientId: 'salt', name: 'Соль', quantity: 2, unit: 'g' }],
  };
  const warehouse = { id: 'stock', name: 'Склад' };
  const primitives = { Text: 'Text', Field: 'Field', Button: 'Button', Card: 'Card', View: 'View', ScrollView: 'ScrollView' };
  const { BatchForm } = load('screens/admin/PreparationBatchEditor.tsx', {
    react: {
      createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
      useRef(initial) { return slots[index++] ??= { current: initial }; },
      useState(initial) {
        const key = index++;
        if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial;
        return [slots[key], (value) => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }];
      },
    },
    'react-native': { StyleSheet: { create: (value) => value }, useWindowDimensions: () => ({ width: 411 }) },
    'expo-crypto': { randomUUID: () => 'same-retry-key' },
    '@/components/themed': primitives,
    '@/components/ui': primitives,
    '@/components/FastPressable': { FastPressable: 'Pressable' },
    '@/components/PwaIcon': { PwaIcon: 'Icon' },
    '@/components/Select': { Select: 'Select' },
    '@/components/DateField': { DateField: 'DateField' },
    '@/components/typography': { Text: 'Text', Alert: {} },
    '@/hooks/usePermissions': { usePermissions: () => ({ canAction: () => true }) },
    '@/lib/api': { apiError: String },
    '@/services/api/warehouse': { qty: String },
    '@/services/api/warehouseProduction': {
      useProductionHistory: () => ({}),
      useProductionMutations: () => ({ produce: { mutateAsync: async (body) => {
        calls.push(plain(body));
        if (calls.length === 1) throw new Error('Network interruption');
        return { totalCost: 80 };
      } } }),
    },
    '@/store/notifications': { useNotifications: (select) => select({ push: (notification) => notifications.push(notification) }) },
    '@/theme': { colors: {}, spacing: {} },
    '@/utils/format': { money: (value) => `${value} с` },
    './WarehouseDirectoryTable': { WarehouseDirectoryField: 'WarehouseDirectoryField' },
    './WarehouseWorkspace': { WarehouseWorkspace: 'Workspace' },
  }, (source) => source.replace('function BatchForm(', 'export function BatchForm('));
  function render() {
    index = 0;
    return BatchForm({ recipe, initialWarehouse: warehouse, locations: [warehouse], onClose() {} });
  }
  function flatten(tree) {
    if (Array.isArray(tree)) return tree.flatMap(flatten);
    return tree?.props ? [tree, ...flatten(tree.props.children), ...flatten(tree.props.footer)] : [];
  }
  const find = (tree, prop, value) => flatten(tree).find((node) => node.props[prop] === value);
  let tree = render();
  find(tree, 'label', 'Дополнительно').props.onPress();
  find(tree, 'accessibilityLabel', 'Количество выпуска').props.onChangeText('1,5');
  tree = render();
  find(tree, 'accessibilityLabel', 'Плановый выход').props.onChangeText('2');
  tree = render();
  find(tree, 'label', 'Рис, г · по норме 500').props.onChangeText('450');
  find(tree, 'title', 'Единица выхода партии').props.onChange('g');
  tree = render();
  find(tree, 'title', 'Провести производство').props.onPress();
  await new Promise(setImmediate);
  tree = render();
  find(tree, 'title', 'Провести производство').props.onPress();
  await new Promise(setImmediate);
  const expected = {
    id: 'recipe', warehouseId: 'stock', quantity: 1500, plannedQuantity: 2000, unit: 'g', requestKey: 'same-retry-key',
    items: [{ ingredientId: 'raw', unit: 'g', quantity: 450 }, { ingredientId: 'salt', unit: 'g', quantity: 4 }],
  };
  assert.deepEqual(calls, [expected, expected]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].message, 'Партия готова · себестоимость 80 с');
});
