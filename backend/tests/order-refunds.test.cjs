require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { Prisma, PrismaClient } = require('@prisma/client');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');
const { recordOrderReceipts } = require('../src/finance/order-receipts.ts');
const { buildRefundPlan } = require('../src/orders/order-refund-plan.ts');
const { allocateCents: allocateRefundCents } = require('../src/orders/order-net.ts');
const { OrderRefundsService } = require('../src/orders/order-refunds.service.ts');
const { TaxesService } = require('../src/settings/taxes.service.ts');
const { tenantPrismaMiddleware, runWithTenant } = require('../src/tenant/tenant-context.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');

const decimal = (value) => new Prisma.Decimal(value);
const fakeOrder = (overrides) => ({
  id: 'order', status: 'paid', paymentStatus: 'paid', finalAmount: decimal('0.05'), refundedAmount: decimal(0),
  roundingAmount: decimal(0), paymentMethod: 'cash', taxes: [], payments: [], fiscalizedAt: null, fiscalReceiptNumber: null,
  items: [{ id: 'item', quantity: 3, refundedQuantity: 0, finalPrice: decimal('0.05'), dishNameSnapshot: 'Product' }],
  ...overrides,
});

test('refunds allocate exact cents without exceeding the original price or tender balances', () => {
  assert.deepEqual(allocateRefundCents(1, [1, 1, 1]), [1, 0, 0]);
  assert.deepEqual(allocateRefundCents(10_000_000_000, [7_000_000_000, 3_000_000_000]), [7_000_000_000, 3_000_000_000]);
  const order = fakeOrder();
  const credits = [];
  for (let count = 0; count < order.items[0].quantity; count++) {
    const plan = buildRefundPlan(order, { itemId: 'item', quantity: 1 });
    credits.push(plan.amount);
    order.items[0].refundedQuantity++;
    order.refundedAmount = order.refundedAmount.add(plan.amount);
    assert.equal(plan.fullyRefunded, count === 2);
  }
  assert.deepEqual(credits, ['0.02', '0.01', '0.02']);
  assert.throws(() => buildRefundPlan(order, { itemId: 'item', quantity: 1 }), { status: 400 });
});

test('historical checks without per-item tax records allow a full refund with the original tax amounts', () => {
  const tax = { taxId: 'legacy', name: 'Налог', rate: decimal(10), type: 'turnover', salesAmount: decimal('0.03'),
    amount: decimal('0.01'), itemAmounts: null };
  const order = fakeOrder({ taxes: [tax] });
  assert.throws(() => buildRefundPlan(order, { itemId: 'item' }), { status: 409 });
  assert.deepEqual(buildRefundPlan(order, {}).taxReversals, [{
    taxId: tax.taxId, name: tax.name, type: tax.type, rate: '10', salesAmount: '0.03', amount: '0.01',
  }]);
});

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: a server requests a refund and an administrator can reject, approve or complete it once', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const { id: cafeId } = await db.cafe.create({ data: { name: 'Refund QA ' + randomUUID() } });
  const logs = [], events = [];
  const audit = { log: async (entry) => logs.push(entry) };
  const service = new OrderRefundsService(db, audit, {
    emitToAdmin: (name, data) => events.push({ name, data }),
    emitToWaiter: () => {},
  }, new IngredientStockService());
  try {
    await runWithTenant({ cafeId }, async () => {
      const users = await Promise.all(['WAITER', 'WAITER', 'ADMIN'].map((role) => db.user.create({
        data: { cafeId, name: role, phone: randomUUID(), passwordHash: 'fixture', role },
      })));
      const [waiter, otherWaiter, administrator] = users.map((user) => ({
        ...user, permissions: getDefaultPermissionsByRole(user.role),
      }));
      const hall = await db.hall.create({ data: { cafeId, name: 'Test hall' } });
      const table = await db.table.create({ data: { cafeId, hallId: hall.id, number: 1, status: 'occupied' } });
      const now = new Date();
      const order = await db.order.create({
        data: { cafeId, orderNumber: 'QA', tableId: table.id, waiterId: waiter.id, status: 'paid', paymentStatus: 'paid',
          paymentMethod: 'mixed', finalAmount: '100.00', totalAmount: '100.01', roundingAmount: '0.01', closedAt: now,
          fiscalizedAt: now, fiscalReceiptNumber: 'SALE-001' },
      });
      const bottle = await db.orderItem.create({ data: { cafeId, orderId: order.id, dishNameSnapshot: 'Bottle',
        quantity: 2, finalPrice: '80.00', priceSnapshot: '40.00', status: 'served', prepStation: 'none' } });
      const food = await db.orderItem.create({ data: { cafeId, orderId: order.id, dishNameSnapshot: 'Food',
        quantity: 1, finalPrice: '20.01', priceSnapshot: '20.01', status: 'served' } });
      const products = await Promise.all(['Goods stock', 'Prepared ingredient'].map((name) => db.ingredient.create({
        data: { cafeId, name, stock: 3, avgCost: 1, valuationKnown: true },
      })));
      await db.stockMovement.createMany({ data: [bottle, food].map((item, index) => ({
        cafeId, orderItemId: item.id, sourceId: order.id, sourceType: 'order', ingredientId: products[index].id, type: 'sale',
        beforeStock: 3 + item.quantity, change: -item.quantity, afterStock: 3, costAtMoment: 1, costKnown: true,
        saleQuantity: item.quantity, recipeSnapshot: { kind: index === 0 ? 'direct' : 'recipe' },
      })) });
      await db.orderTax.create({ data: { cafeId, orderId: order.id, taxId: randomUUID(), type: 'turnover', name: 'Налог',
        rate: 10, salesAmount: 80, amount: 8, soldAt: now, fiscalizedAt: now, itemAmounts: { [bottle.id]: '80' } } });
      await db.payment.createMany({ data: [
        { cafeId, cashierId: waiter.id, orderId: order.id, method: 'cash', amount: 70 },
        { cafeId, cashierId: waiter.id, orderId: order.id, method: 'card', amount: 30 },
      ] });
      await db.$transaction((tx) => recordOrderReceipts(tx, cafeId, order.id, waiter.id, now));

      await assert.rejects(service.quote(otherWaiter, order.id, {}), { status: 403 });
      await assert.rejects(service.pending(waiter), { status: 403 });
      const limited = { ...administrator, permissions: { ...administrator.permissions,
        actions: { ...administrator.permissions.actions, refundChecks: false } } };
      await assert.rejects(service.pending(limited), { status: 403 });
      const requested = { itemId: bottle.id, quantity: 1 };
      const quote = await service.quote(waiter, order.id, requested);
      assert.equal(quote.amount, '40.00');
      assert.deepEqual(quote.paymentParts.map(({ method, amount }) => [method, amount]).sort(), [['card', '12.00'], ['cash', '28.00']]);
      const input = { ...requested, requestId: randomUUID(), reason: 'Guest returned an unopened bottle', quoteVersion: quote.version };
      const first = await service.create(waiter, order.id, input, false);
      assert.equal(first.status, 'pending');
      assert.equal((await service.create(waiter, order.id, input, false)).id, first.id);
      await assert.rejects(service.create(waiter, order.id, { ...input, reason: 'A different reason' }, false), { status: 409 });
      await assert.rejects(service.create(waiter, order.id, { ...input, quantity: 2 }, false), { status: 409 });
      assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).refundedAmount.toString(), '0');
      assert.equal(await db.financeEntry.count({ where: { cafeId, kind: 'refund' } }), 0);
      await assert.rejects(service.create(waiter, order.id, { ...input, requestId: randomUUID() }, false), { status: 409 });
      assert.equal((await service.decide(administrator, first.id, 'rejected')).status, 'rejected');
      assert.equal(await db.financeEntry.count({ where: { cafeId, kind: 'refund' } }), 0);

      const second = await service.create(waiter, order.id, { ...input, requestId: randomUUID() }, false);
      await assert.rejects(service.decide(waiter, second.id, 'approved', {}), { status: 403 });
      await assert.rejects(service.decide(administrator, second.id, 'approved', {}), { status: 400 });
      await assert.rejects(service.decide(administrator, second.id, 'approved', { fundsReturned: true }), { status: 400 });
      assert.equal((await service.pending(administrator)).length, 1);
      const approval = { fundsReturned: true, fiscalRefundReference: 'RETURN-001', restockGoods: true };
      const approved = await Promise.all([0, 1].map(() => service.decide(administrator, second.id, 'approved', approval)));
      assert.deepEqual(approved.map(({ status }) => status), ['approved', 'approved']);
      assert.equal(await db.financeEntry.count({ where: { cafeId, kind: 'refund' } }), 2);
      const partial = await db.orderItem.findUniqueOrThrow({ where: { id: bottle.id } });
      assert.equal(partial.refundedQuantity, 1);
      assert.equal(partial.quantity, 2);
      assert.equal(partial.status, 'served');
      assert.equal(partial.updatedAt.toISOString(), bottle.updatedAt.toISOString());
      assert.equal((await db.ingredient.findUniqueOrThrow({ where: { id: products[0].id } })).stock.toString(), '4');

      const rest = await service.quote(administrator, order.id, {});
      assert.equal(rest.amount, '60.00');
      const direct = { requestId: randomUUID(), reason: 'Return the remaining items', quoteVersion: rest.version,
        approval: { fundsReturned: true, fiscalRefundReference: 'RETURN-002', restockGoods: true } };
      assert.equal((await service.create(administrator, order.id, direct, true)).status, 'approved');
      assert.equal((await service.create(administrator, order.id, direct, true)).status, 'approved');
      const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      assert.equal(after.status, 'paid');
      assert.equal(after.paymentStatus, 'refunded');
      assert.equal(after.finalAmount.toString(), '100');
      assert.equal(after.refundedAmount.toString(), '100');
      assert.equal(after.fiscalReceiptNumber, 'SALE-001');
      assert.equal((await db.table.findUniqueOrThrow({ where: { id: table.id } })).status, 'occupied');
      assert.equal((await db.ingredient.findUniqueOrThrow({ where: { id: products[0].id } })).stock.toString(), '5');
      assert.equal((await db.ingredient.findUniqueOrThrow({ where: { id: products[1].id } })).stock.toString(), '3');
      const payments = await db.payment.findMany({ where: { orderId: order.id }, orderBy: { amount: 'asc' } });
      assert.deepEqual(payments.map(({ amount, refundedAmount, status }) => [String(amount), String(refundedAmount), status]),
        [['30', '30', 'paid'], ['70', '70', 'paid']]);
      const journal = await db.financeEntry.aggregate({ where: { cafeId, kind: 'refund' }, _sum: { amount: true } });
      assert.equal(journal._sum.amount.toString(), '-100');
      const tax = (await new TaxesService(db, audit).report({ kind: 'reversal' }))[0];
      assert.equal(tax.salesAmount.toString(), '-80');
      assert.equal(tax.amount.toString(), '-8');
      assert.equal((await service.pending(administrator)).length, 0);
      assert.equal(logs.filter((log) => log.metadata.status === 'approved').length, 2);
      assert.ok(events.some(({ name }) => name === 'order:refund_updated'));
      await assert.rejects(service.quote(waiter, order.id, {}), { status: 409 });
      const outsider = { ...administrator, cafeId: randomUUID() };
      await assert.rejects(runWithTenant({ cafeId: outsider.cafeId }, () => service.history(outsider, order.id)), { status: 404 });
    });
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.stockMovement.deleteMany({ where: { cafeId } });
    await db.order.deleteMany({ where: { cafeId } });
    await db.ingredient.deleteMany({ where: { cafeId } });
    await db.table.deleteMany({ where: { cafeId } });
    await db.hall.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
