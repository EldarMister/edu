const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/refunds/refundRules.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleContext = { exports: {} };
vm.runInNewContext(code, moduleContext);
const { canRefundOrder, canConfirmRefund, refundableQuantity, refundStatusLabel } = moduleContext.exports;

test('refunds use only paid orders and subtract prior refunds by item', () => {
  assert.equal(canRefundOrder({ status: 'paid', paymentStatus: 'paid' }), true);
  assert.equal(canRefundOrder({ status: 'waiting_payment' }), false);
  assert.equal(canRefundOrder({ status: 'paid', paymentStatus: 'refunded' }), false);
  assert.equal(refundableQuantity({ status: 'served', quantity: 4, refundedQuantity: 2 }), 2);
  assert.equal(refundableQuantity({ status: 'cancelled', quantity: 4 }), 0);
  assert.equal(refundableQuantity({ status: 'rejected', quantity: 4 }), 0);
  assert.equal(refundableQuantity({ status: 'served', quantity: 2, refundedQuantity: 2 }), 0);
});

test('fiscal refunds require both a monetary acknowledgement and the KKM receipt reference', () => {
  const quote = { requireFiscalReference: true, paymentParts: [{ method: 'cash', amount: '100.00' }] };
  assert.equal(canConfirmRefund(quote, { fiscalRefundReference: '10' }), false);
  assert.equal(canConfirmRefund(quote, { fundsReturned: true, fiscalRefundReference: ' ' }), false);
  assert.equal(canConfirmRefund(quote, { fundsReturned: true, fiscalRefundReference: '10' }), true);
  assert.equal(canConfirmRefund({ requireFiscalReference: false, paymentParts: [] }, {}), true);
});

test('refund status distinguishes complete and partial returns', () => {
  assert.equal(refundStatusLabel({ paymentStatus: 'refunded', refundedAmount: '200.00' }), 'Возвращён');
  assert.equal(refundStatusLabel({ paymentStatus: 'paid', refundedAmount: '100.00' }), 'Частичный возврат');
  assert.equal(refundStatusLabel({ paymentStatus: 'paid', refundedAmount: '0.00' }), undefined);
});
