const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const cells = []; let cursor = 0, effects = [], changed = false, tree;
  const differs = (before, after) => !before || !after || before.length !== after.length || after.some((value, i) => !Object.is(value, before[i]));
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++; if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[index].value, value => { const next = typeof value === 'function' ? value(cells[index].value) : value; if (!Object.is(next, cells[index].value)) { cells[index].value = next; changed = true; } }];
    },
    useRef(initial) { return (cells[cursor++] ??= { value: { current: initial } }).value; },
    useMemo(factory, deps) { const i = cursor++; if (!cells[i] || differs(cells[i].deps, deps)) cells[i] = { value: factory(), deps }; return cells[i].value; },
    useEffect(effect, deps) { const i = cursor++; if (!cells[i] || differs(cells[i].deps, deps)) { const previous = cells[i]; cells[i] = { deps }; effects.push(() => { previous?.cleanup?.(); cells[i].cleanup = effect(); }); } },
  };
  const requests = [], payloads = [];
  const props = { visible: true, instantDismiss: false, orderId: 'a', total: 100, paymentMethods: ['qr', 'cash'], qrAvailable: true, submitting: false, onClose() {}, onComplete: payload => { const request = deferred(); payloads.push(payload); requests.push(request); return request.promise; } };
  const modules = {
    react: hooks,
    'react-native': { View: 'View', StyleSheet: { create: value => value }, ScrollView: 'ScrollView' },
    'react-native-reanimated': {},
    '@/components/typography': { Text: 'Text', TextInput: 'TextInput' },
    '@/components/FastPressable': { FastPressable: 'FastPressable' },
    '@/components/ui': { Button: 'Button' },
    '@/components/BottomSheet': { BottomSheet: 'BottomSheet', SheetScrollView: 'SheetScrollView' },
    '@/components/motion': {}, '@/components/PwaIcon': { PwaIcon: 'PwaIcon' },
    '@/theme': { colors: {}, fontSize: {}, radius: {}, spacing: {} },
    '@/services/api/waiter': {}, '@/services/api/settings': {},
    '@/lib/api': { apiError: error => error.message }, '@/lib/sound': {},
    '@/store/notifications': {}, '@/store/receiptPrint': {}, '@/store/auth': {},
    '@/utils/format': { money: String }, './orderRules': {},
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/screens/waiter/PaymentSheet.tsx'), 'utf8').replace('function SplitBillSheet(', 'export function SplitBillSheet(');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children), ...all(node.props?.footer)];
  return {
    props, requests, payloads,
    render() { for (let n = 0; n < 10; n++) { cursor = 0; effects = []; changed = false; tree = module.exports.SplitBillSheet(props); effects.forEach(fn => fn()); if (!changed) return tree; } assert.fail('did not settle'); },
    methods: () => all(tree).filter(node => node.type?.name === 'SplitMethodSelect'),
    buttons: () => all(tree).filter(node => node.type === 'Button' && node.props.title.startsWith('Оплатить')),
    amounts: () => all(tree).filter(node => node.type === 'TextInput' && node.props.editable !== undefined),
    texts: () => all(tree).filter(node => node.type === 'Text').map(node => node.props.children).flat(Infinity).join(' '),
  };
}

test('accepted split parts survive a changed order total and remaining amounts can be reconciled', async () => {
  const h = harness(); h.render(); h.buttons()[0].props.onPress(); h.render();
  assert.equal(h.buttons().length, 1);
  h.props.total = 120; h.render();
  assert.equal(h.buttons().length, 1, 'first accepted part must not disappear');
  assert.equal(h.amounts()[0].props.value, '50');
  assert.equal(h.buttons()[0].props.disabled, true);
  h.amounts()[0].props.onChangeText('70'); h.render();
  assert.equal(h.buttons()[0].props.disabled, false);
  h.buttons()[0].props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(h.payloads[0].payments)), [{ method: 'qr', amount: 50 }, { method: 'qr', amount: 70 }]);
  h.requests[0].resolve(); await settle();
});

test('a rejected final split payment preserves earlier parts and unlocks the final part for retry', async () => {
  const h = harness(); h.render(); h.buttons()[0].props.onPress(); h.render();
  const final = h.buttons()[0]; final.props.onPress(); final.props.onPress();
  assert.equal(h.requests.length, 1, 'same-frame presses cannot submit twice');
  h.requests[0].reject(new Error('Соединение прервано')); await settle(); h.render();
  assert.equal(h.buttons().length, 1);
  assert.equal(h.buttons()[0].props.disabled, false);
  assert.match(h.texts(), /Соединение прервано/);
  h.buttons()[0].props.onPress();
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve(); await settle();
});

test('a late split payment failure cannot mark parts or inject errors into a different order', async () => {
  const h = harness(); h.render(); h.buttons()[0].props.onPress(); h.render(); h.buttons()[0].props.onPress();
  h.props.orderId = 'b'; h.props.total = 80; h.render();
  h.buttons()[0].props.onPress(); h.render();
  h.requests[0].reject(new Error('Old failure')); await settle(); h.render();
  assert.equal(h.buttons().length, 1, 'the first part for the new order remains accepted');
  assert.doesNotMatch(h.texts(), /Old failure/);
  assert.equal(h.amounts()[0].props.value, '40');
});


test('split payments offer only enabled methods and support card-only settings', async () => {
  const h = harness(); h.props.paymentMethods = ['card']; h.render();
  assert.deepEqual(JSON.parse(JSON.stringify(h.methods()[0].props.methods.map(method => method.key))), ['card']);
  assert.equal(h.methods()[0].props.value, 'card');
  h.buttons()[0].props.onPress(); h.render(); h.buttons()[0].props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(h.payloads[0].payments)), [{ method: 'card', amount: 50 }, { method: 'card', amount: 50 }]);
  h.requests[0].resolve(); await settle();
});

test('live settings changes replace disabled unpaid choices and remove mixed unless cash and QR are enabled', () => {
  const h = harness(); h.render();
  h.methods()[0].props.onChange('mixed'); h.render();
  assert.equal(h.methods()[0].props.value, 'mixed');
  h.props.paymentMethods = ['cash']; h.render();
  assert.deepEqual(h.methods().map(node => node.props.value), ['cash', 'cash']);
  assert.deepEqual(JSON.parse(JSON.stringify(h.methods()[0].props.methods.map(method => method.key))), ['cash']);
  assert.equal(h.buttons()[0].props.disabled, false);
  h.methods()[0].props.onChange('qr'); h.render();
  assert.equal(h.methods()[0].props.value, 'cash', 'stale method menu cannot restore a disabled method');
});

test('disabling an already accepted part preserves it and blocks completion until the method is restored', async () => {
  const h = harness(); h.render(); h.buttons()[0].props.onPress(); h.render();
  h.props.paymentMethods = ['cash']; h.render();
  assert.equal(h.buttons().length, 1, 'accepted part remains recorded');
  assert.equal(h.methods()[0].props.value, 'cash');
  assert.equal(h.buttons()[0].props.disabled, true);
  h.buttons()[0].props.onPress();
  assert.equal(h.requests.length, 0);
  assert.match(h.texts(), /уже отмеченного платежа отключён/);
  h.props.paymentMethods = ['cash', 'qr']; h.render();
  assert.equal(h.buttons()[0].props.disabled, false);
  h.buttons()[0].props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(h.payloads[0].payments)), [{ method: 'qr', amount: 50 }, { method: 'cash', amount: 50 }]);
  h.requests[0].resolve(); await settle();
});

test('missing QR image and empty method settings block split submission without marking a part paid', () => {
  const h = harness(); h.props.qrAvailable = false; h.render();
  assert.equal(h.buttons()[0].props.disabled, true);
  h.buttons()[0].props.onPress(); h.render();
  assert.equal(h.buttons().length, 2);
  assert.match(h.texts(), /QR-код не загружен/);
  h.methods()[0].props.onChange('cash'); h.render();
  assert.equal(h.buttons()[0].props.disabled, false);
  h.props.paymentMethods = []; h.render();
  assert.equal(h.buttons()[0].props.disabled, true);
  assert.equal(h.methods()[0].props.methods.length, 0);
  h.buttons()[0].props.onPress();
  assert.equal(h.requests.length, 0);
});
