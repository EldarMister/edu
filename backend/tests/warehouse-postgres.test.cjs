require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { MovementsService } = require('../src/warehouse/movements.service.ts');
const { WarehouseOverviewService } = require('../src/warehouse/overview.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: ingredient supplies report posted receipts in display units with discounts and warehouse scope', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafes = [];
  try {
    const cafe = await db.cafe.create({ data: { name: `Ingredient supplies ${randomUUID()}` } });
    const foreign = await db.cafe.create({ data: { name: `Foreign supplies ${randomUUID()}` } });
    cafes.push(cafe.id, foreign.id);
    const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
    const ingredients = new IngredientsService(db);
    const purchases = new PurchasesService(db);
    const fixture = await runWithTenant({ cafeId: cafe.id }, async () => {
      const main = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Supplies bar');
      const flour = await ingredients.create({ name: 'Supplies flour', unit: 'kg' });
      const water = await ingredients.create({ name: 'Unrelated water', unit: 'l' });
      const create = (extra) => purchases.create({
        supplier: 'Historical supplier', warehouseId: main.id, complete: true,
        items: [{ ingredientId: flour.id, quantity: 1, unit: 'kg', purchasePrice: 100 }],
        ...extra,
      });
      const receipt = await create({
        date: '2026-11-12T10:00:00Z', discount: 30,
        items: [
          { ingredientId: flour.id, quantity: 2, unit: 'kg', purchasePrice: 100 },
          { ingredientId: flour.id, quantity: 1000, unit: 'g', purchasePrice: 0.1 },
        ],
      });
      const legacy = await create({ date: '2026-11-11T10:00:00Z' });
      await db.purchase.update({ where: { id: legacy.id }, data: { warehouseId: null } });
      const barReceipt = await create({ date: '2026-11-13T10:00:00Z', warehouseId: bar.id });
      await create({ complete: false });
      const cancelled = await create({ complete: false });
      await purchases.cancel(cancelled.id);
      await create({ items: [{ ingredientId: water.id, quantity: 1, unit: 'l', purchasePrice: 5 }] });
      const report = await ingredients.supplies(flour.id, { warehouseId: main.id });
      assert.equal(report.total, 2);
      assert.deepEqual(report.rows.map((row) => row.purchaseId), [receipt.id, legacy.id]);
      assert.deepEqual(
        { quantity: report.rows[0].quantity, unitCode: report.rows[0].unitCode, unitPrice: report.rows[0].unitPrice, total: report.rows[0].total },
        { quantity: 3, unitCode: 'kg', unitPrice: 90, total: 270 },
      );
      assert.equal(report.rows[0].supplier, 'Historical supplier');
      const listedReceipt = (await purchases.findAll({ warehouseId: main.id })).find((row) => row.id === receipt.id);
      assert.deepEqual(listedReceipt.productNames, ['Supplies flour']);
      assert.equal(listedReceipt.itemsCount, 2);
      assert.equal(listedReceipt.items, undefined, 'list previews do not load document quantity and price fields');
      assert.equal((await purchases.findOne(receipt.id)).items.length, 2, 'document detail retains full lines');
      assert.equal(report.rows[1].warehouseId, main.id);
      assert.equal(report.rows[1].warehouseName, main.name);
      assert.equal((await ingredients.supplies(flour.id, { warehouseId: bar.id })).rows[0].purchaseId, barReceipt.id);
      const first = await ingredients.supplies(flour.id, { pageSize: 1 });
      const second = await ingredients.supplies(flour.id, { page: 2, pageSize: 1 });
      assert.equal(first.total, 3);
      assert.equal(first.rows[0].purchaseId, barReceipt.id);
      assert.equal(second.rows[0].purchaseId, receipt.id);
      assert.deepEqual((await ingredients.supplies(flour.id, { page: 4, pageSize: 1 })).rows, []);
      // The report uses the current display unit without changing historic document amounts.
      await db.ingredient.update({ where: { id: flour.id }, data: { displayUnit: 'g' } });
      const grams = await ingredients.supplies(flour.id, { warehouseId: main.id });
      assert.equal(grams.rows[0].quantity, 3000);
      assert.equal(grams.rows[0].unitPrice, 0.09);
      assert.equal(grams.rows[0].total, 270);
      return { ingredientId: flour.id, warehouseId: main.id };
    });
    await runWithTenant({ cafeId: foreign.id }, async () => {
      const own = await ingredients.create({ name: 'Own item', unit: 'pcs' });
      assert.deepEqual((await ingredients.supplies(own.id, {})).rows, []);
      await assert.rejects(ingredients.supplies(fixture.ingredientId, {}), /не найден/);
      await assert.rejects(ingredients.supplies(own.id, { warehouseId: fixture.warehouseId }), /Склад не найден/);
    });
  } finally {
    for (const cafeId of cafes) {
      await db.stockMovement.deleteMany({ where: { cafeId } });
      await db.purchase.deleteMany({ where: { cafeId } });
      await db.ingredient.deleteMany({ where: { cafeId } });
      await db.cafe.delete({ where: { id: cafeId } });
    }
    await db.$disconnect();
  }
});

test('PostgreSQL: draft package snapshots survive resizing and archival without accepting forged reuse', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  let cafe;
  try {
    cafe = await db.cafe.create({ data: { name: `Package snapshots ${randomUUID()}` } });
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const ingredients = new IngredientsService(db);
      const purchases = new PurchasesService(db);
      const rice = await ingredients.create({ name: 'Snapshot rice', unit: 'kg' });
      const flour = await ingredients.create({ name: 'Snapshot flour', unit: 'kg' });
      const pack = await db.warehousePackage.create({ data: { name: 'Two kg', unit: 'kg', unitType: 'mass', quantity: 2, quantityBase: 2000 } });
      const item = { ingredientId: rice.id, packageId: pack.id, quantity: 2, purchasePrice: 60 };
      let draft = await purchases.create({ supplier: 'Snapshot supplier', items: [item] });
      const other = await purchases.create({ supplier: 'Snapshot supplier', items: [item] });
      await db.warehousePackage.update({ where: { id: pack.id }, data: { name: 'Five kg', quantity: 5, quantityBase: 5000, isActive: false } });
      const saved = { ...item, purchaseItemId: draft.items[0].id };
      await assert.rejects(purchases.create({ supplier: 'Snapshot supplier', items: [saved] }), /Сохранённая строка/);
      await assert.rejects(purchases.update(draft.id, { items: [item] }), /Фасовка не найдена/);
      await assert.rejects(purchases.update(draft.id, { items: [{ ...saved, purchaseItemId: other.items[0].id }] }), /Сохранённая строка/);
      await assert.rejects(purchases.update(draft.id, { items: [{ ...saved, ingredientId: flour.id }] }), /Сохранённая строка/);
      await assert.rejects(purchases.update(draft.id, { items: [saved, saved] }), /несколько раз/);
      draft = await purchases.update(draft.id, { items: [{ ...saved, quantity: 3, total: 180 }], discount: 30 });
      assert.equal(draft.items[0].quantityBase, 6000);
      assert.equal(draft.items[0].packageName, 'Two kg');
      assert.equal(draft.items[0].packageQuantity, 2);
      assert.equal(draft.items[0].packageFactor, 2000);
      assert.equal(draft.totalAmount, 150);
      const posted = await purchases.update(draft.id, { items: [{ ...item, purchaseItemId: draft.items[0].id, quantity: 3, total: 180 }], complete: true });
      assert.equal(posted.status, 'completed');
      assert.equal(posted.totalAmount, 150);
      const balance = await ingredients.findOne(rice.id);
      assert.equal(balance.stock, 6);
      assert.equal(balance.avgCost, 25);
    });
  } finally {
    if (cafe) {
      await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
      await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
      await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
      await db.cafe.delete({ where: { id: cafe.id } });
    }
    await db.$disconnect();
  }
});

test('PostgreSQL: warehouse receipts and transfers are scoped and consistent', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafes = [];
  try {
    const cafe = await db.cafe.create({ data: { name: `Warehouse API ${randomUUID()}` } });
    cafes.push(cafe.id);
    const foreign = await db.cafe.create({ data: { name: `Warehouse API ${randomUUID()}` } });
    cafes.push(foreign.id);
    const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
    const ingredients = new IngredientsService(db);
    const movements = new MovementsService(db);
    const overview = new WarehouseOverviewService(db);
    const purchases = new PurchasesService(db);

    const { warehouseId, ingredientId } = await runWithTenant({ cafeId: cafe.id }, async () => {
      const main = (await locations.list(cafe.id)).locations[0];
      assert.equal(main.isDefault, true);
      const bar = await locations.save(cafe.id, 'Напитки');
      assert.equal(bar.isDefault, false);
      await assert.rejects(locations.save(cafe.id, 'напитки'), /уже существует/);

      const cola = await ingredients.create({ name: 'Кола', unit: 'pcs', stock: 20, avgCost: 4 });
      const onlyBar = await ingredients.create({ name: 'Тоник', unit: 'pcs', stock: 3, avgCost: 2, warehouseId: bar.id });
      assert.equal(onlyBar.stock, 3);
      assert.equal((await ingredients.findAll({ warehouseId: main.id, search: 'Тоник' }))[0].stock, 0);
      const transfer = { ingredientId: cola.id, fromWarehouseId: main.id, toWarehouseId: bar.id,
        quantity: 10, unit: 'pcs', requestKey: randomUUID() };
      const [firstTransfer, duplicateTransfer] = await Promise.all([locations.transfer(transfer), locations.transfer(transfer)]);
      assert.equal(firstTransfer.documentId, duplicateTransfer.documentId);
      await assert.rejects(locations.transfer({ ...transfer, toWarehouseId: main.id, requestKey: randomUUID() }), /другой склад/);

      const purchase = await purchases.create({
        supplier: 'Поставщик', warehouseId: bar.id, items: [{ ingredientId: cola.id, quantity: 10, total: 60 }],
      });
      const completions = await Promise.allSettled([purchases.complete(purchase.id), purchases.complete(purchase.id)]);
      assert.deepEqual(completions.map((entry) => entry.status).sort(), ['fulfilled', 'rejected']);
      await assert.rejects(purchases.update(purchase.id, { warehouseId: main.id }), /изменилась/);

      await Promise.all([
        purchases.create({ supplier: 'Поставщик', complete: true, warehouseId: bar.id, items: [{ ingredientId: cola.id, quantity: 1, unit: 'pcs', purchasePrice: 5 }] }),
        purchases.create({ supplier: 'Поставщик', complete: true, warehouseId: bar.id, items: [{ ingredientId: cola.id, quantity: 1, unit: 'pcs', purchasePrice: 5 }] }),
      ]);
      const [commonCola] = await ingredients.findAll({ warehouseId: main.id, search: 'Кола' });
      const [barCola] = await ingredients.findAll({ warehouseId: bar.id, search: 'Кола' });
      const [allCola] = await ingredients.findAll({ search: 'Кола' });
      assert.deepEqual([commonCola.stock, barCola.stock, allCola.stock], [10, 22, 32]);
      assert.deepEqual([commonCola.avgCost, barCola.avgCost, allCola.avgCost], [4, 5, 4.69]);
      assert.equal((await overview.getOverview({ warehouseId: bar.id })).stockValue, 116);
      assert.equal((await overview.getOverview({})).stockValue, 156);
      assert.equal((await purchases.findAll({ warehouseId: bar.id }))[0].warehouseId, bar.id);
      assert.deepEqual(await purchases.findAll({ warehouseId: main.id }), []);
      const journal = await movements.findAll({ ingredientId: cola.id });
      assert.equal(journal.filter((entry) => entry.type === 'purchase').length, 3);
      assert.equal(journal.filter((entry) => entry.warehouseId === bar.id).length, 4);
      assert.equal(journal.filter((entry) => entry.warehouseId === main.id).length, 2);
      assert.equal(journal.filter((entry) => entry.comment === 'Начальный остаток').length, 1);
      assert.equal((await ingredients.remove(cola.id)).deactivated, true);
      assert.equal((await movements.findAll({ ingredientId: cola.id })).length, 6);
      return { warehouseId: bar.id, ingredientId: cola.id };
    });

    await runWithTenant({ cafeId: foreign.id }, async () => {
      assert.deepEqual((await locations.list(foreign.id)).locations.map((location) => location.isDefault), [true]);
      await assert.rejects(ingredients.findAll({ warehouseId }), /Склад не найден/);
      await assert.rejects(purchases.create({ supplier: 'Поставщик', complete: true, items: [{ ingredientId, quantity: 1, unit: 'pcs', purchasePrice: 5 }] }), /не найдено/);
      await assert.rejects(purchases.findAll({ warehouseId }), /Склад не найден/);
      await assert.rejects(movements.findAll({ warehouseId }), /Склад не найден/);
    });
  } finally {
    for (const cafeId of cafes) {
      await db.stockMovement.deleteMany({ where: { cafeId } });
      await db.purchase.deleteMany({ where: { cafeId } });
      await db.warehouseDocument.deleteMany({ where: { cafeId } });
      await db.ingredient.deleteMany({ where: { cafeId } });
      await db.cafe.delete({ where: { id: cafeId } });
    }
    await db.$disconnect();
  }
});

test('PostgreSQL: purchase search matches visible fields while preserving warehouse, status and date filters', { skip: !url }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafes = [];
  try {
    const cafe = await db.cafe.create({ data: { name: `Purchase search ${randomUUID()}` } });
    cafes.push(cafe.id);
    const foreign = await db.cafe.create({ data: { name: `Purchase search foreign ${randomUUID()}` } });
    cafes.push(foreign.id);
    await runWithTenant({ cafeId: foreign.id }, async () => await db.purchase.create({ data: {
      number: 205, supplier: 'Milk Farm', note: 'Доставка без сахара',
      status: 'completed', date: new Date('2026-11-14T12:00:00Z'),
    } }));

    await runWithTenant({ cafeId: cafe.id }, async () => {
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const main = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Бар');
      const make = (number, overrides = {}) => db.purchase.create({ data: {
        number, supplier: 'Milk Farm', note: 'Доставка без сахара',
        warehouseId: main.id, status: 'completed', date: new Date('2026-11-14T12:00:00Z'), ...overrides,
      } });
      const receipt = await make(205);
      const legacy = await make(207, { warehouseId: null });
      await make(206, { warehouseId: bar.id });
      await make(208, { status: 'draft' });
      await make(209, { date: new Date('2026-11-13T12:00:00Z') });
      await make(210, { date: new Date('2026-11-15T12:00:00Z') });
      await make(1205, { supplier: 'Вода', note: null });
      const supplierNumber = await make(900, { supplier: 'Поставщик 205', note: null });
      const purchases = new PurchasesService(db);
      const filters = { warehouseId: main.id, status: 'completed', from: '2026-11-14', to: '2026-11-14' };
      const ids = async (search, overrides = {}) => (await purchases.findAll({ ...filters, search, ...overrides })).map(({ id }) => id).sort();

      await t.test('supplier and note use case-insensitive contains and trim surrounding spaces', async () => {
        const expected = [receipt.id, legacy.id].sort();
        assert.deepEqual(await ids('FaRm'), expected);
        assert.deepEqual(await ids('  без сахара  '), expected);
      });
      await t.test('raw and formatted numbers match exactly, retaining text matches in the same query', async () => {
        assert.deepEqual(await ids('205'), [receipt.id, supplierNumber.id].sort());
        assert.deepEqual(await ids('000205'), [receipt.id]);
        assert.deepEqual(await ids('ЗКП-000205'), [receipt.id]);
        assert.deepEqual(await ids('  зкп-000205  '), [receipt.id]);
        assert.deepEqual(await ids('20'), [supplierNumber.id], 'numeric search must not match a portion of a document number');
      });
      await t.test('number search cannot bypass status, date, warehouse or tenant scope', async () => {
        for (const search of ['ЗКП-000206', 'ЗКП-000208', 'ЗКП-000209', 'ЗКП-000210']) {
          assert.deepEqual(await ids(search), [], search);
        }
        assert.deepEqual(await ids('ЗКП-000205', { warehouseId: bar.id }), []);
        assert.deepEqual(await ids('ЗКП-000205', { status: 'draft' }), []);
        assert.deepEqual(await ids('ЗКП-000205', { warehouseId: undefined }), [receipt.id]);
      });
      await t.test('empty and out-of-range numeric searches remain valid queries', async () => {
        assert.deepEqual(await ids('   '), await ids(undefined));
        assert.deepEqual(await ids('999999999999999999999999999999'), []);
      });
    });
  } finally {
    for (const cafeId of cafes) {
      await db.purchase.deleteMany({ where: { cafeId } });
      await db.cafe.delete({ where: { id: cafeId } });
    }
    await db.$disconnect();
  }
});
