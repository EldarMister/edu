require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { OrdersService } = require('../src/orders/orders.service.ts');
const { SettingsService } = require('../src/settings/settings.service.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');
const { tenantPrismaMiddleware, runWithTenant } = require('../src/tenant/tenant-context.ts');
const { normalizeWaiterOrderPermissions } = require('../src/orders/order-policy.ts');
const { lockOrder } = require('../src/orders/order-lock.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('PostgreSQL: waiter policies, cooking races and retained history', { skip: !url }, async t => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Order integration ${randomUUID()}` } });
  const eventLog = [];
  const events = new Proxy({}, { get: (_, event) => (...args) => eventLog.push({ event, args }) });
  const audit = { log: async () => {} };
  const push = { notifyRole: async () => {}, notifyUser: async () => {}, notifyWaiter: async () => {} };
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const makeUser = (name, role) => db.user.create({ data: { name, role, phone: randomUUID(), passwordHash: 'unused-test-hash' } });
      const owner = await makeUser('Owner', 'OWNER');
      const waiter = await makeUser('Waiter', 'WAITER');
      const cooks = await Promise.all(['Сушист', 'Пиццерист', 'Гриль'].map((direction, i) => makeUser(`Cook ${i}`, 'KITCHEN', direction)));
      const shift = await db.waiterShift.create({ data: { waiterId: waiter.id } });
      const hall = await db.hall.create({ data: { name: 'Test hall' } });
      const category = await db.category.create({ data: { name: 'Test menu' } });
      const dishes = await Promise.all(['Роллы', 'Пицца', 'Шашлык', 'Салат'].map((name, i) => db.dish.create({ data: { name, categoryId: category.id, price: 100, trackInventory: true, stock: 1000 } })));
      const ingredient = await db.ingredient.create({ data: { name: 'Test rice', unitType: 'mass', displayUnit: 'g', stock: 100000, avgCost: 1 } });
      await db.recipeItem.create({ data: { dishId: dishes[0].id, ingredientId: ingredient.id, amount: 10 } });
      const settings = new SettingsService(db, audit, events);
      const orders = new OrdersService(db, events, { getRequiredActiveShift: async () => shift }, push, settings, { recalculateDishes: async () => {} }, audit, new IngredientStockService());
      const initialSettings = await settings.ensure();
      let tableNumber = 100;
      const newOrder = async (items = [{ dishId: dishes[0].id, quantity: 2 }]) => {
        const table = await db.table.create({ data: { hallId: hall.id, number: tableNumber++ } });
        const order = await orders.create(waiter, { tableId: table.id, items, idempotencyKey: randomUUID() });
        order.items.sort((a, b) => items.findIndex(i => i.dishId === a.dishId) - items.findIndex(i => i.dishId === b.dishId));
        return order;
      };
      const editLine = i => ({ id: i.id, dishId: i.dishId, quantity: i.quantity, comment: i.comment ?? undefined, takeaway: i.takeaway });
      const setPolicy = async overrides => {
        const policy = normalizeWaiterOrderPermissions(null);
        for (const [stage, value] of Object.entries(overrides)) Object.assign(policy[stage], value);
        await settings.update({ waiterOrderPermissions: policy }, owner);
        return policy;
      };

      await t.test('live policy update is scoped to cafe and emits settings sync', async () => {
        await setPolicy({ cooking: { cancel: false, edit: true } });
        assert.deepEqual((await settings.getPublic()).waiterOrderPermissions.cooking, { cancel: false, edit: true });
        assert.ok(eventLog.some(e => e.event === 'emitBroadcast' && e.args[0] === 'settings:updated'));
        const other = await db.cafe.create({ data: { name: 'Other cafe' } });
        await runWithTenant({ cafeId: other.id }, async () => {
          assert.deepEqual((await settings.getPublic()).waiterOrderPermissions.cooking, { cancel: true, edit: true });
        });
      });

      await t.test('direct cancellation and edit removal/reduction/replacement cannot bypass cooking policy', async () => {
        const order = await newOrder([{ dishId: dishes[0].id, quantity: 2 }, { dishId: dishes[1].id, quantity: 1 }]);
        await orders.stationAccept(order.id, cooks[0].id, 'kitchen');
        await assert.rejects(orders.cancelOrder(order.id, waiter, 'Отказ гостя'), /Отмена запрещена/);
        await assert.rejects(orders.cancelReadyItem(order.id, order.items[0].id, waiter, 'Отказ гостя'), /Отмена запрещена/);
        await assert.rejects(orders.editOrder(order.id, waiter, [{ ...editLine(order.items[0]), quantity: 1 }, editLine(order.items[1])], undefined, 'Уменьшение'), /Отмена запрещена/);
        await assert.rejects(orders.editOrder(order.id, waiter, [editLine(order.items[1])], undefined, 'Удаление'), /Отмена запрещена/);
        await assert.rejects(orders.editOrder(order.id, waiter, [{ ...editLine(order.items[0]), dishId: dishes[2].id }, editLine(order.items[1])], undefined, 'Замена'), /Отмена запрещена/);
        const edited = await orders.editOrder(order.id, waiter, [{ ...editLine(order.items[0]), comment: 'Без соли' }, editLine(order.items[1])]);
        const kept = edited.items.find(i => i.id === order.items[0].id);
        assert.equal(kept.status, 'cooking');
        assert.equal(kept.comment, 'Без соли');
      });

      await t.test('editing retains unaffected progress and creates only genuinely new portions', async () => {
        const order = await newOrder();
        await orders.stationAccept(order.id, cooks[0].id, 'kitchen');
        const edited = await orders.editOrder(order.id, waiter, [{ ...editLine(order.items[0]), quantity: 3 }, { dishId: dishes[1].id, quantity: 1 }]);
        const old = edited.items.find(i => i.id === order.items[0].id);
        assert.equal(old.status, 'cooking'); assert.equal(old.quantity, 2);
        const fresh = edited.items.filter(i => i.id !== old.id);
        assert.equal(fresh.length, 2); assert.ok(fresh.every(i => i.status === 'new'));
        assert.ok(await db.kitchenEvent.findFirst({ where: { orderId: edited.id, type: 'change' } }));
      });

      await t.test('partial cancellation stays explicit; full cancellation checks every affected item', async () => {
        await setPolicy({});
        const order = await newOrder([{ dishId: dishes[0].id, quantity: 1 }, { dishId: dishes[1].id, quantity: 1 }]);
        await orders.kitchenReadyItem(order.id, order.items[0].id, cooks[0].id);
        await assert.rejects(orders.cancelOrder(order.id, waiter, 'Отказ'), /Отмена запрещена/);
        const partial = await orders.cancelReadyItem(order.id, order.items[1].id, waiter, 'Гость передумал');
        assert.equal(partial.status, 'ready'); assert.equal(Number(partial.finalAmount), 100);
        assert.equal(partial.items.find(i => i.id === order.items[1].id).status, 'cancelled');
        const history = await db.kitchenEvent.findFirst({ where: { orderId: partial.id, type: 'cancel' } });
        assert.equal(history.createdById, waiter.id); assert.equal(history.reason, 'Гость передумал'); assert.ok(history.createdAt);
        await setPolicy({ ready: { cancel: true, edit: false } });
        const cancelled = await orders.cancelReadyItem(order.id, order.items[0].id, waiter, 'Отмена остатка');
        assert.equal(cancelled.status, 'cancelled');
      });

      await t.test('HTTP-shaped edit keeps an unchanged ready line when absent takeaway and null comment normalize to defaults', async () => {
        await setPolicy({});
        const order = await newOrder([{ dishId: dishes[0].id, quantity: 1 }, { dishId: dishes[1].id, quantity: 1 }]);
        await orders.kitchenReadyItem(order.id, order.items[0].id, cooks[0].id);
        const edited = await orders.editOrder(order.id, waiter, order.items.map(i => ({ id: i.id, dishId: i.dishId, quantity: i.dishId === dishes[1].id ? 2 : 1 })), '', 'Гость добавил пиццу');
        assert.equal(edited.items.find(i => i.id === order.items[0].id).status, 'ready');
        assert.equal(edited.items.filter(i => i.dishId === dishes[1].id).reduce((n, i) => n + i.quantity, 0), 2);
        assert.equal(edited.status, 'sent_to_kitchen');
      });

      await t.test('quantity decrease preserves live item and records cancelled quantity without duplicate stock returns', async () => {
        await setPolicy({});
        const before = (await db.dish.findUnique({ where: { id: dishes[0].id } })).stock;
        const ingredientsBefore = Number((await db.ingredient.findUnique({ where: { id: ingredient.id } })).stock);
        const order = await newOrder();
        const reduced = await orders.editOrder(order.id, waiter, [{ ...editLine(order.items[0]), quantity: 1 }], undefined, 'Одна порция лишняя');
        assert.equal(reduced.items.find(i => i.id === order.items[0].id).quantity, 1);
        assert.equal(reduced.items.filter(i => i.status === 'cancelled').reduce((n, i) => n + i.quantity, 0), 1);
        await orders.cancelOrder(order.id, waiter, 'Отмена остатка');
        assert.equal((await db.dish.findUnique({ where: { id: dishes[0].id } })).stock, before);
        assert.equal(Number((await db.ingredient.findUnique({ where: { id: ingredient.id } })).stock), ingredientsBefore);
      });

      await t.test('partial kitchen rejection and cancellation of the remainder return each portion exactly once', async () => {
        const before = Number((await db.ingredient.findUnique({ where: { id: ingredient.id } })).stock);
        const order = await newOrder();
        await orders.kitchenRejectItems(order.id, [order.items[0].id], cooks[0].id, 'Нет продукта', undefined, 'kitchen', [], [{ itemId: order.items[0].id, quantity: 1 }]);
        await orders.cancelOrder(order.id, waiter, 'Отмена остатка');
        assert.equal(Number((await db.ingredient.findUnique({ where: { id: ingredient.id } })).stock), before);
      });

      await t.test('real simultaneous cook and waiter requests serialize to one valid outcome', async () => {
        await setPolicy({ cooking: { cancel: false } });
        for (let attempt = 0; attempt < 6; attempt++) {
          const order = await newOrder();
          let release; let acquired;
          const held = new Promise(resolve => { acquired = resolve; });
          const gate = new Promise(resolve => { release = resolve; });
          const blocker = db.$transaction(async tx => { await lockOrder(tx, order.id); acquired(); await gate; });
          await held;
          const pending = Promise.allSettled([
            orders.stationAccept(order.id, cooks[0].id, 'kitchen'),
            orders.cancelReadyItem(order.id, order.items[0].id, waiter, 'Одновременно'),
          ]);
          release(); await blocker;
          const results = await pending;
          assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
          const final = await orders.findById(order.id);
          assert.ok(['cooking', 'cancelled'].includes(final.status));
          assert.equal(final.items[0].status, final.status);
        }
      });

      await t.test('payment and tenant barriers still apply even when all waiter stages are enabled', async () => {
        const order = await newOrder();
        await db.orderItem.updateMany({ where: { orderId: order.id }, data: { status: 'served' } });
        await db.order.update({ where: { id: order.id }, data: { status: 'served' } });
        await orders.markPaid(order.id, waiter, 'cash');
        await assert.rejects(orders.cancelOrder(order.id, owner, 'Нельзя без возврата'), /оплачен/);
        await assert.rejects(orders.editOrder(order.id, waiter, [editLine(order.items[0])]), /оплачен/);
        await runWithTenant({ cafeId: 'another-cafe' }, async () => {
          await assert.rejects(orders.cancelReadyItem(order.id, order.items[0].id, owner, 'Cross tenant'), /не найден/);
        });
        assert.equal((await orders.findById(order.id)).status, 'paid');
        await orders.adminUpdateStatus(order.id, owner, 'served', 'Отмена оплаты по существующему механизму');
        assert.equal((await orders.findById(order.id)).payments.length, 0);
        await orders.cancelOrder(order.id, owner, 'Отмена после возврата');
        assert.equal((await orders.findById(order.id)).status, 'cancelled');
      });

      await t.test('waiter history pages through tied timestamps and stays scoped to the waiter and cafe', async () => {
        const historyWaiter = await makeUser('History waiter', 'WAITER');
        const table = await db.table.create({ data: { hallId: hall.id, number: tableNumber++ } });
        const createdAt = new Date('2025-01-02T10:00:00.000Z');
        const orderData = {
          tableId: table.id,
          waiterId: historyWaiter.id,
          businessDate: createdAt,
          createdAt,
          finalAmount: '50.25',
        };
        const ownOrders = Array.from({ length: 32 }, (_, index) => ({
          ...orderData,
          id: randomUUID(),
          orderNumber: String(index + 1),
          status: ['paid', 'cancelled'][index % 2],
          createdAt: index === 31 ? new Date('2025-01-01T10:00:00.000Z') : createdAt,
        }));
        await db.order.createMany({ data: [
          ...ownOrders,
          { ...orderData, waiterId: waiter.id, orderNumber: '33' },
        ] });
        const foreignCafe = await db.cafe.create({ data: { name: 'Foreign history cafe' } });
        await runWithTenant({ cafeId: foreignCafe.id }, async () => {
          const foreignHall = await db.hall.create({ data: { name: 'Foreign hall' } });
          const foreignTable = await db.table.create({ data: { hallId: foreignHall.id, number: 1 } });
          await db.order.create({ data: { ...orderData, tableId: foreignTable.id, orderNumber: '1' } });
        });

        const expected = ownOrders
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
          .map((order) => order.id);
        const first = await orders.waiterOrderHistory(historyWaiter.id);
        assert.deepEqual(first.items.map((order) => order.id), expected.slice(0, 30));
        assert.ok(first.nextCursor);
        assert.equal(first.items[0].tableNumber, table.number);
        assert.equal(first.items[0].finalAmount, '50.25');
        assert.ok(first.items.some((order) => order.status === 'paid'));
        assert.ok(first.items.some((order) => order.status === 'cancelled'));

        // A transfer between pages should not invalidate the previously issued cursor.
        await db.order.update({ where: { id: expected[29] }, data: { waiterId: waiter.id } });
        const second = await orders.waiterOrderHistory(historyWaiter.id, first.nextCursor);
        assert.deepEqual(second.items.map((order) => order.id), expected.slice(30));
        assert.equal(second.nextCursor, null);
        assert.deepEqual(await orders.waiterOrderHistory(owner.id), { items: [], nextCursor: null });
        await assert.rejects(orders.waiterOrderHistory(historyWaiter.id, 'invalid'), { status: 400 });
      });
      assert.ok(initialSettings.cafeId === cafe.id);
    });
  } finally {
    await db.$disconnect();
  }
});
