require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { CashShiftsService } = require('../src/cash-shifts/cash-shifts.module.ts');
const { CashHandoverService } = require('../src/finance/cash-handover.service.ts');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { recordOrderReceipts } = require('../src/finance/order-receipts.ts');
const { recordRefundReceipts } = require('../src/finance/refund-order-receipts.ts');
const { warehouseDay } = require('../src/warehouse/report-range.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: a waiter’s cash reaches the drawer once at handover and has a separate receipt date', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const { id: cafeId } = await db.cafe.create({ data: { name: 'Cash handover ' + randomUUID() } });
  const audit = { log: async () => {} };
  const finance = new FinanceService(db, audit);
  const handover = new CashHandoverService(db, audit);
  const shifts = new CashShiftsService(db, audit, {});
  try {
    const [owner, waiter, manager] = await Promise.all(['OWNER', 'WAITER', 'ADMIN'].map((role) => db.user.create({
      data: { cafeId, role, name: role, phone: randomUUID(), passwordHash: 'fixture' },
    })));
    const viewOnly = { ...manager, permissions: { sections: { finance: true }, readOnlySections: ['finance'] } };
    const hall = await db.hall.create({ data: { cafeId, name: 'Test hall' } });
    const table = await db.table.create({ data: { cafeId, hallId: hall.id, number: 1 } });
    const yesterday = new Date(Date.now() - 86_400_000);
    const saleDay = warehouseDay(yesterday);
    const today = warehouseDay(new Date());
    const history = { from: saleDay, to: today };
    const salesDay = { from: saleDay, to: saleDay };

    const balances = async () => {
      const overview = await finance.overview(owner, history);
      return [overview.accounts.find(({ type }) => type === 'cash').balance,
        overview.accounts.find(({ type }) => type === 'noncash').balance];
    };
    const pay = async (actor, methods, now) => db.$transaction(async (tx) => {
      const order = await tx.order.create({ data: { cafeId, tableId: table.id, orderNumber: randomUUID() } });
      const payments = await Promise.all(methods.map(([method, amount]) => tx.payment.create({
        data: { cafeId, orderId: order.id, cashierId: actor.id, method, amount },
      })));
      await recordOrderReceipts(tx, cafeId, order.id, actor.id, now);
      return { order, payments };
    });
    const refund = (payment, amount) => db.$transaction((tx) => recordRefundReceipts(tx, cafeId, owner.id, randomUUID(), '1',
      [{ paymentId: payment.id, method: payment.method, amount: String(amount) }], new Date()));
    const receipt = { employeeId: waiter.id, date: saleDay, amount: 75 };

    await pay(waiter, [['cash', 10]], yesterday);
    assert.deepEqual(await balances(), [10, 0]);
    assert.deepEqual((await handover.report(owner, history)).rows, []);
    await assert.rejects(handover.setEnabled({ ...viewOnly, permissions: { sections: { finance: true } } }, true), { status: 403 });
    await handover.setEnabled(owner, true);
    const sale = await pay(waiter, [['cash', 100], ['card', 45]], yesterday);
    await pay(owner, [['cash', 20]], yesterday);
    assert.deepEqual(await balances(), [30, 45]);
    const cash = sale.payments[0];
    await refund(cash, 10);
    const before = (await handover.report(viewOnly, salesDay)).rows[0];
    assert.deepEqual([before.due, before.received, before.difference], [90, null, -90]);
    await assert.rejects(handover.receive(viewOnly, receipt), { status: 403 });

    await shifts.setting(cafeId, true);
    await assert.rejects(handover.receive(owner, receipt), { status: 409 });
    const shift = await shifts.open(cafeId, owner.id, 30);
    assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 30);
    await Promise.all([handover.receive(owner, receipt), handover.receive(owner, receipt)]);
    assert.deepEqual(await balances(), [105, 45]);
    assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 105);
    const recorded = (await handover.report(owner, history)).rows[0];
    assert.deepEqual([recorded.due, recorded.received, recorded.difference], [90, 75, -15]);
    await assert.rejects(handover.receive(owner, { ...receipt, amount: 80 }), { status: 409 });
    await handover.receive(owner, { ...receipt, amount: 80, expectedReceivedAt: recorded.receivedAt.toISOString() });
    assert.deepEqual(await balances(), [110, 45]);
    assert.deepEqual((await handover.report(owner, salesDay)).daily, []);
    assert.deepEqual((await handover.report(owner, { from: today, to: today })).daily, [{ date: today, amount: 80 }]);

    await refund(cash, 20);
    assert.equal((await handover.report(owner, history)).rows[0].due, 80);
    assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 100);
    await shifts.close(cafeId, owner.id, { shiftId: shift.id, amount: 100, expectedAmount: 100 });
    assert.deepEqual(await balances(), [100, 45]);
    const ledger = await finance.overview(owner, { from: today, to: today });
    assert.deepEqual([ledger.flow.opening, ledger.flow.income, ledger.flow.expense, ledger.flow.closing], [75, 80, 10, 145]);
    assert.equal(await db.financeEntry.count({ where: { cafeId, sourceKey: { startsWith: 'cash-handover:' } } }), 2);
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.payment.deleteMany({ where: { cafeId } });
    await db.order.deleteMany({ where: { cafeId } });
    await db.hall.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.settings.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
