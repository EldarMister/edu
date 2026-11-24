require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const XLSX = require('xlsx');
const { PrismaClient, Prisma } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');
const { MovementsService } = require('../src/warehouse/movements.service.ts');
const { WarehouseOverviewService } = require('../src/warehouse/overview.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { postStockMovement } = require('../src/warehouse/stock-posting.ts');
const { lockIngredients } = require('../src/warehouse/stock-lock.ts');
const { resolveWarehouse } = require('../src/warehouse/warehouse-location.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

function inventoryWorkbookRows(buffer) {
  const workbook = XLSX.read(buffer);
  return XLSX.utils.sheet_to_json(workbook.Sheets['Инвентаризация'], { header: 1, defval: null });
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
      const draftExport = inventoryWorkbookRows(await docs.inventoryWorkbook(full.id, true));
      assert.deepEqual(draftExport.find(([name]) => name === 'Кола').slice(8), [24, 21, -3, 12, -36]);
      assert.deepEqual(draftExport.find(([name]) => name === 'Сироп').slice(8), [2, null, null, 40, null]);
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
      const postedExport = inventoryWorkbookRows(await docs.inventoryWorkbook(full.id, true));
      assert.deepEqual(postedExport.find(([name]) => name === 'Кола').slice(8), [22, 21, -1, 12, -12]);
      assert.deepEqual(postedExport.find(([name]) => name === 'Сироп').slice(8), [2, 0, -2, 40, -80]);
      assert.equal(postedExport.find(([name]) => name === 'Итоговая разница в деньгах').at(-1), -92);
      const withoutCosts = inventoryWorkbookRows(await docs.inventoryWorkbook(full.id, false));
      assert.equal(withoutCosts.find(([name]) => name === 'Наименование').at(-1), 'Разница');
      assert.deepEqual(withoutCosts.find(([name]) => name === 'Кола').slice(8), [22, 21, -1]);
      assert.equal(withoutCosts.some(([name]) => name === 'Итоговая разница в деньгах'), false);

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
      await assert.rejects(docs.inventoryWorkbook(returned.id, true), { status: 404 });
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
      await assert.rejects(docs.inventoryWorkbook(identifiers.documentId, true), { status: 404 });
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

test('PostgreSQL: transfer act exports posted quantities and historical valuation with permission-safe columns', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Transfer act ${randomUUID()}` } });
  const foreign = await db.cafe.create({ data: { name: `Foreign transfer act ${randomUUID()}` } });
  const docs = new WarehouseDocumentsService(db);
  const readAct = async (id, showCosts = true) => {
    const workbook = XLSX.read(await docs.transferAct(id, showCosts), { type: 'buffer' });
    return XLSX.utils.sheet_to_json(workbook.Sheets['Акт перемещения'], { header: 1 });
  };
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = await db.user.create({ data: { name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'test' } });
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const source = (await locations.list(cafe.id)).locations.find((item) => item.isDefault);
      const destination = await locations.save(cafe.id, 'Склад получателя');
      const ingredients = new IngredientsService(db);
      const flour = await ingredients.create({ name: 'Мука', unit: 'kg', stock: 5, avgCost: 80 });
      const syrup = await ingredients.create({ name: 'Сироп без цены', unit: 'l', stock: 5 });
      const note = '=Текст комментария';
      const input = { warehouseId: source.id, destinationWarehouseId: destination.id, kind: 'transfer', note,
        items: [{ ingredientId: flour.id, quantity: 1.25 }, { ingredientId: syrup.id, quantity: 0.75 }] };
      const draft = await docs.create(owner, input);
      await assert.rejects(docs.transferAct(draft.id, true), { status: 400 });
      const posted = await docs.create(owner, { ...input, finalize: 'post' });
      await runWithTenant({ cafeId: foreign.id }, () => assert.rejects(docs.transferAct(posted.id, true), { status: 404 }));
      await new PurchasesService(db).create({ supplier: 'Новая стоимость', warehouseId: source.id, complete: true,
        items: [{ ingredientId: flour.id, unit: 'kg', quantity: 1, purchasePrice: 200 }] });
      const rows = await readAct(posted.id);
      assert.deepEqual(rows[0], ['Акт перемещения']);
      const find = (label) => rows.find(([key]) => key === label);
      assert.deepEqual([find('Документ')[1], find('Со склада')[1], find('На склад')[1], find('Комментарий')[1]],
        [posted.id, source.name, destination.name, note]);
      assert.match(find('Дата и время (Бишкек)')[1], /\d{2}\.\d{2}\.\d{4}/);
      assert.deepEqual(find('Мука'), ['Мука', 'кг', 1.25, 100]);
      assert.deepEqual(find('Сироп без цены'), ['Сироп без цены', 'л', 0.75, 'Не рассчитано']);
      assert.equal(find('Итого')[3], 'Не рассчитано');
      const noCosts = await readAct(posted.id, false);
      assert.deepEqual(noCosts.find(([label]) => label === 'Мука'), ['Мука', 'кг', 1.25]);
      assert.deepEqual(noCosts.find(([label]) => label === 'Наименование'), ['Наименование', 'Ед. изм.', 'Количество']);
      assert.equal(noCosts.some(([label]) => label === 'Итого'), false);
      assert.equal(await db.stockMovement.count({ where: { sourceId: posted.id } }), 4, 'downloading does not post stock');
      await docs.reverse(owner, posted.id, 'Проверка сторно', posted.revision);
      const reversed = await readAct(posted.id);
      assert.deepEqual(reversed.find(([label]) => label === 'Статус'), ['Статус', 'Сторнировано']);
      assert.deepEqual(reversed.find(([label]) => label === 'Мука'), ['Мука', 'кг', 1.25, 100]);
    });
  } finally {
    for (const { id: cafeId } of [cafe, foreign]) {
      await db.stockMovement.deleteMany({ where: { cafeId } });
      await db.warehouseDocument.deleteMany({ where: { cafeId } });
      await db.purchase.deleteMany({ where: { cafeId } });
      await db.warehouseStock.deleteMany({ where: { cafeId } });
      await db.ingredient.deleteMany({ where: { cafeId } });
      await db.user.deleteMany({ where: { cafeId } });
      await db.cafe.delete({ where: { id: cafeId } });
    }
    await db.$disconnect();
  }
});

test('PostgreSQL: inventory context reconciles the counted warehouse and posting cutoff, including no-op counts', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Inventory period ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = { id: randomUUID(), cafeId: cafe.id, name: 'Owner', role: 'OWNER' };
      const ingredients = new IngredientsService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const docs = new WarehouseDocumentsService(db);
      const [main] = (await locations.list(cafe.id)).locations;
      const bar = await locations.save(cafe.id, 'Бар');
      const milk = await ingredients.create({ name: 'Молоко', unit: 'l' });
      const imported = await ingredients.create({ name: 'Остаток без проводки', unit: 'l' });
      const empty = await ingredients.create({ name: 'Нет на складе', unit: 'pcs' });
      const seeded = await ingredients.create({ name: 'Начальный остаток с проводкой', unit: 'l', stock: 3 });
      await db.ingredient.update({ where: { id: milk.id }, data: { stock: 4000 } });
      await db.ingredient.update({ where: { id: imported.id }, data: { stock: 8000 } });
      const day = (n) => new Date(Date.UTC(2025, 0, n));
      const move = (item, warehouse, quantity, sourceType, type, createdAt) => db.$transaction(async (tx) => {
        await lockIngredients(tx, [item.id]);
        const location = warehouse ? await resolveWarehouse(tx, warehouse.id) : null;
        await postStockMovement(tx, { ingredientId: item.id, warehouse: location, change: new Prisma.Decimal(quantity * 1000),
          movement: { sourceType, type, sourceId: randomUUID(), createdAt } });
      });
      const count = (warehouse, items, finalize) => docs.create(owner, {
        warehouseId: warehouse.id, kind: 'inventory', mode: 'partial', items, finalize,
      });

      await move(milk, null, 6, 'purchase', 'purchase', day(3)); // Legacy default warehouse row.
      const last = await count(main, [{ ingredientId: milk.id, quantity: 10 }, { ingredientId: empty.id, quantity: 0 }], 'post');
      await db.warehouseDocument.update({ where: { id: last.id }, data: { postedAt: day(5) } });
      assert.equal(await db.stockMovement.count({ where: { sourceId: last.id } }), 0);
      const reversed = await count(main, [{ ingredientId: milk.id, quantity: 10 }], 'post');
      await docs.reverse(owner, reversed.id, 'Recount aborted');
      await db.warehouseDocument.update({ where: { id: reversed.id }, data: { postedAt: day(6), reversedAt: day(7) } });
      const wrongWarehouse = await count(bar, [{ ingredientId: milk.id, quantity: 0 }], 'post');
      await db.warehouseDocument.update({ where: { id: wrongWarehouse.id }, data: { postedAt: day(6) } });
      await move(milk, bar, 50, 'purchase', 'purchase', day(7));
      await move(milk, main, 20, 'purchase', 'purchase', day(8));
      await move(milk, main, -18, 'order', 'sale', day(9));
      await move(milk, main, -2, 'writeoff', 'writeoff', day(10));
      await move(milk, main, 1, 'order', 'return', day(11));
      await move(milk, main, 2, 'transfer', 'transfer', day(12));
      await move(milk, main, -2, 'transfer', 'transfer', day(13));
      await move(milk, main, -1, 'manual', 'correction', day(13));
      await move(imported, main, 2, 'purchase', 'purchase', day(14));
      const draft = await count(main, [
        { ingredientId: milk.id, quantity: 7 }, { ingredientId: imported.id, quantity: 10 },
        { ingredientId: empty.id, quantity: 0 }, { ingredientId: seeded.id, quantity: 3 },
      ]);
      const draftWithContext = await docs.get(draft.id, true);
      const draftRows = new Map(draftWithContext.inventoryContext.rows.map((row) => [row.ingredientId, row]));
      assert.deepEqual(draftRows.get(milk.id), {
        ingredientId: milk.id, lastCountAt: day(5), openingQuantity: 10, incomingQuantity: 22,
        consumptionQuantity: -17, writeoffQuantity: -2, otherQuantity: -3,
      });
      assert.deepEqual(draftRows.get(imported.id), {
        ingredientId: imported.id, lastCountAt: null, openingQuantity: 8, incomingQuantity: 2,
        consumptionQuantity: 0, writeoffQuantity: 0, otherQuantity: 0,
      });
      assert.deepEqual(draftRows.get(empty.id), {
        ingredientId: empty.id, lastCountAt: day(5), openingQuantity: 0, incomingQuantity: 0,
        consumptionQuantity: 0, writeoffQuantity: 0, otherQuantity: 0,
      });
      assert.equal(draftRows.get(seeded.id).openingQuantity, 3);
      assert.equal(draftRows.get(seeded.id).otherQuantity, 0);
      for (const line of draftWithContext.items) {
        const { openingQuantity, incomingQuantity, consumptionQuantity, writeoffQuantity, otherQuantity } = draftRows.get(line.ingredientId);
        assert.equal(openingQuantity + incomingQuantity + consumptionQuantity + writeoffQuantity + otherQuantity, line.expected);
      }

      const posted = await docs.update(owner, draft.id, { revision: draft.revision, finalize: 'post' });
      assert.equal((await docs.get(posted.id)).inventoryContext, undefined);
      assert.equal(await db.stockMovement.count({ where: { sourceId: posted.id, ingredientId: milk.id } }), 1);
      await move(milk, main, 100, 'purchase', 'purchase', new Date(posted.postedAt.getTime() + 1));
      await assert.rejects(docs.reverse(owner, last.id, 'Review previous count'), /инвентаризация/);
      const postedWithContext = await docs.get(posted.id, true);
      assert.equal(postedWithContext.inventoryContext.cutoffAt.getTime(), posted.postedAt.getTime());
      assert.deepEqual(postedWithContext.inventoryContext.rows, draftWithContext.inventoryContext.rows,
        'later stock and attempted reversal cannot change the closed period; own correction is never counted');
      const exported = inventoryWorkbookRows(await docs.inventoryWorkbook(posted.id, true));
      assert.deepEqual(exported.find(([name]) => name === 'Молоко').slice(3),
        [10, 22, -17, -2, -3, 10, 7, -3, null, null]);
    });
  } finally {
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
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

test('PostgreSQL: historical inventory applies the cutoff variance once and refuses unverified or overlapping periods', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Historical inventory ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = { id: randomUUID(), cafeId: cafe.id, name: 'Owner', role: 'OWNER' };
      const ingredients = new IngredientsService(db);
      const docs = new WarehouseDocumentsService(db);
      const purchases = new PurchasesService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const [main] = (await locations.list(cafe.id)).locations;
      const bar = await locations.save(cafe.id, 'Бар');
      const item = await ingredients.create({ name: 'Milk', unit: 'pcs', stock: 10, avgCost: 2 });
      const anchorAt = new Date(Date.now() - 120_000);
      const countedAt = new Date(Date.now() - 60_000);
      await db.ingredient.update({ where: { id: item.id }, data: { createdAt: anchorAt } });
      await db.stockMovement.updateMany({ where: { ingredientId: item.id }, data: { createdAt: anchorAt } });

      const body = { warehouseId: main.id, kind: 'inventory', mode: 'partial',
        countedAt: countedAt.toISOString(), items: [{ ingredientId: item.id, quantity: 8 }] };
      const draft = await docs.create(owner, body);
      assert.equal(draft.countedAt.getTime(), countedAt.getTime());
      assert.deepEqual(draft.items.map(({ expected, difference }) => [expected, difference]), [[10, -2]]);
      const createReceipt = (warehouse) => purchases.create({
        supplier: 'Later receipt', warehouseId: warehouse.id, complete: true,
        items: [{ ingredientId: item.id, unit: 'pcs', quantity: 5, purchasePrice: 7 }],
      }, owner);
      const receipt = await createReceipt(main);
      await createReceipt(bar);
      const readReceipt = () => db.stockMovement.findFirstOrThrow({ where: { sourceId: receipt.id } });
      const originalReceipt = await readReceipt();
      const laterWriteoff = await docs.create(owner, { warehouseId: main.id, kind: 'writeoff', reason: 'damage',
        finalize: 'post', items: [{ ingredientId: item.id, quantity: 2 }] });
      const adjusted = await docs.get(draft.id, true);
      assert.equal(adjusted.inventoryContext.cutoffAt.getTime(), countedAt.getTime());
      assert.deepEqual(adjusted.items.map(({ expected, quantity, difference }) => [expected, quantity, difference]), [[10, 8, -2]]);
      const posted = await docs.update(owner, draft.id, { revision: draft.revision, finalize: 'post' });
      assert.equal(posted.countedAt.getTime(), countedAt.getTime());
      assert.ok(posted.postedAt > countedAt);
      assert.deepEqual(posted.items.map(({ expected, quantity, difference }) => [expected, quantity, difference]), [[10, 8, -2]]);
      const balances = (await ingredients.findOne(item.id)).balances;
      assert.equal(balances.find(({ warehouseId }) => warehouseId === main.id).stock, 11,
        '10 opening + 5 received - 2 written off + (8 counted - 10 expected)');
      assert.equal(balances.find(({ warehouseId }) => warehouseId === bar.id).stock, 5);
      assert.deepEqual(await readReceipt(), originalReceipt, 'inventory does not rewrite immutable receipt valuation');
      assert.equal((await db.stockMovement.findFirstOrThrow({ where: { sourceId: laterWriteoff.id } })).change.toNumber(), -2);
      assert.deepEqual((await docs.get(posted.id, true)).inventoryContext.rows, adjusted.inventoryContext.rows);
      await assert.rejects(docs.approve(owner, posted.id, posted.revision));
      assert.equal(await db.stockMovement.count({ where: { sourceId: posted.id } }), 1);

      const zero = await ingredients.create({ name: 'Empty', unit: 'pcs' });
      await db.ingredient.update({ where: { id: zero.id }, data: { createdAt: anchorAt } });
      const zeroBody = { ...body, items: [{ ingredientId: zero.id, quantity: 0 }] };
      const noOp = await docs.create(owner, { ...zeroBody, countedAt: null, finalize: 'post' });
      assert.equal(await db.stockMovement.count({ where: { sourceId: noOp.id } }), 0);
      await assert.rejects(docs.create(owner, zeroBody), /позже проведения/);
      const imported = await ingredients.create({ name: 'Unconfirmed stock', unit: 'pcs' });
      await db.ingredient.update({ where: { id: imported.id }, data: { createdAt: anchorAt, stock: 3 } });
      await assert.rejects(docs.create(owner, { ...zeroBody, items: [{ ingredientId: imported.id, quantity: 3 }] }), /Журнал .* не подтверждает/);
      await assert.rejects(docs.create(owner, { ...body, countedAt: new Date(Date.now() + 60_000).toISOString() }), /в будущем/);
      await assert.rejects(docs.create(owner, { ...body, countedAt: '2026-02-30T12:00:00Z' }), /часовым поясом/);

      const lateProduct = await ingredients.create({ name: 'Later product', unit: 'pcs', stock: 2, warehouseId: bar.id });
      const full = await docs.create(owner, { warehouseId: bar.id, kind: 'inventory', mode: 'full' });
      assert.equal(full.items.find(({ ingredientId }) => ingredientId === lateProduct.id).quantity, null);
      await assert.rejects(docs.update(owner, full.id, { revision: full.revision, countedAt: countedAt.toISOString(),
        items: [{ ingredientId: lateProduct.id, quantity: 2 }] }), /создана после даты/);
      const movedFull = await docs.update(owner, full.id, { revision: full.revision, countedAt: countedAt.toISOString() });
      assert.ok(!movedFull.items.some(({ ingredientId }) => ingredientId === lateProduct.id || ingredientId === item.id));
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

test('PostgreSQL: historical inventory follows tied stock chains regardless of UUID order', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Tied inventory ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = await db.user.create({ data: { name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'unused' } });
      const ingredients = new IngredientsService(db);
      const docs = new WarehouseDocumentsService(db);
      const purchases = new PurchasesService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const [main] = (await locations.list(cafe.id)).locations;
      const warehouse = await resolveWarehouse(db, main.id);
      const origin = new Date(Date.now() - 120_000);
      const receiptAt = new Date(+origin + 30_000);
      const before = new Date(+receiptAt - 1);
      const after = new Date(+receiptAt + 1);
      const product = await ingredients.create({ name: 'Rice in two invoice lines', unit: 'pcs' });
      await db.ingredient.update({ where: { id: product.id }, data: { createdAt: origin } });
      const receipt = await purchases.create({ warehouseId: main.id, supplier: 'Two prices', complete: true,
        effectiveAt: receiptAt.toISOString(), items: [
          { ingredientId: product.id, quantity: 10, purchasePrice: 2 },
          { ingredientId: product.id, quantity: 20, purchasePrice: 3 },
        ] }, owner);
      const movements = await db.stockMovement.findMany({ where: { sourceId: receipt.id } });
      assert.equal(movements.length, 2);
      assert.ok(movements.every((row) => +row.createdAt === +receiptAt));
      const first = movements.find((row) => row.beforeStock.isZero());
      const last = movements.find((row) => row.afterStock.eq(30));
      // Force the old DESC UUID ordering to select the earlier posting first.
      await db.stockMovement.update({ where: { id: first.id }, data: { id: `ffffffff-${randomUUID().slice(9)}` } });
      await db.stockMovement.update({ where: { id: last.id }, data: { id: `00000000-${randomUUID().slice(9)}` } });

      const count = async (item, at, expected) => {
        const document = await docs.create(owner, { kind: 'inventory', mode: 'partial', warehouseId: main.id,
          countedAt: at.toISOString(), items: [{ ingredientId: item.id, quantity: expected }] });
        assert.equal(document.items[0].expected, expected);
        assert.equal(document.items[0].difference, 0);
        assert.equal((await docs.get(document.id)).items[0].expected, expected);
        return document;
      };
      const earlierCount = await count(product, before, 0);
      await count(product, receiptAt, 0); // A timestamp at the cutoff is outside the checked period.
      const laterCount = await count(product, after, 30);

      // A valid same-time chain may revisit a balance; greedy edge selection
      // would get stuck if it unwound 0→10 before the cycle 10→20→10.
      const cycling = await ingredients.create({ name: 'Receipt and withdrawal', unit: 'pcs' });
      await db.ingredient.update({ where: { id: cycling.id }, data: { createdAt: origin } });
      await db.$transaction(async (tx) => {
        await lockIngredients(tx, [cycling.id]);
        for (const change of [10, 10, -10]) await postStockMovement(tx, {
          warehouse, ingredientId: cycling.id, change: new Prisma.Decimal(change),
          movement: { type: 'correction', sourceType: 'manual', sourceId: randomUUID(), createdAt: receiptAt },
        });
      });
      await count(cycling, before, 0);
      await count(cycling, after, 10);

      // A disconnected balanced loop has zero net quantity but is not evidence
      // of this stock history. It must still fail both rewind and anchor checks.
      await db.stockMovement.createMany({ data: [[50, 60], [60, 50]].map(([from, to]) => ({
        cafeId: cafe.id, ingredientId: product.id, warehouseId: main.id, warehouseKey: 'default',
        type: 'correction', sourceType: 'manual', sourceId: randomUUID(), createdAt: receiptAt,
        beforeStock: from, afterStock: to, change: to - from, costAtMoment: 0,
      })) });
      await assert.rejects(docs.get(earlierCount.id), /Журнал .* не подтверждает/);
      await assert.rejects(docs.get(laterCount.id), /Журнал .* не подтверждает/);
      assert.equal(Number((await db.ingredient.findUniqueOrThrow({ where: { id: product.id } })).stock), 30);
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
