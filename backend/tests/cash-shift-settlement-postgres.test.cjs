require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { CashShiftsService } = require('../src/cash-shifts/cash-shifts.module.ts');
const { AuditAction } = require('../src/audit/audit.constants.ts');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { recordOrderReceipts, reverseOrderReceipts } = require('../src/finance/order-receipts.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: shift settlement posts sales and both collection legs once and reconciles later edits', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const cafe = await db.cafe.create({ data: { name: 'Cash shifts ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    const [owner, waiter] = await Promise.all(['OWNER', 'WAITER'].map((role) => db.user.create({
      data: { cafeId, name: role, phone: randomUUID(), passwordHash: 'fixture', role,
        permissions: { actions: { financeCashShifts: true } } },
    })));
    const hall = await db.hall.create({ data: { cafeId, name: 'Settlement' } });
    const table = await db.table.create({ data: { cafeId, hallId: hall.id, number: 1 } });
    const staffEvents = [];
    const shifts = new CashShiftsService(db, { log: async () => {} }, {
      emitToWaiter: (id, event, shift) => staffEvents.push({ id, event, shift }),
      emitToAdmin: (event, shift) => staffEvents.push({ event, shift }),
    });
    const finance = new FinanceService(db, { log: async () => {} });
    const balance = async () => {
      const overview = await finance.overview(owner, {});
      return {
        cash: overview.accounts.find((account) => account.isDefault && account.type === 'cash')?.balance,
        card: overview.accounts.find((account) => account.isDefault && account.type === 'noncash')?.balance,
        safe: overview.accounts.find((account) => account.isCollection)?.balance,
      };
    };
    async function pay(methods) {
      const order = await db.order.create({ data: { cafeId, tableId: table.id, orderNumber: randomUUID(), status: 'paid' } });
      await db.payment.createMany({ data: methods.map(([method, amount]) =>
        ({ cafeId, orderId: order.id, cashierId: waiter.id, method, amount })) });
      await db.$transaction((tx) => recordOrderReceipts(tx, cafeId, order.id, waiter.id, new Date()));
      return order;
    }
    const operation = (kind, amount, extra = {}) => ({ kind, amount, requestKey: randomUUID(), ...extra });

    await pay([['cash', 10]]);
    assert.deepEqual(await balance(), { cash: 10, card: 0, safe: undefined });
    await shifts.setting(cafeId, true);
    await assert.rejects(pay([['card', 30]]), { status: 409 });
    const shift = await shifts.open(cafeId, waiter.id, 100);
    assert.deepEqual(await balance(), { cash: 10, card: 0, safe: 0 });
    const mixedOrder = await pay([['cash', 150], ['card', 80]]);
    const returned = await pay([['cash', 12], ['card', 8]]);
    await db.$transaction((tx) => reverseOrderReceipts(tx, cafeId, returned.id, waiter.id));

    const category = await db.financeCategory.create({ data: { cafeId, name: 'Visible', kind: 'both', showOnPos: true } });
    const hidden = await db.financeCategory.create({ data: { cafeId, name: 'Hidden', kind: 'expense' } });
    const depositRequest = operation('income', 13, { categoryId: category.id, note: 'Удалённое внесение' });
    const deposit = await shifts.createOperation(cafeId, waiter, shift.id, depositRequest);
    assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 263);
    await shifts.updateOperation(cafeId, owner, shift.id, deposit.id);
    await shifts.updateOperation(cafeId, owner, shift.id, deposit.id);
    await assert.rejects(shifts.createOperation(cafeId, waiter, shift.id, depositRequest), { status: 409 });
    await assert.rejects(shifts.updateOperation(cafeId, owner, shift.id, deposit.id, { kind: 'income', amount: 15 }), { status: 409 });
    const deletedDeposit = (await shifts.movements(cafeId, shift.id)).find(({ id }) => id === deposit.id);
    assert.deepEqual([deletedDeposit.amount, deletedDeposit.category, deletedDeposit.note, deletedDeposit.actorName,
      deletedDeposit.deletedByName, deletedDeposit.editable], [13, 'Visible', 'Удалённое внесение', 'WAITER', 'OWNER', false]);
    assert.ok(deletedDeposit.deletedAt instanceof Date);
    assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 250);
    await assert.rejects(shifts.createOperation(cafeId, waiter, shift.id, operation('expense', 1, { categoryId: hidden.id })), { status: 400 });
    await shifts.createOperation(cafeId, waiter, shift.id, operation('income', 20, { categoryId: category.id }));
    const expense = await shifts.createOperation(cafeId, waiter, shift.id, operation('expense', 30, { categoryId: category.id }));
    const collection = operation('collection', 100);
    const transfer = await shifts.createOperation(cafeId, waiter, shift.id, collection);
    assert.equal((await shifts.createOperation(cafeId, waiter, shift.id, collection)).id, transfer.id);
    assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 140);
    assert.deepEqual(await balance(), { cash: 10, card: 0, safe: 0 });

    await assert.rejects(shifts.close(cafeId, waiter.id, { shiftId: shift.id, amount: 135, expectedAmount: 139 }), { status: 409 });
    const employeeShift = await db.waiterShift.create({ data: { cafeId, waiterId: waiter.id } });
    const activeOrder = await db.order.create({
      data: { cafeId, tableId: table.id, orderNumber: randomUUID(), waiterId: waiter.id, waiterShiftId: employeeShift.id, status: 'waiting_payment' },
    });
    const request = { shiftId: shift.id, amount: 135, expectedAmount: 140, closingComment: '  Проведена сверка  ', closeEmployeeShifts: true };
    await assert.rejects(shifts.close(cafeId, waiter.id, request), { status: 409 });
    assert.equal((await shifts.list(cafeId, true)).current.id, shift.id);
    assert.equal((await db.waiterShift.findUniqueOrThrow({ where: { id: employeeShift.id } })).status, 'active');
    assert.deepEqual(await balance(), { cash: 10, card: 0, safe: 0 });
    await db.order.update({ where: { id: activeOrder.id }, data: { status: 'paid' } });
    const [closed, retry] = await Promise.all([shifts.close(cafeId, waiter.id, request), shifts.close(cafeId, waiter.id, request)]);
    assert.equal(retry.id, closed.id);
    assert.equal(closed.difference, -5);
    assert.equal(closed.closingComment, 'Проведена сверка');
    assert.equal((await shifts.list(cafeId, true)).history[0].closingComment, 'Проведена сверка');
    assert.deepEqual(staffEvents.map(({ id, event, shift }) => [id, event, shift.id, shift.status]), [
      [waiter.id, 'waiter:shift_ended', employeeShift.id, 'closed'],
      [undefined, 'waiter:shift_ended', employeeShift.id, 'closed'],
    ]);
    assert.deepEqual(staffEvents[0].shift.endedAt, closed.closedAt);
    const closureJournal = await db.auditLog.findMany({ where: { cafeId, entityId: employeeShift.id, actionType: AuditAction.STAFF_SHIFT_CHANGED } });
    assert.equal(closureJournal.length, 1, 'retry should not duplicate the employee shift history');
    assert.equal(closureJournal[0].userId, waiter.id);
    assert.equal(closureJournal[0].metadata.kind, 'cash-close');
    assert.equal(closureJournal[0].oldValue.endedAt, null);
    assert.equal(closureJournal[0].newValue.endedAt, closed.closedAt.toISOString());
    await assert.rejects(shifts.close(cafeId, waiter.id, { ...request, closeEmployeeShifts: false }), { status: 409 });
    assert.deepEqual(await balance(), { cash: 135, card: 80, safe: 100 });
    const removedCollection = await shifts.createOperation(cafeId, owner, shift.id, operation('collection', 12, { note: 'Удалённая инкассация' }));
    assert.equal((await shifts.list(cafeId, true)).history[0].collectionAmount, 112);
    assert.deepEqual(await balance(), { cash: 135, card: 80, safe: 112 });
    await shifts.updateOperation(cafeId, owner, shift.id, removedCollection.id);
    assert.deepEqual(await balance(), { cash: 135, card: 80, safe: 100 });
    const report = await shifts.movements(cafeId, shift.id);
    assert.equal(report.filter((entry) => !entry.cash).reduce((total, entry) => total + entry.amount, 0), 80);
    assert.equal(report.filter((entry) => entry.kind === 'transfer' && !entry.deletedAt).length, 1);
    const deletedCollection = report.find(({ id }) => id === removedCollection.id);
    assert.deepEqual([deletedCollection.collection, deletedCollection.amount, deletedCollection.deletedByName], [true, -12, 'OWNER']);
    const ledger = await finance.overview(owner, {});
    assert.ok(!ledger.entries.some(({ id }) => id === deposit.id || id === removedCollection.id));
    assert.equal((await shifts.list(cafeId, true)).history[0].collectionAmount, 100);
    assert.equal(await db.financeEntry.count({ where: { cafeId, pendingCashShift: true } }), 0);

    await shifts.updateOperation(cafeId, owner, shift.id, expense.id, { kind: 'expense', amount: 35, categoryId: category.id });
    assert.equal((await shifts.list(cafeId, true)).history[0].difference, 0);
    assert.equal(await db.financeEntry.count({ where: { cafeId, sourceKey: 'cash-close:' + shift.id } }), 0);
    assert.deepEqual(await balance(), { cash: 135, card: 80, safe: 100 });

    const nextShift = await shifts.open(cafeId, waiter.id, 135);
    const bank = await db.financeAccount.findFirstOrThrow({ where: { cafeId, type: 'noncash', isDefault: true } });
    const nonCollection = await finance.post(owner, { kind: 'transfer', amount: 5, requestKey: randomUUID(),
      accountId: nextShift.accountId, destinationAccountId: bank.id });
    assert.equal((await shifts.list(cafeId, true)).current.collectionAmount, 0);
    assert.equal((await shifts.movements(cafeId, nextShift.id)).find(({ id }) => id === nonCollection.id).collection, false);
    await finance.reverseTransaction(owner, nonCollection.id, 'Undo test transfer to bank');
    await shifts.correctCashCount(cafeId, owner, shift.id, { actualAmount: 136 });
    assert.deepEqual(await balance(), { cash: 136, card: 80, safe: 100 });
    assert.equal((await shifts.list(cafeId, true)).current.openingDifference, -1);
    await assert.rejects(shifts.createOperation(cafeId, waiter, shift.id, operation('income', 1)), { status: 409 });
    await db.$transaction((tx) => reverseOrderReceipts(tx, cafeId, mixedOrder.id, waiter.id));
    assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, -15);
    assert.deepEqual(await balance(), { cash: 136, card: 80, safe: 100 });
    const nextEmployeeShift = await db.waiterShift.create({ data: { cafeId, waiterId: waiter.id } });
    await db.order.create({ data: { cafeId, tableId: table.id, orderNumber: randomUUID(), waiterId: waiter.id,
      waiterShiftId: nextEmployeeShift.id, status: 'waiting_payment' } });
    await shifts.setting(cafeId, undefined, true);
    assert.equal((await shifts.list(cafeId, true)).requireClosedOrders, true);
    await assert.rejects(shifts.close(cafeId, waiter.id, { shiftId: nextShift.id, amount: 0, expectedAmount: -15 }),
      /Закройте открытые заказы/);
    assert.equal((await shifts.list(cafeId, true)).current.id, nextShift.id);
    await shifts.setting(cafeId, undefined, false);
    const cashOnly = await shifts.close(cafeId, waiter.id, { shiftId: nextShift.id, amount: 0, expectedAmount: -15 });
    assert.equal(cashOnly.closingComment, null);
    assert.equal((await db.waiterShift.findUniqueOrThrow({ where: { id: nextEmployeeShift.id } })).status, 'active');
    assert.equal(staffEvents.length, 2);
    assert.deepEqual(await balance(), { cash: 0, card: 0, safe: 100 });

    const arithmetic = await shifts.open(cafeId, waiter.id, 1000);
    assert.equal((await shifts.list(cafeId, true)).current.collectionAmount, 0);
    await pay([['cash', 4500], ['card', 250], ['qr', 50]]);
    const refunded = await pay([['cash', 500]]);
    await db.$transaction((tx) => reverseOrderReceipts(tx, cafeId, refunded.id, waiter.id));
    await shifts.createOperation(cafeId, waiter, arithmetic.id, operation('income', 200));
    await shifts.createOperation(cafeId, waiter, arithmetic.id, operation('expense', 700));
    await shifts.createOperation(cafeId, waiter, arithmetic.id, operation('collection', 4000));
    const { summary } = await shifts.details(cafeId, arithmetic.id);
    assert.deepEqual(summary, {
      openingAmount: 1000, cashSales: 5000, cashRefunds: 500, noncashSales: 300, noncashRefunds: 0,
      deposits: 200, expenses: 700, collections: 4000, otherTransfers: 0, adjustments: 0,
      expectedAmount: 1000, actualAmount: null, difference: null,
    });
    await shifts.close(cafeId, waiter.id, { shiftId: arithmetic.id, amount: 1000, expectedAmount: 1000 });
    assert.deepEqual((await shifts.details(cafeId, arithmetic.id)).summary, { ...summary, actualAmount: 1000, difference: 0 });
  } finally {
    await db.auditLog.deleteMany({ where: { cafeId } });
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
