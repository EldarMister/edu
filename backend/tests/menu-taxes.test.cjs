require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Prisma } = require('@prisma/client');
const { calculateSaleTaxes, recordOrderTaxes, dishTaxFields } = require('../src/settings/order-taxes.ts');
const { TaxesService } = require('../src/settings/taxes.service.ts');
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
  const item = (dishId, finalPrice, status = 'served') => ({ dishId, finalPrice: decimal(finalPrice), status });
  const soldAt = new Date('2026-11-21T12:00:00+06:00');
  await recordOrderTaxes(tx, 'order', 'cafe',
    [item('inherit', '112'), item('override', '50'), item('exempt', '70'), item('foreign', '20'), item('inherit', '20', 'cancelled')],
    soldAt);
  assert.deepEqual(snapshot.map((row) => [row.taxId, String(row.amount), row.soldAt]), [['vat', '12', soldAt], ['turnover', '2', soldAt]]);
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
  } } }, {});
  await runWithTenant({ cafeId: 'cafe' }, async () => {
    const sale = await service.report({ from: '2026-11-20', to: '2026-11-20' });
    const reversal = await service.report({ from: '2026-11-21', to: '2026-11-21' });
    assert.deepEqual(sale.map((row) => [row.kind, row.rate, String(row.amount)]), [['fiscal', 12, '12']]);
    assert.deepEqual(reversal.map((row) => [row.kind, row.rate, String(row.amount)]), [['reversal', 12, '-12']]);
  });
});
