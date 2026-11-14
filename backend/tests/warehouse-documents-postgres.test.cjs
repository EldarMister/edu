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

test('PostgreSQL: inventory confirms current physical stock and owner approval is atomic', { skip: !url }, async () => {
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
      assert.deepEqual([await stock(cola, bar.id), await stock(syrup, bar.id), await stock(cola, common.id)], [21, 0, 5]);
      assert.equal(posted.items.find(({ ingredientId }) => ingredientId === cola.id).expected, 22, 'approval compares the count against stock after the intervening sale');
      const inventoryMoves = await movements.findAll({ warehouseId: bar.id, sourceType: 'inventory', type: 'inventory' });
      assert.deepEqual(inventoryMoves.filter(({ sourceId }) => sourceId === full.id).map(({ change }) => change).sort(), [-1, -2]);

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
      const listedWriteoffs = await docs.list(bar.id, 'writeoff');
      assert.equal(listedWriteoffs.length, 1);
      assert.deepEqual(listedWriteoffs[0].productNames, ['Кола']);
      assert.equal(listedWriteoffs[0].items, undefined, 'list preview must not include full document lines');
      assert.equal(listedWriteoffs[0].varianceValue, -24, 'preview does not change the signed ledger result');
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
      assert.ok((await docs.list(common.id, 'transfer', 'Кола')).some((document) => document.id === directTransfer.id), 'destination warehouse must include incoming transfers');
      assert.equal((await docs.list(common.id, 'transfer', 'Кола')).find((document) => document.id === directTransfer.id).varianceValue, -12, 'incoming filter retains the original transfer amount');
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
      const previewItems = [];
      for (const name of ['A preview', 'B preview', 'C preview', 'Z fourth product']) {
        previewItems.push(await ingredients.create({ name, unit: 'pcs' }));
      }
      const previewDocument = await docs.create(owner, { warehouseId: bar.id, kind: 'writeoff', reason: 'tasting',
        items: previewItems.map((item) => ({ ingredientId: item.id, quantity: 1 })) });
      const searchResult = await docs.list(undefined, 'writeoff', 'fourth product');
      assert.deepEqual(searchResult.map((row) => row.id), [previewDocument.id], 'search must include lines beyond the three-name preview');
      assert.deepEqual(searchResult[0].productNames, ['A preview', 'B preview', 'C preview']);
      assert.equal(searchResult[0].itemsCount, 4);
      assert.deepEqual(await docs.list(common.id, 'writeoff', 'fourth product'), [], 'search respects the warehouse');
      return { warehouseId: bar.id, documentId: full.id };
    });

    await runWithTenant({ cafeId: foreign.id }, async () => {
      await assert.rejects(docs.list(identifiers.warehouseId, 'inventory'));
      await assert.rejects(docs.get(identifiers.documentId));
      assert.deepEqual(await docs.list(undefined, 'writeoff', 'fourth product'), [], 'search respects tenant isolation');
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

test('PostgreSQL: posting-time inventory keeps nullable scope and follows receipts without double counting', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Current inventory ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = { id: randomUUID(), name: 'Owner', role: 'OWNER', cafeId: cafe.id };
      const ingredients = new IngredientsService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const docs = new WarehouseDocumentsService(db);
      const purchases = new PurchasesService(db);
      const main = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Other warehouse');
      const milk = await ingredients.create({ name: 'Counted milk', unit: 'pcs', stock: 10, avgCost: 2 });
      const unused = await ingredients.create({ name: 'Never used', unit: 'pcs' });
      const otherWarehouse = await ingredients.create({ name: 'Only in bar', unit: 'pcs', stock: 5, warehouseId: bar.id });
      const depleted = await ingredients.create({ name: 'Previously used', unit: 'pcs', stock: 3, avgCost: 2 });
      await docs.create(owner, { warehouseId: main.id, kind: 'writeoff', reason: 'damage', finalize: 'post',
        items: [{ ingredientId: depleted.id, quantity: 3 }] });

      const full = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'full' });
      assert.deepEqual(full.items.map((item) => item.ingredientId).sort(), [milk.id, depleted.id].sort(),
        'full scope includes stock/history in this warehouse, excluding unused and other-warehouse-only products');
      assert.ok(!full.items.some((item) => item.ingredientId === unused.id || item.ingredientId === otherWarehouse.id));
      await ingredients.create({ name: 'New unused catalog item', unit: 'pcs' });
      const allCounted = await docs.update(owner, full.id, { revision: full.revision,
        items: full.items.map((item) => ({ ingredientId: item.ingredientId, quantity: item.expected })) });
      const fullSubmitted = await docs.submit(owner, full.id, allCounted.revision);
      await docs.approve(owner, full.id, fullSubmitted.revision);

      const partial = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'partial',
        items: [{ ingredientId: milk.id, quantity: null }, { ingredientId: unused.id, quantity: null }] });
      assert.equal(partial.itemsCount, 2);
      assert.ok(partial.items.every((item) => item.quantity === null && item.difference === null));
      const savedBlank = await docs.update(owner, partial.id, { revision: partial.revision, note: 'Continue later' });
      assert.equal((await docs.get(partial.id)).itemsCount, 2, 'metadata edits preserve the selected uncounted positions');
      await assert.rejects(docs.submit(owner, partial.id, savedBlank.revision), /фактический остаток/);
      await assert.rejects(docs.create(owner, { warehouseId: main.id, kind: 'writeoff', reason: 'damage',
        items: [{ ingredientId: milk.id, quantity: null }] }), /количество/);

      const receipt = (quantity) => purchases.create({ supplier: 'Inventory fixture', warehouseId: main.id, complete: true,
        items: [{ ingredientId: milk.id, quantity, unit: 'pcs', purchasePrice: 2 }] }, owner);
      await receipt(10);
      const counted = await docs.update(owner, partial.id, { revision: savedBlank.revision,
        items: [{ ingredientId: milk.id, quantity: 20 }, { ingredientId: unused.id, quantity: null }] });
      const milkRow = (document) => document.items.find((item) => item.ingredientId === milk.id);
      assert.deepEqual([milkRow(counted).expected, milkRow(counted).quantity, milkRow(counted).difference], [20, 20, 0],
        'draft 10 + receipt 10 + physical count 20 has no invented surplus');
      await assert.rejects(docs.submit(owner, partial.id, counted.revision), /фактический остаток/);
      const completedCount = await docs.update(owner, partial.id, { revision: counted.revision,
        items: [{ ingredientId: milk.id, quantity: 20 }, { ingredientId: unused.id, quantity: 0 }] });
      const submitted = await docs.submit(owner, partial.id, completedCount.revision);
      await receipt(5);
      const preview = await docs.get(partial.id);
      assert.deepEqual([milkRow(preview).expected, milkRow(preview).quantity, milkRow(preview).difference], [25, 20, -5],
        'receipts after entering the count update only the book preview');
      const posted = await docs.approve(owner, partial.id, submitted.revision);
      assert.deepEqual([milkRow(posted).expected, milkRow(posted).quantity, milkRow(posted).difference], [25, 20, -5]);
      assert.equal((await ingredients.findOne(milk.id)).stock, 20);
      await receipt(1);
      assert.equal(milkRow(await docs.get(partial.id)).expected, 25, 'posted history does not follow later receipts');

      const scopeBeforeReceipt = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'full' });
      const filledScope = await docs.update(owner, scopeBeforeReceipt.id, { revision: scopeBeforeReceipt.revision,
        items: scopeBeforeReceipt.items.map((item) => ({ ingredientId: item.ingredientId, quantity: item.expected })) });
      await purchases.create({ supplier: 'Newly used product', complete: true, warehouseId: main.id,
        items: [{ ingredientId: unused.id, quantity: 1, purchasePrice: 1 }] }, owner);
      await assert.rejects(docs.submit(owner, filledScope.id, filledScope.revision), /Сохраните черновик/);
      const staleScope = await docs.update(owner, scopeBeforeReceipt.id, { revision: filledScope.revision,
        items: filledScope.items.map((item) => ({ ingredientId: item.ingredientId, quantity: item.quantity })) });
      assert.equal(staleScope.items.find((item) => item.ingredientId === unused.id).quantity, null,
        'a newly used product joins a refreshed full draft as uncounted');
      await assert.rejects(docs.submit(owner, staleScope.id, staleScope.revision), /фактический остаток/);

      const first = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'partial',
        items: [{ ingredientId: milk.id, quantity: 21 }] });
      const overlapping = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'partial',
        items: [{ ingredientId: milk.id, quantity: 20 }] });
      const firstSubmitted = await docs.submit(owner, first.id, first.revision);
      await docs.approve(owner, first.id, firstSubmitted.revision);
      await assert.rejects(docs.submit(owner, overlapping.id, overlapping.revision), /другая инвентаризация/);
      const recounted = await docs.update(owner, overlapping.id, { revision: overlapping.revision, recount: true,
        items: [{ ingredientId: milk.id, quantity: null }] });
      assert.equal(recounted.items[0].quantity, null, 'recount retains selection while making the new count explicit');
      const refilled = await docs.update(owner, overlapping.id, { revision: recounted.revision, finalize: 'post',
        items: [{ ingredientId: milk.id, quantity: 20 }] });
      assert.equal(refilled.status, 'posted');
      assert.equal((await ingredients.findOne(milk.id)).stock, 20);
    });
  } finally {
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
