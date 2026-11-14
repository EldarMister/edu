require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');
const { MovementsService } = require('../src/warehouse/movements.service.ts');
const { WarehouseOverviewService } = require('../src/warehouse/overview.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: count discrepancies preserve later movement and owner approval is atomic', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafes = [];
  try {
    const cafe = await db.cafe.create({ data: { name: `Warehouse documents ${randomUUID()}` } });
    cafes.push(cafe.id);
    const foreign = await db.cafe.create({ data: { name: `Warehouse documents ${randomUUID()}` } });
    cafes.push(foreign.id);
    const ingredients = new IngredientsService(db);
    const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
    const docs = new WarehouseDocumentsService(db);
    const movements = new MovementsService(db);
    const overview = new WarehouseOverviewService(db);
    const identifiers = await runWithTenant({ cafeId: cafe.id }, async () => {
      const makeUser = (role) => db.user.create({
        data: { name: role, role, phone: randomUUID(), passwordHash: 'not-used' },
      });
      const owner = await makeUser('OWNER');
      const admin = await makeUser('ADMIN');
      const common = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Бар');
      const cola = await ingredients.create({ name: 'Кола', unit: 'pcs', stock: 24, avgCost: 12, warehouseId: bar.id });
      const syrup = await ingredients.create({ name: 'Сироп', unit: 'l', stock: 2, avgCost: 40, warehouseId: bar.id });
      await new PurchasesService(db).create({ supplier: 'Начальная поставка', warehouseId: common.id, complete: true, items: [{ ingredientId: cola.id, unit: 'pcs', quantity: 5, purchasePrice: 12 }] });
      const stock = async (ingredient, warehouseId) => {
        const rows = await ingredients.findAll({ search: ingredient.name, warehouseId });
        return rows.find(({ id }) => id === ingredient.id).stock;
      };

      const full = await docs.create(admin, { warehouseId: bar.id, kind: 'inventory', mode: 'full' });
      assert.equal(full.itemsCount, 2);
      const counted = await docs.update(admin, full.id, { revision: full.revision, items: [{ ingredientId: cola.id, quantity: 21 }] });
      assert.equal(counted.items.find(({ ingredientId }) => ingredientId === cola.id).expected, 24);
      await assert.rejects(docs.submit(admin, full.id, counted.revision));
      const filled = await docs.update(admin, full.id, { revision: counted.revision, items: [
        { ingredientId: cola.id, quantity: 21 }, { ingredientId: syrup.id, quantity: 0 },
      ] });
      await assert.rejects(docs.update(admin, full.id, { revision: counted.revision, note: 'Stale edit' }));
      const submitted = await docs.submit(admin, full.id, filled.revision);
      assert.equal(submitted.status, 'submitted');
      assert.equal(submitted.varianceValue, -116);
      await assert.rejects(docs.approve(admin, full.id, submitted.revision));
      const category = await db.category.create({ data: { name: 'Напитки', prepStation: 'bar' } });
      const dish = await db.dish.create({ data: { categoryId: category.id, name: 'Кола', price: 60 } });
      await db.recipeItem.create({ data: { dishId: dish.id, ingredientId: cola.id, amount: 1 } });
      await locations.route(owner, 'bar', bar.id);
      const hall = await db.hall.create({ data: { name: 'Inventory sale fixture' } });
      const table = await db.table.create({ data: { hallId: hall.id, number: 1 } });
      const sale = await db.order.create({ data: { tableId: table.id, waiterId: owner.id, orderNumber: '1', status: 'sent_to_kitchen',
        items: { create: { dishId: dish.id, dishNameSnapshot: dish.name, priceSnapshot: 60, quantity: 2, finalPrice: 120, prepStation: 'bar' } } }, include: { items: true } });
      await db.$transaction((tx) => new IngredientStockService().applyDishSale(tx, sale.id, sale.items));
      const attempts = await Promise.allSettled([
        docs.approve(owner, full.id, submitted.revision),
        docs.approve(owner, full.id, submitted.revision),
      ]);
      assert.ok(attempts.some((attempt) => attempt.status === 'fulfilled'));
      const posted = await docs.get(full.id);
      assert.equal(posted.status, 'posted');
      assert.equal(posted.postedByName, 'OWNER');
      assert.deepEqual([await stock(cola, bar.id), await stock(syrup, bar.id), await stock(cola, common.id)], [19, 0, 5]);
      const inventoryMoves = await movements.findAll({ warehouseId: bar.id, sourceType: 'inventory', type: 'inventory' });
      assert.deepEqual(inventoryMoves.filter(({ sourceId }) => sourceId === full.id).map(({ change }) => change).sort(), [-2, -3]);

      const startPartial = async (quantity) => {
        const draft = await docs.create(admin, { warehouseId: bar.id, kind: 'inventory', mode: 'partial',
          items: [{ ingredientId: cola.id, quantity }] });
        return docs.submit(admin, draft.id, draft.revision);
      };
      const prior = await startPartial(19);
      const overlapping = await startPartial(18);
      await docs.approve(owner, prior.id, prior.revision);
      await assert.rejects(docs.approve(owner, overlapping.id, overlapping.revision));
      const reopened = await docs.reopen(owner, overlapping.id, overlapping.revision);
      assert.equal(reopened.status, 'draft');
      const recounted = await docs.update(admin, reopened.id, { revision: reopened.revision, recount: true, items: [{ ingredientId: cola.id, quantity: 18 }] });
      const resubmitted = await docs.submit(admin, reopened.id, recounted.revision);
      await docs.approve(owner, reopened.id, resubmitted.revision);
      assert.equal(await stock(cola, bar.id), 18);

      await assert.rejects(docs.create(admin, { warehouseId: bar.id, kind: 'writeoff', reason: 'invented' }));
      const waste = await docs.create(admin, { warehouseId: bar.id, kind: 'writeoff', reason: 'expired', note: 'Проверка срока',
        items: [{ ingredientId: cola.id, quantity: 2 }] });
      const wasteSubmitted = await docs.submit(admin, waste.id, waste.revision);
      assert.equal(await stock(cola, bar.id), 18);
      await docs.approve(owner, waste.id, wasteSubmitted.revision);
      assert.equal(await stock(cola, bar.id), 16);
      const [wasteMove] = await movements.findAll({ warehouseId: bar.id, sourceType: 'writeoff', type: 'writeoff' });
      assert.equal(wasteMove.sourceId, waste.id);
      assert.equal(wasteMove.change, -2);
      assert.equal((await overview.getOverview({ warehouseId: bar.id })).ingredientWriteOffTotal, 48);
      assert.equal((await docs.list(bar.id, 'writeoff')).length, 1);
      const missingReason = await docs.create(admin, { warehouseId: bar.id, kind: 'writeoff', reason: 'other',
        items: [{ ingredientId: cola.id, quantity: 1 }] });
      await assert.rejects(docs.submit(admin, missingReason.id, missingReason.revision));
      const excessive = await docs.create(admin, { warehouseId: bar.id, kind: 'writeoff', reason: 'damage',
        items: [{ ingredientId: cola.id, quantity: 99 }] });
      const excessiveSubmitted = await docs.submit(admin, excessive.id, excessive.revision).catch(() => null);
      if (excessiveSubmitted) await assert.rejects(docs.approve(owner, excessive.id, excessiveSubmitted.revision));
      assert.equal(await stock(cola, bar.id), 16);
      assert.equal((await movements.findAll({ warehouseId: bar.id, type: 'writeoff' })).length, 1);
      // Page forms save and post in one request. A failed post must roll back even the draft edits.
      const beforeCount = await db.warehouseDocument.count();
      const body = { warehouseId: bar.id, kind: 'writeoff', reason: 'damage', finalize: 'post',
        requestKey: randomUUID(), items: [{ ingredientId: cola.id, quantity: 1 }] };
      await assert.rejects(docs.create(admin, body), /владельцу/);
      assert.equal(await db.warehouseDocument.count(), beforeCount);
      await assert.rejects(docs.create(owner, { ...body, items: [{ ingredientId: cola.id, quantity: 999 }] }));
      assert.equal(await db.warehouseDocument.count(), beforeCount);
      const direct = await docs.create(owner, body);
      assert.equal(direct.status, 'posted');
      assert.equal(await stock(cola, bar.id), 15);
      assert.equal((await docs.create(owner, body)).id, direct.id, 'retry must return the same posted document');
      assert.equal(await stock(cola, bar.id), 15, 'retry must not post twice');
      const editable = await docs.create(admin, { warehouseId: bar.id, kind: 'writeoff', reason: 'damage',
        items: [{ ingredientId: cola.id, quantity: 1 }], note: 'Original' });
      await assert.rejects(docs.update(owner, editable.id, { revision: editable.revision, finalize: 'post',
        items: [{ ingredientId: cola.id, quantity: 999 }], note: 'Failed edit' }));
      assert.deepEqual(await docs.get(editable.id), editable, 'failed final save must preserve the entire draft');
      const final = await docs.update(owner, editable.id, { revision: editable.revision, finalize: 'post',
        items: [{ ingredientId: cola.id, quantity: 2 }], note: 'Posted edit' });
      assert.equal(final.status, 'posted'); assert.equal(await stock(cola, bar.id), 13);
      await assert.rejects(docs.update(owner, editable.id, { revision: editable.revision, finalize: 'post' }));
      const countedOnce = await docs.create(admin, { warehouseId: bar.id, kind: 'inventory', mode: 'partial' });
      const finishedCount = await docs.update(owner, countedOnce.id, { revision: countedOnce.revision,
        finalize: 'post', items: [{ ingredientId: cola.id, quantity: 12 }] });
      assert.equal(finishedCount.status, 'posted'); assert.equal(await stock(cola, bar.id), 12);
      const forApproval = await docs.create(admin, { warehouseId: bar.id, kind: 'writeoff', reason: 'damage',
        finalize: 'submit', items: [{ ingredientId: cola.id, quantity: 1 }] });
      assert.equal(forApproval.status, 'submitted'); assert.equal(await stock(cola, bar.id), 12);
      const directTransfer = await docs.create(admin, { warehouseId: bar.id, destinationWarehouseId: common.id,
        kind: 'transfer', finalize: 'post', items: [{ ingredientId: cola.id, quantity: 1 }] });
      assert.equal(directTransfer.status, 'posted');
      assert.deepEqual([await stock(cola, bar.id), await stock(cola, common.id)], [11, 6]);
      const purchases = new PurchasesService(db);
      const receipt = await purchases.create({ supplier: 'Final save', warehouseId: bar.id,
        items: [{ ingredientId: cola.id, quantity: 1, unit: 'pcs', purchasePrice: 12 }] }, owner);
      const finalReceipt = await purchases.update(receipt.id, { complete: true,
        items: [{ ingredientId: cola.id, quantity: 3, unit: 'pcs', purchasePrice: 12 }] }, owner);
      assert.equal(finalReceipt.status, 'completed'); assert.equal(await stock(cola, bar.id), 14);
      const returned = await docs.create(owner, { warehouseId: bar.id, kind: 'supplier_return',
        sourcePurchaseId: receipt.id, finalize: 'post', items: [{ ingredientId: cola.id, quantity: 1 }] });
      assert.equal(returned.status, 'posted'); assert.equal(await stock(cola, bar.id), 13);
      await assert.rejects(docs.create(owner, { warehouseId: bar.id, kind: 'supplier_return',
        sourcePurchaseId: receipt.id, finalize: 'post', items: [{ ingredientId: cola.id, quantity: 3 }] }));
      assert.equal(await stock(cola, bar.id), 13);
      return { warehouseId: bar.id, documentId: full.id };
    });

    await runWithTenant({ cafeId: foreign.id }, async () => {
      await assert.rejects(docs.list(identifiers.warehouseId, 'inventory'));
      await assert.rejects(docs.get(identifiers.documentId));
    });
  } finally {
    try {
      for (const cafeId of cafes) {
        await db.stockMovement.deleteMany({ where: { cafeId } });
        await db.purchase.deleteMany({ where: { cafeId } });
        await db.warehouseDocument.deleteMany({ where: { cafeId } });
        await db.order.deleteMany({ where: { cafeId } });
        await db.table.deleteMany({ where: { cafeId } });
        await db.hall.deleteMany({ where: { cafeId } });
        await db.user.deleteMany({ where: { cafeId } });
        await db.recipeItem.deleteMany({ where: { cafeId } });
        await db.dish.deleteMany({ where: { cafeId } });
        await db.category.deleteMany({ where: { cafeId } });
        await db.ingredient.deleteMany({ where: { cafeId } });
        await db.cafe.delete({ where: { id: cafeId } });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
