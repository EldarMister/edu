require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildStatisticsReports } = require('../src/admin/statistics-reports.ts');
const { StatisticsService } = require('../src/admin/statistics.service.ts');
const { StatisticsController } = require('../src/admin/statistics.controller.ts');

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
};
const movement = {
  type: 'sale', sourceType: 'order', sourceId: order.id, orderItemId: item.id, saleLineId: null,
  saleCycle: 0, warehouseKey: 'bar', ingredientId: 'beans', change: -20,
  costAtMoment: 0.4, costKnown: true,
};

test('daily sales, payment splits and report dimensions aggregate the same closed check in Bishkek', () => {
  const result = buildStatisticsReports([order], [movement], true);
  assert.deepEqual(result.sales, [{ date: '2026-11-16', orders: 1, revenue: 60, discount: 5, avgCheck: 60 }]);
  assert.deepEqual(result.payments, [{ date: '2026-11-16', orders: 1, cash: 20, card: 40, qr: 0, other: 0, total: 60 }]);
  const [product] = result.products;
  assert.deepEqual({ ...product, id: undefined }, { id: undefined, name: 'Эспрессо · Двойной',
    categoryId: 'coffee-category', category: 'Кофе', waiterId: 'alice', waiter: 'Алиса', quantity: 2,
    gross: 60, discount: 5, revenue: 55, cost: 8, profit: 47 });
  assert.deepEqual(result.categories, [{ id: 'coffee-category', name: 'Кофе', quantity: 2, revenue: 55, cost: 8, profit: 47 }]);
  assert.deepEqual(result.staff, [{ id: 'alice', name: 'Алиса', orders: 1, revenue: 60, avgCheck: 60, avgSeconds: 60, profit: 52 }]);
});

test('costs follow split line origin and return; historical payment fallback retains disabled methods', () => {
  const remainder = { ...item, id: 'espresso-return-remnant', quantity: 1, finalPrice: 30, stockSourceLineId: item.id };
  const returned = { ...movement, type: 'return', orderItemId: 'cancelled', saleLineId: item.id, change: 10 };
  const legacy = { ...order, items: [remainder], finalAmount: 30, payments: [], paymentMethod: 'qr' };
  const result = buildStatisticsReports([legacy], [movement, returned], true);
  assert.equal(result.products[0].cost, 4);
  assert.equal(result.payments[0].qr, 30);
  assert.equal(result.payments[0].total, 30);
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
