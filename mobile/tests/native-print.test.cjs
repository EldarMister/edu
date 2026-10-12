const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');

function load(file, modules, globals = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, setTimeout, clearTimeout, AbortController, ...globals,
    require: name => { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; },
  });
  return module.exports;
}

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function lifecycle(os = 'android') {
  const listeners = new Set();
  const timers = new Map();
  let nextTimer = 0;
  const native = {
    Platform: { OS: os },
    AppState: { addEventListener: (_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    } },
  };
  const helper = load('src/screens/admin/nativePrintLifecycle.ts', { 'react-native': native }, {
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return {
    ...helper, listeners, timers,
    emit: state => [...listeners].forEach(listener => listener(state)),
  };
}

test('Android waits for background then active even when printAsync resolves at launch', async () => {
  const env = lifecycle();
  let finished = false;
  const printing = env.waitForNativePrintReturn(async () => assert.equal(env.listeners.size, 1))
    .then(() => { finished = true; });
  await tick();
  assert.equal(finished, false);
  env.emit('active');
  await tick();
  assert.equal(finished, false, 'An unrelated foreground event is not print completion');
  env.emit('background');
  assert.equal(env.timers.size, 0, 'Do not time out while the user is in the print UI');
  env.emit('active');
  await printing;
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test('return events before printAsync settles are retained without resolving early', async () => {
  const env = lifecycle();
  const native = deferred();
  let finished = false;
  const printing = env.waitForNativePrintReturn(() => {
    env.emit('inactive'); env.emit('active');
    return native.promise;
  }).then(() => { finished = true; });
  await tick();
  assert.equal(finished, false);
  native.resolve();
  await printing;
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test('native failure removes subscriptions and permits a subsequent print', async () => {
  const env = lifecycle();
  await assert.rejects(env.waitForNativePrintReturn(() => { throw new Error('render failed'); }), /render failed/);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
  await env.waitForNativePrintReturn(async () => { env.emit('background'); env.emit('active'); });
  assert.equal(env.listeners.size, 0);
});

test('a print activity that never opens releases its subscription with an error', async () => {
  const env = lifecycle();
  const printing = env.waitForNativePrintReturn(async () => {});
  const rejected = assert.rejects(printing, /Не удалось открыть системное окно печати/);
  await tick();
  assert.equal(env.timers.size, 1);
  [...env.timers.values()][0]();
  await rejected;
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test('native rejection after leaving the app fails immediately and removes the listener', async () => {
  const env = lifecycle();
  await assert.rejects(env.waitForNativePrintReturn(async () => {
    env.emit('background');
    throw new Error('native print failed');
  }), /native print failed/);
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test('abort during the print activity does not wait for another foreground event', async () => {
  const env = lifecycle();
  const controller = new AbortController();
  const printing = env.waitForNativePrintReturn(async () => env.emit('background'), controller.signal);
  const rejected = assert.rejects(printing, /Печать отменена/);
  await tick();
  controller.abort();
  await rejected;
  assert.equal(env.listeners.size, 0);
  assert.equal(env.timers.size, 0);
});

test('abort cleans up while native promise is pending and its late resolution creates no timer', async () => {
  const env = lifecycle();
  const native = deferred();
  const controller = new AbortController();
  const printing = env.waitForNativePrintReturn(() => native.promise, controller.signal);
  const rejected = assert.rejects(printing, /Печать отменена/);
  await tick();
  controller.abort();
  await rejected;
  assert.equal(env.listeners.size, 0);
  native.resolve();
  await tick();
  assert.equal(env.timers.size, 0);
});

test('an already aborted operation never launches native printing', async () => {
  const env = lifecycle();
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(env.waitForNativePrintReturn(async () => { calls++; }, controller.signal), /Печать отменена/);
  assert.equal(calls, 0);
  assert.equal(env.listeners.size, 0);
});

test('iOS continues to follow its native print promise without Android lifecycle tracking', async () => {
  const env = lifecycle('ios');
  const native = deferred();
  let finished = false;
  const printing = env.waitForNativePrintReturn(() => native.promise).then(() => { finished = true; });
  await tick();
  assert.equal(finished, false);
  assert.equal(env.listeners.size, 0);
  native.resolve();
  await printing;
});

test('actual receipt printing subscribes before the Expo module and waits for return', async () => {
  const env = lifecycle();
  const { printNativeReceipt } = load('src/screens/admin/print.ts', {
    'expo-print': { printAsync: async options => {
      assert.equal(env.listeners.size, 1);
      assert.match(options.html, /420/);
      env.emit('background');
    } },
    'expo-file-system': {}, 'expo-sharing': {}, qrcode: {},
    '@/utils/format': { displayOrderNumber: String, money: String, orderItemDisplayName: String, paymentMethodLabel: String },
    './nativePrintLifecycle': env,
  });
  let finished = false;
  const printing = printNativeReceipt({ items: [], date: '2026-10-10', orderNumber: '102', finalAmount: 420 })
    .then(() => { finished = true; });
  await tick();
  assert.equal(finished, false);
  env.emit('active');
  await printing;
  assert.equal(env.listeners.size, 0);
});

function receiptScreen(printNativeReceipt) {
  const row = { id: 'request-120', orderId: 'order-102', source: 'request', status: 'requested', type: 'preliminary', amount: 420, createdAt: '2026-10-10', orderNumber: '102' };
  const calls = { approved: [], printed: [], busy: [], alerts: [], notifications: [], cleanups: [] };
  let stateIndex = 0;
  const hooks = {
    ...React,
    useState: initial => { const index = stateIndex++; return [initial, value => { if (index === 0) calls.busy.push(value); }]; },
    useRef: initial => ({ current: initial }),
    useEffect: effect => { const cleanup = effect(); if (cleanup) calls.cleanups.push(cleanup); },
  };
  const { ReceiptPrintsScreen } = load('src/screens/admin/ReceiptPrintsScreen.tsx', {
    react: hooks,
    'react-native': { Platform: { OS: 'android' }, ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl', ScrollView: 'ScrollView', View: 'View', StyleSheet: { create: value => value } },
    '@/components/typography': { Text: 'Text', Alert: { alert: (title, message, buttons, options) => calls.alerts.push({ title, message, buttons, options }) } },
    '@/components/ui': { Button: 'Button', Card: 'Card' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/lib/api': { api: { get: async () => ({ data: { finalAmount: 420 } }) }, apiError: error => error.message },
    '@/store/notifications': { useNotifications: selector => selector({ push: value => calls.notifications.push(value) }) },
    '@/services/api/admin': {
      useReceiptPrintRequests: () => ({ data: [row], isLoading: false }),
      useReceiptPrintActions: () => ({
        approve: { mutateAsync: async id => { calls.approved.push(id); row.status = 'approved'; } },
        printed: { mutateAsync: async id => { calls.printed.push(id); row.status = 'printed'; } },
        reject: {},
      }),
      useFiscalizeForPrint: () => ({}), useAdminOrderDetails: () => ({}),
    },
    '@/services/api/settings': { usePublicSettings: () => ({ data: { fiscalEnabled: false } }) },
    '@/utils/format': { displayOrderNumber: String, money: String, timeHM: String },
    '@/theme': load('src/theme/index.ts', {}),
    './OrderDetailsModal': { OrderDetailsModal: 'OrderDetailsModal' },
    './print': { printNativeReceipt },
  });
  let button;
  const find = node => {
    if (Array.isArray(node)) { node.forEach(find); return; }
    if (!React.isValidElement(node)) return;
    if (node.type === 'Button' && node.props.title === 'Принять и печатать') button = node;
    find(node.props.children);
  };
  find(ReceiptPrintsScreen());
  assert.ok(button);
  return { row, calls, press: () => button.props.onPress(), unmount: () => calls.cleanups.forEach(cleanup => cleanup()) };
}

test('receipt confirmation waits for native return; dismiss keeps approval and unlocks retry', async () => {
  const native = deferred();
  const env = receiptScreen(() => native.promise);
  env.press();
  await tick();
  assert.equal(env.calls.alerts.length, 0);
  assert.equal(env.calls.printed.length, 0);
  native.resolve();
  await tick();
  assert.equal(env.calls.alerts.length, 1);
  assert.equal(env.calls.alerts[0].options.cancelable, true);
  env.calls.alerts[0].options.onDismiss();
  await tick();
  assert.equal(env.row.status, 'approved');
  assert.equal(env.calls.printed.length, 0);
  assert.equal(env.calls.busy.at(-1), null);
  env.press();
  await tick();
  assert.equal(env.calls.alerts.length, 2, 'running guard must allow retry after cancellation');
  assert.equal(env.calls.approved.length, 1);
  env.calls.alerts[1].buttons[0].onPress();
  await tick();
  assert.equal(env.calls.busy.at(-1), null);
});

test('receipt is marked printed only after explicit confirmation', async () => {
  const env = receiptScreen(async () => {});
  env.press();
  await tick();
  assert.equal(env.calls.printed.length, 0);
  env.calls.alerts[0].buttons[1].onPress();
  await tick();
  assert.deepEqual(env.calls.printed, ['request-120']);
  assert.equal(env.calls.busy.at(-1), null);
});

test('print failure leaves request approved and releases all action guards', async () => {
  let attempts = 0;
  const env = receiptScreen(async () => { if (++attempts === 1) throw new Error('print unavailable'); });
  env.press();
  await tick();
  assert.equal(env.row.status, 'approved');
  assert.equal(env.calls.printed.length, 0);
  assert.equal(env.calls.busy.at(-1), null);
  assert.equal(env.calls.notifications[0].type, 'error');
  env.press();
  await tick();
  assert.equal(attempts, 2);
  env.calls.alerts[0].options.onDismiss();
  await tick();
});

test('screen unmount aborts native wait and a late return shows no confirmation', async () => {
  const native = deferred();
  let signal;
  const env = receiptScreen((_receipt, _preliminary, _fiscal, cancellation) => { signal = cancellation; return native.promise; });
  env.press();
  await tick();
  env.unmount();
  assert.equal(signal.aborted, true);
  native.resolve();
  await tick();
  assert.equal(env.calls.alerts.length, 0);
  assert.equal(env.calls.printed.length, 0);
  assert.equal(env.calls.busy.at(-1), null);
});
