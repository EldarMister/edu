const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function loadSource(file, modules) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, setTimeout, clearTimeout,
    require: name => {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    },
  });
  return module.exports;
}

// Execute the actual screen with persistent hook state and controlled query
// snapshots. Native child components stay opaque: this tests the React element
// boundary that owns PaymentSheet's payment/receipt state, not its internals.
function screenHarness() {
  const cells = [];
  let cursor = 0, pendingEffects = [], changed = false;
  const dependenciesChanged = (previous, next) => !previous || !next
    || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[index].value, value => {
        const next = typeof value === 'function' ? value(cells[index].value) : value;
        if (!Object.is(next, cells[index].value)) { cells[index].value = next; changed = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: { current: initial } };
      return cells[index].value;
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!cells[index] || dependenciesChanged(cells[index].dependencies, dependencies)) {
        cells[index] = { value: callback, dependencies };
      }
      return cells[index].value;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!cells[index] || dependenciesChanged(cells[index].dependencies, dependencies)) {
        pendingEffects.push(effect);
        cells[index] = { dependencies };
      }
    },
  };
  const queries = {
    active: { data: undefined, isLoading: true, isFetched: false },
    detail: { data: undefined, isLoading: false },
  };
  const navigations = [];
  const navigation = { getParent: () => ({ navigate: value => navigations.push(value) }) };
  const mutation = () => ({ isPending: false, mutate() {}, mutateAsync() {} });
  const api = Object.fromEntries([
    'usePickedUp', 'useServed', 'useToPayment', 'useResolvePartialRejection',
    'useRemoveRejectedItem', 'useCancelReadyItem', 'useCancelOrder', 'useClaimQrOrder',
    'useCreateReceiptPrintRequest', 'useCallAdministrator',
  ].map(name => [name, mutation]));
  const store = selector => selector({
    selectTable() {}, clear() {}, startEditing() {}, begin() {}, setTarget() {}, push() {},
  });
  const { OrderDetailScreen } = loadSource('src/screens/waiter/OrderDetailScreen.tsx', {
    react: hooks,
    'react-native': {
      ActivityIndicator: 'ActivityIndicator', InteractionManager: {}, ScrollView: 'ScrollView',
      StyleSheet: { create: styles => styles }, View: 'View',
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@react-navigation/native': {
      useRoute: () => ({ params: { orderId: 'order-102' } }),
      useNavigation: () => navigation,
      useFocusEffect() {},
    },
    'react-native-svg': { default: 'Svg', Path: 'Path', __esModule: true },
    '@/components/typography': { Text: 'Text', TextInput: 'TextInput' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/ui': { Button: 'Button', EmptyState: 'EmptyState', Loading: 'Loading' },
    '@/components/BottomSheet': { BottomSheet: 'BottomSheet' },
    '@/components/PwaIcon': { PwaIcon: 'PwaIcon' },
    '@/components/StatusBadge': { OrderStatusBadges: 'OrderStatusBadges' },
    '@/components/NumberTicker': { NumberTicker: 'NumberTicker' },
    '@/theme': loadSource('src/theme/index.ts', {}),
    '@/theme/status': { ORDER_STATUS: {} },
    '@/store/notifications': { useNotifications: store },
    '@/store/cart': { useCart: store },
    '@/store/receiptPrint': { useReceiptPrint: store },
    '@/store/replacement': { useReplacement: store },
    '@/services/api/waiter': {
      ...api,
      useActiveOrders: () => queries.active,
      useOrderDetails: () => queries.detail,
      useDishes: () => ({ data: [] }),
      fetchReceipt() {},
    },
    '@/lib/api': { apiError: String },
    '@/utils/format': { displayOrderNumber: String, money: String },
    '@/utils/orderCart': { orderToCartLines: () => [] },
    './PaymentSheet': { PaymentSheet: 'PaymentSheet' },
    './InsufficientPermissionsSheet': { InsufficientPermissionsSheet: 'InsufficientPermissionsSheet' },
    './orderRules': {
      canRequestPreliminaryBill: () => false, deliveryDetails: () => null, orderLocation: () => 'Стол 2',
    },
  });
  return {
    queries, navigations,
    render() {
      for (let iteration = 0; iteration < 10; iteration++) {
        cursor = 0; changed = false; pendingEffects = [];
        const tree = OrderDetailScreen();
        pendingEffects.forEach(effect => effect());
        if (!changed) return tree;
      }
      assert.fail('Screen did not settle after effects');
    },
  };
}

function paymentSlot(tree) {
  assert.equal(tree.type, 'SafeAreaView', 'Screen wrapper must survive query transitions');
  const sheet = tree.props.children[0];
  assert.equal(sheet.type, 'PaymentSheet', 'PaymentSheet must remain in the first child slot');
  assert.equal(sheet.key, null);
  return sheet;
}

test('payment sheet survives active-order removal, detail loading, fallback and paid detail', () => {
  const env = screenHarness();
  const waiting = {
    id: 'order-102', orderNumber: 102, status: 'waiting_payment', source: 'pos',
    waiter: { id: 'waiter-1' }, table: { id: 'table-2', number: 2 }, items: [], finalAmount: 420,
  };
  env.queries.active = { data: [waiting], isLoading: false, isFetched: true };
  const original = paymentSlot(env.render());
  assert.equal(original.props.visible, true);
  assert.equal(original.props.order, waiting);

  // The payment mutation invalidates active orders before the detail request
  // resolves; success animation and receipt fetch are still running in sheet.
  env.queries.active = { data: [], isLoading: false, isFetched: true };
  env.queries.detail = { data: undefined, isLoading: true };
  const loading = paymentSlot(env.render());
  assert.equal(loading.props.visible, true);
  assert.equal(loading.props.order, waiting, 'Keep the payment snapshot while fetching paid details');

  env.queries.detail = { data: undefined, isLoading: false };
  const fallback = paymentSlot(env.render());
  assert.equal(fallback.props.visible, true);
  assert.equal(fallback.props.order, waiting);

  const paid = { ...waiting, status: 'paid' };
  env.queries.detail = { data: paid, isLoading: false };
  const completed = paymentSlot(env.render());
  assert.equal(completed.props.visible, true, 'Receipt stays open until the user closes it');
  assert.equal(completed.props.order, paid);
  completed.props.onPaid();
  assert.equal(paymentSlot(env.render()).props.visible, false);
  assert.deepEqual(env.navigations, ['Tables']);
});

test('initial loading and missing order keep the same payment slot and show their fallback', () => {
  const env = screenHarness();
  const initial = env.render();
  assert.equal(paymentSlot(initial).props.visible, false);
  assert.equal(initial.props.children[1].type, 'Loading');
  env.queries.active = { data: [], isLoading: false, isFetched: true };
  const missing = env.render();
  assert.equal(paymentSlot(missing).props.visible, false);
  assert.equal(missing.props.children[1].type, 'EmptyState');
});
