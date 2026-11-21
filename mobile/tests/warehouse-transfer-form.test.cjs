const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, modules = {}, exportFields = false) {
  let source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  if (exportFields) source = source.replace('function TransferDocumentFields(', 'export function TransferDocumentFields(');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, require(name) {
      if (name in modules) return modules[name];
      if (name === '@/services/api/warehouseUnits') return load('services/api/warehouseUnits.ts');
      if (name.startsWith('@/utils/warehouse')) return load(`utils/${name.slice('@/utils/'.length)}.ts`);
      throw new Error(`Unexpected import: ${name}`);
    }});
  return module.exports;
}
const helpers = load('utils/warehouseTransferForm.ts');
const row = { key: 'rice', ingredientId: 'rice', name: 'Рис', quantity: '500,5', unit: 'g', documentUnit: 'kg' };
test('transfer quantities serialize per saved line unit, independently of current catalogue display', () => {
  assert.deepEqual(plain(helpers.transferRowsInput([row]).items), [{ ingredientId: 'rice', quantity: 0.5005 }]);
  const saved = helpers.transferDraftRows([{ ingredientId: 'rice', name: 'Рис', unit: 'г', quantity: 1000 }])[0];
  const changed = helpers.changeTransferUnit(saved, 'kg');
  assert.equal(changed.quantity, '1'); assert.equal(changed.documentUnit, 'g');
  assert.deepEqual(plain(helpers.transferRowsInput([changed]).items), [{ ingredientId: 'rice', quantity: 1000 }]);
});
test('transfer rejects duplicate products, bad dimensions, zero and sub-ledger precision', () => {
  assert.ok(helpers.transferRowsInput([row, { ...row, key: 'duplicate' }]).error);
  for (const quantity of ['', '0', '-1', 'NaN', '0,0001']) assert.ok(helpers.transferRowsInput([{ ...row, quantity }]).error, quantity);
  assert.ok(helpers.transferRowsInput([{ ...row, documentUnit: 'l' }]).error);
  assert.equal(helpers.transferRowsInput([]).canPost, false);
  assert.equal(helpers.transferRowsInput([]).error, '');
});
const catalog = [{ id: 'rice', name: 'Рис', displayUnit: 'kg', unit: 'кг', unitType: 'mass', stock: 10, stockBase: 10000, avgCostBase: 0.1, avgCost: 100, isActive: true },
  { id: 'oil', name: 'Масло', displayUnit: 'l', unit: 'л', unitType: 'volume', stock: 5, stockBase: 5000, avgCostBase: null, avgCost: null, isActive: true }];
const locations = [{ id: 'main', name: 'Основной' }, { id: 'bar', name: 'Бар' }];
const doc = () => ({ id: 'transfer', kind: 'transfer', warehouseId: 'main', destinationWarehouseId: 'bar', status: 'draft', revision: 4,
  effectiveAt: null, note: null, createdAt: '2026-01-01T10:00:00Z', items: [{ ingredientId: 'rice', name: 'Рис', unit: 'г', quantity: 1000, value: -100 }], varianceValue: -100 });
function harness(permissions = {}) {
  let cursor = 0; const slots = []; const calls = []; let failNext = false; let latest = doc();
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; }, useEffect() {},
  };
  const primitives = { Text: 'Text', Button: 'Button', Card: 'Card', Field: 'Field', View: 'View', ScrollView: 'ScrollView' };
  const mutation = method => ({ isPending: false, mutateAsync: async body => {
    calls.push({ method, body: plain(body) });
    if (failNext) { failNext = false; throw new Error('network retry'); }
    return { ...latest, warehouseId: body.warehouseId ?? latest.warehouseId, destinationWarehouseId: body.destinationWarehouseId ?? latest.destinationWarehouseId,
      revision: latest.revision + 1, status: body.finalize === 'post' || body.action === 'approve' ? 'posted' : body.action === 'reverse' ? 'reversed' : 'draft',
      note: body.note ?? latest.note, effectiveAt: body.effectiveAt ?? latest.effectiveAt,
      items: body.items?.map(item => ({ ...item, name: catalog.find(value => value.id === item.ingredientId).name, unit: catalog.find(value => value.id === item.ingredientId).unit, value: null })) ?? latest.items };
  }});
  const component = load('screens/admin/WarehouseTransferForm.tsx', {
    react, 'react-native': { StyleSheet: { create: value => value } }, 'expo-crypto': require('node:crypto'),
    '@/components/themed': primitives, '@/components/ui': primitives, '@/components/Select': { Select: 'Select' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/typography': { Text: 'Text', Alert: { alert(_title, _body, actions) { actions.at(-1)?.onPress?.(); } } },
    '@/hooks/usePermissions': { usePermissions: () => ({ canAction: key => permissions[key] ?? true }) },
    '@/lib/api': { apiError: String }, '@/services/api/stockDocuments': { useStockDocumentMutations: () => ({ create: mutation('create'), save: mutation('save'), transition: mutation('transition') }) },
    '@/services/api/warehouse': { useIngredients: () => ({ data: catalog, isSuccess: true }), qty: (quantity, unit) => `${quantity} ${unit}` },
    '@/theme': { colors: {}, spacing: {}, fontSize: {} }, '@/utils/format': { money: String },
    './WarehouseTimingField': { WarehouseTimingField: 'Timing' }, './WarehouseWorkspace': { WarehouseWorkspace: 'Workspace' },
  }, true);
  function render(incoming) { cursor = 0; latest = incoming ?? doc(); return component.TransferDocumentFields({ incoming, initialIngredient: incoming ? undefined : catalog[0], source: locations[0], locations, onClose() {} }); }
  function flatten(tree, out = []) { if (!tree || typeof tree !== 'object') return out; if (Array.isArray(tree)) { tree.forEach(value => flatten(value, out)); return out; } out.push(tree); flatten(tree.props?.children, out); flatten(tree.props?.footer, out); return out; }
  const find = (tree, type, key, value) => flatten(tree).find(node => node.type === type && node.props[key] === value);
  return { render, find, flatten, calls, fail() { failNext = true; } };
}
const wait = () => new Promise(resolve => setImmediate(resolve));

test('new transfer sends multiple items, selected date and the same request key on retry', async () => {
  const h = harness({ warehouseApprove: false }); let tree = h.render();
  h.find(tree, 'Select', 'title', 'На склад').props.onChange('bar');
  h.find(tree, 'Field', 'label', 'Количество').props.onChangeText('2');
  h.find(tree, 'Timing', 'label', 'Дата перемещения').props.onChange({ mode: 'past', date: '2020-01-01', time: '12:30' });
  h.find(tree, 'FastPressable', 'accessibilityLabel', 'Добавить строку перемещения').props.onPress(); tree = h.render();
  h.flatten(tree).filter(node => node.type === 'Select' && node.props.title === 'Продукт перемещения')[1].props.onChange('oil'); tree = h.render();
  h.flatten(tree).filter(node => node.type === 'Field' && node.props.label === 'Количество')[1].props.onChangeText('0,5'); tree = h.render();
  h.fail(); h.find(tree, 'Button', 'title', 'Сохранить').props.onPress(); await wait(); tree = h.render();
  h.find(tree, 'Button', 'title', 'Сохранить').props.onPress(); await wait();
  assert.equal(h.calls[0].body.requestKey, h.calls[1].body.requestKey);
  assert.equal(h.calls[1].body.finalize, 'post'); assert.equal(h.calls[1].body.effectiveAt, '2020-01-01T06:30:00.000Z');
  assert.deepEqual(h.calls[1].body.items, [{ ingredientId: 'rice', quantity: 2 }, { ingredientId: 'oil', quantity: 0.5 }]);
  assert.equal(h.calls[1].body.destinationWarehouseId, 'bar');
});
test('saved draft retains immutable warehouses and serializes quantity in saved units with revision', async () => {
  const h = harness(); const document = doc(); let tree = h.render(document);
  assert.equal(h.find(tree, 'Select', 'title', 'Со склада'), undefined);
  h.find(tree, 'Select', 'title', 'Единица').props.onChange('kg'); tree = h.render(document);
  h.find(tree, 'Field', 'label', 'Количество').props.onChangeText('2'); tree = h.render(document);
  h.find(tree, 'Button', 'title', 'Сохранить черновик').props.onPress(); await wait();
  assert.equal(h.calls[0].method, 'save'); assert.equal(h.calls[0].body.revision, 4);
  assert.deepEqual(h.calls[0].body.items, [{ ingredientId: 'rice', quantity: 2000 }]);
  assert.equal(h.calls[0].body.warehouseId, undefined); assert.equal(h.calls[0].body.destinationWarehouseId, undefined);
});
test('posted transfer is read only; reverse requires a reason and approval permission', async () => {
  const h = harness(); const document = { ...doc(), status: 'posted' }; let tree = h.render(document);
  assert.equal(h.find(tree, 'Field', 'label', 'Количество'), undefined);
  assert.equal(h.find(tree, 'Button', 'title', 'Сторнировать перемещение').props.disabled, true);
  h.find(tree, 'Field', 'label', 'Причина сторно').props.onChangeText('Ошибочный склад'); tree = h.render(document);
  h.find(tree, 'Button', 'title', 'Сторнировать перемещение').props.onPress(); await wait();
  assert.deepEqual(h.calls[0], { method: 'transition', body: { id: 'transfer', revision: 4, action: 'reverse', note: 'Ошибочный склад' } });
  const restricted = harness({ warehouseApprove: false });
  assert.equal(restricted.find(restricted.render(document), 'Button', 'title', 'Сторнировать перемещение'), undefined);
});
test('submitted document supports reopen by approver; conflicting revision preserves input', async () => {
  const h = harness(); let tree = h.render({ ...doc(), status: 'submitted' });
  h.find(tree, 'Button', 'title', 'Вернуть в черновик').props.onPress(); await wait();
  assert.equal(h.calls[0].body.action, 'reopen');
  const concurrent = harness(); const document = doc(); tree = concurrent.render(document);
  concurrent.find(tree, 'Field', 'label', 'Количество').props.onChangeText('300'); tree = concurrent.render({ ...document, revision: 5 });
  assert.equal(concurrent.find(tree, 'Field', 'label', 'Количество').props.value, '300');
  assert.equal(concurrent.find(tree, 'Button', 'title', 'Сохранить черновик').props.disabled, true);
});
