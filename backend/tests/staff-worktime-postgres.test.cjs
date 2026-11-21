require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomInt, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { Reflector } = require('@nestjs/core');
const { RolesGuard } = require('../src/common/guards/roles.guard.ts');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
const { StaffService } = require('../src/admin/staff.service.ts');
const { PositionsController } = require('../src/admin/positions.controller.ts');
const { StaffShiftsController } = require('../src/waiter-shifts/staff-shifts.controller.ts');
const { WaiterShiftsController } = require('../src/waiter-shifts/waiter-shifts.controller.ts');
const { WaiterShiftsService, MAX_WORK_SHIFT_MS } = require('../src/waiter-shifts/waiter-shifts.service.ts');
const { ShiftExpiryService } = require('../src/waiter-shifts/shift-expiry.service.ts');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { currentPayrollMonth, payrollReport } = require('../src/finance/payroll.ts');
const { warehouseDay } = require('../src/warehouse/report-range.ts');

const databaseUrl = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || !new URL(databaseUrl).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('PostgreSQL: waiter reports use Bishkek payment dates, exclude returns and group assigned employees', { skip: !databaseUrl }, async () => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Waiter report ' + randomUUID() } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const createEmployee = (name, role) => db.user.create({
        data: { name, role, phone: randomUUID(), passwordHash: 'fixture' },
      });
      const waiter = await createEmployee('Официант', 'WAITER');
      const cashier = await createEmployee('Кассир', 'ADMIN');
      const owner = await createEmployee('Владелец', 'OWNER');
      const hall = await db.hall.create({ data: { name: 'Тестовый зал' } });
      const table = await db.table.create({ data: { hallId: hall.id, number: 1 } });
      const date = '2026-10-04';
      const paidAt = new Date('2026-10-03T18:00:00.000Z');
      const createCheck = async (employee, seconds, { paid = paidAt, refunded = 0, finalAmount = 100, paymentStatus = 'paid' } = {}) => {
        const order = await db.order.create({ data: {
          tableId: table.id, waiterId: employee.id, orderNumber: randomUUID(), status: 'paid',
          paymentStatus, closedAt: paid, finalAmount, paymentMethod: 'cash', refundedAmount: finalAmount * refunded / 2,
          createdAt: new Date(paid.getTime() - seconds * 1000),
        } });
        await db.orderItem.create({ data: {
          orderId: order.id, dishNameSnapshot: 'Чай', priceSnapshot: 50, quantity: 2, finalPrice: 100,
          refundedQuantity: refunded, updatedAt: new Date('2026-10-05T11:00:00.000Z'),
        } });
      };
      await createCheck(waiter, 120, { refunded: 1, finalAmount: 99 });
      await createCheck(cashier, 60);
      await createCheck(waiter, 60, { paid: new Date(paidAt.getTime() - 1) });
      await createCheck(waiter, 60, { refunded: 2, paymentStatus: 'refunded' });
      await createCheck(owner, 60);

      const staff = new StaffService(db, {});
      const all = await staff.waiterOrdersReport({ waiterId: 'all', from: date, to: date });
      assert.equal(all.summary.ordersCount, 2);
      assert.equal(all.summary.dishesCount, 3);
      assert.equal(all.summary.amount, 149.5);
      assert.equal(all.summary.averagePaymentSeconds, 90);
      assert.deepEqual(all.items.map((item) => item.waiterName).sort(), ['Кассир', 'Официант']);
      assert.ok(all.items.every((item) => item.paidAt === paidAt.toISOString()));

      const single = await staff.waiterOrdersReport({ waiterId: waiter.id, from: date, to: date });
      assert.equal(single.summary.ordersCount, 1);
      assert.equal(single.summary.amount, 49.5);
      assert.equal(single.summary.averagePaymentSeconds, 120);
      const shift = (await staff.shiftReport(date, { id: owner.id, role: 'OWNER' })).find(({ waiterId }) => waiterId === waiter.id);
      assert.equal(shift.turnover, 49.5);
      assert.equal(shift.cashDue, 49.5);
      assert.equal(shift.categories[0].amount, 49.5);

      await db.user.update({ where: { id: waiter.id }, data: { role: 'KITCHEN' } });
      const afterReassignment = await staff.waiterOrdersReport({ waiterId: 'all', from: date, to: date });
      assert.deepEqual(afterReassignment.items, all.items);
    });
  } finally {
    await db.$disconnect();
  }
});

test('work-time routes allow each employee to manage their own shift without staff management rights', async () => {
  const roles = new RolesGuard(new Reflector());
  const permissions = new PermissionsGuard(new Reflector());
  const call = (controller, method, user) => ({ getClass: () => controller, getHandler: () => controller.prototype[method],
    switchToHttp: () => ({ getRequest: () => ({ user, method: 'POST' }) }) });
  for (const role of ['WAITER', 'KITCHEN', 'BAR', 'ADMIN']) {
    const user = { id: role, role, permissions: getDefaultPermissionsByRole('KITCHEN') };
    for (const method of ['current', 'start', 'end']) {
      assert.equal(roles.canActivate(call(StaffShiftsController, method, user)), true);
      assert.equal(permissions.canActivate(call(StaffShiftsController, method, user)), true);
    }
    if (role !== 'WAITER') assert.throws(() => roles.canActivate(call(WaiterShiftsController, 'start', user)), { status: 403 });
  }
  const owner = { id: 'owner', role: 'OWNER' };
  assert.throws(() => roles.canActivate(call(StaffShiftsController, 'start', owner)), { status: 403 });
  assert.equal(await new StaffShiftsController({}).current(owner), null);
  const captured = [];
  const controller = new StaffShiftsController({ startStaff: (id) => captured.push(id), endStaff: (id) => captured.push(id) });
  controller.start({ id: 'self' });
  controller.end({ id: 'self' });
  assert.deepEqual(captured, ['self', 'self']);
});

test('PostgreSQL: work time for every position feeds payroll, reports and safe lifecycle handling', { skip: !databaseUrl }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Worktime test ' + randomUUID() } });
  const foreignCafe = await db.cafe.create({ data: { name: 'Worktime foreign ' + randomUUID() } });
  const audit = { log: async () => {} };
  const eventLog = [];
  const events = { emitToWaiter: (id, event, shift) => eventLog.push({ id, event, shift }), emitToAdmin: () => {} };
  const staff = new StaffService(db, audit);
  const positions = new PositionsController(db, audit);
  const shifts = new WaiterShiftsService(db, events);
  const createInput = (positionId) => ({ name: 'Worktime employee', positionId, phone: '+996' + randomInt(100000000, 999999999), password: 'test-password' });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = await db.user.create({ data: { name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'fixture' } });
      const ownerActor = { ...owner, permissions: getDefaultPermissionsByRole('OWNER') };
      const waiter = await db.user.create({ data: { name: 'Waiter', role: 'WAITER', phone: randomUUID(), passwordHash: 'fixture' } });
      const hall = await db.hall.create({ data: { name: 'Worktime hall' } });
      const table = await db.table.create({ data: { hallId: hall.id, number: 1 } });
      const now = new Date();
      const paid = await db.order.create({ data: { tableId: table.id, waiterId: waiter.id, orderNumber: randomUUID(),
        status: 'paid', finalAmount: 100, closedAt: new Date(now.getTime() - 3600000) } });
      const members = {};
      for (const role of ['ADMIN', 'KITCHEN', 'BAR']) {
        const position = await positions.create(ownerActor, { name: 'Табель ' + role, role, permissions: {},
          salary: { hourly: 120, perShift: 50, monthly: 0, personalPercent: 10, shiftPercent: 5 } });
        members[role] = { position, employee: await staff.create(createInput(position.id), ownerActor) };
      }

      await t.test('admin, kitchen and bar record work time and earn configured rates without opening the cash drawer', async () => {
        for (const { employee } of Object.values(members)) {
          const opened = await shifts.startStaff(employee.id);
          assert.equal(opened.employeeId, employee.id);
          assert.equal(opened.cafeId, cafe.id);
          assert.equal(opened.autoCloseAt.getTime() - opened.startedAt.getTime(), MAX_WORK_SHIFT_MS);
          assert.equal((await shifts.currentWithStats(employee.id)).stats.ordersCount, 0);
          await assert.rejects(shifts.startStaff(employee.id), { status: 400 });
          await assert.rejects(shifts.start(employee.id), { status: 403 }, 'legacy waiter route remains waiter-only');
          await db.waiterShift.update({ where: { id: opened.id }, data: { startedAt: new Date(now.getTime() - 2 * 3600000) } });
          const closed = await shifts.endStaff(employee.id);
          assert.equal(closed.status, 'closed');
          assert.equal(closed.autoCloseAt, null);
          assert.equal(closed.stats.ordersCount, 0);
          const row = (await payrollReport(db, cafe.id, currentPayrollMonth())).staff.find(({ userId }) => userId === employee.id);
          assert.ok(Math.abs(row.hours - 2) < 0.02);
          assert.ok(Math.abs(row.hourlyPay - 240) < 0.1);
          assert.equal(row.shiftPay, 50);
          assert.equal(row.personalCommission, 0, 'team turnover must not become personal sales');
          assert.equal(row.shiftCommission, 5);
          assert.equal(await shifts.currentWithStats(employee.id), null);
          const report = await staff.shiftReport(warehouseDay(now), ownerActor);
          assert.ok(report.find(({ waiterId }) => waiterId === employee.id).shiftStart);
        }
        assert.equal(await db.cashShift.count({ where: { cafeId: cafe.id } }), 0);
        await assert.rejects(shifts.startStaff(owner.id), { status: 403 });
      });

      await t.test('concurrent starts create one shift and an active shift blocks deactivation and workspace reassignment', async () => {
        const { employee } = members.KITCHEN;
        const starts = await Promise.allSettled([shifts.startStaff(employee.id), shifts.startStaff(employee.id)]);
        assert.equal(starts.filter(({ status }) => status === 'fulfilled').length, 1);
        assert.equal(await db.waiterShift.count({ where: { waiterId: employee.id, status: 'active' } }), 1);
        await assert.rejects(staff.update(employee.id, { isActive: false }, ownerActor), { status: 409 });
        await assert.rejects(staff.update(employee.id, { positionId: members.BAR.position.id }, ownerActor), { status: 409 });
        await shifts.endStaff(employee.id);
        const race = await Promise.allSettled([shifts.startStaff(employee.id), staff.update(employee.id, { isActive: false }, ownerActor)]);
        assert.equal(race.filter(({ status }) => status === 'fulfilled').length, 1);
        const member = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
        const active = await shifts.current(employee.id);
        assert.equal(!!active, member.isActive);
        if (active) await shifts.endStaff(employee.id);
        await staff.update(employee.id, { isActive: true }, ownerActor);
      });

      await t.test('Bishkek daily and history reports clip overnight work and exclude breaks', async () => {
        const { employee } = members.BAR;
        await db.waiterShift.createMany({ data: [
          { waiterId: employee.id, status: 'closed', startedAt: new Date('2026-01-14T23:30:00+06:00'), endedAt: new Date('2026-01-15T00:30:00+06:00') },
          { waiterId: employee.id, status: 'closed', startedAt: new Date('2026-01-15T02:00:00+06:00'), endedAt: new Date('2026-01-15T03:00:00+06:00') },
          { waiterId: employee.id, status: 'closed', startedAt: new Date('2026-01-14T21:00:00+06:00'), endedAt: new Date('2026-01-15T00:00:00+06:00') },
        ] });
        const row = (await staff.shiftReport('2026-01-15', ownerActor)).find(({ waiterId }) => waiterId === employee.id);
        assert.equal(row.durationMin, 90);
        assert.equal(row.shiftStart, '2026-01-14T17:30:00.000Z');
        const history = await staff.shiftHistory({ period: 'custom', from: '2026-01-15', to: '2026-01-15', employeeId: employee.id }, ownerActor);
        assert.equal(history.range.from, '2026-01-14T18:00:00.000Z');
        assert.equal(history.range.to, '2026-01-15T18:00:00.000Z');
        assert.equal(history.items.length, 2);
        assert.equal(history.summary.totalDurationMin, 90);
      });

      await t.test('manual corrections reject overlapping/future work and cannot reopen inactive employees', async () => {
        const employee = await staff.create(createInput(members.KITCHEN.position.id), ownerActor);
        const first = await db.waiterShift.create({ data: { waiterId: employee.id, status: 'closed',
          startedAt: new Date('2026-01-10T09:00:00+06:00'), endedAt: new Date('2026-01-10T10:00:00+06:00') } });
        await db.waiterShift.create({ data: { waiterId: employee.id, status: 'closed',
          startedAt: new Date('2026-01-10T11:00:00+06:00'), endedAt: new Date('2026-01-10T12:00:00+06:00') } });
        await assert.rejects(staff.updateShiftHistory(first.id, { endedAt: '2026-01-10T11:30:00+06:00' }, ownerActor), { status: 409 });
        await assert.rejects(staff.updateShiftHistory(first.id, { endedAt: new Date(Date.now() + 86400000).toISOString() }, ownerActor), { status: 400 });
        await staff.updateShiftHistory(first.id, { startedAt: '2026-01-10T08:30', endedAt: '2026-01-10T10:00' }, ownerActor);
        assert.equal((await db.waiterShift.findUniqueOrThrow({ where: { id: first.id } })).startedAt.toISOString(), '2026-01-10T02:30:00.000Z');
        await staff.update(employee.id, { isActive: false }, ownerActor);
        await assert.rejects(staff.updateShiftHistory(first.id, { endedAt: null }, ownerActor), { status: 400 });
      });

      await t.test('waiter shifts retain unpaid-order barriers and generic time tracking does not assign other roles to orders', async () => {
        const opened = await shifts.start(waiter.id);
        const order = await db.order.create({ data: { tableId: table.id, waiterId: waiter.id, waiterShiftId: opened.id,
          orderNumber: randomUUID(), status: 'waiting_payment' } });
        await assert.rejects(shifts.endStaff(waiter.id), { status: 400 });
        await assert.rejects(staff.closeShiftHistory(opened.id, ownerActor), { status: 409 });
        await assert.rejects(staff.updateShiftHistory(opened.id, { endedAt: new Date().toISOString() }, ownerActor), { status: 409 });
        await db.order.update({ where: { id: order.id }, data: { status: 'paid', finalAmount: 20, closedAt: new Date() } });
        const ended = await shifts.end(waiter.id);
        assert.equal(ended.stats.ordersCount, 1);
        assert.equal(ended.stats.totalAmount, '20');
        assert.equal((await db.order.findUniqueOrThrow({ where: { id: paid.id } })).waiterId, waiter.id);
      });

      await t.test('auto expiry caps forgotten work at 20 hours, preserves active orders and never changes a closed shift', async () => {
        const staleStart = new Date(Date.now() - 30 * 3600000);
        const expired = await db.waiterShift.create({ data: { waiterId: members.ADMIN.employee.id, startedAt: staleStart } });
        const waiterShift = await db.waiterShift.create({ data: { waiterId: waiter.id, startedAt: staleStart } });
        const order = await db.order.create({ data: { tableId: table.id, waiterId: waiter.id, waiterShiftId: waiterShift.id,
          orderNumber: randomUUID(), status: 'waiting_payment' } });
        const endedAt = new Date(staleStart.getTime() + 3600000);
        const closed = await db.waiterShift.create({ data: { waiterId: members.BAR.employee.id, startedAt: staleStart,
          endedAt, status: 'closed' } });
        const expiry = new ShiftExpiryService(db, events);
        await expiry.closeExpiredShifts();
        const row = await db.waiterShift.findUniqueOrThrow({ where: { id: expired.id } });
        assert.equal(row.status, 'closed');
        assert.equal(row.endedAt.getTime() - staleStart.getTime(), MAX_WORK_SHIFT_MS);
        assert.equal((await db.waiterShift.findUniqueOrThrow({ where: { id: waiterShift.id } })).status, 'active');
        assert.equal((await db.waiterShift.findUniqueOrThrow({ where: { id: closed.id } })).endedAt.getTime(), endedAt.getTime());
        await db.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
        await expiry.closeExpiredShifts();
        assert.equal((await db.waiterShift.findUniqueOrThrow({ where: { id: waiterShift.id } })).status, 'closed');
        assert.ok(eventLog.some(({ id, event }) => id === members.ADMIN.employee.id && event === 'waiter:shift_ended'));
      });

      await t.test('a tenant cannot start or read another cafe employee shift', async () => {
        const foreign = await runWithTenant({ cafeId: foreignCafe.id }, async () => {
          return await db.user.create({ data: { name: 'Foreign cook', role: 'KITCHEN', phone: randomUUID(), passwordHash: 'fixture' } });
        });
        await assert.rejects(shifts.startStaff(foreign.id), { status: 403 });
        assert.equal(await shifts.currentWithStats(foreign.id), null);
      });

      await t.test('personal sales follow the Bishkek payment day and remain visible after a position change', async () => {
        await db.order.create({ data: { tableId: table.id, waiterId: waiter.id, orderNumber: randomUUID(),
          status: 'paid', finalAmount: 42, createdAt: new Date('2026-01-14T23:55:00+06:00'), closedAt: new Date('2026-01-15T00:05:00+06:00') } });
        await staff.update(waiter.id, { positionId: members.BAR.position.id }, ownerActor);
        const report = await staff.waiterReport('today', '2026-01-15');
        assert.equal(report.find(({ id }) => id === waiter.id).revenue, 42);
        const details = await staff.waiterOrdersReport({ waiterId: waiter.id, from: '2026-01-15', to: '2026-01-15' });
        assert.equal(details.summary.ordersCount, 1);
        assert.equal(details.range.from, '2026-01-14T18:00:00.000Z');
        assert.equal(details.range.to, '2026-01-15T17:59:59.999Z');
        const day = (await staff.shiftReport('2026-01-15', ownerActor)).find(({ waiterId }) => waiterId === waiter.id);
        assert.equal(day.role, 'BAR');
        assert.equal(day.turnover, 42);
        assert.equal(day.isWaiter, true, 'sales details remain available for past waiter orders');
      });
    });
  } finally {
    const ids = [cafe.id, foreignCafe.id];
    await db.order.deleteMany({ where: { cafeId: { in: ids } } });
    await db.table.deleteMany({ where: { cafeId: { in: ids } } });
    await db.hall.deleteMany({ where: { cafeId: { in: ids } } });
    await db.user.deleteMany({ where: { cafeId: { in: ids } } });
    await db.cafe.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
