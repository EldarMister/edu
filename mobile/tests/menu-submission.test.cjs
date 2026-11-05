const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const flush = () => new Promise(resolve => setImmediate(resolve));
function load(file, modules = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  return module.exports;
}
const dish = { id: 'tea', name: 'Tea', price: '100', isAvailable: true, variants: [] };
const first = { id: 'table-a', number: 1 }, second = { id: 'table-b', number: 2 };
function harness() {
  const cells = []; let cursor = 0, effects = [], tree;
  const differs = (a, b) => !a || !b || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]));
  const hooks = { ...React,
    useState(initial) { const cell = cells[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; }]; },
    useRef(initial) { return (cells[cursor++] ??= { value: { current: initial } }).value; },
    useMemo(fn, deps) { const i = cursor++; if (!cells[i] || differs(cells[i].deps, deps)) cells[i] = { value: fn(), deps }; return cells[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || differs(cells[i].deps, deps)) { const previous = cells[i]; cells[i] = { deps }; effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = fn(); }); } },
  };
  const cartModule = load('src/store/cart.ts', { zustand: require('zustand'), '@/utils/format': { dishUnitPrice: Number }, '@/utils/set': { calcSetPrice: Number } });
  const cart = cartModule.useCart;
  const useCart = selector => selector(cart.getState()); useCart.getState = cart.getState;
  const replacement = { target: null, clear() { replacement.target = null; } };
  const useReplacement = selector => selector(replacement); useReplacement.getState = () => replacement;
  const auth = { user: { id: 'waiter-1' } };
  const useAuth = selector => selector(auth); useAuth.getState = () => auth;
  const requests = [], navigations = [], notices = [];
  const mutation = kind => ({ isPending: false, mutateAsync(payload) {
    let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    requests.push({ kind, payload, resolve, reject }); return promise;
  } });
  const mutations = { create: mutation('create'), add: mutation('add'), edit: mutation('edit'), replace: mutation('replace') };
  const { MenuScreen } = load('src/screens/waiter/MenuScreen.tsx', {
    react: hooks,
    'react-native': { FlatList: 'FlatList', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: x => x } },
    'react-native-gesture-handler': {}, 'react-native-reanimated': {},
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@react-navigation/native': { useNavigation: () => ({ navigate: (...args) => navigations.push(args) }) },
    '@/components/typography': { Text: 'Text', TextInput: 'TextInput' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/ui': { Button: 'Button', EmptyState: 'EmptyState', Loading: 'Loading', PillTabs: 'PillTabs' },
    '@/components/BottomSheet': { BottomSheet: 'BottomSheet', SheetScrollView: 'SheetScrollView' },
    '@/components/FullscreenSheet': { FullscreenSheet: 'FullscreenSheet' },
    '@/components/motion': {}, '@/components/PwaIcon': { PwaIcon: 'PwaIcon' }, '@/components/NumberTicker': { NumberTicker: 'NumberTicker' },
    '@/theme': load('src/theme/index.ts'),
    '@/services/api/waiter': {
      useCategories: () => ({ data: [] }), useDishes: () => ({ data: [dish] }), useActiveOrders: () => ({ data: [], isFetched: true }),
      useCreateOrder: () => mutations.create, useAddItems: () => mutations.add, useEditOrder: () => mutations.edit, useReplaceRejectedItem: () => mutations.replace,
    },
    '@/store/cart': { ...cartModule, useCart }, '@/store/auth': { useAuth }, '@/store/replacement': { useReplacement },
    '@/store/notifications': { useNotifications: selector => selector({ push: x => notices.push(x) }) },
    '@/utils/set': {}, '@/utils/format': { makeIdempotencyKey: () => 'key', displayOrderNumber: String },
    '@/utils/prepStation': { cartStations: () => ({ hasPrep: true, kitchen: true }) },
    '@/lib/api': { apiError: error => error.message }, '@/services/socket': { useConnectionStatus: () => true },
    './CartSheet': { CartSheet: 'CartSheet' }, './TablePickerSheet': { TablePickerSheet: 'TablePickerSheet' }, './WeightPickerSheet': { WeightPickerSheet: 'WeightPickerSheet' }, './orderRules': {},
  });
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
  cart.getState().selectTable(first); cart.getState().add(dish);
  return { cart, auth, replacement, requests, navigations, notices,
    render() { cursor = 0; effects = []; tree = MenuScreen(); effects.forEach(fn => fn()); return tree; },
    submit() { all(tree).find(x => x.type === 'CartSheet').props.onSubmit(); },
    replace() { const grid = all(tree).find(x => x.type === 'FlatList'); grid.props.renderItem({ item: dish }).props.onAdd(dish); },
    unmount() { cells.forEach(cell => cell.cleanup?.()); },
  };
}

test('same-frame submit runs once and late response only clears the submitted table', async () => {
  const h = harness(); h.render(); h.submit(); h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].payload.tableId, first.id);
  h.cart.getState().selectTable(second); h.cart.getState().add(dish);
  const next = h.cart.getState().lines;
  h.requests[0].resolve({ id: 'created-a' }); await flush();
  assert.equal(h.cart.getState().lines, next);
  assert.equal(h.cart.getState().tableId, second.id);
  assert.equal(h.cart.getState().pendingTables[first.id], undefined);
  assert.equal(h.navigations.length, 0);
});

test('submission captures fresh store state and completes after the menu unmounts', async () => {
  const h = harness(); h.render(); h.cart.getState().add(dish); h.submit(); h.unmount();
  assert.equal(h.requests[0].payload.lines[0].quantity, 2);
  h.requests[0].resolve({ id: 'created-a' }); await flush();
  assert.equal(h.cart.getState().lines.length, 0);
  assert.equal(h.cart.getState().activeOrderId, 'created-a');
  assert.equal(h.cart.getState().pendingTables[first.id], undefined);
  assert.equal(h.navigations.length, 0);
});

test('a late previous-session completion never touches a newer same-account draft', async () => {
  const h = harness(); h.render(); h.submit();
  h.cart.getState().resetAll(); h.cart.getState().selectTable(first); h.cart.getState().add(dish);
  const next = h.cart.getState().lines;
  h.requests[0].resolve({ id: 'previous-order' }); await flush();
  assert.equal(h.cart.getState().lines, next);
  assert.equal(h.cart.getState().activeOrderId, null);
  assert.equal(h.navigations.length, 0);
});

test('replacement suppresses duplicate press and does not clear a newer replacement target', async () => {
  const h = harness();
  h.replacement.target = { orderId: 'order-a', table: first, item: { id: 'rejected-a', dishNameSnapshot: 'Tea' } };
  h.render(); h.replace(); h.replace();
  assert.equal(h.requests.length, 1);
  const next = { orderId: 'order-b', table: second, item: { id: 'rejected-b', dishNameSnapshot: 'Coffee' } };
  h.replacement.target = next;
  h.requests[0].resolve({ id: 'order-a' }); await flush();
  assert.equal(h.replacement.target, next);
  assert.equal(h.navigations.length, 0);
});
