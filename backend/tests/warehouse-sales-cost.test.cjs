require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const { WarehouseReportsService } = require('../src/warehouse/reports.service.ts');

const d = (value) => new Prisma.Decimal(value);
const movement = (type, change, extra = {}) => ({
  type, sourceType: 'order', sourceId: 'check', orderItemId: 'unknown', saleLineId: null,
  ingredientId: 'ingredient', saleCycle: 0, warehouseKey: 'bar', change: d(change),
  costAtMoment: d(17), costKnown: false, recipeSnapshot: {}, ...extra,
});
const known = movement('sale', -1, { orderItemId: 'known', ingredientId: 'known-product', costAtMoment: d(5), costKnown: true });
async function summarize(movements) {
  const report = new WarehouseReportsService({
    order: { findMany: async () => [{ id: 'check', paymentStatus: 'paid', finalAmount: d(100), serviceChargeAmount: d(0),
      payments: [{ status: 'paid', amount: d(100) }], items: [{ id: 'known' }] }] },
    stockMovement: { findMany: async () => [known, ...movements] },
  });
  return report.salesPerformance({ view: 'sales' });
}

test('fully returned unknown stock does not hide the known cost of the retained paid line', async () => {
  const result = await summarize([movement('sale', -2), movement('return', 2, { orderItemId: 'cancelled-part', saleLineId: 'unknown' })]);
  assert.equal(result.unknownPriceLines, 0);
  assert.equal(result.actualCost, 5);
  assert.equal(result.grossMargin, 95);
  assert.equal(result.complete, true);
});

test('a partial return leaves the surviving unknown consumption incomplete', async () => {
  const result = await summarize([movement('sale', -2), movement('return', 1, { orderItemId: 'cancelled-part', saleLineId: 'unknown' })]);
  assert.equal(result.unknownPriceLines, 1);
  assert.equal(result.actualCost, null);
  assert.equal(result.complete, false);
});

test('physical return plus prepared loss removes the entire unknown portion from sales, without another stock return', async () => {
  const result = await summarize([movement('sale', -2),
    movement('return', 1, { orderItemId: 'unstarted-part', saleLineId: 'unknown' }),
    movement('writeoff', 0, { orderItemId: 'cooked-part', saleLineId: 'unknown', recipeSnapshot: { kind: 'prepared_loss', lossQuantity: '1' } }),
  ]);
  assert.equal(result.unknownPriceLines, 0);
  assert.equal(result.actualCost, 5);
  assert.equal(result.complete, true);
});

test('partial prepared loss leaves the remaining unknown sale incomplete', async () => {
  const result = await summarize([movement('sale', -2),
    movement('writeoff', 0, { orderItemId: 'cooked-part', saleLineId: 'unknown', recipeSnapshot: { kind: 'prepared_loss', lossQuantity: '1' } }),
  ]);
  assert.equal(result.unknownPriceLines, 1);
  assert.equal(result.actualCost, null);
});

test('a returned later cycle cannot clear unknown consumption from an earlier cycle', async () => {
  const result = await summarize([movement('sale', -2),
    movement('sale', -2, { saleCycle: 1, costKnown: true }),
    movement('return', 2, { saleCycle: 1, orderItemId: 'cancelled-later', saleLineId: 'unknown', costKnown: true }),
  ]);
  assert.equal(result.unknownPriceLines, 1);
  assert.equal(result.complete, false);
});

test('a return in another warehouse does not clear an unknown stock route', async () => {
  const result = await summarize([movement('sale', -2),
    movement('sale', -2, { warehouseKey: 'main', costKnown: true }),
    movement('return', 2, { warehouseKey: 'main', orderItemId: 'cancelled-main', saleLineId: 'unknown', costKnown: true }),
  ]);
  assert.equal(result.unknownPriceLines, 1);
  assert.equal(result.complete, false);
});
