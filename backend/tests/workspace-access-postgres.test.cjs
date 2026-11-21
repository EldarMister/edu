require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID, randomInt } = require('node:crypto');
const bcrypt = require('bcrypt');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, Reflector } = require('@nestjs/core');
const { PassportModule } = require('@nestjs/passport');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { PrismaService } = require('../src/prisma/prisma.service.ts');
const { AuthController } = require('../src/auth/auth.controller.ts');
const { AuthService } = require('../src/auth/auth.service.ts');
const { JwtStrategy } = require('../src/auth/strategies/jwt.strategy.ts');
const { JwtAuthGuard } = require('../src/common/guards/jwt-auth.guard.ts');
const { RolesGuard } = require('../src/common/guards/roles.guard.ts');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
const { OrdersController } = require('../src/orders/orders.controller.ts');
const { OrdersService } = require('../src/orders/orders.service.ts');
const { PaymentsController } = require('../src/payments/payments.controller.ts');
const { PaymentsService } = require('../src/payments/payments.service.ts');
const { FiscalController } = require('../src/fiscal/fiscal.controller.ts');
const { FiscalService } = require('../src/fiscal/fiscal.service.ts');
const { StaffController } = require('../src/admin/staff.controller.ts');
const { StaffService } = require('../src/admin/staff.service.ts');
const { PositionsController } = require('../src/admin/positions.controller.ts');
const { CatalogController } = require('../src/admin/catalog.controller.ts');
const { CatalogService } = require('../src/admin/catalog.service.ts');
const { MenuEntryService } = require('../src/admin/menu-entry.service.ts');
const { HallsController } = require('../src/halls/halls.controller.ts');
const { HallsService } = require('../src/halls/halls.service.ts');
const { AuditService } = require('../src/audit/audit.service.ts');
const { TablesController } = require('../src/tables/tables.controller.ts');
const { TablesService } = require('../src/tables/tables.service.ts');
const { WaiterShiftsController } = require('../src/waiter-shifts/waiter-shifts.controller.ts');
const { StaffShiftsController } = require('../src/waiter-shifts/staff-shifts.controller.ts');
const { WaiterShiftsService } = require('../src/waiter-shifts/waiter-shifts.service.ts');
const { SettingsService } = require('../src/settings/settings.service.ts');
const { SettingsController } = require('../src/settings/settings.controller.ts');
const { ReceiptPrintsService } = require('../src/receipt-prints/receipt-prints.service.ts');
const { ReceiptPrintsController } = require('../src/receipt-prints/receipt-prints.controller.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');
const { tenantPrismaMiddleware, runWithTenant } = require('../src/tenant/tenant-context.ts');

const databaseUrl = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || !new URL(databaseUrl).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('HTTP + PostgreSQL: independent terminal and administration access with stable employee identity', { skip: !databaseUrl }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Workspace ${randomUUID()}` } });
  const auditEntries = [];
  const audit = { log: async (entry) => auditEntries.push(entry) };
  const events = new Proxy({}, { get: () => () => {} });
  const push = { notifyRole: async () => {}, notifyUser: async () => {}, notifyWaiter: async () => {} };
  const shifts = new WaiterShiftsService(db, events);
  const fiscalized = [];
  const fiscal = { fiscalizeOrder: async (id) => { fiscalized.push(id); return { success: true }; } };
  const settings = new SettingsService(db, audit, events);
  const orders = new OrdersService(db, events, shifts, push, settings, { recalculateDishes: async () => {} }, audit, new IngredientStockService());
  const staff = new StaffService(db, audit);
  const providers = [
    [PrismaService, db], [AuditService, audit], [AuthService, new AuthService(db, new JwtService())],
    [OrdersService, orders], [PaymentsService, new PaymentsService(db, orders, settings)],
    [WaiterShiftsService, shifts], [StaffService, staff], [TablesService, new TablesService(db, events)],
    [JwtStrategy, new JwtStrategy(db)],
    [CatalogService, new CatalogService(db, events, audit)], [MenuEntryService, {}], [HallsService, new HallsService(db)],
    [FiscalService, fiscal], [SettingsService, settings], [ReceiptPrintsService, new ReceiptPrintsService(db, events, fiscal, push)],
  ].map(([provide, useValue]) => ({ provide, useValue }));
  class HttpFixtureModule {}
  Module({ imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [AuthController, OrdersController, PaymentsController, FiscalController, WaiterShiftsController, StaffShiftsController, StaffController, PositionsController, TablesController, SettingsController, ReceiptPrintsController, CatalogController, HallsController], providers })(HttpFixtureModule);
  const app = await NestFactory.create(HttpFixtureModule, { logger: false });
  app.setGlobalPrefix('api');
  app.use((_req, _res, next) => runWithTenant({}, next));
  const reflector = new Reflector();
  app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector), new PermissionsGuard(reflector));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()) + '/api';
  const request = async (path, { token, workspace, method = 'GET', body, status = 200 } = {}) => {
    const response = await fetch(base + path, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(workspace ? { 'X-EDU-Workspace': workspace } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.text();
    const value = payload ? JSON.parse(payload) : null;
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
    return value;
  };
  try {
    const fixture = await runWithTenant({ cafeId: cafe.id }, async () => {
      const passwordHash = await bcrypt.hash('workspace-test-password', 4);
      const makeUser = (role, positionId) => db.user.create({ data: { role, name: role, phone: `+996${randomInt(100_000_000, 1_000_000_000)}`, passwordHash, positionId } });
      const owner = await makeUser('OWNER');
      const permissions = getDefaultPermissionsByRole('ADMIN');
      permissions.terminalAccess = true;
      permissions.adminAccess = true;
      permissions.sections.orders = false;
      permissions.sections.checks = false;
      permissions.sections.staff = true;
      permissions.readOnlySections = ['staff'];
      const mixedPosition = await db.staffPosition.create({ data: { name: 'Manager and cashier', role: 'ADMIN', permissions } });
      const mixed = await makeUser('ADMIN', mixedPosition.id);
      const legacy = await makeUser('WAITER');
      const kitchen = await makeUser('KITCHEN');
      const bar = await makeUser('BAR');
      const admin = await makeUser('ADMIN');
      const seeded = await db.staffPosition.findMany({ where: { name: { in: ['Касса', 'Кладовщик'] } } });
      const cashierPosition = seeded.find((position) => position.name === 'Касса');
      const storekeeperPosition = seeded.find((position) => position.name === 'Кладовщик');
      assert.ok(cashierPosition && storekeeperPosition);
      const cashier = await makeUser(cashierPosition.role, cashierPosition.id);
      const storekeeper = await makeUser(storekeeperPosition.role, storekeeperPosition.id);
      const hall = await db.hall.create({ data: { name: 'Workspace hall' } });
      const category = await db.category.create({ data: { name: 'Workspace menu', prepStation: 'none' } });
      const dish = await db.dish.create({ data: { categoryId: category.id, name: 'Water', price: 50, prepStation: 'none' } });
      await settings.ensure();
      return { owner, mixed, legacy, kitchen, bar, admin, cashier, storekeeper, cashierPosition, storekeeperPosition, mixedPosition, permissions, hall, dish };
    });
    const sessions = {};
    for (const name of ['owner', 'mixed', 'legacy', 'kitchen', 'bar', 'admin', 'cashier', 'storekeeper']) {
      const session = await request('/auth/login', { method: 'POST', body: { phone: fixture[name].phone, password: 'workspace-test-password' } });
      sessions[name] = session.accessToken;
      assert.equal(session.user.role, fixture[name].role);
      assert.equal(session.user.access.terminal, ['owner', 'mixed', 'legacy', 'cashier'].includes(name));
    }
    const newTable = () => runWithTenant({ cafeId: cafe.id }, async () => await db.table.create({ data: { hallId: fixture.hall.id, number: ++tableNumber } }));
    let tableNumber = 1;
    let mixedOrder;
    await t.test('item cancellation requests use the administrator queue and cancel a position only once', async () => {
      const table = await newTable();
      const order = await runWithTenant({ cafeId: cafe.id }, () => db.order.create({ data: {
        cafeId: cafe.id, orderNumber: 'QA-' + randomUUID(), tableId: table.id, waiterId: fixture.legacy.id, status: 'served',
        finalAmount: 150, totalAmount: 150,
        items: { create: [1, 2].map((quantity) => ({
          cafeId: cafe.id, dishId: fixture.dish.id, dishNameSnapshot: fixture.dish.name, priceSnapshot: 50,
          finalPrice: quantity * 50, quantity, status: 'served', prepStation: 'none',
        })) },
      }, include: { items: true } }));
      const terminal = { token: sessions.legacy, workspace: 'terminal' };
      const admin = { token: sessions.admin, workspace: 'admin' };
      const [first, second] = [...order.items].sort((a, b) => a.quantity - b.quantity);
      const requestPath = (line) => `/orders/${order.id}/items/${line.id}/cancellation-request`;
      const requestInput = { ...terminal, method: 'POST', status: 201, body: { reason: 'Гость передумал' } };
      const queuePath = '/orders/item-cancellation-requests';
      await request(queuePath, { ...terminal, status: 403 });
      await request(queuePath, { token: sessions.mixed, workspace: 'admin', status: 403 });
      await request(requestPath(first), { ...requestInput, token: sessions.owner, status: 403 });
      const [pending, repeated] = await Promise.all([request(requestPath(first), requestInput), request(requestPath(first), requestInput)]);
      assert.equal(pending.id, repeated.id);
      assert.equal((await db.orderItem.findUniqueOrThrow({ where: { id: first.id } })).status, 'served');
      assert.deepEqual(await request(`/orders/${order.id}/item-cancellation-requests`, terminal), [{ itemId: first.id }]);
      const queue = await request(queuePath, admin);
      assert.deepEqual(queue.map(({ itemId, itemName }) => [itemId, itemName]), [[first.id, fixture.dish.name]]);

      const decision = (entry, action, access = admin, code = 201) => request(
        `/orders/${order.id}/item-cancellation-requests/${entry.id}/${action}`, { ...access, method: 'POST', status: code });
      await decision(pending, 'approve', terminal, 403);
      const approvals = await Promise.all([decision(pending, 'approve'), decision(pending, 'approve')]);
      assert.ok(approvals.every(({ status }) => status === 'approved'));
      assert.equal(await db.kitchenEvent.count({ where: { orderItemId: first.id, type: 'cancel' } }), 1);
      assert.equal(Number((await db.order.findUniqueOrThrow({ where: { id: order.id } })).finalAmount), 100);

      const rejected = await request(requestPath(second), requestInput);
      await decision(rejected, 'reject');
      await decision(rejected, 'approve', admin, 409);
      assert.equal((await db.orderItem.findUniqueOrThrow({ where: { id: second.id } })).status, 'served');
      const afterRejection = await request(requestPath(second), requestInput);
      await db.orderItem.update({ where: { id: second.id }, data: { quantity: 3, finalPrice: 150 } });
      await decision(afterRejection, 'approve', admin, 409);
      assert.equal((await db.orderItemCancellationRequest.findUniqueOrThrow({ where: { id: afterRejection.id } })).status, 'pending');
      await request(`/orders/${order.id}/items/${second.id}/cancel`, { ...requestInput, ...admin });
      assert.equal((await db.orderItemCancellationRequest.findUniqueOrThrow({ where: { id: afterRejection.id } })).status, 'approved');
      assert.deepEqual(await request(queuePath, admin), []);
    });

    await t.test('owner operates a real terminal shift, order and payment without changing owner identity', async () => {
      const token = sessions.owner;
      await request('/waiter/shifts/start', { token, workspace: 'terminal', method: 'POST', status: 201 });
      const table = await newTable();
      const order = await request('/orders', { token, workspace: 'terminal', method: 'POST', status: 201,
        body: { tableId: table.id, items: [{ dishId: fixture.dish.id, quantity: 1 }], idempotencyKey: randomUUID() } });
      assert.equal(order.waiterId, fixture.owner.id);
      await request(`/orders/${order.id}/served`, { token, workspace: 'terminal', method: 'POST', status: 201 });
      const terminal = { token, workspace: 'terminal', method: 'POST' };
      const cashBody = { orderId: order.id, method: 'cash' };
      await request('/payments', { ...terminal, status: 409,
        body: { ...cashBody, expectedAmount: Number(order.finalAmount) + 1 } });
      assert.equal(await db.payment.count({ where: { orderId: order.id } }), 0);
      const paid = await request('/payments', { ...terminal, status: 201,
        body: { ...cashBody, expectedAmount: Number(order.finalAmount) } });
      assert.equal(paid.status, 'paid');
      const admin = { token, workspace: 'admin', method: 'PATCH' };
      const nextTable = await newTable();
      const mixed = await request('/orders', { ...terminal, status: 201,
        body: { tableId: nextTable.id, items: [{ dishId: fixture.dish.id, quantity: 1 }] } });
      await request(`/orders/${mixed.id}/served`, { ...terminal, status: 201 });
      const mixedBody = { orderId: mixed.id, method: 'mixed', cashAmount: 19.75, cardAmount: 30.25 };
      await request('/admin/settings', { ...admin, body: { payCard: false } });
      await request('/payments', { ...terminal, status: 400, body: mixedBody });
      await request('/admin/settings', { ...admin, body: { payCard: true } });
      await request('/payments', { ...terminal, status: 400, body: { ...mixedBody, cardAmount: 30.24 } });
      const payment = await request('/payments', { ...terminal, status: 201, body: mixedBody });
      assert.equal(payment.status, 'paid');
      const receipt = await request(`/payments/${mixed.id}/receipt`, { token, workspace: 'terminal' });
      assert.deepEqual(receipt.payments.map((part) => [part.method, Number(part.amount), part.source]).sort(), [
        ['card', 30.25, 'normal'],
        ['cash', 19.75, 'normal'],
      ]);
      await request('/admin/settings', { ...admin, body: { payCard: false } });
      await request('/waiter/shifts/end', { token, workspace: 'terminal', method: 'POST', status: 201 });
      assert.equal((await request('/auth/me', { token, workspace: 'terminal' })).role, 'OWNER');
      assert.equal((await db.user.findUnique({ where: { id: fixture.owner.id } })).role, 'OWNER');
      assert.equal(auditEntries.find((entry) => entry.actor?.id === fixture.owner.id && entry.actor?.workspace === 'terminal').actor.identityRole, 'OWNER');
    });
    await t.test('mixed cashier works independently of disabled admin orders and read-only staff', async () => {
      const token = sessions.mixed;
      await request('/admin/staff', { token, workspace: 'admin' });
      await request('/admin/staff', { token, workspace: 'terminal', status: 403 });
      await request('/waiter/shifts/start', { token, workspace: 'admin', method: 'POST', status: 403 });
      await request('/waiter/shifts/start', { token, workspace: 'terminal', method: 'POST', status: 201 });
      const table = await newTable();
      mixedOrder = await request('/orders', { token, workspace: 'terminal', method: 'POST', status: 201,
        body: { tableId: table.id, items: [{ dishId: fixture.dish.id, quantity: 1 }] } });
      await request(`/orders/${mixedOrder.id}`, { token, workspace: 'admin', status: 403 });
      await request(`/orders/${mixedOrder.id}`, { token, workspace: 'terminal' });
      await request('/payments', { token, workspace: 'admin', method: 'POST', status: 403, body: { orderId: mixedOrder.id, method: 'cash' } });
      await request(`/orders/${mixedOrder.id}`, { token: sessions.owner, workspace: 'terminal', status: 403 });
      await request('/payments', { token: sessions.owner, workspace: 'terminal', method: 'POST', status: 403, body: { orderId: mixedOrder.id, method: 'cash' } });
      const active = await request('/tables/available-waiters', { token, workspace: 'terminal' });
      assert.ok(active.some((row) => row.id === fixture.mixed.id), 'technical ADMIN with terminal access must be a transfer target');
      assert.equal((await request('/auth/me', { token })).role, 'ADMIN');
    });
    await t.test('legacy clients retain their defaults and cannot forge a workspace capability', async () => {
      await request('/waiter/shifts/start', { token: sessions.legacy, method: 'POST', status: 201 });
      await request('/admin/staff', { token: sessions.legacy, workspace: 'admin', status: 403 });
      await request('/waiter/shifts/start', { token: sessions.admin, workspace: 'terminal', method: 'POST', status: 403 });
      await request('/waiter/shifts/start', { token: sessions.kitchen, workspace: 'terminal', method: 'POST', status: 403 });
      await request('/orders/active', { token: sessions.mixed, workspace: 'invented', status: 403 });
      await request('/waiter/shifts/end', { token: sessions.legacy, method: 'POST', status: 201 });
    });
    await t.test('terminal revocation waits for live work, then invalidates existing tokens immediately', async () => {
      const permissions = { ...fixture.permissions, terminalAccess: false };
      await request(`/admin/positions/${fixture.mixedPosition.id}`, { token: sessions.owner, workspace: 'admin', method: 'PATCH', status: 409,
        body: { name: fixture.mixedPosition.name, permissions: { ...fixture.permissions, workShiftRequired: false } } });
      await request(`/admin/positions/${fixture.mixedPosition.id}`, { token: sessions.owner, workspace: 'admin', method: 'PATCH', status: 409,
        body: { name: fixture.mixedPosition.name, permissions } });
      await request(`/orders/${mixedOrder.id}/served`, { token: sessions.mixed, workspace: 'terminal', method: 'POST', status: 201 });
      await request('/payments', { token: sessions.mixed, workspace: 'terminal', method: 'POST', status: 201, body: { orderId: mixedOrder.id, method: 'cash' } });
      await request('/waiter/shifts/end', { token: sessions.mixed, workspace: 'terminal', method: 'POST', status: 201 });
      await request(`/admin/positions/${fixture.mixedPosition.id}`, { token: sessions.owner, workspace: 'admin', method: 'PATCH', body: { name: fixture.mixedPosition.name, permissions } });
      await request('/orders/active', { token: sessions.mixed, workspace: 'terminal', status: 403 });
      const account = await request('/auth/me', { token: sessions.mixed, workspace: 'terminal' });
      assert.equal(account.access.terminal, false);
      assert.equal(account.access.admin, true);
      await request('/admin/staff', { token: sessions.mixed, workspace: 'admin' });
    });
    await t.test('position disables work tracking and keeps order creation and payment available', async () => {
      const token = sessions.mixed;
      const owner = { token: sessions.owner, workspace: 'admin' };
      const terminal = { token, workspace: 'terminal' };
      await request(`/admin/positions/${fixture.mixedPosition.id}`, { ...owner, method: 'PATCH', body: {
        name: fixture.mixedPosition.name, permissions: { ...fixture.permissions, workShiftRequired: false },
      } });
      assert.equal((await request('/auth/me', terminal)).permissions.workShiftRequired, false);
      await request('/waiter/shifts/start', { ...terminal, method: 'POST', status: 400 });
      const table = await newTable();
      const order = await request('/orders', { ...terminal, method: 'POST', status: 201,
        body: { tableId: table.id, items: [{ dishId: fixture.dish.id, quantity: 1 }] } });
      assert.equal((await db.order.findUnique({ where: { id: order.id } })).waiterShiftId, null);
      const targets = await request('/tables/available-waiters', terminal);
      assert.ok(targets.some(({ id }) => id === fixture.mixed.id));
      await request(`/orders/${order.id}/served`, { ...terminal, method: 'POST', status: 201 });
      await request('/payments', { ...terminal, method: 'POST', status: 201, body: { orderId: order.id, method: 'cash' } });
    });
    await t.test('staff shifts follow the assigned position and exclude the owner in the admin workspace', async () => {
      const owner = { token: sessions.owner, workspace: 'admin' };
      const admin = { token: sessions.admin, workspace: 'admin' };
      const change = { method: 'POST', status: 201 };
      assert.equal(await request('/staff/shifts/current', owner), null);
      await request('/staff/shifts/start', { ...owner, ...change, status: 403 });
      await request('/staff/shifts/end', { ...owner, ...change, status: 403 });
      assert.equal(await request('/staff/shifts/current', admin), null);
      const adminShift = await request('/staff/shifts/start', { ...admin, ...change });
      assert.equal(adminShift.waiterId, fixture.admin.id);
      assert.equal((await request('/staff/shifts/current', admin)).id, adminShift.id);
      assert.equal(await request('/staff/shifts/current', owner), null);
      assert.equal((await request('/staff/shifts/end', { ...admin, ...change })).id, adminShift.id);
      assert.equal(await request('/staff/shifts/current', admin), null);
      await request('/staff/shifts/start', { token: sessions.mixed, workspace: 'admin', method: 'POST', status: 400 });
    });
    await t.test('owner can restrict the print queue to actual waiter requests', async () => {
      const owner = { token: sessions.owner, workspace: 'admin' };
      const admin = { token: sessions.admin, workspace: 'admin' };
      const printOptions = { token: sessions.mixed, workspace: 'terminal', method: 'POST', status: 201,
        body: { orderId: mixedOrder.id, type: 'receipt' } };
      const [ticket, retry] = await Promise.all([
        request('/receipt-prints', printOptions), request('/receipt-prints', printOptions),
      ]);
      assert.equal(retry.id, ticket.id);
      await request('/receipt-prints', { ...printOptions, status: 400,
        body: { orderId: mixedOrder.id, type: 'preliminary' } });
      assert.ok((await request('/receipt-prints', admin)).some(({ source }) => source === 'order'));
      await request('/admin/settings', { ...admin, method: 'PATCH', status: 403, body: { receiptPrintRequestsOnly: true } });
      await request('/admin/settings', { ...owner, method: 'PATCH', body: { receiptPrintRequestsOnly: true } });
      const filtered = await request('/receipt-prints', admin);
      assert.deepEqual(filtered.map(({ id, source }) => [id, source]), [[ticket.id, 'request']]);
      await request('/admin/settings', { ...owner, method: 'PATCH', body: { receiptPrintRequestsOnly: false } });
      assert.ok((await request('/receipt-prints', admin)).some(({ source }) => source === 'order'));
    });
    await t.test('cashier prints approved waiter requests and their own orders with independent editable permissions', async () => {
      const owner = { token: sessions.owner, workspace: 'admin' };
      const cashier = { token: sessions.cashier, workspace: 'terminal' };
      const waiter = { token: sessions.legacy, workspace: 'terminal' };
      const post = { method: 'POST', status: 201 };
      const queue = await request('/receipt-prints', cashier);
      const ticket = queue.find((item) => item.orderId === mixedOrder.id && item.source === 'request');
      assert.ok(ticket);
      assert.ok(queue.every((item) => item.source === 'request'));
      await request('/receipt-prints', { ...waiter, status: 403 });
      await request(`/payments/${mixedOrder.id}/receipt?print=true&requestId=${ticket.id}`, { ...cashier, status: 403 });
      await request(`/receipt-prints/${ticket.id}/approve`, { ...cashier, ...post });
      await request(`/receipt-prints/${ticket.id}/approve`, { ...cashier, ...post, status: 400 });
      const approvedRetry = await request('/receipt-prints', { token: sessions.mixed, workspace: 'terminal', ...post,
        body: { orderId: mixedOrder.id, type: 'receipt' } });
      assert.equal(approvedRetry.id, ticket.id);
      await request(`/payments/${mixedOrder.id}/receipt?print=true`, { ...cashier, status: 403 });
      await request(`/payments/${mixedOrder.id}/receipt?print=true&requestId=${ticket.id}`, cashier);
      await request(`/fiscal/orders/${mixedOrder.id}/print?requestId=${ticket.id}`, { ...cashier, ...post });
      assert.equal(fiscalized.at(-1), mixedOrder.id);
      const fiscalCount = fiscalized.length;
      const printed = await Promise.all([
        request(`/receipt-prints/${ticket.id}/printed`, { ...cashier, ...post }),
        request(`/receipt-prints/${ticket.id}/printed`, { ...cashier, ...post }),
      ]);
      assert.ok(printed.every(({ status }) => status === 'printed'));
      assert.equal(fiscalized.length, fiscalCount + 1);

      await request('/waiter/shifts/start', { ...cashier, ...post });
      const table = await newTable();
      const line = { dishId: fixture.dish.id, quantity: 1 };
      const order = await request('/orders', { ...cashier, ...post, body: {
        tableId: table.id, items: [line], idempotencyKey: randomUUID(),
      } });
      await request(`/payments/${order.id}/receipt?print=true`, cashier);
      await request(`/fiscal/orders/${order.id}/print`, { ...cashier, ...post, status: 403 });
      await request(`/orders/${order.id}/served`, { ...cashier, ...post });
      await request('/payments', { ...cashier, ...post, body: { orderId: order.id, method: 'cash' } });
      await request('/admin/settings', { ...owner, method: 'PATCH', body: { receiptPrintRequestsOnly: true } });
      await request(`/payments/${order.id}/receipt?print=true`, cashier);
      await request(`/fiscal/orders/${order.id}/print`, { ...cashier, ...post });
      await request('/admin/settings', { ...owner, method: 'PATCH', body: { receiptPrintRequestsOnly: false } });
      const deliveryBody = { customerName: 'Получатель', customerPhone: '+996 555 555 555', deliveryAddress: 'Тестовая улица 1',
        items: [line], idempotencyKey: randomUUID() };
      const delivery = await request('/orders/delivery', { ...cashier, ...post, body: deliveryBody });
      assert.equal(delivery.source, 'delivery');

      const position = (await request('/admin/positions', owner)).find(({ id }) => id === fixture.cashierPosition.id);
      await request(`/admin/positions/${position.id}`, { ...owner, method: 'PATCH', body: {
        name: position.name, permissions: { ...position.permissions, actions: { ...position.permissions.actions,
          acceptOrderPayments: false, printReceipts: false, createDeliveryOrders: false,
        } },
      } });
      await request('/receipt-prints', { ...cashier, status: 403 });
      await request(`/payments/${order.id}/receipt?print=true`, { ...cashier, status: 403 });
      await request(`/fiscal/orders/${order.id}/print`, { ...cashier, ...post, status: 403 });
      await request('/payments', { ...cashier, ...post, status: 403, body: { orderId: delivery.id, method: 'cash' } });
      await request(`/orders/${delivery.id}/to-payment`, { ...cashier, ...post, status: 403 });
      await request('/orders/delivery', { ...cashier, ...post, status: 403, body: { ...deliveryBody, idempotencyKey: randomUUID() } });
      await request('/orders', { ...cashier, ...post, body: {
        tableId: (await newTable()).id, items: [line], idempotencyKey: randomUUID(),
      } });
    });
    await t.test('storekeeper receives only editable menu and warehouse access from the starter position', async () => {
      const owner = { token: sessions.owner, workspace: 'admin' };
      const storekeeper = { token: sessions.storekeeper, workspace: 'admin' };
      const me = await request('/auth/me', storekeeper);
      assert.deepEqual(Object.keys(me.permissions.sections).filter((key) => me.permissions.sections[key]).sort(), ['menu', 'warehouse']);
      assert.equal(me.permissions.actions.editMenu, true);
      await request('/admin/dishes', storekeeper);
      await request('/admin/staff', { ...storekeeper, status: 403 });
      await request('/receipt-prints', { ...storekeeper, status: 403 });
      await request('/orders/active', { ...storekeeper, workspace: 'terminal', status: 403 });
      await request(`/admin/positions/${fixture.storekeeperPosition.id}`, { ...owner, method: 'PATCH', body: {
        name: 'Кладовщик', permissions: { ...me.permissions, sections: { ...me.permissions.sections, menu: false } },
      } });
      await request('/admin/dishes', { ...storekeeper, status: 403 });
    });
    await t.test('the position grants manual delivery on the terminal and regular orders keep their own tables', async () => {
      const owner = { token: sessions.owner, workspace: 'admin' };
      const terminal = { token: sessions.mixed, workspace: 'terminal' };
      const cookedDish = await runWithTenant({ cafeId: cafe.id }, async () => {
        const category = await db.category.create({ data: { name: 'Kitchen menu', prepStation: 'kitchen' } });
        return db.dish.create({ data: { categoryId: category.id, name: 'Soup', price: 100, prepStation: 'kitchen' } });
      });
      await request('/admin/settings', { ...owner, method: 'PATCH', status: 400, body: { serviceChargeAmount: 25 } });
      await runWithTenant({ cafeId: cafe.id }, async () => {
        const { id } = await db.settings.findFirstOrThrow({ select: { id: true } });
        await db.settings.update({ where: { id }, data: { serviceChargeAmount: 25 } });
      });
      assert.equal((await request('/admin/settings', owner)).serviceChargeAmount, '0');
      const body = {
        customerName: 'Test recipient', customerPhone: '+996 555 555 555', deliveryAddress: '  Test street 1  ',
        items: [{ dishId: cookedDish.id, quantity: 1 }, { dishId: fixture.dish.id, quantity: 1 }],
        idempotencyKey: randomUUID(),
      };
      const createDelivery = (actor, payload, status = 201) =>
        request('/orders/delivery', { ...actor, method: 'POST', body: payload, status });
      const orderTable = await newTable();
      const tableCountBeforeDelivery = (await request('/admin/tables/overview', owner)).tablesCount;
      await createDelivery(terminal, body, 403);
      const permissions = { ...fixture.permissions, workShiftRequired: false };
      await request(`/admin/positions/${fixture.mixedPosition.id}`, { ...owner, method: 'PATCH', body: {
        name: fixture.mixedPosition.name, permissions: { ...permissions, actions: { ...permissions.actions, createDeliveryOrders: true } },
      } });
      const tableOrder = await request('/orders', { ...terminal, method: 'POST', status: 201, body: {
        tableId: orderTable.id, items: [{ dishId: fixture.dish.id, quantity: 1 }], idempotencyKey: randomUUID(),
      } });
      assert.equal(tableOrder.serviceChargeAmount, '0');
      assert.equal(tableOrder.finalAmount, '50');
      const updatedTableOrder = await request(`/orders/${tableOrder.id}/items`, { ...terminal, method: 'POST', status: 201, body: {
        items: [{ dishId: fixture.dish.id, quantity: 1 }],
      } });
      assert.equal(updatedTableOrder.serviceChargeAmount, '0');
      assert.equal(updatedTableOrder.finalAmount, '100');
      await createDelivery({ ...terminal, workspace: 'admin' }, body, 403);
      await createDelivery({ token: sessions.legacy, workspace: 'terminal' }, body, 403);
      await createDelivery(terminal, { ...body, deliveryAddress: '   ' }, 400);
      await createDelivery(terminal, { ...body, customerPhone: 'no phone' }, 400);
      const [first, second] = await Promise.all([
        createDelivery(terminal, body),
        createDelivery(terminal, { ...body, idempotencyKey: randomUUID(), deliveryAddress: 'Test street 2' }),
      ]);
      assert.notEqual(first.id, second.id);
      assert.notEqual(first.orderNumber, second.orderNumber);
      assert.equal((await createDelivery(terminal, body)).id, first.id);
      assert.equal(first.waiterId, fixture.mixed.id);
      assert.equal(first.source, 'delivery');
      assert.equal(first.externalOrderId, null);
      assert.equal(first.deliveryAddress, 'Test street 1');
      assert.equal(first.status, 'sent_to_kitchen');
      assert.equal(first.serviceChargeAmount, '0');
      assert.ok(first.items.every(({ takeaway }) => takeaway));
      assert.ok((await request('/orders/active', terminal)).some(({ id }) => id === first.id));
      await request(`/orders/${first.id}`, { token: sessions.legacy, workspace: 'terminal', status: 403 });
      await createDelivery({ token: sessions.owner, workspace: 'terminal' }, body, 409);
      assert.equal((await request('/halls', terminal)).some(({ id }) => id === first.table.hallId), false);
      assert.equal((await request('/admin/halls', owner)).some(({ id }) => id === first.table.hallId), false);
      assert.equal((await request('/admin/tables/overview', owner)).tablesCount, tableCountBeforeDelivery);
      const action = (name, status = 201, data) =>
        request(`/orders/${first.id}/${name}`, { ...terminal, method: 'POST', body: data, status });
      const updated = await action('items', 201, { items: [{ dishId: fixture.dish.id, quantity: 1, takeaway: false }] });
      assert.equal(updated.finalAmount, '200');
      assert.ok(updated.items.every(({ takeaway }) => takeaway));
      await action('picked-up', 400);
      await runWithTenant({ cafeId: cafe.id }, () => orders.kitchenReadyStation(first.id, fixture.kitchen.id, 'kitchen'));
      await action('served', 400);
      assert.equal((await action('picked-up')).status, 'picked_up');
      await action('items', 400, { items: [{ dishId: fixture.dish.id, quantity: 1 }] });
      assert.equal((await action('served')).status, 'served');
      await action('to-payment');
      const payment = await request('/payments', { ...terminal, method: 'POST', status: 201, body: { orderId: first.id, method: 'cash' } });
      assert.equal(payment.status, 'paid');
      assert.equal((await request(`/payments/${first.id}/receipt`, terminal)).source, 'delivery');
      const ticket = await request('/receipt-prints', { ...terminal, method: 'POST', status: 201,
        body: { orderId: first.id, type: 'receipt' } });
      assert.equal(ticket.orderSource, 'delivery');
      await request(`/admin/positions/${fixture.mixedPosition.id}`, { ...owner, method: 'PATCH', body: {
        name: fixture.mixedPosition.name, permissions,
      } });
      await createDelivery(terminal, { ...body, idempotencyKey: randomUUID() }, 403);
    });
    await t.test('each hall can inherit the global floor plan mode or override it on the terminal', async () => {
      const owner = { token: sessions.owner, workspace: 'admin' };
      const terminal = { token: sessions.mixed, workspace: 'terminal' };
      const createHall = (body) => request('/admin/halls', { ...owner, method: 'POST', body, status: 201 });
      const mapped = await createHall({ name: 'Floor plan', useFloorPlan: true });
      const buttons = await createHall({ name: 'Numbered buttons', useFloorPlan: false });
      await request('/admin/tables/floor-plan-mode', { ...owner, method: 'PUT', body: { useFloorPlan: true } });
      const halls = await request('/halls', terminal);
      const mode = (id) => halls.find((hall) => hall.id === id).useFloorPlan;
      assert.equal(mode(fixture.hall.id), null);
      assert.equal(mode(mapped.id), true);
      assert.equal(mode(buttons.id), false);
      await request(`/admin/halls/${mapped.id}`, { ...owner, method: 'PATCH', body: { useFloorPlan: null } });
      assert.equal((await request('/halls', terminal)).find((hall) => hall.id === mapped.id).useFloorPlan, null);
    });
    await t.test('the four default positions keep their workspace limits after edits and renames', async () => {
      const owner = { token: sessions.owner, workspace: 'admin' };
      const positions = await request('/admin/positions', owner);
      for (const [user, name, workspace] of [
        ['legacy', 'Официант', 'terminal'],
        ['cashier', 'Касса', 'terminal'],
        ['kitchen', 'Кухня', 'production'],
        ['bar', 'Бар', 'production'],
      ]) {
        const position = positions.find((row) => row.name === name);
        assert.equal(position.fixedWorkspace, workspace);
        const saved = await request(`/admin/positions/${position.id}`, { ...owner, method: 'PATCH', body: {
          name: `${name} QA`,
          permissions: { ...position.permissions, fixedWorkspace: null, adminAccess: true, terminalAccess: true },
        } });
        assert.equal(saved.fixedWorkspace, workspace);
        assert.equal(saved.permissions.adminAccess, false);
        assert.equal(saved.permissions.terminalAccess, workspace === 'terminal');

        await runWithTenant({ cafeId: cafe.id }, () => db.user.update({
          where: { id: fixture[user].id }, data: { positionId: position.id },
        }));
        await request('/admin/staff', { token: sessions[user], workspace: 'admin', status: 403 });
        if (workspace === 'production') {
          await request('/orders/active', { token: sessions[user], workspace: 'terminal', status: 403 });
          await request('/staff/shifts/current', { token: sessions[user], workspace });
        } else {
          await request('/orders/active', { token: sessions[user], workspace });
        }
      }
      await request('/admin/staff', { token: sessions.mixed, workspace: 'admin' });
      await request('/orders/active', { token: sessions.mixed, workspace: 'terminal' });
    });
  } finally {
    await app.close();
    await db.order.deleteMany({ where: { cafeId: cafe.id } });
    await db.table.deleteMany({ where: { cafeId: cafe.id } });
    await db.hall.deleteMany({ where: { cafeId: cafe.id } });
    await db.dish.deleteMany({ where: { cafeId: cafe.id } });
    await db.category.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.settings.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
