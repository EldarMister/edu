require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: reopening a physical count allows corrections while newer actual quantities still anchor the ledger', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Reopen count ' + randomUUID() } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const employee = (name, role) => db.user.create({ data: { cafeId: cafe.id, role, name, phone: 'inventory-test-' + randomUUID(), passwordHash: 'test' } });
      const owner = await employee('Owner', 'OWNER');
      const clerk = { ...await employee('Clerk', 'ADMIN'), permissions: { actions: { warehouseCount: true } } };
      const manager = { ...clerk, permissions: { actions: { warehouseCount: true, warehouseApprove: true } } };
      const ingredients = new IngredientsService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const documents = new WarehouseDocumentsService(db);
      const purchases = new PurchasesService(db);
      const [main] = (await locations.list(cafe.id)).locations;
      const bar = await locations.save(cafe.id, 'Bar');
      const flour = await ingredients.create({ name: 'Flour', unit: 'pcs', stock: 10, avgCost: 2 });
      const items = (quantity) => [{ ingredientId: flour.id, quantity }];
      const count = (quantity, countedAt) => documents.create(owner, { kind: 'inventory', mode: 'partial',
        warehouseId: main.id, items: items(quantity), countedAt, finalize: 'post' });
      const quantity = async (warehouseId = main.id) => (await ingredients.findAll({ warehouseId })).find((row) => row.id === flour.id).stock;
      const receiptItems = (quantity) => [{ ...items(quantity)[0], unit: 'pcs', purchasePrice: 4 }];
      const receipt = await purchases.create({ supplier: 'Supplier', warehouseId: main.id, complete: true, items: receiptItems(10) });
      const first = await count(18);
      const transfer = await documents.create(owner, { kind: 'transfer', warehouseId: main.id, destinationWarehouseId: bar.id,
        items: items(2), finalize: 'post' });
      const second = await count(16);
      await documents.create(owner, { kind: 'writeoff', warehouseId: main.id, reason: 'damage', items: items(1), finalize: 'post' });
      assert.equal(await db.stockMovement.count({ where: { sourceId: second.id } }), 0);
      await assert.rejects(purchases.update(receipt.id, { complete: true, expectedUpdatedAt: receipt.updatedAt.toISOString(), items: receiptItems(12) }), /инвентаризац/);
      const openedSecond = await documents.reopen(owner, second.id, second.revision);
      await assert.rejects(purchases.update(receipt.id, { complete: true, expectedUpdatedAt: receipt.updatedAt.toISOString(), items: receiptItems(12) }), /ближайшую инвентаризацию/);
      const republishedSecond = await documents.update(owner, second.id, { revision: openedSecond.revision, finalize: 'post' });
      await assert.rejects(documents.reopen(clerk, first.id, first.revision), /подтверждение/i);
      await assert.rejects(documents.reopen(manager, first.id), /данные инвентаризации/);
      const reopened = await documents.reopen(manager, first.id, first.revision);
      assert.equal(reopened.status, 'draft');
      assert.ok(reopened.reopenedAt);
      assert.equal(reopened.countedAt.getTime(), first.postedAt.getTime());
      assert.equal(await quantity(), 15, 'the previous posting stays active while the count is open');
      await assert.rejects(documents.reopen(owner, second.id, republishedSecond.revision), /уже открыта/);
      await assert.rejects(documents.update(owner, first.id, { revision: reopened.revision, items: [] }), /Список позиций/);
      await assert.rejects(documents.update(owner, first.id, { revision: reopened.revision, countedAt: '2025-01-01T00:00:00Z' }), /дата/);
      await assert.rejects(documents.submit(owner, first.id, reopened.revision), /повторно/);
      const stored = await documents.update(manager, first.id, { revision: reopened.revision, items: items(20) });
      assert.equal(stored.items[0].quantity, 20);
      assert.equal(await quantity(), 15);
      await purchases.update(receipt.id, { complete: true, expectedUpdatedAt: receipt.updatedAt.toISOString(), items: receiptItems(12) });
      const preview = await documents.get(first.id, true);
      assert.equal(preview.items[0].quantity, 20, 'historical correction must not overwrite an unpublished count');
      assert.equal(preview.items[0].expected, 22);
      assert.equal(preview.inventoryContext.rows[0].incomingQuantity, 12);
      assert.equal(await quantity(), 15, 'historical purchase changes the count variance, not later physical stock');

      const posted = await documents.update(manager, stored.id, { revision: stored.revision, finalize: 'post' });
      assert.equal(posted.reopenedAt, null);
      assert.equal(posted.postedAt.getTime(), first.postedAt.getTime());
      assert.equal(posted.items[0].difference, -2);
      assert.equal((await documents.get(second.id)).items[0].expected, 18);
      assert.equal((await documents.get(second.id)).items[0].quantity, 16);
      assert.equal((await documents.get(second.id)).items[0].difference, -2);
      assert.equal(await quantity(), 15);
      assert.equal(await quantity(bar.id), 2);
      const destination = await db.stockMovement.findFirstOrThrow({ where: { sourceId: transfer.id, warehouseId: bar.id } });
      assert.equal(destination.costAtMoment.toNumber(), 3.09090909);
      const [oldEffect, newEffect] = await Promise.all([first.id, second.id].map((sourceId) =>
        db.stockMovement.findMany({ where: { sourceId } })));
      assert.deepEqual(oldEffect.map(({ change }) => Number(change)), [-2]);
      assert.deepEqual(newEffect.map(({ change }) => Number(change)), [-2]);
      await assert.rejects(documents.update(owner, first.id, { revision: stored.revision, finalize: 'post' }), /уже изменился/);
      assert.equal(await db.auditLog.count({ where: { entityId: first.id, actionType: { in: ['WAREHOUSE_INVENTORY_REOPENED', 'WAREHOUSE_INVENTORY_REPOSTED'] } } }), 2);

      const again = await documents.reopen(owner, posted.id, posted.revision);
      await documents.update(owner, again.id, { revision: again.revision, finalize: 'post' });
      assert.equal(await db.stockMovement.count({ where: { sourceId: second.id } }), 1);
      assert.equal(await quantity(), 15);

      const rice = await ingredients.create({ name: 'Rice', unit: 'pcs', stock: 10, avgCost: 3 });
      const riceItems = (quantity) => [{ ingredientId: rice.id, quantity }];
      const loss = await documents.create(owner, { kind: 'writeoff', warehouseId: main.id, reason: 'damage',
        items: riceItems(2), finalize: 'post' });
      const countedRice = await documents.create(owner, { kind: 'inventory', mode: 'partial', warehouseId: main.id,
        items: riceItems(7), finalize: 'post' });
      await assert.rejects(documents.reverse(owner, loss.id, 'Wrong quantity', loss.revision), /инвентаризация/);
      const openRice = await documents.reopen(owner, countedRice.id, countedRice.revision);
      await documents.reverse(owner, loss.id, 'Wrong quantity', loss.revision);
      assert.equal((await documents.get(countedRice.id)).items[0].expected, 10);
      const cancellation = await db.stockMovement.findFirstOrThrow({ where: { sourceId: loss.id, type: 'cancel' } });
      assert.ok(cancellation.recordedAt > cancellation.createdAt);
      await documents.create(owner, { kind: 'writeoff', warehouseId: main.id, reason: 'damage',
        effectiveAt: cancellation.createdAt.toISOString(), items: riceItems(1), finalize: 'post' });
      assert.equal((await documents.get(countedRice.id)).items[0].expected, 9);
      assert.equal((await documents.get(countedRice.id)).items[0].quantity, 7);
      const postedRice = await documents.update(owner, openRice.id, { revision: openRice.revision, items: riceItems(6), finalize: 'post' });
      assert.equal(postedRice.items[0].difference, -3);
      assert.equal((await ingredients.findAll({ warehouseId: main.id })).find(({ id }) => id === rice.id).stock, 6);

      const tea = await ingredients.create({ name: 'Tea', unit: 'pcs', stock: 10, avgCost: 3 });
      const teaItems = (quantity) => [{ ingredientId: tea.id, quantity }];
      const opening = await db.stockMovement.findFirstOrThrow({ where: { ingredientId: tea.id } });
      const cutoff = new Date(opening.createdAt.getTime() + 1);
      await new Promise((resolve) => setTimeout(resolve, Math.max(cutoff.getTime() - Date.now() + 1, 1)));
      await documents.create(owner, { kind: 'writeoff', warehouseId: main.id, reason: 'damage',
        items: teaItems(3), finalize: 'post' });
      const historical = await documents.create(owner, { kind: 'inventory', mode: 'partial', warehouseId: main.id,
        countedAt: cutoff.toISOString(), items: teaItems(8), finalize: 'post' });
      assert.equal((await ingredients.findAll({ warehouseId: main.id })).find(({ id }) => id === tea.id).stock, 5);
      const editHistorical = await documents.reopen(owner, historical.id, historical.revision);
      const correctedHistorical = await documents.update(owner, editHistorical.id, { revision: editHistorical.revision,
        items: teaItems(7), finalize: 'post' });
      assert.equal(correctedHistorical.countedAt.getTime(), cutoff.getTime());
      assert.equal(correctedHistorical.items[0].expected, 10);
      assert.equal(correctedHistorical.items[0].difference, -3);
      assert.equal((await ingredients.findAll({ warehouseId: main.id })).find(({ id }) => id === tea.id).stock, 4);
    });
  } finally {
    await db.auditLog.deleteMany({ where: { cafeId: cafe.id } });
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
