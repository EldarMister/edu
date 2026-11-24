require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomInt, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { StaffService } = require('../src/admin/staff.service.ts');
const { PositionsController } = require('../src/admin/positions.controller.ts');
const { AuthService } = require('../src/auth/auth.service.ts');
const { JwtStrategy } = require('../src/auth/strategies/jwt.strategy.ts');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { currentPayrollMonth, payrollPeriodReport } = require('../src/finance/payroll.ts');
const { WaiterShiftsService } = require('../src/waiter-shifts/waiter-shifts.service.ts');
const { CashShiftsService } = require('../src/cash-shifts/cash-shifts.module.ts');
const { warehouseDay } = require('../src/warehouse/report-range.ts');

const databaseUrl = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (databaseUrl && (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)
  || !new URL(databaseUrl).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('PostgreSQL: positions determine employee access, support safe reassignment and cannot be bypassed', { skip: !databaseUrl }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Staff positions test ' + randomUUID() } });
  const foreignCafe = await db.cafe.create({ data: { name: 'Foreign staff test ' + randomUUID() } });
  const audit = { log: async () => {} };
  const staff = new StaffService(db, audit);
  const positions = new PositionsController(db, audit);
  const input = (positionId) => ({ name: 'Employee', positionId, phone: '+996' + randomInt(100000000, 999999999), password: 'Test-only-password' });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = await db.user.create({ data: { name: 'Owner', phone: randomUUID(), passwordHash: 'fixture', role: 'OWNER' } });
      const ownerActor = { ...owner, permissions: getDefaultPermissionsByRole('OWNER') };
      const managerPerms = getDefaultPermissionsByRole('ADMIN');
      managerPerms.actions.manageStaff = true;
      const manager = await db.user.create({ data: { name: 'Manager', phone: randomUUID(), passwordHash: 'fixture', role: 'ADMIN', permissions: managerPerms } });
      const managerActor = { ...manager, permissions: managerPerms };
      const cashier = await positions.create(ownerActor, { name: 'Кассир', role: 'WAITER', permissions: { actions: { financeCashShifts: true } } });
      const waiter = await positions.create(ownerActor, { name: 'Стажёр', role: 'WAITER', permissions: {} });
      const cook = await positions.create(ownerActor, { name: 'Повар со складом', role: 'KITCHEN', permissions: {
        sections: { warehouse: true }, actions: { warehouseReceive: true, warehouseCosts: false, manageStaff: true },
      } });
      const administrator = await positions.create(ownerActor, { name: 'Управляющий', role: 'ADMIN', permissions: managerPerms });
      const foreignPosition = await runWithTenant({ cafeId: foreignCafe.id }, async () => await db.staffPosition.findFirst({ where: { role: 'WAITER' } }));

      await t.test('creation uses position alone, rejects mismatches, null and foreign positions', async () => {
        const employee = await staff.create(input(cook.id), ownerActor);
        assert.equal(employee.role, 'KITCHEN');
        assert.equal(employee.positionId, cook.id);
        assert.equal(employee.permissions.sections.warehouse, true);
        assert.equal(employee.permissions.actions.warehouseReceive, true);
        assert.equal(employee.permissions.actions.warehouseCosts, false);
        assert.equal(employee.permissions.actions.manageStaff, false, 'unsupported kitchen privileges cannot be stored');
        await assert.rejects(staff.create({ ...input(cook.id), role: 'ADMIN' }, ownerActor), { status: 400 });
        await assert.rejects(staff.create({ ...input(null), role: 'WAITER' }, ownerActor), { status: 400 });
        await assert.rejects(staff.create(input(foreignPosition.id), ownerActor), { status: 404 });
      });

      await t.test('saving disabled position sections also disables their dependent actions', async () => {
        const permissions = getDefaultPermissionsByRole('OWNER');
        Object.assign(permissions.sections, { menu: false, checks: false, staff: false, warehouse: false });
        const restricted = await positions.create(ownerActor, { name: 'Ограниченное управление', role: 'ADMIN', permissions });
        const saved = await db.staffPosition.findUniqueOrThrow({ where: { id: restricted.id } });
        for (const action of ['editMenu', 'refundChecks', 'manageStaff']) assert.equal(saved.permissions.actions[action], false);
        for (const [action, enabled] of Object.entries(saved.permissions.actions)) {
          if (action.startsWith('warehouse')) assert.equal(enabled, false, action);
        }
        for (const action of ['financeCashShifts', 'exportReports', 'closeShift']) assert.equal(saved.permissions.actions[action], true);
        const enabled = await positions.create(ownerActor, { name: 'Изменение доступа', role: 'ADMIN', permissions: getDefaultPermissionsByRole('OWNER') });
        const changed = await positions.update(ownerActor, enabled.id, { name: enabled.name, permissions });
        assert.equal(changed.permissions.actions.refundChecks, false);
        assert.equal(changed.permissions.actions.manageStaff, false);
        for (const role of ['KITCHEN', 'BAR']) {
          const position = await positions.create(ownerActor, { name: 'Закрытый склад ' + role, role, permissions });
          assert.equal(position.permissions.sections.warehouse, false);
          for (const [action, allowed] of Object.entries(position.permissions.actions)) {
            if (action.startsWith('warehouse')) assert.equal(allowed, false, action);
          }
        }
      });

      await t.test('a rate can be scheduled ahead of an existing future rate without repricing past work', async () => {
        const day = (offset) => warehouseDay(new Date(Date.now() + offset * 86_400_000));
        const category = await db.category.create({ data: { id: 'legacy-' + randomUUID(), name: 'Салаты' } });
        const firstRate = { hourly: 100, perShift: 0, monthly: 0, personalPercent: 5, shiftPercent: 0 };
        const position = await positions.create(ownerActor, { name: 'График ставок', role: 'WAITER', salary: firstRate });
        const employee = await staff.create(input(position.id), ownerActor);
        const nextRate = { name: position.name, salary: { ...firstRate, hourly: 200 },
          categoryRates: [{ categoryId: category.id, personalPercent: 0 }] };
        await positions.update(ownerActor, position.id, { ...nextRate, salaryEffectiveDay: day(12) });
        await positions.update(ownerActor, position.id, { ...nextRate, salaryEffectiveDay: day(4) });
        const employeeRates = await db.employeeSalaryRate.findMany({ where: { userId: employee.id }, orderBy: { effectiveDay: 'asc' } });
        assert.deepEqual(employeeRates.map((rate) => [rate.effectiveDay, +rate.hourly]),
          [[day(0), 100], [day(4), 200], [day(12), 200]]);
        assert.equal(employeeRates[1].categoryRates[0].personalPercent, 0);
        await assert.rejects(positions.update(ownerActor, position.id, { ...nextRate, salaryEffectiveDay: day(0) }), { status: 400 });
      });

      await t.test('manager can choose custom positions within own access but cannot escalate', async () => {
        const available = await staff.positions(managerActor);
        assert.ok(available.some(({ id }) => id === waiter.id));
        assert.ok(available.some(({ id }) => id === cook.id));
        assert.ok(!available.some(({ id }) => id === cashier.id));
        assert.ok(!available.some(({ id }) => id === administrator.id));
        const employee = await staff.create(input(waiter.id), managerActor);
        assert.equal(employee.canManage, true);
        await staff.update(employee.id, { name: 'Renamed' }, managerActor);
        await assert.rejects(staff.update(employee.id, { positionId: cashier.id }, managerActor), { status: 403 });
        await assert.rejects(staff.create(input(administrator.id), managerActor), { status: 403 });
        const protectedEmployee = await staff.create(input(cashier.id), ownerActor);
        assert.equal((await staff.getOne(protectedEmployee.id, managerActor)).canManage, false);
        await assert.rejects(staff.update(protectedEmployee.id, { password: 'reset' }, managerActor), { status: 403 });
        const moved = await staff.update(employee.id, { positionId: cook.id }, managerActor);
        assert.equal(moved.role, 'KITCHEN');
        assert.equal(moved.positionId, cook.id);
      });

      await t.test('position edits change existing session rights and override legacy individual permissions', async () => {
        const employee = await staff.create(input(cashier.id), ownerActor);
        await db.user.update({ where: { id: employee.id }, data: { permissions: { actions: { financeCashShifts: true } } } });
        const auth = new AuthService(db, {});
        const strategy = new JwtStrategy(db);
        assert.equal((await auth.me(employee.id)).permissions.actions.financeCashShifts, true);
        await positions.update(ownerActor, cashier.id, { name: 'Кассир', permissions: { actions: { financeCashShifts: false } } });
        assert.equal((await auth.me(employee.id)).permissions.actions.financeCashShifts, false);
        const actor = await strategy.validate({}, { sub: employee.id, role: 'OWNER' });
        assert.equal(actor.role, 'WAITER', 'an old token never overrides database role');
        assert.equal(actor.permissions.actions.financeCashShifts, false);
        await assert.rejects(staff.update(employee.id, { positionId: null }, ownerActor), { status: 400 });
        await assert.rejects(staff.update(employee.id, { positionId: cook.id }, actor), { status: 403 });
      });

      await t.test('partial updates preserve the assigned position’s other access rules', async () => {
        const position = await positions.create(ownerActor, {
          name: 'Кассир с ограниченным доступом',
          role: 'ADMIN',
          permissions: {
            terminalAccess: true,
            adminAccess: false,
            sections: { orders: false, warehouse: true },
            readOnlySections: ['warehouse'],
            workShiftRequired: false,
            actions: { acceptOrderPayments: false },
          },
        });
        const employee = await staff.create(input(position.id), ownerActor);
        await positions.update(ownerActor, position.id, {
          name: position.name,
          permissions: { actions: { printReceipts: true } },
        });
        const { access, permissions } = await new AuthService(db, {}).me(employee.id);
        assert.deepEqual(access, { terminal: true, admin: false, production: null });
        assert.equal(permissions.actions.printReceipts, true);
        assert.equal(permissions.actions.acceptOrderPayments, false);
        assert.equal(permissions.sections.orders, false);
        assert.deepEqual(permissions.readOnlySections, ['warehouse']);
        assert.equal(permissions.workShiftRequired, false);
      });

      await t.test('workspace changes wait for active shifts and atomically reset station and personal access', async () => {
        const employee = await staff.create(input(waiter.id), ownerActor);
        const shift = await db.waiterShift.create({ data: { waiterId: employee.id } });
        await assert.rejects(staff.update(employee.id, { positionId: cook.id }, ownerActor), { status: 409 });
        assert.equal((await staff.getOne(employee.id, ownerActor)).role, 'WAITER');
        await db.waiterShift.update({ where: { id: shift.id }, data: { status: 'closed', endedAt: new Date() } });
        await db.user.update({ where: { id: employee.id }, data: { permissions: managerPerms } });
        const changed = await staff.update(employee.id, { positionId: cook.id }, ownerActor);
        assert.equal(changed.role, 'KITCHEN');
        assert.equal(changed.prepStation, null);
        assert.equal((await db.user.findUnique({ where: { id: employee.id } })).permissions, null);
      });

      await t.test('removal transfers employees to another workspace and preserves salary snapshots', async () => {
        const source = await positions.create(ownerActor, { name: 'Удаляемая', role: 'WAITER', permissions: {} });
        const employee = await staff.create(input(source.id), ownerActor);
        const shift = await db.waiterShift.create({ data: { waiterId: employee.id } });
        await assert.rejects(positions.remove(ownerActor, source.id, { replacementPositionId: cook.id }), { status: 409 });
        assert.ok(await db.staffPosition.findUnique({ where: { id: source.id } }));
        await db.waiterShift.update({ where: { id: shift.id }, data: { status: 'closed', endedAt: new Date() } });
        await positions.remove(ownerActor, source.id, { replacementPositionId: cook.id });
        const changed = await staff.getOne(employee.id, ownerActor);
        assert.equal(changed.role, 'KITCHEN');
        assert.equal(changed.positionId, cook.id);
        assert.equal(await db.staffPosition.findUnique({ where: { id: source.id } }), null);
        const rates = await db.employeeSalaryRate.findMany({ where: { userId: employee.id }, orderBy: { effectiveDay: 'desc' } });
        assert.equal(rates[0].positionId, cook.id);
        assert.equal(rates.length, 2);
      });

      await t.test('legacy role-only clients always obtain a real position or an explicit error', async () => {
        const employee = await staff.create({ ...input(undefined), role: 'BAR' }, ownerActor);
        assert.ok(employee.positionId);
        const starter = await db.staffPosition.findFirst({ where: { role: 'BAR', isStarter: true } });
        await positions.remove(ownerActor, starter.id, { replacementPositionId: cook.id });
        await assert.rejects(staff.create({ ...input(undefined), role: 'BAR' }, ownerActor), { status: 400 });
      });

      await t.test('removing staff with no orders retains closed shifts and payroll history', async () => {
        const employee = await staff.create(input(waiter.id), ownerActor);
        const month = currentPayrollMonth();
        const shift = await db.waiterShift.create({ data: { waiterId: employee.id, status: 'closed',
          startedAt: new Date(month + '-01T09:00:00+06:00'), endedAt: new Date(month + '-01T10:00:00+06:00') } });
        const accrual = await db.salaryAccrual.create({ data: { cafeId: cafe.id, userId: employee.id,
          employeeName: employee.name, month, amount: 100, actorId: owner.id, requestKey: randomUUID() } });
        assert.equal(await db.order.count({ where: { waiterId: employee.id } }), 0);
        await staff.remove(employee.id, ownerActor);
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).isActive, false);
        assert.ok(await db.waiterShift.findUnique({ where: { id: shift.id } }));
        assert.ok(await db.salaryAccrual.findUnique({ where: { id: accrual.id } }));
        const report = await payrollPeriodReport(db, cafe.id, month + '-01', month + '-02');
        const row = report.staff.find(({ userId }) => userId === employee.id);
        assert.equal(row.hours, 1);
        assert.equal(row.accrued, 100);
        assert.equal(row.due, 100);
      });

      await t.test('deactivation and removal reject unfinished shifts and retain access until they close', async () => {
        const employee = await staff.create(input(waiter.id), ownerActor);
        const shift = await db.waiterShift.create({ data: { waiterId: employee.id } });
        await assert.rejects(staff.update(employee.id, { isActive: false }, ownerActor), { status: 409 });
        await assert.rejects(staff.remove(employee.id, ownerActor), { status: 409 });
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).isActive, true);
        await db.waiterShift.update({ where: { id: shift.id }, data: { status: 'closed', endedAt: new Date() } });
        await staff.remove(employee.id, ownerActor);
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).isActive, false);
        assert.ok(await db.waiterShift.findUnique({ where: { id: shift.id } }));
      });

      await t.test('cashier history is retained and only an unused employee is physically removed', async () => {
        const employee = await staff.create(input(waiter.id), ownerActor);
        const account = await db.financeAccount.create({ data: { cafeId: cafe.id, name: 'Staff test drawer', type: 'cash' } });
        const cashShift = await db.cashShift.create({ data: { cafeId: cafe.id, accountId: account.id,
          openedById: employee.id, openingAmount: 0 } });
        await assert.rejects(staff.update(employee.id, { isActive: false }, ownerActor), { status: 409 });
        await assert.rejects(staff.remove(employee.id, ownerActor), { status: 409 });
        await db.cashShift.update({ where: { id: cashShift.id }, data: { closedById: employee.id, closedAt: new Date() } });
        await staff.remove(employee.id, ownerActor);
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).isActive, false);
        assert.ok(await db.cashShift.findUnique({ where: { id: cashShift.id } }));
        const unused = await staff.create(input(waiter.id), ownerActor);
        await staff.remove(unused.id, ownerActor);
        assert.equal(await db.user.findUnique({ where: { id: unused.id } }), null);
      });

      await t.test('starting a shift and deactivating the employee serialize without stranding a shift', async () => {
        const employee = await staff.create(input(waiter.id), ownerActor);
        const shifts = new WaiterShiftsService(db, { emitToWaiter: () => {}, emitToAdmin: () => {} });
        const outcomes = await Promise.allSettled([
          shifts.start(employee.id), staff.update(employee.id, { isActive: false }, ownerActor),
        ]);
        assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
        const user = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
        const open = await db.waiterShift.count({ where: { waiterId: employee.id, status: 'active' } });
        assert.equal(open, user.isActive ? 1 : 0);
        if (user.isActive) {
          await db.waiterShift.updateMany({ where: { waiterId: employee.id }, data: { status: 'closed', endedAt: new Date() } });
          await staff.update(employee.id, { isActive: false }, ownerActor);
        }
        await assert.rejects(shifts.start(employee.id), { status: 403 });
      });

      await t.test('cash shift opening rechecks live access and serializes with employee deactivation', async () => {
        const shifts = new CashShiftsService(db, audit, { emitToWaiter: () => {}, emitToAdmin: () => {} });
        await shifts.setting(cafe.id, true);
        const position = await positions.create(ownerActor, { name: 'Кассир для проверки открытия', role: 'WAITER',
          permissions: { actions: { financeCashShifts: true } } });
        const employee = await staff.create(input(position.id), ownerActor);
        await staff.update(employee.id, { isActive: false }, ownerActor);
        await assert.rejects(shifts.open(cafe.id, employee.id, 0), { status: 403 });
        await staff.update(employee.id, { isActive: true }, ownerActor);
        await db.user.update({ where: { id: employee.id }, data: { permissions: { actions: { financeCashShifts: true } } } });
        await positions.update(ownerActor, position.id, { name: position.name, permissions: { actions: { financeCashShifts: false } } });
        await assert.rejects(shifts.open(cafe.id, employee.id, 0), { status: 403 });
        await positions.update(ownerActor, position.id, { name: position.name, permissions: { actions: { financeCashShifts: true } } });
        const kitchen = await staff.create(input(cook.id), ownerActor);
        await assert.rejects(shifts.open(cafe.id, kitchen.id, 0), { status: 403 });
        const outcomes = await Promise.allSettled([
          shifts.open(cafe.id, employee.id, 0), staff.update(employee.id, { isActive: false }, ownerActor),
        ]);
        assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
        const user = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
        const open = await db.cashShift.findFirst({ where: { cafeId: cafe.id, closedAt: null } });
        assert.equal(!!open, user.isActive);
        if (open) {
          await shifts.close(cafe.id, owner.id, { shiftId: open.id, amount: 0, expectedAmount: 0 });
          await staff.update(employee.id, { isActive: false }, ownerActor);
        }
        await assert.rejects(shifts.open(cafe.id, employee.id, 0), { status: 403 });
      });
    });
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId: { in: [cafe.id, foreignCafe.id] } } });
    await db.cashShift.deleteMany({ where: { cafeId: { in: [cafe.id, foreignCafe.id] } } });
    await db.settings.deleteMany({ where: { cafeId: { in: [cafe.id, foreignCafe.id] } } });
    await db.user.deleteMany({ where: { cafeId: { in: [cafe.id, foreignCafe.id] } } });
    await db.category.deleteMany({ where: { cafeId: { in: [cafe.id, foreignCafe.id] } } });
    await db.cafe.deleteMany({ where: { id: { in: [cafe.id, foreignCafe.id] } } });
    await db.$disconnect();
  }
});
