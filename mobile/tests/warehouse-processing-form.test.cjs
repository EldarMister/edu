const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
    .replace('function ProcessingForm(', 'export function ProcessingForm(');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(module, module.exports, (name) => {
    if (name in dependencies) return dependencies[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    throw new Error('Unexpected import: ' + name);
  });
  return module.exports;
}

const { allocatedProcessingShare, changeProcessingUnit, processingRowsInput } = load('utils/warehouseProcessingForm.ts');
const row = { key: 'flour', ingredientId: 'flour', warehouseId: 'main', name: 'Мука', quantity: '1,25', unit: 'kg', share: '73,3333' };

test('processing converts physical quantity, allows the same item in another warehouse and allocates four-place shares', () => {
  const converted = changeProcessingUnit(row, 'g');
  assert.equal(converted.quantity, '1250');
  assert.deepEqual(processingRowsInput([converted], false), { lines: [{ ingredientId: 'flour', warehouseId: 'main', unit: 'g', quantity: 1250 }], error: '' });
  assert.ok(processingRowsInput([converted, converted], false).error);
  const second = { ...converted, key: 'second', warehouseId: 'bar', share: '26,6667' };
  assert.equal(processingRowsInput([row, second], true).lines.length, 2);
  assert.equal(allocatedProcessingShare([row, second]), 100);
  const splitAtMidpoint = [{ ...row, share: '0,00015' }, { ...second, share: '99,99975' }];
  assert.equal(allocatedProcessingShare(splitAtMidpoint), 100);
  assert.deepEqual(processingRowsInput(splitAtMidpoint, true).lines.map((line) => line.costSharePercent), [0.0002, 99.9998]);
  assert.ok(processingRowsInput([{ ...second, share: '150' }], true).error);
  assert.ok(processingRowsInput([{ ...second, quantity: '0,0001' }], true).error);
});

function editorHarness() {
  let cursor = 0, failPost = true;
  const slots = [], calls = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useMemo: (factory) => factory(),
  };
  function line(id, ingredientId, name, costSharePercent) {
    return { id, ingredientId, name, quantity: 1, warehouseId: 'main', unit: 'kg', costSharePercent };
  }
  const initialDocument = {
    id: 'processing', revision: 4, status: 'draft', date: '2026-11-14T17:00:00.765Z',
    note: null, inputs: [line('in', 'flour', 'Мука', 100)], outputs: [line('out', 'dough', 'Тесто', 100)],
  };
  const save = { mutateAsync: async (payload) => {
    calls.push(['save', payload]);
    return { ...initialDocument, revision: 5, note: payload.note };
  } };
  const transition = { mutateAsync: async (payload) => {
    calls.push(['transition', payload]);
    if (failPost) { failPost = false; throw new Error('Проведение не выполнено'); }
    return { ...initialDocument, revision: 6, status: 'posted' };
  } };
  const { ProcessingForm } = load('screens/admin/WarehouseProcessingTab.tsx', {
    react,
    'react-native': { StyleSheet: { create: (value) => value } },
    'expo-crypto': require('node:crypto'),
    '@/components/BottomSheet': { BottomSheet: 'BottomSheet', SheetFlatList: 'SheetFlatList' },
    '@/components/BottomPanel': {},
    '@/components/DateField': { DateField: 'DateField' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/PwaIcon': { PwaIcon: 'PwaIcon' },
    '@/components/Select': { Select: 'Select' },
    '@/components/themed': { View: 'View', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator' },
    '@/components/typography': { Text: 'Text', Alert: {} },
    '@/components/ui': { Button: 'Button', Card: 'Card', Field: 'Field' },
    '@/hooks/usePermissions': { usePermissions: () => ({ canAction: () => true }) },
    '@/lib/api': { apiError: (error) => error.message },
    '@/services/api/warehouse': { useIngredients: () => ({ data: [], isSuccess: true }) },
    '@/services/api/warehouseProcessing': { useProcessingMutations: () => ({ save, transition }) },
    '@/store/notifications': { useNotifications: () => () => {} },
    '@/theme': { colors: {}, fontSize: {}, spacing: {}, radius: {} },
    './WarehouseWorkspace': { WarehouseWorkspace: 'Workspace' },
    './WarehouseTimingField': { WarehouseDateTimeField: 'Timing' },
  });
  function render() {
    cursor = 0;
    return ProcessingForm({
      initialDocument,
      locations: [{ id: 'main', name: 'Основной склад', isDefault: true }],
      onClose: () => calls.push(['close']),
    });
  }
  function flatten(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    return [node, ...flatten(node.props.children), ...flatten(node.props.footer)];
  }
  const find = (tree, type, property, value) =>
    flatten(tree).find((node) => node.type === type && node.props[property] === value);
  return { render, find, calls };
}

test('posting a changed processing draft uses its new revision and retries only posting after failure', async () => {
  const editor = editorHarness();
  editor.find(editor.render(), 'Field', 'label', 'Комментарий').props.onChangeText('Проверка');
  editor.find(editor.render(), 'Button', 'title', 'Сохранить').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(editor.calls[0][1].revision, 4);
  assert.equal(editor.calls[0][1].date, '2026-11-14T17:00:00.765Z');
  assert.deepEqual(editor.calls[1], ['transition', { id: 'processing', revision: 5, action: 'post' }]);
  assert.ok(editor.find(editor.render(), 'Text', 'accessibilityRole', 'alert').props.children[0].startsWith('Изменения черновика сохранены.'));
  editor.find(editor.render(), 'Button', 'title', 'Сохранить').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(editor.calls.slice(2), [['transition', { id: 'processing', revision: 5, action: 'post' }], ['close']]);
});
