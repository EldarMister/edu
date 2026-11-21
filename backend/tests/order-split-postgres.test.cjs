require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { OrdersService } = require('../src/orders/orders.service.ts');
const { OrderRefundsService } = require('../src/orders/order-refunds.service.ts');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');
const { SettingsService } = require('../src/settings/settings.service.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: split checks keep quantities, stock, pricing, table occupation and history consistent', { skip: !url }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Separate check QA ' + randomUUID() } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const makeUser = (role) => db.user.create({ data: { role, phone: randomUUID(), name: role, passwordHash: 'fixture' } });
      const [waiter, otherWaiter, rawOwner] = await Promise.all([makeUser('WAITER'), makeUser('WAITER'), makeUser('OWNER')]);
      const owner = { ...rawOwner, permissions: getDefaultPermissionsByRole('OWNER') };
      const shifts = { shiftForTerminalOrder: async () => null };
      const sentEvents = [];
      const events = new Proxy({}, { get: (_, scope) => (event, payload) => sentEvents.push({ scope, event, payload }) });
      const audit = { log: async () => {} };
      const push = { notifyRole: async () => {}, notifyUser: async () => {}, notifyWaiter: async () => {} };
      const ingredients = new IngredientsService(db);
      const ingredientStock = new IngredientStockService();
      const settings = new SettingsService(db, audit, events);
      const orders = new OrdersService(db, events, shifts, push, settings, { recalculateDishes: async () => {} }, audit, ingredientStock);
      const refunds = new OrderRefundsService(db, audit, events, ingredientStock);
      const purchases = new PurchasesService(db);
      const [warehouse] = (await new WarehouseLocationsService(db, events).list(cafe.id)).locations;
      await settings.ensure();

      const hall = await db.hall.create({ data: { name: 'Зал' } });
      const category = await db.category.create({ data: { name: 'Напитки', prepStation: 'none' } });
      const goods = await ingredients.create({ name: 'Бутылка', unit: 'pcs', stock: 10, avgCost: 10 });
      const opening = new Date(Date.now() - 60_000);
      await db.ingredient.update({ where: { id: goods.id }, data: { createdAt: opening } });
      await db.stockMovement.updateMany({ where: { ingredientId: goods.id }, data: { createdAt: opening } });
      const bottle = await db.dish.create({ data: {
        name: 'Бутылка', categoryId: category.id, catalogKind: 'goods', stockIngredientId: goods.id, price: '21.40',
      } });
      const bread = await db.dish.create({ data: { name: 'Хлеб', categoryId: category.id, price: '10.70' } });
      let nextTable = 1;
      const newTable = () => db.table.create({ data: { hallId: hall.id, number: nextTable++ } });
      const createCheck = async (table, items) => {
        const raw = await orders.create(waiter, { tableId: table.id, items, idempotencyKey: randomUUID() });
        await orders.served(raw.id, waiter.id);
        return orders.toPayment(raw.id, waiter.id);
      };
      const makeSplit = (order, item, quantity) => ({
        idempotencyKey: randomUUID(), expectedUpdatedAt: order.updatedAt.toISOString(), items: [{ itemId: item.id, quantity }],
      });

      await t.test('concurrent retries create one child, and two splits keep the common stock ledger in sequence', async () => {
        const table = await newTable();
        const original = await createCheck(table, [{ dishId: bottle.id, quantity: 4 }]);
        const [line] = original.items;
        const input = makeSplit(original, line, 1);
        const eventStart = sentEvents.length;
        await assert.rejects(orders.splitCheck(original.id, otherWaiter, input), { status: 403 });
        await assert.rejects(orders.splitCheck(original.id, waiter, makeSplit(original, line, 4)), /Оставьте хотя бы/);
        const [first, retry] = await Promise.all([
          orders.splitCheck(original.id, waiter, input), orders.splitCheck(original.id, waiter, input),
        ]);
        assert.equal(first.newOrder.id, retry.newOrder.id);
        assert.equal(first.newOrder.splitFromOrderId, original.id);
        assert.equal(first.newOrder.items[0].status, 'served');
        assert.equal(first.newOrder.items[0].quantity, 1);
        assert.notEqual(first.newOrder.items[0].id, line.id);
        assert.equal(first.sourceOrder.items[0].quantity, 3);
        assert.equal(+first.sourceOrder.finalAmount, 64.2);
        assert.equal(+first.newOrder.finalAmount, 21.4);
        assert.ok(sentEvents.slice(eventStart).every(({ event }) => event !== 'kitchen:new_order'));
        await assert.rejects(orders.splitCheck(original.id, waiter, { ...input, items: [{ itemId: line.id, quantity: 2 }] }), /Ключ операции/);
        await assert.rejects(orders.splitCheck(original.id, waiter, { ...input, idempotencyKey: randomUUID() }), /Чек изменился/);
        const second = await orders.splitCheck(original.id, waiter, makeSplit(first.sourceOrder, line, 1));
        assert.equal(second.newOrder.splitFromOrderId, original.id);
        assert.equal(new Set([original.orderNumber, first.newOrder.orderNumber, second.newOrder.orderNumber]).size, 3);
        const salesBeforeReceipt = await db.stockMovement.findMany({ where: { ingredientId: goods.id, type: 'sale' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        assert.equal(new Set(salesBeforeReceipt.map(({ createdAt }) => +createdAt)).size, 1);
        assert.deepEqual(salesBeforeReceipt.map((row) => [row.sourceId, +row.beforeStock, +row.afterStock]), [
          [original.id, 10, 8], [second.newOrder.id, 8, 7], [first.newOrder.id, 7, 6],
        ]);
        const effectiveAt = new Date(+salesBeforeReceipt[0].createdAt - 1).toISOString();
        await purchases.create({ supplier: 'Поставщик', warehouseId: warehouse.id, complete: true, effectiveAt,
          items: [{ ingredientId: goods.id, quantity: 10, purchasePrice: 20 }] }, owner);
        const salesAfterReceipt = await db.stockMovement.findMany({ where: { ingredientId: goods.id, type: 'sale' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        assert.deepEqual(salesAfterReceipt.map((row) => [+row.beforeStock, +row.afterStock, +row.costAtMoment]), [
          [20, 18, 15], [18, 17, 15], [17, 16, 15],
        ]);
        const third = await orders.splitCheck(original.id, waiter, makeSplit(second.sourceOrder, line, 1));
        const salesAfterThirdSplit = await db.stockMovement.findMany({ where: { ingredientId: goods.id, type: 'sale' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        assert.deepEqual(salesAfterThirdSplit.map((row) => [row.sourceId, +row.beforeStock, +row.afterStock, +row.costAtMoment]), [
          [original.id, 20, 19, 15], [third.newOrder.id, 19, 18, 15], [second.newOrder.id, 18, 17, 15], [first.newOrder.id, 17, 16, 15],
        ]);

        await orders.markPaid(original.id, waiter, 'cash');
        assert.equal((await db.table.findUniqueOrThrow({ where: { id: table.id } })).status, 'waiting_payment');
        await assert.rejects(orders.closeTable(table.id, waiter), /активный заказ/);
        await assert.rejects(orders.create(waiter, { tableId: table.id, items: [{ dishId: bread.id, quantity: 1 }] }), /активный заказ/);
        await assert.rejects(db.order.create({ data: { tableId: table.id, status: 'ready', orderNumber: '№99999' } }),
          /orders_one_active_family_per_table/);
        await Promise.all([
          orders.markPaid(first.newOrder.id, waiter, 'card'),
          orders.markPaid(second.newOrder.id, waiter, 'cash'),
          orders.markPaid(third.newOrder.id, waiter, 'card'),
        ]);
        assert.equal((await db.table.findUniqueOrThrow({ where: { id: table.id } })).status, 'free');
        const childrenPayments = await db.payment.findMany({ where: { orderId: { in: [first.newOrder.id, second.newOrder.id] } } });
        assert.deepEqual(childrenPayments.map((p) => [p.method, +p.amount]).sort(), [['card', 21.4], ['cash', 21.4]]);
        const quote = await refunds.quote(owner, first.newOrder.id, {});
        assert.equal(quote.amount, '21.40');
        const result = await refunds.create(owner, first.newOrder.id, {
          requestId: randomUUID(), quoteVersion: quote.version, reason: 'Покупатель вернул один товар',
          approval: { fundsReturned: true, restockGoods: true },
        }, true);
        assert.equal(result.status, 'approved');
        assert.equal(+(await db.order.findUniqueOrThrow({ where: { id: original.id } })).refundedAmount, 0);
        assert.equal(+(await db.stockMovement.findFirstOrThrow({
          where: { type: 'return', sourceId: first.newOrder.id, saleLineId: first.newOrder.items[0].id },
        })).costAtMoment, 15);
        assert.equal((await ingredients.findOne(goods.id)).balances.find((row) => row.warehouseId === warehouse.id).stock, 17);
      });

      await t.test('whole-line split preserves original rounding and all unpaid checks move together', async () => {
        await db.settings.updateMany({ data: { roundOrderTotal: true } });
        const table = await newTable();
        const target = await newTable();
        const original = await createCheck(table, [{ dishId: bread.id, quantity: 1 }, { dishId: bottle.id, quantity: 1 }]);
        assert.equal(+original.finalAmount, 32);
        const bottleLine = original.items.find(({ dishId }) => dishId === bottle.id);
        const split = await orders.splitCheck(original.id, waiter, makeSplit(original, bottleLine, 1));
        assert.equal(split.newOrder.items[0].id, bottleLine.id);
        assert.equal(split.sourceOrder.finalAmount.add(split.newOrder.finalAmount).toString(), '32');
        assert.equal(split.sourceOrder.roundingAmount.add(split.newOrder.roundingAmount).toString(), '0.1');
        const selection = { id: { in: [original.id, split.newOrder.id] } };
        await orders.transferTable(table.id, otherWaiter.id, waiter);
        assert.equal(await db.order.count({ where: { ...selection, waiterId: otherWaiter.id } }), 2);
        await orders.moveTable(table.id, target.id, otherWaiter);
        assert.equal(await db.order.count({ where: { ...selection, tableId: target.id } }), 2);
        assert.equal((await db.table.findUniqueOrThrow({ where: { id: table.id } })).status, 'free');
        await orders.cancelReadyItem(split.newOrder.id, bottleLine.id, owner, 'Товар отменён');
        assert.equal((await db.table.findUniqueOrThrow({ where: { id: target.id } })).status, 'waiting_payment');
        await orders.cancelOrder(original.id, owner, 'Покупатель ушёл');
        assert.equal((await db.table.findUniqueOrThrow({ where: { id: target.id } })).status, 'free');

        // Platform cleanup deletes an entire cafe's orders in one statement.
        await assert.rejects(db.order.delete({ where: { id: original.id } }), { code: 'P2003' });
        const deleted = await db.order.deleteMany({ where: selection });
        assert.equal(deleted.count, 2);
      });

      await t.test('a prepared dish moves after serving without a duplicate kitchen job or ingredient return', async () => {
        const kitchen = await makeUser('KITCHEN');
        const table = await newTable();
        const meals = await db.category.create({ data: { name: 'Горячее', prepStation: 'kitchen' } });
        const ingredient = await ingredients.create({ name: 'Мука', unit: 'g', stock: 1000, avgCost: '0.05' });
        const dish = await db.dish.create({ data: { categoryId: meals.id, name: 'Лепёшка', price: '75' } });
        await db.recipeItem.create({ data: { dishId: dish.id, ingredientId: ingredient.id, amount: 150 } });
        const order = await orders.create(waiter, { tableId: table.id, items: [
          { dishId: dish.id, quantity: 1 }, { dishId: bread.id, quantity: 1 },
        ] });
        const dishLine = order.items.find(({ dishId }) => dishId === dish.id);
        await assert.rejects(orders.splitCheck(order.id, waiter, makeSplit(order, dishLine, 1)), /после подачи/);
        await orders.stationAccept(order.id, kitchen.id, 'kitchen');
        await orders.kitchenReadyItems(order.id, [dishLine.id], kitchen.id, 'kitchen');
        const served = await orders.served(order.id, waiter.id);
        const eventStart = sentEvents.length;
        const { newOrder } = await orders.splitCheck(order.id, waiter, makeSplit(served, dishLine, 1));
        assert.equal(newOrder.items[0].id, dishLine.id);
        assert.equal(await db.kitchenEvent.count({ where: { orderId: newOrder.id, orderItemId: dishLine.id, type: 'ready_item' } }), 1);
        assert.ok(sentEvents.slice(eventStart).every(({ event }) => event !== 'kitchen:new_order'));
        assert.equal(await db.stockMovement.count({ where: { orderItemId: dishLine.id, type: 'sale', sourceId: newOrder.id } }), 1);
        await orders.markPaid(newOrder.id, waiter, 'cash');
        const quote = await refunds.quote(owner, newOrder.id, {});
        await refunds.create(owner, newOrder.id, {
          requestId: randomUUID(), quoteVersion: quote.version, reason: 'Возврат денег за блюдо',
          approval: { fundsReturned: true, restockGoods: true },
        }, true);
        const current = await ingredients.findOne(ingredient.id);
        assert.equal(current.balances.find((row) => row.warehouseId === warehouse.id).stock, 850);
        assert.equal(await db.stockMovement.count({ where: { sourceId: newOrder.id, type: 'return' } }), 0);
      });
    });
  } finally {
    await db.$disconnect();
  }
});
