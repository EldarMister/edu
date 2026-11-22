require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Prisma } = require('@prisma/client');
const XLSX = require('xlsx');
const { calculateSaleTaxes, recordOrderTaxes, dishTaxFields } = require('../src/settings/order-taxes.ts');
const { TaxesService } = require('../src/settings/taxes.service.ts');
const { writeGoodsWorkbook } = require('../src/admin/goods-xlsx.ts');
const { runWithTenant } = require('../src/tenant/tenant-context.ts');

const decimal = (value) => new Prisma.Decimal(value);
const vat = { id: 'vat', cafeId: 'cafe', name: 'НДС', type: 'vat', rate: decimal(12) };
const turnover = { id: 'turnover', cafeId: 'cafe', name: 'Налог с оборота', type: 'turnover', rate: decimal(4) };

test('VAT and turnover are calculated from prices after discounts and rounded once per rate', () => {
  const rows = calculateSaleTaxes([
    { rate: vat, salesAmount: decimal('79.99') },
    { rate: vat, salesAmount: decimal('32.01') },
    { rate: turnover, salesAmount: decimal('37.49') },
    { rate: turnover, salesAmount: decimal('0') },
  ]);
  assert.deepEqual(rows.map((row) => [row.taxId, String(row.salesAmount), String(row.amount)]),
    [['vat', '112', '12'], ['turnover', '37.49', '1.5']]);
  const [grouped] = calculateSaleTaxes([{ rate: vat, salesAmount: decimal('0.04') }, { rate: vat, salesAmount: decimal('0.04') }]);
  assert.equal(String(grouped.amount), '0.01');
});

test('at payment a dish inherits the category rate, overrides it or can be exempt', async () => {
  let snapshot;
  const foreign = { ...vat, cafeId: 'another' };
  const tx = {
    settings: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { cafeId: 'cafe' });
      return { taxesEnabled: true };
    } },
    dish: { findMany: async () => [
      { id: 'inherit', taxExempt: false, tax: null, category: { tax: vat } },
      { id: 'override', taxExempt: false, tax: turnover, category: { tax: vat } },
      { id: 'exempt', taxExempt: true, tax: null, category: { tax: vat } },
      { id: 'foreign', taxExempt: false, tax: foreign, category: { tax: null } },
    ] },
    orderTax: { createMany: async ({ data }) => { snapshot = data; } },
  };
  const soldAt = new Date('2026-11-21T12:00:00+06:00');
  const item = (dishId, finalPrice, status = 'served') => ({ id: 'line-' + dishId, dishId, finalPrice: decimal(finalPrice), status });
  await recordOrderTaxes(tx, 'order', 'cafe',
    [item('inherit', '112'), item('override', '50'), item('exempt', '70'), item('foreign', '20'), item('inherit', '20', 'cancelled')],
    soldAt);
  assert.deepEqual(snapshot.map((row) => [row.taxId, String(row.amount), row.soldAt]), [['vat', '12', soldAt], ['turnover', '2', soldAt]]);
  assert.deepEqual(snapshot.map((row) => row.itemAmounts), [{ 'line-inherit': '112' }, { 'line-override': '50' }]);
  await recordOrderTaxes(tx, 'order', 'cafe',
    [item('exempt', '0.67'), item('inherit', '0.67'), item('override', '0.67')], soldAt, decimal(2));
  assert.deepEqual(snapshot.map((row) => [row.taxId, String(row.salesAmount), row.itemAmounts]), [
    ['vat', '0.67', { 'line-inherit': '0.67' }], ['turnover', '0.66', { 'line-override': '0.66' }],
  ]);
  await recordOrderTaxes({ settings: { findFirst: async () => ({ taxesEnabled: false }) } }, 'order', 'cafe', [item('inherit', '112')], soldAt);
});

test('a rate must belong to the current cafe and clearing a rate restores inheritance', async () => {
  const tx = { menuTax: { findFirst: async ({ where }) => {
    assert.equal(where.cafeId, 'cafe');
    return where.id === 'vat' ? vat : null;
  } } };
  await runWithTenant({ cafeId: 'cafe' }, async () => {
    await assert.rejects(dishTaxFields(tx, { taxId: 'foreign' }), /Налог не найден/);
    assert.deepEqual(await dishTaxFields(tx, { taxId: 'vat' }), { taxId: 'vat', taxExempt: false });
    assert.deepEqual(await dishTaxFields(tx, { taxId: null }), { taxId: null, taxExempt: false });
    assert.deepEqual(await dishTaxFields(tx, { taxExempt: true }), { taxId: null, taxExempt: true });
  });
});

test('a reversal belongs to its own business day and uses the original rate and amount', async () => {
  const entry = {
    taxId: vat.id, name: vat.name, rate: vat.rate, type: vat.type,
    salesAmount: decimal(112), amount: decimal(12),
    soldAt: new Date('2026-11-20T23:55:00+06:00'),
    reversedAt: new Date('2026-11-21T00:05:00+06:00'),
    fiscalizedAt: new Date('2026-11-20T23:56:00+06:00'),
  };
  const service = new TaxesService({ orderTax: { findMany: async ({ where }) => {
    assert.equal(where.cafeId, 'cafe');
    return [entry];
  } }, orderRefund: { findMany: async () => [] } }, {});
  await runWithTenant({ cafeId: 'cafe' }, async () => {
    const sale = await service.report({ from: '2026-11-20', to: '2026-11-20' });
    const reversal = await service.report({ from: '2026-11-21', to: '2026-11-21' });
    assert.deepEqual(sale.map((row) => [row.kind, row.rate, String(row.amount)]), [['fiscal', 12, '12']]);
    assert.deepEqual(reversal.map((row) => [row.kind, row.rate, String(row.amount)]), [['reversal', 12, '-12']]);
  });
});

function workbookRows(buffer) {
  const book = XLSX.read(buffer, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
}

test('tax statistics separate refunds backed by a KKM receipt from ordinary and test refunds', async () => {
  const reversal = { taxId: vat.id, name: vat.name, rate: '12', type: vat.type, salesAmount: '56', amount: '6' };
  const service = new TaxesService({
    orderTax: { findMany: async () => [] },
    orderRefund: { findMany: async ({ where, select }) => {
      assert.equal(where.cafeId, 'cafe');
      assert.equal(where.status, 'approved');
      assert.equal(select.fiscalRefundReference, true);
      return ['123', null, 'MOCK-123'].map((fiscalRefundReference) => ({ fiscalRefundReference, taxReversals: [reversal] }));
    } },
  }, {});
  const summary = (rows) => rows.map(({ kind, operation, amount }) => [kind, operation, String(amount)]);
  await runWithTenant({ cafeId: 'cafe' }, async () => {
    assert.deepEqual(summary(await service.report({ kind: 'reversal' })), [
      ['reversal', 'fiscalReversal', '-6'], ['reversal', 'nonFiscalReversal', '-12'],
    ]);
    assert.deepEqual(summary(await service.report({ kind: 'fiscalReversal' })), [['reversal', 'fiscalReversal', '-6']]);
    assert.deepEqual(summary(await service.report({ kind: 'nonFiscalReversal' })), [['reversal', 'nonFiscalReversal', '-12']]);
    const [, reportRow] = workbookRows(await service.exportReport({ kind: 'fiscalReversal' }));
    assert.deepEqual(reportRow.slice(3), ['Возврат с чеком ККМ', -56, -6]);
  });
});

test('goods export matches tax sorting, with no-tax and exempt products before taxed products', () => {
  const item = (name, taxId, inheritedTax, taxExempt = false) => ({
    name, taxId, taxExempt, category: { name: 'Категория', taxId: inheritedTax },
    goodsUnits: [], variants: [],
  });
  const goods = [item('Абрикос', 'vat', null), item('Банан', null, 'vat'), item('Вода', null, null), item('Груша', null, 'vat', true)];
  const taxes = new Map([[vat.id, vat.name]]);
  const order = (taxSort) => workbookRows(writeGoodsWorkbook(goods, { taxSort }, ['name', 'tax'], new Map(), taxes))
    .slice(1).map(([name]) => name);
  assert.deepEqual(order('asc'), ['Вода', 'Груша', 'Абрикос', 'Банан']);
  assert.deepEqual(order('desc'), ['Абрикос', 'Банан', 'Вода', 'Груша']);
});
