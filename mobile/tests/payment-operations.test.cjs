const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function loadSource(file, modules, timers = { setTimeout, clearTimeout }) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, ...timers,
    require: name => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; },
  });
  return module.exports;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const order = id => ({ id, orderNumber: id, finalAmount: '100', waiter: { id: 'staff' }, items: [{ status: 'served' }] });

// Preserve real hook state while controlling native boundaries and API completion order.
function paymentHarness() {
  const cells = [], timers = [];
  let cursor = 0, effects = [], changed = false;
  const differs = (before, after) => !before || !after || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
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
      return (cells[index] ??= { value: { current: initial } }).value;
    },
    useMemo(factory, dependencies) {
      const index = cursor++;
      if (!cells[index] || differs(cells[index].dependencies, dependencies)) cells[index] = { value: factory(), dependencies };
      return cells[index].value;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!cells[index] || differs(cells[index].dependencies, dependencies)) {
        const previous = cells[index];
        cells[index] = { dependencies };
        effects.push(() => { previous?.cleanup?.(); cells[index].cleanup = effect(); });
      }
    },
  };
  const auth = { user: { id: 'staff' } };
  const payments = new Map(), receipts = new Map(), printing = deferred();
  const paymentCalls = [], printCalls = [], begins = [], sounds = [], notices = [];
  const props = { order: order('a'), visible: true, onClose: () => { props.visible = false; }, onPaid() {} };
  const { PaymentSheet } = loadSource('src/screens/waiter/PaymentSheet.tsx', {
    react: hooks,
    'react-native': { ActivityIndicator: 'ActivityIndicator', Image: 'Image', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: value => value } },
    'react-native-reanimated': {},
    '@/components/typography': { Text: 'Text', TextInput: 'TextInput' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/ui': { Button: 'Button' }, '@/components/BottomSheet': { BottomSheet: 'BottomSheet', SheetScrollView: 'SheetScrollView' },
    '@/components/motion': {}, '@/components/PwaIcon': { PwaIcon: 'PwaIcon' },
    '@/theme': loadSource('src/theme/index.ts', {}),
    '@/services/api/waiter': {
      usePay: () => ({ isPending: false, mutateAsync: payload => {
        paymentCalls.push(payload);
        const request = deferred(); payments.set(payload.orderId, request); return request.promise;
      } }),
      fetchReceipt: id => { const request = deferred(); receipts.set(id, request); return request.promise; },
      useCreateReceiptPrintRequest: () => ({ isPending: false, mutateAsync: payload => { printCalls.push(payload); return printing.promise; } }),
    },
    '@/services/api/settings': { usePublicSettings: () => ({ data: { paymentMethods: ['cash'] } }), resolveQrSrc: () => null },
    '@/lib/api': { apiError: error => error.message }, '@/lib/sound': { beep: async sound => sounds.push(sound) },
    '@/store/notifications': { useNotifications: selector => selector({ push: value => notices.push(value) }) },
    '@/store/receiptPrint': { useReceiptPrint: selector => selector({ begin: (...value) => begins.push(value) }) },
    '@/store/auth': { useAuth: { getState: () => auth } },
    '@/utils/format': { displayOrderNumber: String, money: String }, './orderRules': { orderLocation: value => value.id },
  }, { setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {} });
  let tree;
  const all = value => {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(all);
    if (typeof value !== 'object') return [];
    return [value, ...all(value.props?.children), ...all(value.props?.footer)];
  };
  return {
    props, auth, payments, paymentCalls, receipts, printing, printCalls, begins, sounds, notices,
    render() {
      for (let count = 0; count < 10; count++) {
        cursor = 0; effects = []; changed = false;
        tree = PaymentSheet(props); effects.forEach(effect => effect());
        if (!changed) return tree;
      }
      assert.fail('Payment sheet did not settle');
    },
    find(type) { return all(tree).find(node => (typeof node.type === 'function' ? node.type.name : node.type) === type); },
    pay() { all(tree).find(node => node.type === 'Button' && node.props.title.startsWith('Принять оплату')).props.onPress(); },
    print() { all(tree).find(node => node.type === 'Button' && node.props.title === 'Печать чека').props.onPress(); },
    close() { all(tree).find(node => node.type === 'BottomSheet').props.onClose(); },
    finishAnimation() { timers.splice(0).forEach(callback => callback()); },
  };
}

test('normal payment preserves success animation, receipt and print owner', async () => {
  const env = paymentHarness(); env.render(); env.pay();
  env.pay(); // A second press before React rerenders must not submit another payment.
  assert.equal(env.paymentCalls.length, 1);
  env.payments.get('a').resolve(order('a')); await settle(); env.render();
  assert.ok(env.find('PaymentSuccessContent'));
  assert.equal(env.find('BottomSheet').props.presentation, 'center', 'Success appears centered while retaining the payment owner');
  assert.equal(env.find('BottomSheet').props.footer, undefined, 'Success animation has no payment or receipt buttons');
  env.receipts.get('a').resolve({ orderNumber: 'receipt-a' }); await settle(); env.render();
  assert.ok(env.find('PaymentSuccessContent'));
  env.finishAnimation(); await settle(); env.render();
  assert.equal(env.find('ReceiptContent').props.receipt.orderNumber, 'receipt-a');
  assert.equal(env.find('BottomSheet').props.presentation, 'bottom');
  env.print(); env.printing.resolve({ id: 'request-a', orderId: 'a' }); await settle();
  assert.equal(env.begins.length, 1);
  assert.equal(env.printCalls[0].orderId, 'a');
  assert.equal(env.begins[0][1].orderNumber, 'receipt-a');
});

test('closing during payment ignores late success and does not load a receipt', async () => {
  const env = paymentHarness(); env.render(); env.pay(); env.close(); env.render();
  env.payments.get('a').resolve(order('a')); await settle(); env.render();
  assert.equal(env.receipts.size, 0);
  assert.equal(env.sounds.length, 0);
  assert.equal(env.notices.length, 0);
  assert.equal(env.find('ReceiptContent'), undefined);
});

test('late receipt after close and order switch cannot replace the new order receipt', async () => {
  const env = paymentHarness(); env.render(); env.pay();
  env.payments.get('a').resolve(order('a')); await settle(); env.render();
  env.close(); env.render();
  env.props.order = order('b'); env.props.visible = true; env.render(); env.pay();
  env.payments.get('b').resolve(order('b')); await settle();
  env.receipts.get('a').resolve({ orderNumber: 'receipt-a' });
  env.finishAnimation(); await settle(); env.render();
  assert.equal(env.find('ReceiptContent'), undefined);
  assert.ok(env.find('PaymentSuccessContent'));
  env.receipts.get('b').resolve({ orderNumber: 'receipt-b' }); await settle(); env.render();
  assert.equal(env.find('ReceiptContent').props.receipt.orderNumber, 'receipt-b');
});

test('order change during receipt loading resets payment state without needing close', async () => {
  const env = paymentHarness(); env.render(); env.pay();
  env.payments.get('a').resolve(order('a')); await settle(); env.render();
  env.props.order = order('b'); env.render();
  env.receipts.get('a').resolve({ orderNumber: 'receipt-a' }); env.finishAnimation(); await settle(); env.render();
  assert.equal(env.find('ReceiptContent'), undefined);
  assert.equal(env.find('PaymentSuccessContent'), undefined);
  assert.equal(env.find('BottomSheet').props.title, 'Оплата заказа');
});

test('late print response cannot open old account receipt after close or logout', async () => {
  const env = paymentHarness(); env.render(); env.pay();
  env.payments.get('a').resolve(order('a')); await settle();
  env.receipts.get('a').resolve({ orderNumber: 'receipt-a' }); env.finishAnimation(); await settle(); env.render();
  env.print(); env.close(); env.auth.user = { id: 'different-user' }; env.render();
  env.printing.resolve({ id: 'request-a', orderId: 'a' }); await settle();
  assert.equal(env.begins.length, 0);
  assert.equal(env.notices.length, 1); // Only the completed original payment notification.
});

test('fast receipt rejection is handled immediately and keeps the success animation duration', async () => {
  const env = paymentHarness(); env.render(); env.pay();
  env.payments.get('a').resolve(order('a')); await settle();
  env.receipts.get('a').reject(new Error('receipt-offline')); await settle(); env.render();
  assert.ok(env.find('PaymentSuccessContent'));
  env.finishAnimation(); await settle(); env.render();
  assert.ok(env.find('PaymentReceiptErrorContent'));
});

test('account switch alone rejects a late payment result', async () => {
  const env = paymentHarness(); env.render(); env.pay();
  env.auth.user = { id: 'different-user' };
  env.payments.get('a').resolve(order('a')); await settle(); env.render();
  assert.equal(env.receipts.size, 0);
  assert.equal(env.sounds.length, 0);
  assert.equal(env.notices.length, 0);
});

test('a stale close handler from the previous order cannot close the current order', () => {
  const env = paymentHarness(); env.render();
  const oldClose = env.find('BottomSheet').props.onClose;
  env.props.order = order('b'); env.render(); oldClose();
  assert.equal(env.props.visible, true);
});

test('printed realtime updates and the visible receipt sheet play exactly one acceptance sound', () => {
  const events = loadSource('src/services/socket/events.ts', {}).SERVER_EVENTS;
  const sounds = [], listeners = new Map();
  const noop = () => {};
  const request = { id: 'request-a', orderId: 'a', orderNumber: '001', type: 'receipt' };
  const state = { request, status: 'pending', sheetOpen: true, resolve(value) { state.status = value; }, dismiss: noop };
  const { useRealtimeSync } = loadSource('src/hooks/useRealtimeSync.ts', {
    react: { useRef: value => ({ current: value }), useEffect: effect => effect() },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) }, Platform: { OS: 'android' } },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: noop }) },
    '@/services/socket': { getSocket: () => ({ on: (event, handler) => listeners.set(event, handler), off: noop }) },
    '@/services/socket/events': { SERVER_EVENTS: events }, '@/lib/sound': { beep: value => sounds.push(value) },
    '@/store/notifications': { useNotifications: selector => selector({ push: noop }) },
    '@/store/auth': { useAuth: selector => selector({ user: { id: 'staff' } }) },
    '@/services/waiterVoice': {}, '@/services/realtimeVoice': {},
    '@/features/ptt/backgroundFlag': {},
    '@/services/push': { isRemotePushRegistered: () => false, notificationDeduper: { claim: () => true } },
    '@/store/receiptPrint': { useReceiptPrint: { getState: () => state } },
    '@/utils/format': { displayOrderNumber: String }, '@/utils/orderCache': {},
  });
  useRealtimeSync(); listeners.get(events.RECEIPT_PRINT_REQUEST_PRINTED)(request);
  const refs = [];
  let refCursor = 0;
  const { ReceiptPrintSheet } = loadSource('src/components/ReceiptPrintSheet.tsx', {
    react: { ...React, useRef: initial => refs[refCursor++] ?? (refs[refCursor - 1] = { current: initial }), useEffect: effect => effect() },
    'react-native': { StyleSheet: { create: value => value }, View: 'View' },
    '@/components/typography': { Text: 'Text' }, '@/components/BottomSheet': { BottomSheet: 'BottomSheet', SheetScrollView: 'SheetScrollView' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' }, '@/components/ui': { Button: 'Button' },
    '@/components/PwaIcon': { PwaIcon: 'PwaIcon' }, '@/theme': loadSource('src/theme/index.ts', {}),
    '@/store/receiptPrint': { useReceiptPrint: () => state }, '@/utils/format': {},
    '@/lib/sound': { beep: value => sounds.push(value) },
  });
  ReceiptPrintSheet(); refCursor = 0; ReceiptPrintSheet();
  assert.deepEqual(sounds, ['accept']);
});
