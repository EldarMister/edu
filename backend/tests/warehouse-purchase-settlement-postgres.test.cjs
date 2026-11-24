require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { AuditService } = require('../src/audit/audit.service.ts');
const { CashShiftsService } = require('../src/cash-shifts/cash-shifts.module.ts');
const { FinanceService } = require('../src/finance/finance.service.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { PurchaseSettlementService } = require('../src/warehouse/purchase-settlement.ts');
const { WarehouseSuppliersService } = require('../src/warehouse/suppliers.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: supplier settlement preserves stock, reconciles old invoices, and posts cash and bank amounts once', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Settlement ' + randomUUID() } });
  const cafeId = cafe.id;
  const audit = { log: async () => {} };
  const ingredients = new IngredientsService(db);
  const purchases = new PurchasesService(db);
  const settlement = new PurchaseSettlementService(db);
  const suppliers = new WarehouseSuppliersService(db);
  const finance = new FinanceService(db, audit);
  const shifts = new CashShiftsService(db, audit, { emitToWaiter() {}, emitToAdmin() {} });
  try {
    await runWithTenant({ cafeId }, async () => {
      const owner = await db.user.create({ data: { cafeId, name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'fixture' } });
      const flour = await ingredients.create({ name: 'Мука', unit: 'kg' });
      const supplier = await suppliers.save({ name: 'Поставщик' });
      const receipt = (purchasePrice, extra) => purchases.create({ supplierId: supplier.id, complete: true,
        items: [{ ingredientId: flour.id, quantity: 10, unit: 'kg', purchasePrice }], ...extra }, owner);
      const first = await receipt(100);
      const legacy = await receipt(200);
      await db.purchase.update({ where: { id: legacy.id }, data: { settlementKnownAt: null } });
      assert.deepEqual(await suppliers.settlements(), [{ supplierId: supplier.id, purchaseTotal: 3000, knownDebt: 1000, missingSettlementCount: 1 }]);
      assert.equal((await purchases.findOne(legacy.id)).debtAmount, null);

      const accounts = await settlement.accounts(owner);
      const bank = accounts.find(({ type }) => type === 'noncash');
      const cash = accounts.find(({ type }) => type === 'cash');
      const batch = (...lines) => ({ requestKey: randomUUID(), payments: lines.map(([accountId, amount]) => ({ accountId, amount })) });
      await assert.rejects(settlement.pay(owner, legacy.id, batch([bank.id, 10])), { status: 409 });
      const unauthorized = { ...owner, role: 'ADMIN', permissions: { sections: { warehouse: true }, actions: { warehouseReceive: true, warehouseCosts: true } } };
      await assert.rejects(settlement.pay(unauthorized, first.id, batch([bank.id, 10])), { status: 403 });
      for (const section of ['warehouse', 'finance']) {
        const viewOnly = { ...unauthorized, permissions: { ...unauthorized.permissions, sections: { warehouse: true, finance: true }, readOnlySections: [section] } };
        await assert.rejects(settlement.pay(viewOnly, first.id, batch([bank.id, 10])), { status: 403 });
      }

      const reconcile = { paidAmount: 500, reason: 'Подтверждено сверкой с поставщиком' };
      await settlement.reconcile(owner, legacy.id, reconcile);
      await settlement.reconcile(owner, legacy.id, reconcile);
      await db.auditLog.updateMany({ where: { cafeId, entityId: legacy.id }, data: { createdAt: new Date(Date.now() - 8 * 86400000) } });
      await new AuditService(db).purgeExpiredLogs();
      assert.equal(await db.financeEntry.count({ where: { cafeId } }), 0, 'opening settlement does not create a cash movement');
      assert.equal(await db.auditLog.count({ where: { cafeId, entityId: legacy.id, actionType: 'PURCHASE_SETTLEMENT_RECONCILED' } }), 1);
      const reconciled = await purchases.findOne(legacy.id, true);
      assert.equal(reconciled.reconciliation.paidAmount, 500);
      assert.equal(reconciled.debtAmount, 1500);
      const retiredPayment = await settlement.pay(owner, legacy.id, batch([bank.id, 10]));
      await settlement.reverse(owner, legacy.id, retiredPayment.paymentIds[0], 'Ошибочный счёт');
      assert.deepEqual((await purchases.findAll({}, true)).find(({ id }) => id === legacy.id).fundingAccounts, []);

      await shifts.setting(cafeId, true);
      await assert.rejects(settlement.pay(owner, first.id, batch([cash.id, 100])), { status: 409 });
      const shift = await shifts.open(cafeId, owner.id, 700);
      const tooMuchCash = batch([bank.id, 50], [cash.id, 750]);
      await assert.rejects(settlement.pay(owner, first.id, tooMuchCash), { status: 400 });
      assert.equal(await db.financeEntry.count({ where: { purchaseId: first.id } }), 0, 'an invalid second payment rolls back the whole batch');

      const partial = batch([cash.id, 400], [bank.id, 200]);
      const [saved, retry] = await Promise.all([settlement.pay(owner, first.id, partial), settlement.pay(owner, first.id, partial)]);
      assert.deepEqual(saved, retry);
      assert.equal(saved.paymentIds.length, 2);
      await assert.rejects(settlement.pay(owner, first.id, { ...partial, payments: [...partial.payments, { accountId: bank.id, amount: 20 }] }), { status: 409 });
      await assert.rejects(settlement.pay(owner, first.id, { ...partial, payments: partial.payments.map((row) => ({ ...row, occurredAt: new Date().toISOString() })) }), { status: 409 });
      await assert.rejects(settlement.pay(owner, first.id, batch([bank.id, 0])), { status: 400 });
      await assert.rejects(settlement.pay(owner, first.id, batch([bank.id, 401])), { status: 400 });
      const details = await purchases.findOne(first.id, true);
      assert.deepEqual([details.paymentStatus, details.paidAmount, details.debtAmount, details.payments.length], ['partly_paid', 600, 400, 2]);
      assert.equal((await purchases.findAll({})).find(({ id }) => id === first.id).fundingAccounts, undefined);
      const visible = (await purchases.findAll({}, true)).find(({ id }) => id === first.id);
      assert.deepEqual([...visible.fundingAccounts].sort(), [bank.name, cash.name].sort());
      await assert.rejects(purchases.exportXlsx({ columns: 'fundingAccounts' }), { status: 403 });
      const workbook = XLSX.read(await purchases.exportXlsx({ columns: 'number,fundingAccounts' }, true), { type: 'buffer' });
      const [header, ...listed] = XLSX.utils.sheet_to_json(workbook.Sheets['Поставки'], { header: 1 });
      assert.deepEqual(header, ['№', 'Счёт']);
      assert.ok(listed.some((row) => row[1]?.includes(bank.name) && row[1]?.includes(cash.name)));
      assert.equal((await shifts.list(cafeId, true)).current.expectedAmount, 300);
      assert.equal((await purchases.findAll({ paymentStatus: 'partly_paid' })).length, 2);

      const final = await settlement.pay(owner, first.id, batch([bank.id, 400]));
      assert.equal((await purchases.findOne(first.id)).paymentStatus, 'paid');
      const reverse = await settlement.reverse(owner, first.id, final.paymentIds[0], 'Ошибочный платёж');
      assert.deepEqual(reverse, await settlement.reverse(owner, first.id, final.paymentIds[0], 'Ошибочный платёж'));
      assert.equal((await purchases.findOne(first.id)).debtAmount, 400);
      await settlement.pay(owner, first.id, batch([bank.id, 400]));
      await shifts.close(cafeId, owner.id, { shiftId: shift.id, amount: 300, expectedAmount: 300 });
      await assert.rejects(settlement.reverse(owner, first.id, saved.paymentIds[0], 'Ошибка прошлой смены'), { status: 409 });
      const after = await finance.overview(owner, {});
      assert.equal(after.accounts.find(({ id }) => id === cash.id).balance, 300);
      assert.equal(after.accounts.find(({ id }) => id === bank.id).balance, -600);
      assert.equal(after.entries.find(({ id }) => id === saved.paymentIds[1]).purchaseId, first.id);
      assert.equal(await db.stockMovement.count({ where: { sourceType: 'purchase', sourceId: { in: [first.id, legacy.id] } } }), 2);
      const stock = await db.ingredient.findUniqueOrThrow({ where: { id: flour.id } });
      assert.equal(Number(stock.stock), 20000);
      assert.equal(Number(stock.avgCost), 0.15);
      assert.deepEqual(await suppliers.settlements(), [{ supplierId: supplier.id, purchaseTotal: 3000, knownDebt: 1500, missingSettlementCount: 0 }]);

      const invoice = await receipt(300);
      const unpaid = await purchases.findOne(invoice.id, true);
      assert.deepEqual([unpaid.debtAmount, unpaid.payments.length], [3000, 0]);
      const firstInstallment = batch([bank.id, 1000]);
      const secondInstallment = batch([bank.id, 2000]);
      await settlement.pay(owner, invoice.id, firstInstallment);
      assert.equal((await purchases.findOne(invoice.id)).debtAmount, 2000);
      await settlement.pay(owner, invoice.id, secondInstallment);
      await settlement.pay(owner, invoice.id, secondInstallment);
      const paid = await purchases.findOne(invoice.id, true);
      assert.deepEqual([paid.debtAmount, paid.payments.length], [0, 2]);
      assert.equal(await db.stockMovement.count({ where: { sourceType: 'purchase', sourceId: invoice.id } }), 1);
      assert.equal(Number((await db.ingredient.findUniqueOrThrow({ where: { id: flour.id } })).stock), 30000);
    });
  } finally {
    await db.financeEntry.deleteMany({ where: { cafeId } });
    await db.cashShift.deleteMany({ where: { cafeId } });
    await db.settings.deleteMany({ where: { cafeId } });
    await db.stockMovement.deleteMany({ where: { cafeId } });
    await db.purchase.deleteMany({ where: { cafeId } });
    await db.ingredient.deleteMany({ where: { cafeId } });
    await db.auditLog.deleteMany({ where: { cafeId } });
    await db.user.deleteMany({ where: { cafeId } });
    await db.cafe.delete({ where: { id: cafeId } });
    await db.$disconnect();
  }
});
