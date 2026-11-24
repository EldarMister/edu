const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadSource(name, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', name + '.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  const scope = { exports, setTimeout, require: (dependency) => dependencies[dependency] ?? require(dependency) };
  vm.runInNewContext(code, scope);
  return exports;
}

const format = loadSource('lib/format');
const i18n = loadSource('lib/i18n', { '@/store/locale': {} });
const receipt = loadSource('lib/receipt', { '@/lib/i18n': i18n });
const { printReceipt } = loadSource('features/waiter/printReceipt', {
  '@/lib/format': format, '@/lib/i18n': i18n, '@/lib/receipt': receipt,
});

test('mixed receipt shows each used tender and combines repeated card payments', () => {
  const payments = [{ method: 'cash', amount: '60.00' }, { method: 'card', amount: '12.25' }, { method: 'card', amount: '27.75' }];
  assert.equal(format.paymentCell({ paymentMethod: 'mixed', payments }), 'Смешанная (Наличные 60 с · Карта 40 с)');
  assert.equal(format.paymentCell({ paymentMethod: 'mixed' }), 'Смешанная');
  assert.equal(format.paymentCell({ paymentMethod: 'mixed', payments: [payments[0], { method: 'qr', amount: '40.00' }] }),
    'Смешанная (Наличные 60 с · QR 40 с)');
});

test('receipt uses the Bishkek business date, selected language, settings, and one row per tender', async () => {
  let html = '';
  let resolvePrint;
  const printed = new Promise((resolve) => { resolvePrint = resolve; });
  await printReceipt({
    orderNumber: '1', tableNumber: 1, source: 'pos', waiter: 'Кассир',
    cafeName: 'EDU Cafe', address: 'Скрытый адрес', date: '2026-10-03T18:04:00.000Z',
    thanks: receipt.DEFAULT_RECEIPT_TEXT, receiptLanguage: 'ky', receiptPrintAddress: false,
    items: [], totalAmount: 150, finalAmount: 150, paymentMethod: 'mixed',
    payments: [{ method: 'cash', amount: 100 }, { method: 'qr', amount: 50 }],
  }, {
    document: { write: (value) => { html = value; }, close() {} },
    focus() {},
    print: resolvePrint,
  });
  await printed;
  assert.match(html, /<html lang="ky">/);
  assert.match(html, /Товардык чек/);
  assert.match(html, /04\.10\.2026(?:,)?\s00:04/);
  assert.doesNotMatch(html, /Скрытый адрес/);
  assert.match(html, /class="muted">Төлөм</);
  assert.match(html, /class="pair payment"><span>Нак акча<\/span><span>100/);
  assert.match(html, /class="pair payment"><span>QR-код<\/span><span>50/);
});
