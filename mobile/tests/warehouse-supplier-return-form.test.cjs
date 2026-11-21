const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const plain = (value) => JSON.parse(JSON.stringify(value));
function load(file, modules = {}, exposeForm = false) {
  let source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  if (exposeForm) source = source.replace('function SupplierReturnFields(', 'export function SupplierReturnFields(');
  const module = { exports: {} };
  const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions }).outputText, {
    module, exports: module.exports,
    require(name) {
      if (name in modules) return modules[name];
      if (name === '@/services/api/warehouseUnits') return load('services/api/warehouseUnits.ts');
      if (name === './warehouseDocumentForm') return load('utils/warehouseDocumentForm.ts');
      if (name.startsWith('@/utils/warehouse')) return load(`utils/${name.slice('@/utils/'.length)}.ts`);
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return module.exports;
}

const { supplierReturnCandidates, supplierReturnDraftRows, supplierReturnRowsInput } = load('utils/warehouseSupplierReturnForm.ts');
const rice = { id: 'rice', name: 'Рис', displayUnit: 'kg', unit: 'кг', stock: 8, stockBase: 8000, avgCostBase: 0.08 };
const oil = { id: 'oil', name: 'Масло', displayUnit: 'l', unit: 'л', stock: 4, stockBase: 4000, avgCostBase: 0.1 };
const catalogue = [rice, oil, { ...rice, id: 'unrelated' }, { ...rice, id: 'virtual', preparationMode: 'virtual' }];
const source = { id: 'purchase', number: 10, supplier: 'Поставщик', date: '2026-11-16T05:00:00Z', status: 'completed', warehouseId: 'main',
  returnableItems: [{ ingredientId: 'rice', remainingQuantityBase: 10000 }, { ingredientId: 'oil', remainingQuantityBase: 0 }, { ingredientId: 'virtual', remainingQuantityBase: 1000 }] };
const row = { key: 'r1', ingredientId: 'rice', name: rice.name, unit: 'kg', quantity: '3,25' };
const candidates = supplierReturnCandidates(catalogue, source.returnableItems);
const savedItem = { ingredientId: 'rice', name: rice.name, unit: 'г', quantity: 3250, value: -260 };

test('return items follow the selected receipt rather than all warehouse items', () => {
  assert.deepEqual([...candidates.keys()], ['rice', 'oil']);
  const result = supplierReturnRowsInput([row], candidates);
  assert.equal(result.limits.get('r1'), 10);
  assert.equal(result.amounts.get('r1'), 260);
  assert.deepEqual(plain(result.items), [{ ingredientId: 'rice', quantity: 3.25 }]);
  for (const ingredientId of ['oil', 'unrelated', 'virtual']) {
    assert.equal(supplierReturnRowsInput([{ ...row, ingredientId }], candidates).errors.size, 1);
  }
});

test('receipt cap and actual stock shortage are enforced separately', () => {
  const result = supplierReturnRowsInput([{ ...row, quantity: '9' }], candidates);
  assert.equal(result.errors.size, 0);
  assert.equal(result.items.length, 1);
  assert.equal(result.shortages.has('r1'), true);
  assert.equal(result.amounts.has('r1'), false);
  const excess = supplierReturnRowsInput([{ ...row, quantity: '10,000001' }], candidates);
  assert.equal(excess.items.length, 0);
  assert.match(excess.errors.get('r1'), /превышает/);
});

test('editing an older return uses its saved unit independently of the ingredient display unit', () => {
  const old = supplierReturnDraftRows([savedItem])[0];
  assert.equal(old.unit, 'g');
  assert.deepEqual(plain(supplierReturnRowsInput([old], candidates, [savedItem]).items), [{ ingredientId: 'rice', quantity: 3250 }]);
  assert.deepEqual(plain(supplierReturnRowsInput([row], candidates, [savedItem]).items), [{ ingredientId: 'rice', quantity: 3250 }]);
});

test('ignores untouched rows and rejects duplicate products and invalid quantities', () => {
  assert.equal(supplierReturnRowsInput([{ ...row, ingredientId: '', quantity: '' }], candidates).errors.size, 0);
  assert.match(supplierReturnRowsInput([row, { ...row, key: 'r2' }], candidates).errors.get('r2'), /уже добавлен/);
  for (const quantity of ['', '0', '-1', '3e-4', '0,0000001']) {
    assert.equal(supplierReturnRowsInput([{ ...row, quantity }], candidates).errors.size, 1, quantity);
  }
});

const draft = { id: 'return', kind: 'supplier_return', sourcePurchaseId: 'purchase', warehouseId: 'main', status: 'draft', revision: 5, items: [savedItem], note: null, createdAt: '2026-11-16T05:00:00Z' };
function harness(permissions = {}) {
  const routes = [];
  const slots = [];
  let cursor = 0;
  let closed = 0;
  const react = { createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect() {},
    useCallback(callback) { return callback; },
  };
  const mutation = (method) => ({ isPending: false, async mutateAsync(body) {
    routes.push({ method, body: plain(body) });
    return { ...draft, revision: draft.revision + 1, status: body.finalize === 'post' || body.action === 'approve' ? 'posted' : 'draft' };
  } });
  const { SupplierReturnFields } = load('screens/admin/WarehouseSupplierReturnForm.tsx', {
    react, 'react-native': { StyleSheet: { create: (value) => value } }, 'expo-crypto': require('node:crypto'),
    '@/components/themed': { ActivityIndicator: 'Loading', ScrollView: 'ScrollView', View: 'View' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/Select': { AnchoredSelectScope: 'SelectScope', Select: 'Select' },
    '@/components/typography': { Alert: { alert() {} }, Text: 'Text' },
    '@/components/ui': { Button: 'Button', Card: 'Card', Field: 'Field' },
    '@/lib/api': { apiError: String },
    '@/hooks/usePermissions': { usePermissions: () => ({ canAction: (key) => permissions[key] ?? true }) },
    '@/services/api/stockDocuments': { useStockDocumentMutations: () => ({ create: mutation('create'), save: mutation('save'), transition: mutation('transition') }) },
    '@/services/api/warehouse': {
      qty: (quantity, unit) => `${quantity} ${unit}`, useIngredients: () => ({ data: catalogue, isSuccess: true }),
      usePurchases: () => ({ data: [source] }), usePurchase: (id) => ({ data: id === source.id ? source : undefined }),
    },
    '@/store/notifications': { useNotifications: () => () => {} }, '@/theme': { colors: {}, spacing: {} },
    './WarehouseWorkspace': { WarehouseWorkspace: 'Workspace' },
  }, true);
  function render(incoming) {
    cursor = 0;
    return SupplierReturnFields({ incoming, locations: [{ id: 'main', name: 'Главный', isDefault: true }], initialPurchaseId: 'purchase',
      onClose() { closed++; }, refreshDocument() {} });
  }
  function walk(node, items = []) {
    if (Array.isArray(node)) node.forEach((child) => walk(child, items));
    else if (node && typeof node === 'object') {
      items.push(node);
      walk(node.props?.children, items);
      walk(node.props?.footer, items);
    }
    return items;
  }
  const find = (tree, type, key, value) => walk(tree).find((node) => node.type === type && node.props[key] === value);
  return { render, find, routes, get closed() { return closed; } };
}

test('receipt return begins preselected, blocks an excess quantity and saves draft with source ID', async () => {
  const h = harness();
  let tree = h.render();
  assert.equal(h.find(tree, 'Select', 'title', 'Исходная поставка').props.value, 'purchase');
  h.find(tree, 'Select', 'title', 'Продукт возврата').props.onChange('rice');
  tree = h.render();
  h.find(tree, 'Field', 'accessibilityLabel', 'Количество · Рис').props.onChangeText('11');
  tree = h.render();
  assert.equal(h.find(tree, 'Button', 'title', 'Сохранить').props.disabled, true);
  assert.equal(h.find(tree, 'Button', 'title', 'Сохранить черновик').props.disabled, true);
  h.find(tree, 'Field', 'label', 'Количество').props.onChangeText('3,25');
  tree = h.render();
  h.find(tree, 'Button', 'title', 'Сохранить черновик').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.closed, 1);
  assert.equal(h.routes[0].body.kind, 'supplier_return');
  assert.equal(h.routes[0].body.sourcePurchaseId, 'purchase');
  assert.equal(h.routes[0].body.warehouseId, 'main');
  assert.ok(h.routes[0].body.requestKey);
  assert.equal(h.routes[0].body.finalize, undefined);
  assert.deepEqual(h.routes[0].body.items, [{ ingredientId: 'rice', quantity: 3.25 }]);
});

test('posts an existing draft atomically in saved units and renders read-only for restricted users', async () => {
  const h = harness();
  const tree = h.render(draft);
  assert.equal(h.find(tree, 'Select', 'title', 'Исходная поставка'), undefined);
  h.find(tree, 'Button', 'title', 'Сохранить').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.routes[0], { method: 'save', body: { id: 'return', revision: 5, items: [{ ingredientId: 'rice', quantity: 3250 }], note: '', finalize: 'post' } });
  assert.equal(h.closed, 1);
  const authorized = harness().render({ ...draft, status: 'posted' });
  assert.equal(JSON.stringify(authorized).includes('260,00 с'), true);
  const restricted = harness({ warehouseCosts: false, warehouseApprove: false });
  const posted = restricted.render({ ...draft, status: 'posted' });
  assert.equal(restricted.find(posted, 'Field', 'label', 'Количество'), undefined);
  assert.equal(restricted.find(posted, 'Button', 'title', 'Сторнировать'), undefined);
  assert.equal(JSON.stringify(posted).includes('260,00 с'), false);
});

test('submitted returns use the current revision and reject edits against a superseded revision', async () => {
  const h = harness();
  const submitted = h.render({ ...draft, status: 'submitted' });
  h.find(submitted, 'Button', 'title', 'Провести возврат').props.onPress();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.routes[0], { method: 'transition', body: { id: 'return', revision: 5, action: 'approve' } });

  const conflicting = harness();
  const editable = conflicting.render(draft);
  conflicting.find(editable, 'Field', 'label', 'Количество').props.onChangeText('3000');
  const stale = conflicting.render({ ...draft, revision: 6 });
  assert.equal(conflicting.find(stale, 'Field', 'label', 'Количество').props.value, '3000');
  assert.equal(conflicting.find(stale, 'Button', 'title', 'Сохранить').props.disabled, true);
  assert.equal(conflicting.find(stale, 'Button', 'title', 'Загрузить актуальный документ').props.disabled, false);
  assert.deepEqual(conflicting.routes, []);
});
