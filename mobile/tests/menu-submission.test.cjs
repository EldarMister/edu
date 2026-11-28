const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { nativeThemeModules } = require('./helpers/native-theme.cjs');
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
function harness({ deliveryAllowed = false, roundOrderTotal = false } = {}) {
  const cells = []; let cursor = 0, effects = [], tree;
  const differs = (a, b) => !a || !b || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]));
  const hooks = { ...React,
    useState(initial) { const cell = cells[cursor++] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cell.value, value => { cell.value = typeof value === 'function' ? value(cell.value) : value; }]; },
    useRef(initial) { return (cells[cursor++] ??= { value: { current: initial } }).value; },
    useMemo(fn, deps) { const i = cursor++; if (!cells[i] || differs(cells[i].deps, deps)) cells[i] = { value: fn(), deps }; return cells[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || differs(cells[i].deps, deps)) { const previous = cells[i]; cells[i] = { deps }; effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = fn(); }); } },
  };
  const cartModule = load('src/store/cart.ts', { zustand: require('zustand'),
    '@/utils/format': { dishUnitPrice: Number, makeIdempotencyKey: () => 'configured-line' }, '@/utils/set': { calcSetPrice: Number } });
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
  const native = { useWindowDimensions: () => ({ width: 390, height: 844 }), FlatList: 'FlatList', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: x => x } };
  const safeArea = { SafeAreaView: 'SafeAreaView' };
  const orderRules = load('src/screens/waiter/orderRules.ts', { '@/lib/order-permissions': {}, '@/utils/format': {} });
  const fields = load('src/screens/waiter/OrderFulfillmentFields.tsx', {
    react: hooks, 'react-native': native, ...nativeThemeModules(native, safeArea),
    '@/components/typography': { Text: 'Text', TextInput: 'TextInput' }, '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/PwaIcon': {}, '@/components/ui': {}, '@/components/Select': {}, '@/lib/api': {},
    '@/services/api/waiter': {}, './orderRules': orderRules,
  });
  const { MenuScreen } = load('src/screens/waiter/MenuScreen.tsx', {
    react: hooks,
    '@/lib/layout': load('src/lib/layout.ts'),
    'react-native': native,
    'react-native-gesture-handler': {}, 'react-native-reanimated': {},
    'react-native-safe-area-context': safeArea,
    '@react-navigation/native': { useNavigation: () => ({ navigate: (...args) => navigations.push(args) }) },
    '@/components/typography': { Text: 'Text', TextInput: 'TextInput' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/ui': { Button: 'Button', EmptyState: 'EmptyState', Loading: 'Loading', PillTabs: 'PillTabs' },
    '@/components/BottomSheet': { BottomSheet: 'BottomSheet', SheetScrollView: 'SheetScrollView' },
    '@/components/FullscreenSheet': { FullscreenSheet: 'FullscreenSheet' },
    '@/components/motion': {}, '@/components/PwaIcon': { PwaIcon: 'PwaIcon' }, '@/components/NumberTicker': { NumberTicker: 'NumberTicker' },
    ...nativeThemeModules(native, safeArea),
    '@/services/api/waiter': {
      useCategories: () => ({ data: [] }), useDishes: () => ({ data: [dish] }), useActiveOrders: () => ({ data: [], isFetched: true }),
      useCreateOrder: () => mutations.create, useAddItems: () => mutations.add, useEditOrder: () => mutations.edit, useReplaceRejectedItem: () => mutations.replace,
    },
    '@/services/api/settings': { usePublicSettings: () => ({ data: { roundOrderTotal } }) },
    '@/hooks/usePermissions': { usePermissions: () => ({ canAction: permission => permission === 'createDeliveryOrders' && deliveryAllowed }) },
    '@/store/cart': { ...cartModule, useCart }, '@/store/auth': { useAuth }, '@/store/replacement': { useReplacement },
    '@/store/notifications': { useNotifications: selector => selector({ push: x => notices.push(x) }) },
    '@/utils/set': {}, '@/utils/format': { makeIdempotencyKey: () => 'key', displayOrderNumber: String },
    '@/utils/prepStation': { cartStations: () => ({ hasPrep: true, kitchen: true }) },
    '@/lib/api': { apiError: error => error.message }, '@/services/socket': { useConnectionStatus: () => true },
    './CartSheet': { CartSheet: 'CartSheet' },
    './OrderFulfillmentFields': fields,
    './ModifierPickerSheet': { ModifierPickerSheet: 'ModifierPickerSheet' },
    './TablePickerSheet': { TablePickerSheet: 'TablePickerSheet' },
    './WeightPickerSheet': { WeightPickerSheet: 'WeightPickerSheet' },
    './orderRules': orderRules,
  });
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
  cart.getState().selectTable(first); cart.getState().add(dish);
  return { cart, auth, replacement, requests, navigations, notices, cartModule,
    render() { cursor = 0; effects = []; tree = MenuScreen(); effects.forEach(fn => fn()); return tree; },
    submit() { all(tree).find(x => x.type === 'CartSheet').props.onSubmit(); },
    cartSheet() { return all(tree).find(x => x.type === 'CartSheet')?.props; },
    modifierPicker() { return all(tree).find(x => x.type === 'ModifierPickerSheet')?.props; },
    replace(item = dish) { const grid = all(tree).find(x => x.type === 'FlatList'); grid.props.renderItem({ item }).props.onAdd(item); },
    unmount() { cells.forEach(cell => cell.cleanup?.()); },
  };
}

test('a configurable dish waits for choices and merges only matching additions and exclusions', async () => {
  const h = harness();
  const coffee = { ...dish, id: 'coffee', hasModifiers: true, allowIngredientExclusions: true };
  const add = { modifierSelections: [{ optionId: 'syrup', name: 'Syrup', price: 30, quantity: 2 }],
    excludedIngredientIds: ['milk'], excludedIngredientNames: ['Milk'] };
  h.render(); h.replace(coffee); h.render();
  assert.ok(h.modifierPicker());
  assert.equal(h.cart.getState().lines.length, 1);
  h.modifierPicker().onConfirm(add);
  h.render(); h.replace(coffee); h.render(); h.modifierPicker().onConfirm(add);
  h.render(); h.replace(coffee); h.render();
  h.modifierPicker().onConfirm({ ...add, excludedIngredientIds: [], excludedIngredientNames: [] });
  const lines = h.cart.getState().lines;
  assert.deepEqual(Array.from(lines, line => line.quantity), [1, 2, 1]);
  assert.equal(h.cartModule.linePrice(lines[1]), 320);
  h.render(); h.submit();
  assert.equal(h.requests[0].payload.lines[1].excludedIngredientIds[0], 'milk');
  h.requests[0].resolve({ id: 'created-a' }); await flush();
});

test('confirming modifiers after switching tables cannot insert into the new draft', () => {
  const h = harness();
  h.render(); h.replace({ ...dish, hasModifiers: true }); h.render();
  const confirm = h.modifierPicker().onConfirm;
  h.cart.getState().selectTable(second);
  confirm({ modifierSelections: [{ optionId: 'mint', name: 'Mint', price: 10, quantity: 1 }] });
  assert.equal(h.cart.getState().lines.length, 0);
  assert.equal(h.cart.getState().carts[first.id].lines.length, 1);
});

test('editing a configuration preserves the identity and restriction of an existing order position', () => {
  const h = harness();
  const changed = { modifierSelections: [], excludedIngredientIds: ['lemon'], excludedIngredientNames: ['Lemon'] };
  const editable = { lineId: 'edit-1', orderItemId: '1', dish, quantity: 2 };
  const locked = { lineId: 'edit-2', orderItemId: '2', dish, quantity: 1, cancelAllowed: false };
  h.cart.getState().replaceLines([editable, locked]);
  h.cart.getState().setLineModifiers('edit-1', changed);
  h.cart.getState().setLineModifiers('edit-2', changed);
  assert.equal(h.cart.getState().lines[0].orderItemId, '1');
  assert.equal(h.cart.getState().lines[0].excludedIngredientIds[0], 'lemon');
  assert.equal(h.cart.getState().lines[1], locked);
});

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

test('manual delivery requires only dishes and isolates its checkout from table drafts', async () => {
  const h = harness({ deliveryAllowed: true, roundOrderTotal: true });
  const { NEW_DELIVERY_CART, orderCartDestination, cartTotals } = h.cartModule;
  const tableLines = h.cart.getState().lines;
  h.cart.getState().selectTable(NEW_DELIVERY_CART); h.cart.getState().add(dish);
  h.render();
  assert.equal(h.cartSheet().delivery, true);
  assert.equal(h.cartSheet().roundTotal, true);
  assert.equal(h.cartSheet().customerFields, undefined);
  h.submit();
  assert.deepEqual({ ...h.requests[0].payload.delivery }, { type: 'delivery' });
  assert.equal(h.requests[0].payload.tableId, undefined);
  h.requests[0].reject(new Error('Таймаут')); await flush(); h.render();
  assert.ok(h.notices.some(notice => notice.message === 'Таймаут'));
  h.submit();
  assert.equal(h.requests[1].payload.idempotencyKey, h.requests[0].payload.idempotencyKey);
  h.requests[1].resolve({ id: 'delivery-order' }); await flush();
  assert.equal(h.cart.getState().tableId, null);
  h.cart.getState().selectTable(first);
  assert.equal(h.cart.getState().lines, tableLines);
  assert.ok(h.notices.some(notice => notice.message === 'Заказ создан'));

  const serviceTable = { id: 'service-table', number: 0 };
  const firstDelivery = orderCartDestination({ id: 'delivery-a', source: 'delivery', table: serviceTable });
  const secondDelivery = orderCartDestination({ id: 'delivery-b', source: 'delivery', table: serviceTable });
  assert.notEqual(firstDelivery.id, secondDelivery.id);
  const rounded = cartTotals([{ dish: { ...dish, price: '10.60' }, quantity: 1 }], true);
  assert.equal(rounded.total, 10);
  assert.equal(rounded.rounding, 0.6);
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

test('switching a table draft to delivery keeps its dishes without customer fields', async () => {
  const h = harness({ deliveryAllowed: true });
  const lines = h.cart.getState().lines;
  h.render();
  h.cartSheet().typeControl.props.onChange('delivery');
  h.render();
  h.submit();
  const { delivery, tableId } = h.requests[0].payload;
  assert.equal(tableId, undefined);
  assert.deepEqual({ ...delivery }, { type: 'delivery' });
  assert.equal(h.cart.getState().lines, lines);
  h.requests[0].resolve({ id: 'delivery-order' });
  await flush();
});
