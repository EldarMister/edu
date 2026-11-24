require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const { Prisma } = require('@prisma/client');
const { buildStatisticsReports } = require('../src/admin/statistics-reports.ts');
const { StatisticsService } = require('../src/admin/statistics.service.ts');
const { StatisticsController } = require('../src/admin/statistics.controller.ts');
const { AdminOrdersService } = require('../src/admin/admin-orders.service.ts');
const { warehouseDay } = require('../src/warehouse/report-range.ts');

const item = {
  id: 'espresso', dishId: 'coffee', dishVariantId: 'double', dishNameSnapshot: 'Эспрессо',
  dishVariantNameSnapshot: 'Двойной', quantity: 2, priceSnapshot: 30, discountAmount: 5, finalPrice: 55,
  dish: { category: { id: 'coffee-category', name: 'Кофе' } },
};
const order = {
  id: 'order-a', waiterId: 'alice', waiter: { name: 'Алиса' },
  createdAt: new Date('2026-11-15T17:59:30Z'), closedAt: new Date('2026-11-15T18:00:30Z'),
  finalAmount: 60, discountAmount: 5, serviceChargeAmount: 5, paymentMethod: 'mixed',
  payments: [{ method: 'cash', amount: 20, status: 'paid' }, { method: 'card', amount: 40, status: 'paid' },
    { method: 'qr', amount: 60, status: 'refunded' }],
  items: [item],
  taxes: [],
  refunds: [],
};
const movement = {
  type: 'sale', sourceType: 'order', sourceId: order.id, orderItemId: item.id, saleLineId: null,
  saleCycle: 0, warehouseKey: 'bar', ingredientId: 'beans', change: -20,
  costAtMoment: 0.4, costKnown: true,
};

test('daily sales, payment splits and report dimensions aggregate the same closed check in Bishkek', () => {
  const result = buildStatisticsReports([order], [movement], true);
  assert.deepEqual(result.sales, [{ date: '2026-11-16', orders: 1, paidAmount: 60, refundedAmount: 0, revenue: 60, discount: 5, avgCheck: 60 }]);
  assert.deepEqual(result.payments, [{ date: '2026-11-16', orders: 1, cash: 20, card: 40, qr: 0, other: 0, total: 60 }]);
  const [{ productKey, variantKey, baseName, costBasis, profitBasis, ...product }] = result.products;
  assert.deepEqual([baseName, costBasis, profitBasis], ['Эспрессо', 8, 47]);
  assert.equal(typeof productKey, 'string');
  assert.equal(typeof variantKey, 'string');
  assert.deepEqual({ ...product, id: undefined }, { id: undefined, name: 'Эспрессо · Двойной',
    categoryId: 'coffee-category', category: 'Кофе', waiterId: 'alice', waiter: 'Алиса', quantity: 2,
    gross: 60, discount: 5, revenue: 55, cost: 8, profit: 47 });
  assert.deepEqual(result.categories, [{ id: 'coffee-category', name: 'Кофе', quantity: 2, revenue: 55, cost: 8, tax: 0, profit: 47 }]);
  assert.deepEqual(result.staff, [{ id: 'alice', name: 'Алиса', orders: 1, revenue: 60, avgCheck: 60, avgSeconds: 60, profit: 52 }]);
});

test('sold product rows identify the same dish and variant across waiters without losing sale evidence', () => {
  const other = { ...order, id: 'order-b', waiterId: 'bob', waiter: { name: 'Борис' }, items: [{ ...item, id: 'other-espresso' }] };
  const single = { ...item, id: 'single', dishVariantId: 'single', dishVariantNameSnapshot: 'Одинарный' };
  const variant = { ...order, id: 'order-c', items: [single] };
  const [first, second, third] = buildStatisticsReports([order, other, variant], [], false).products;
  assert.equal(first.productKey, second.productKey);
  assert.equal(first.productKey, third.productKey);
  assert.equal(first.variantKey, second.variantKey);
  assert.notEqual(first.variantKey, third.variantKey);
  assert.notEqual(first.id, second.id);
  assert.equal(first.costBasis, null);
  assert.equal(first.profitBasis, null);
});

test('costs follow split line origin and return; historical payment fallback retains disabled methods', () => {
  const remainder = { ...item, id: 'espresso-return-remnant', quantity: 1, finalPrice: 30, stockSourceLineId: item.id };
  const returned = { ...movement, type: 'return', orderItemId: 'cancelled', saleLineId: item.id, change: 10 };
  const legacy = { ...order, items: [remainder], finalAmount: 30, serviceChargeAmount: 0, payments: [], paymentMethod: 'qr' };
  const result = buildStatisticsReports([legacy], [movement, returned], true);
  assert.equal(result.products[0].cost, 4);
  assert.equal(result.payments[0].qr, 30);
  assert.equal(result.payments[0].total, 30);
});

test('profit subtracts recorded tax and restores the refunded part without taxing exempt products', () => {
  const exempt = { ...item, id: 'exempt', dishId: 'water', dishNameSnapshot: 'Вода',
    dishVariantNameSnapshot: null, quantity: 1, finalPrice: 20 };
  const taxable = { ...item, refundedQuantity: 1 };
  const recorded = { ...order, finalAmount: 75, serviceChargeAmount: 0, refundedAmount: 27.5, items: [taxable, exempt],
    taxes: [{ taxId: 'vat', amount: new Prisma.Decimal(6), salesAmount: new Prisma.Decimal(55), itemAmounts: { [item.id]: '55' } }],
    refunds: [{ taxReversals: [{ taxId: 'vat', amount: '3' }] }],
  };
  const waterCost = { ...movement, orderItemId: exempt.id, change: -1, costAtMoment: 2 };
  const returned = { ...movement, type: 'return', change: 10, saleLineId: item.id };
  const { products, categories, staff } = buildStatisticsReports([recorded], [movement, returned, waterCost], true);
  assert.deepEqual(products.map(({ name, profit }) => [name, profit]), [['Эспрессо · Двойной', 20.5], ['Вода', 18]]);
  assert.equal(categories[0].tax, 3);
  assert.equal(categories[0].profit, 38.5);
  assert.equal(staff[0].profit, 38.5);

  const legacy = { ...recorded, taxes: [{ ...recorded.taxes[0], itemAmounts: null }] };
  const legacyReport = buildStatisticsReports([legacy], [movement, returned, waterCost], true);
  assert.ok(legacyReport.products.every(({ profit }) => profit === null));
  assert.equal(legacyReport.categories[0].tax, null);
  assert.equal(legacyReport.staff[0].profit, 38.5);
});

test('split check rounding and partial mixed refund reconcile across payment methods and item reports', async () => {
  const check = { ...order, finalAmount: 98.99, refundedAmount: 33, serviceChargeAmount: 0,
    payments: [
      { method: 'cash', status: 'paid', amount: 60, refundedAmount: 20 },
      { method: 'card', status: 'paid', amount: 38.99, refundedAmount: 13 },
    ],
    items: [
      { ...item, priceSnapshot: 33.33, finalPrice: 66.66, refundedQuantity: 1, discountAmount: 0 },
      { ...item, id: 'dessert', dishId: 'cake', dishNameSnapshot: 'Торт', dishVariantNameSnapshot: null,
        priceSnapshot: 33.33, quantity: 1, finalPrice: 33.33, discountAmount: 0 },
    ],
  };
  const result = buildStatisticsReports([check], [], false);
  assert.deepEqual(result.products.map(({ name, revenue }) => [name, revenue]), [['Торт', 33], ['Эспрессо · Двойной', 32.99]]);
  assert.deepEqual([result.sales[0].paidAmount, result.sales[0].refundedAmount, result.sales[0].revenue], [98.99, 33, 65.99]);
  assert.equal(result.categories[0].revenue, 65.99);
  assert.equal(result.staff[0].revenue, 65.99);
  assert.equal(result.payments[0].total, 65.99);

  const statistics = new StatisticsService({
    order: {
      findMany: async ({ select }) => select.items ? [check] : [],
      aggregate: async () => ({ _sum: {}, _count: 0 }),
    },
  }, { enabledMethods: async () => ['cash'] });
  const overview = await statistics.dashboard({ period: 'custom', from: '2026-11-16', to: '2026-11-16' });
  assert.deepEqual(overview.peakHours, [{ hour: '00:00', amount: 65.99, orders: 1 }]);
  assert.deepEqual(overview.topDishes.map(({ name, amount }) => [name, amount]), [['Торт', 33], ['Эспрессо · Двойной', 32.99]]);
  assert.deepEqual(overview.paymentMethods, [{ method: 'cash', amount: 40, percent: 61 }, { method: 'card', amount: 25.99, percent: 39 }]);
});

test('missing or restricted stock prices surface as null instead of claiming zero cost', () => {
  for (const result of [
    buildStatisticsReports([order], [], true),
    buildStatisticsReports([order], [{ ...movement, costKnown: false }], true),
    buildStatisticsReports([order], [movement], false),
  ]) {
    assert.equal(result.products[0].cost, null);
    assert.equal(result.categories[0].profit, null);
    assert.equal(result.staff[0].profit, null);
  }
});

test('custom report date boundaries filter closed paid checks and skip warehouse queries without cost permission', async () => {
  let filter;
  const statistics = new StatisticsService({
    $transaction: (callback) => callback({
      order: { findMany: async ({ where }) => { filter = where; return [order]; } },
      stockMovement: { findMany: async () => { throw new Error('cost data must not be loaded'); } },
    }),
  }, {});
  const result = await statistics.reports({ period: 'custom', from: '2026-11-16', to: '2026-11-16' }, false);
  assert.equal(filter.status, 'paid');
  assert.deepEqual(filter.closedAt, { gte: new Date('2026-11-15T18:00:00Z'), lt: new Date('2026-11-16T18:00:00Z') });
  assert.equal(result.sales[0].orders, 1);
  assert.equal(result.products[0].cost, null);
});

test('cost fields require warehouse report access for delegated administrators', () => {
  const controller = new StatisticsController({ reports: (_, costs) => costs });
  const admin = { role: 'ADMIN', permissions: {
    sections: { statistics: true, warehouse: true }, actions: { warehouseCosts: true, warehouseReports: true },
  } };
  assert.equal(controller.reports({}, admin), true);
  assert.equal(controller.reports({}, { ...admin, permissions: { ...admin.permissions,
    actions: { warehouseCosts: true, warehouseReports: false } } }), false);
  assert.equal(controller.reports({}, { role: 'OWNER' }), true);
});

test('yesterday uses Bishkek business days and receipt drill-down uses the same closing date', async () => {
  const today = new Date(warehouseDay(new Date()) + 'T00:00:00+06:00');
  const yesterday = new Date(+today - 86_400_000);
  let reportWhere;
  const reportService = new StatisticsService({
    $transaction: (callback) => callback({ order: { findMany: async ({ where }) => { reportWhere = where; return []; } } }),
  }, {});
  await reportService.reports({ period: 'yesterday' }, false);
  assert.deepEqual(reportWhere, { status: 'paid', closedAt: { gte: yesterday, lt: today } });

  let receiptQuery;
  const orders = new AdminOrdersService({ order: {
    findMany: async (query) => { receiptQuery = query; return []; }, count: async () => 0,
  } });
  const day = warehouseDay(yesterday);
  await orders.list({ tab: 'paid', dateField: 'closed', dateFrom: day, dateTo: day });
  assert.deepEqual(receiptQuery.where, { status: 'paid', closedAt: { gte: yesterday, lte: new Date(+today - 1) } });
  assert.deepEqual(receiptQuery.orderBy, { closedAt: 'desc' });
});
