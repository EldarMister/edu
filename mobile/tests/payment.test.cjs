const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, '../src/utils/payment.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const payment = {};
new Function('exports', compiled.outputText)(payment);
const { moneyCents, mixedTender } = payment;

test('payment input accepts comma decimals and distinguishes zero from invalid input', () => {
  assert.equal(moneyCents('15,02'), 1502);
  assert.equal(moneyCents('0'), 0);
  assert.equal(moneyCents(''), null);
  assert.equal(moneyCents('12.345'), null);
  assert.equal(moneyCents('-2.00'), null);
});

test('cash and card settle exact cents, with change computed on cash only', () => {
  assert.deepEqual(mixedTender(10039, { cash: '80.00', card: '40.30', qr: '10.00' }, ['cash', 'card']),
    { cashAmount: 60.09, cardAmount: 40.30, qrAmount: 0, change: 19.91 });
  assert.equal(mixedTender(10039, { cash: '60.08', card: '40.30', qr: '' }, ['cash', 'card']), null);
  assert.equal(mixedTender(10039, { cash: '60.09', card: '40.30', qr: '' }, ['cash']), null);
  assert.equal(mixedTender(10039, { cash: '', card: '40.30', qr: '60.10' }, ['qr', 'card']), null);
  assert.deepEqual(mixedTender(10039, { cash: '', card: '40.30', qr: '60.09' }, ['qr', 'card']),
    { cashAmount: 0, cardAmount: 40.30, qrAmount: 60.09, change: 0 });
});
