require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { CashShiftsService } = require('../src/cash-shifts/cash-shifts.module.ts');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { recordOrderReceipts, reverseOrderReceipts } = require('../src/finance/order-receipts.ts');
const { recordRefundReceipts } = require('../src/finance/refund-order-receipts.ts');
const { processingFeeSourcePrefix, processingFeeCategory } = require('../src/finance/payment-processing-fees.ts');
const { SettingsService } = require('../src/settings/settings.service.ts');
const { runWithTenant } = require('../src/tenant/tenant-context.ts');
const { warehouseDay } = require('../src/warehouse/report-range.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: shift snapshots rates and closes once with protected card and QR expenses on net settlements', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const cafe = await db.cafe.create({ data: { name: 'Acquiring ' + randomUUID() } });
  const cafeId = cafe.id;
  try {
    const makeUser = (role) => db.user.create({ data: { cafeId, role, name: role, phone: randomUUID(), passwordHash: 'fixture' } });
    const [owner, admin] = await Promise.all([makeUser('OWNER'), makeUser('ADMIN')]);
    const hall = await db.hall.create({ data: { cafeId, name: 'Acquiring' } });
    const table = await db.table.create({ data: { cafeId, hallId: hall.id, number: 1 } });
    const audit = { log: async () => {} };
    const shifts = new CashShiftsService(db, audit, {});
    const finance = new FinanceService(db, audit);
    const settings = new SettingsService(db, audit, { emitBroadcast: () => {} });
    const updateRates = (values, actor = owner) => runWithTenant({ cafeId }, () => settings.update(values, actor));

    async function pay(amounts) {
      const order = await db.order.create({ data: { cafeId, tableId: table.id, orderNumber: randomUUID(), status: 'paid' } });
      const payments = await Promise.all(amounts.map(([method, amount]) => db.payment.create({
        data: { cafeId, orderId: order.id, cashierId: owner.id, method, amount },
      })));
      await db.$transaction((tx) => recordOrderReceipts(tx, cafeId, order.id, owner.id, new Date()));
      return { order, payments };
    }
    function feeRows(shiftId) {
      return db.financeEntry.findMany({ where: { cafeId, cashShiftId: shiftId, sourceKey: { startsWith: processingFeeSourcePrefix } },
        orderBy: { paymentMethod: 'asc' }, include: { account: true, category: true } });
    }

    await shifts.setting(cafeId, true);
    await assert.rejects(updateRates({ cardProcessingFeeRate: 2.5 }, admin), { status: 403 });
    await assert.rejects(updateRates({ cardProcessingFeeRate: 100.0001 }), { status: 400 });
    await assert.rejects(updateRates({ qrProcessingFeeRate: 0.00001 }), { status: 400 });
    const beforeRates = await shifts.open(cafeId, owner.id, 0);
    await pay([['card', 50]]);
    const rates = await updateRates({ cardProcessingFeeRate: 2.5, qrProcessingFeeRate: 1 });
    assert.deepEqual([rates.cardProcessingFeeRate, rates.qrProcessingFeeRate], [2.5, 1]);
    await shifts.close(cafeId, owner.id, { shiftId: beforeRates.id, amount: 0, expectedAmount: 0 });
    assert.deepEqual(await feeRows(beforeRates.id), []);

    const shift = await shifts.open(cafeId, owner.id, 100);
    const { payments, order } = await pay([['cash', 80], ['card', 260.5], ['qr', 40.25]]);
    const returned = await pay([['card', 10.1]]);
    await db.$transaction(async (tx) => {
      await recordRefundReceipts(tx, cafeId, owner.id, randomUUID(), order.orderNumber, [
        { paymentId: payments[1].id, method: 'card', amount: '60.50' },
        { paymentId: payments[2].id, method: 'qr', amount: '0.25' },
      ], new Date());
      await reverseOrderReceipts(tx, cafeId, returned.order.id, owner.id);
    });
    await shifts.createOperation(cafeId, owner, shift.id, { kind: 'expense', amount: 10, requestKey: randomUUID() });
    await updateRates({ cardProcessingFeeRate: 4.5, qrProcessingFeeRate: 0 });
    assert.deepEqual(await feeRows(shift.id), []);
    assert.equal((await shifts.details(cafeId, shift.id)).summary.expectedAmount, 170);

    const closing = { shiftId: shift.id, amount: 170, expectedAmount: 170 };
    const closed = await shifts.close(cafeId, owner.id, closing);
    assert.deepEqual(await shifts.close(cafeId, owner.id, closing), closed);
    const fees = await feeRows(shift.id);
    assert.deepEqual(Object.fromEntries(fees.map(({ paymentMethod, amount }) => [paymentMethod, amount.toNumber()])), { card: -5, qr: -0.4 });
    for (const fee of fees) {
      assert.equal(fee.kind, 'expense');
      assert.equal(fee.account.type, 'noncash');
      assert.equal(fee.account.isDefault, true);
      assert.equal(fee.category.name, processingFeeCategory);
      assert.equal(fee.pendingCashShift, false);
      assert.equal(fee.occurredAt.getTime(), closed.closedAt.getTime());
      await assert.rejects(finance.updateTransaction(owner, fee.id, { note: 'Manual edit' }), { status: 400 });
      await assert.rejects(finance.reverseTransaction(owner, fee.id, 'Cancel'), { status: 400 });
      await assert.rejects(shifts.updateOperation(cafeId, owner, shift.id, fee.id), { status: 404 });
    }
    const { summary, movements } = await shifts.details(cafeId, shift.id);
    assert.deepEqual([summary.cashSales, summary.expenses, summary.processingFees, summary.expectedAmount, summary.actualAmount, summary.difference],
      [80, 10, 5.4, 170, 170, 0]);
    assert.deepEqual(movements.filter((row) => row.processingFee).map(({ cash, editable }) => [cash, editable]),
      [[false, false], [false, false]]);
    const day = warehouseDay(closed.closedAt);
    const report = await finance.profitLoss(owner, { from: day, to: day });
    assert.deepEqual(report.rows.filter((row) => [processingFeeCategory, 'Расходы'].includes(row.label)).map(({ label, value }) => [label, value]),
      [['Расходы', 15.4], [processingFeeCategory, 5.4]]);
    const accounts = (await finance.overview(owner, {})).accounts;
    assert.equal(accounts.find(({ type, isDefault }) => type === 'noncash' && isDefault).balance, 284.6);
    assert.equal(accounts.find(({ type, isDefault }) => type === 'cash' && isDefault).balance, 170);

    const next = await shifts.open(cafeId, owner.id, 170);
    await pay([['card', 100], ['qr', 150]]);
    await shifts.close(cafeId, owner.id, { shiftId: next.id, amount: 170, expectedAmount: 170 });
    assert.deepEqual((await feeRows(next.id)).map(({ paymentMethod, amount }) => [paymentMethod, amount.toNumber()]), [['card', -4.5]]);
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

test('PostgreSQL: fee follows actual settlement account across routing changes and late refunds', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const cafe = await db.cafe.create({ data: { name: 'Settlement routing ' + randomUUID() } });
  const cafeId = cafe.id;
  const foreignCafe = await db.cafe.create({ data: { name: 'Foreign bank ' + randomUUID() } });
  try {
    const owner = await db.user.create({ data: { cafeId, role: 'OWNER', name: 'Owner', phone: randomUUID(), passwordHash: 'fixture' } });
    const hall = await db.hall.create({ data: { cafeId, name: 'Settlement routing' } });
    const table = await db.table.create({ data: { cafeId, hallId: hall.id, number: 1 } });
    const audit = { log: async () => {} };
    const shifts = new CashShiftsService(db, audit, {});
    const finance = new FinanceService(db, audit);
    const settings = new SettingsService(db, audit, { emitBroadcast: () => {} });
    const patch = (values) => runWithTenant({ cafeId }, () => settings.update(values, owner));
    const [cardBank, qrBank, newBank, cashBank, foreignBank] = await Promise.all([
      finance.createAccount(owner, { type: 'noncash', name: 'Cards bank' }),
      finance.createAccount(owner, { type: 'noncash', name: 'QR bank' }),
      finance.createAccount(owner, { type: 'noncash', name: 'New cards bank' }),
      finance.createAccount(owner, { type: 'cash', name: 'Cash account' }),
      db.financeAccount.create({ data: { cafeId: foreignCafe.id, type: 'noncash', name: 'Foreign bank' } }),
    ]);
    const archived = await finance.createAccount(owner, { type: 'noncash', name: 'Archived bank' });
    await finance.archiveAccount(owner, archived.id);
    const manualCategory = await finance.createCategory(owner, { kind: 'expense', name: processingFeeCategory, showInProfitLoss: false });
    assert.ok((await settings.paymentAccounts(cafeId)).every(({ id }) => ![foreignBank.id, cashBank.id, archived.id].includes(id)));
    for (const forbidden of [foreignBank, cashBank, archived]) {
      await assert.rejects(patch({ cardSettlementAccountId: forbidden.id }), { status: 400 });
    }

    async function pay(card, qr) {
      const order = await db.order.create({ data: { cafeId, tableId: table.id, orderNumber: randomUUID(), status: 'paid' } });
      const payments = await Promise.all([['card', card], ['qr', qr]].map(([method, amount]) => db.payment.create({
        data: { cafeId, orderId: order.id, cashierId: owner.id, method, amount },
      })));
      await db.$transaction((tx) => recordOrderReceipts(tx, cafeId, order.id, owner.id, new Date()));
      return { order, payments };
    }
    const close = (shift) => shifts.close(cafeId, owner.id, { shiftId: shift.id, amount: 0, expectedAmount: 0 });
    const feeEntries = (cashShiftId) => db.financeEntry.findMany({
      where: { cafeId, cashShiftId, sourceKey: { startsWith: processingFeeSourcePrefix } },
      orderBy: { paymentMethod: 'asc' },
    });
    const byMethod = (rows) => Object.fromEntries(rows.map((row) => [
      row.paymentMethod, [row.accountId, row.amount.toNumber()],
    ]));

    await shifts.setting(cafeId, true);
    await patch({ cardSettlementAccountId: cardBank.id, qrSettlementAccountId: qrBank.id, cardProcessingFeeRate: 2, qrProcessingFeeRate: 1 });
    const first = await shifts.open(cafeId, owner.id, 0);
    await patch({ cardSettlementAccountId: newBank.id, qrSettlementAccountId: cardBank.id, cardProcessingFeeRate: 10 });
    await assert.rejects(finance.archiveAccount(owner, qrBank.id), { status: 409 }, 'open snapshot protects old account before any payment');
    await assert.rejects(finance.updateAccount(owner, newBank.id, { type: 'cash' }), { status: 409 }, 'configured account cannot become cash');
    const original = await pay(100, 300);
    const firstClosed = await close(first);
    assert.deepEqual(await close(first), firstClosed);
    const originalFees = await feeEntries(first.id);
    assert.deepEqual(byMethod(originalFees), { card: [cardBank.id, -2], qr: [qrBank.id, -3] });
    const categoryId = originalFees[0].categoryId;
    assert.equal(originalFees[1].categoryId, categoryId);
    assert.notEqual(categoryId, manualCategory.id);
    assert.equal((await db.financeCategory.findUniqueOrThrow({ where: { id: manualCategory.id } })).showInProfitLoss, false);
    assert.ok((await shifts.details(cafeId, first.id)).movements.some((row) => row.processingFee && row.accountName === 'QR bank'));
    const label = 'Комиссия банков';
    await finance.updateCategory(owner, categoryId, { name: label });
    await assert.rejects(finance.updateCategory(owner, categoryId, { showInProfitLoss: false }), { status: 409 });
    await assert.rejects(finance.deleteCategory(owner, categoryId), { status: 409 });
    await assert.rejects(finance.updateAccount(owner, qrBank.id, { type: 'cash' }), { status: 409 }, 'old refunds still use the original noncash account');

    const second = await shifts.open(cafeId, owner.id, 0);
    await pay(200, 160);
    await db.$transaction((tx) => recordRefundReceipts(tx, cafeId, owner.id, randomUUID(), original.order.orderNumber, [
      { paymentId: original.payments[0].id, method: 'card', amount: '100.00' },
      { paymentId: original.payments[1].id, method: 'qr', amount: '250.00' },
    ], new Date()));
    const refunds = await db.financeEntry.findMany({ where: { cafeId, kind: 'refund', cashShiftId: second.id } });
    assert.deepEqual(byMethod(refunds), { card: [cardBank.id, -100], qr: [qrBank.id, -250] });
    const secondClosed = await close(second);
    assert.deepEqual(await close(second), secondClosed);
    const newFees = await feeEntries(second.id);
    assert.deepEqual(byMethod(newFees), { card: [newBank.id, -20], qr: [cardBank.id, -1.6] });
    assert.ok(newFees.every((fee) => fee.categoryId === categoryId));
    await shifts.correctCashCount(cafeId, owner, first.id, { actualAmount: 1 });
    assert.deepEqual(await feeEntries(first.id), originalFees);
    assert.deepEqual(await feeEntries(second.id), newFees);
    const report = await finance.profitLoss(owner, { from: warehouseDay(firstClosed.closedAt), to: warehouseDay(secondClosed.closedAt) });
    assert.equal(report.rows.find((row) => row.label === label)?.value, 26.6);
    assert.ok(!report.rows.some((row) => row.label === processingFeeCategory));
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.payment.deleteMany({ where: { cafeId } });
    await db.order.deleteMany({ where: { cafeId } });
    await db.hall.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.settings.deleteMany({ where: { cafeId } });
    await db.cafe.deleteMany({ where: { id: { in: [cafeId, foreignCafe.id] } } });
    await db.$disconnect();
  }
});
