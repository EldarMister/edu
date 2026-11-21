const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath, imports = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, { URL, module, exports: module.exports, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  } });
  return module.exports;
}

const timing = load('utils/warehouseTiming.ts');
const form = load('utils/warehousePurchaseForm.ts', {
  '@/services/api/warehouseUnits': load('services/api/warehouseUnits.ts'),
});
const json = (value) => JSON.parse(JSON.stringify(value));
const receiptLine = {
  id: 'line-1', ingredientId: 'rice', ingredientName: 'Рис', quantity: 3, quantityBase: 15000,
  unit: 'Мешок', unitCode: 'Мешок', packageId: 'archived', packageName: 'Мешок', packageFactor: 5000,
  purchasePrice: 100, total: 270, grossTotal: 300,
};

test('invoice attachment lines allow HTTP and HTTPS, retain ordering and reject invalid input', () => {
  assert.deepEqual(json(form.purchaseAttachmentLinks(' https://example.test/a\r\n\r\nhttp://example.test/b ')),
    ['https://example.test/a', 'http://example.test/b']);
  assert.deepEqual(json(form.purchaseAttachmentLinks(' \n ')), []);
  assert.equal(form.purchaseAttachmentLinks('file:///invoice.pdf'), undefined);
  assert.equal(form.purchaseAttachmentLinks('https://example.test/a\ninvoice.pdf'), undefined);
});

test('the previous unit price uses the original saved package factor', () => {
  const saved = form.savedPurchaseLine(receiptLine);
  assert.equal(form.purchaseLastPrice(saved, { unitCode: 'kg', unitPrice: 120 }, undefined, []), 600);
  assert.equal(form.purchaseLastPrice({ ...saved, unit: 'g' }, { unitCode: 'kg', unitPrice: 120 }, undefined, []), 0.12);
});

test('a saved packaged line sends its gross total and the trusted archived package reference', () => {
  const line = form.savedPurchaseLine(receiptLine);
  assert.equal(form.purchaseLineGross(line), 300);
  assert.deepEqual(json(form.purchaseLineInput(line)), {
    ingredientId: 'rice', quantity: 3, packageId: 'archived', purchaseItemId: 'line-1', total: 300,
  });
  assert.equal(form.changePurchaseLineUnit(line, 'kg', { displayUnit: 'kg' }, []).price, '20');
});

test('a product-specific bag becomes a quantity in the product unit at the exact entered gross value', () => {
  const item = { displayUnit: 'kg', purchaseUnits: [{ name: 'Мешок 5 кг', factor: 5 }] };
  const line = { key: 'new', ingredientId: 'rice', quantity: '2', unit: 'custom:0', price: '99,5' };
  assert.deepEqual(json(form.purchaseLineInput(line, item)), {
    ingredientId: 'rice', quantity: 10, unit: 'kg', total: 199,
  });
  assert.equal(form.purchaseLineInput({ ...line, price: '' }, item), null);
});

test('quantity precision is identical in the native amount preview and the API payload', () => {
  const line = { key: 'new', ingredientId: 'rice', quantity: '0.0014', unit: 'kg', price: '100000' };
  assert.equal(form.purchaseLineGross(line), 100);
  assert.equal(form.purchaseLineInput(line).quantity, 0.001);
  assert.equal(form.purchaseLineInput({ ...line, quantity: '0.0004' }), null);
});

test('Bishkek transaction dates preserve the selected day, instant and saved seconds', () => {
  const dateTime = { date: '2026-11-16', time: '00:15' };
  const saved = '2026-11-15T18:15:37.500Z';
  assert.equal(timing.warehouseDateTimeIso(dateTime), '2026-11-15T18:15:00.000Z');
  assert.equal(timing.warehouseDateTimeIso(dateTime, saved), saved);
  assert.deepEqual(json(timing.warehouseTimingFor(saved)), { ...dateTime, mode: 'past' });
  assert.equal(timing.warehouseTimingValue({ ...dateTime, mode: 'current' }, saved), null);
  assert.equal(timing.warehouseDateTimeIso({ date: '2026-02-29', time: '12:00' }), undefined);
  assert.equal(timing.warehouseDateTimeIso({ date: '2026-11-16', time: '24:00' }), undefined);
  assert.match(timing.warehouseTimingError({ ...dateTime, mode: 'past' }, new Date('2026-11-15T18:14:00Z')), /будущем/);
});

test('mobile report periods use the Bishkek day and inclusive preset boundaries', () => {
  const now = new Date('2026-01-01T21:00:00.000Z');
  assert.deepEqual(json(timing.warehouseReportRange('week', now)), { from: '2025-12-27', to: '2026-01-02' });
  assert.deepEqual(json(timing.warehouseReportRange('lastMonth', now)), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(json(timing.warehouseReportRange('yesterday', now)), { from: '2026-01-01', to: '2026-01-01' });
});
