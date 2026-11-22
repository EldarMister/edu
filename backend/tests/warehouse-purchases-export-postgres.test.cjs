require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { PurchaseExportQuery, purchaseDateRange } = require('../src/warehouse/purchases-query.dto.ts');
const { purchaseExportColumns } = require('../src/warehouse/purchases-xlsx.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

async function fixture(run) {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafes = await Promise.all(['Export', 'Foreign export'].map((name) => db.cafe.create({ data: { name: `${name} ${randomUUID()}` } })));
  try {
    const services = { db, ingredients: new IngredientsService(db), purchases: new PurchasesService(db), locations: new WarehouseLocationsService(db, { emitBroadcast() {} }) };
    await runWithTenant({ cafeId: cafes[0].id }, async () => run({ ...services, cafe: cafes[0], foreign: cafes[1] }));
  } finally {
    for (const cafe of cafes) {
      await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
      await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
      await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
      await db.auditLog.deleteMany({ where: { cafeId: cafe.id } });
      await db.cafe.delete({ where: { id: cafe.id } });
    }
    await db.$disconnect();
  }
}

test('purchase query: repeated exact names keep commas and validate enum/array inputs', async () => {
  const query = plainToInstance(PurchaseExportQuery, { suppliers: 'Поставщик, ООО', categories: ['Напитки, холодные', 'Сырьё'], dateSort: 'asc' });
  assert.deepEqual(query.suppliers, ['Поставщик, ООО']);
  assert.equal((await validate(query)).length, 0);
  for (const bad of [{ suppliers: { unexpected: 'object' } }, { categories: [''] }, { dateSort: 'random' }, { status: 'deleted' }]) {
    assert.ok((await validate(plainToInstance(PurchaseExportQuery, bad))).length > 0);
  }
  assert.deepEqual(purchaseExportColumns('supplier,number,totalAmount'), ['supplier', 'number', 'totalAmount']);
  for (const bad of ['', 'number,number', 'number,constructor', 'number,__proto__', 'id']) assert.throws(() => purchaseExportColumns(bad));
});

test('purchase query: Bishkek calendar bounds and explicit ISO instants are independent of server timezone', () => {
  const day = purchaseDateRange('2026-11-15', '2026-11-15');
  assert.equal(day.gte.toISOString(), '2026-11-14T18:00:00.000Z');
  assert.equal(day.lte.toISOString(), '2026-11-15T17:59:59.999Z');
  const instant = purchaseDateRange('2026-11-15T01:02:03+06:00', '2026-11-15T02:03:04Z');
  assert.equal(instant.gte.toISOString(), '2026-11-14T19:02:03.000Z');
  assert.equal(instant.lte.toISOString(), '2026-11-15T02:03:04.000Z');
  assert.deepEqual(purchaseDateRange('', ''), undefined);
  for (const args of [['2026-02-30'], ['2026-02-30T00:00:00Z'], ['2026-11-15T00:00:00'], ['nonsense'], ['2026-11-16', '2026-11-15']]) {
    assert.throws(() => purchaseDateRange(...args));
  }
});

test('PostgreSQL: opening ingredient stock is one editable supply and rolls back on invalid input', { skip: !url }, async () => fixture(async ({ db, cafe, ingredients, purchases, locations }) => {
  const warehouse = await locations.save(cafe.id, 'Склад начальной поставки');
  const dto = { name: 'Мука для начальной поставки', unit: 'kg', processingLosses: { baking: 10 },
    initialSupply: { quantity: 2.5, unitPrice: 40, warehouseId: warehouse.id, requestKey: randomUUID() } };
  const [ingredient, retry] = await Promise.all([ingredients.create(dto), ingredients.create(dto)]);
  assert.equal(retry.id, ingredient.id);
  assert.equal(ingredient.stock, 2.5);
  assert.equal(ingredient.avgCost, 40);
  const [purchase] = await purchases.findAll({ warehouseId: warehouse.id, status: 'completed' });
  assert.ok(purchase);
  assert.equal(purchase.totalAmount, 100);
  const history = await ingredients.supplies(ingredient.id, { warehouseId: warehouse.id });
  assert.equal(history.total, 1);
  assert.equal(history.rows[0].purchaseId, purchase.id);
  assert.equal(history.rows[0].quantity, 2.5);
  const movement = await db.stockMovement.findMany({ where: { ingredientId: ingredient.id } });
  assert.equal(movement.length, 1);
  assert.equal(movement[0].type, 'purchase');
  assert.equal(movement[0].sourceId, purchase.id);
  assert.equal(await db.warehouseSupplier.count(), 0);

  const detail = await purchases.findOne(purchase.id);
  await purchases.update(purchase.id, { expectedUpdatedAt: detail.updatedAt.toISOString(), note: 'Проверено' });
  assert.equal((await purchases.findOne(purchase.id)).note, 'Проверено');
  await assert.rejects(ingredients.create({ ...dto, initialSupply: { ...dto.initialSupply, quantity: 3 } }), /Ключ повторного запроса/);
  await assert.rejects(ingredients.create({ name: 'Ошибочное сырьё', unit: 'kg',
    initialSupply: { ...dto.initialSupply, requestKey: randomUUID(), unitPrice: -1 } }), /цену/);
  assert.equal(await db.ingredient.count(), 1);
  assert.equal(await db.purchase.count(), 1);
}));

test('PostgreSQL: legacy invoice date stays intact while supply list, period, overview and XLSX use the physical receipt date', { skip: !url }, async () => fixture(async ({ db, ingredients, purchases }) => {
  const item = await ingredients.create({ name: 'Поставка с отдельной накладной', unit: 'kg' });
  const invoiceDate = '2025-07-01T03:04:05.123Z';
  const receivedAt = '2025-07-03T06:07:08.456Z';
  const laterAt = '2025-07-03T07:08:09.321Z';
  const create = (date, effectiveAt, quantity) => purchases.create({ supplier: 'Проверка даты поставки', date, effectiveAt, complete: true,
    items: [{ ingredientId: item.id, unit: 'kg', quantity, purchasePrice: 10 }] });
  const legacy = await create(invoiceDate, receivedAt, 1);
  // Older receipts recorded their physical instant only in stockPostedAt; the invoice date is independent.
  await db.purchase.update({ where: { id: legacy.id }, data: { effectiveAt: null, stockPostedAt: new Date(receivedAt) } });
  const explicit = await create('2025-06-30T01:02:03.123Z', laterAt, 2);
  const period = { from: '2025-07-03', to: '2025-07-03', dateSort: 'asc', status: 'completed' };
  const rows = await purchases.findAll(period);
  assert.deepEqual(rows.map(({ id }) => id), [legacy.id, explicit.id], 'sort by receipt, even when invoice dates are reversed');
  assert.deepEqual((await purchases.findAll({ ...period, dateSort: 'desc' })).map(({ id }) => id), [explicit.id, legacy.id]);
  assert.equal(rows[0].date.toISOString(), invoiceDate, 'invoice precision is preserved in the list');
  assert.equal(rows[0].postedAt.toISOString(), receivedAt);
  const detail = await purchases.findOne(legacy.id);
  assert.equal(detail.date.toISOString(), invoiceDate, 'opening a receipt does not rewrite its invoice date');
  assert.equal(detail.postedAt.toISOString(), receivedAt);
  assert.deepEqual((await purchases.findAll({ from: receivedAt, to: receivedAt })).map(({ id }) => id), [legacy.id]);
  assert.equal((await purchases.findAll({ from: '2025-07-01', to: '2025-07-01' })).length, 0, 'invoice day does not masquerade as stock receipt day');
  assert.deepEqual(await purchases.overview(period), { count: 2, suppliers: 1, sum: 30 });
  const workbook = XLSX.read(await purchases.exportXlsx(period), { type: 'buffer' });
  for (const sheet of ['Поставки', 'Позиции']) {
    const values = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1 });
    assert.equal(XLSX.SSF.format('yyyy-mm-dd hh:mm:ss', values[1][1]), '2025-07-03 12:07:08');
    assert.equal(XLSX.SSF.format('yyyy-mm-dd hh:mm:ss', values[2][1]), '2025-07-03 13:08:09');
  }
}));

test('PostgreSQL: list and XLSX combine exact suppliers/categories, warehouse, search, date and status without partial document totals', { skip: !url }, async () => fixture(async ({ db, cafe, foreign, ingredients, purchases, locations }) => {
  const warehouse = (await locations.list(cafe.id)).locations[0];
  const other = await locations.save(cafe.id, 'Другой склад');
  const coffee = await ingredients.create({ name: '=2+2', unit: 'kg', category: 'Напитки, холодные' });
  const sugar = await ingredients.create({ name: 'Сахар', unit: 'kg', category: 'Сырьё' });
  const supplier = '=HYPERLINK("https://example.test")';
  const create = (overrides = {}) => purchases.create({ supplier, warehouseId: warehouse.id, date: '2026-11-14T18:00:00.000Z',
    note: '=SUM(A1:A2)', discount: 5, items: [
      { ingredientId: coffee.id, unit: 'kg', quantity: 1.25, purchasePrice: 20 },
      { ingredientId: sugar.id, unit: 'kg', quantity: 2.5, purchasePrice: 8 },
    ], ...overrides });
  const selected = await create();
  const supplierTwo = await create({ supplier: 'Поставщик, ООО', date: '2026-11-15T17:59:59.999Z', discount: 0 });
  await create({ supplier: 'Другая компания' });
  await create({ warehouseId: other.id });
  await create({ date: '2026-11-14T17:59:59.999Z' });
  await create({ date: '2026-11-15T18:00:00.000Z' });
  const cancelled = await create();
  await purchases.cancel(cancelled.id);
  await runWithTenant({ cafeId: foreign.id }, async () => {
    const foreignItem = await ingredients.create({ name: '=2+2', unit: 'kg', category: 'Напитки, холодные' });
    await purchases.create({ supplier, date: '2026-11-14T18:00:00.000Z', items: [{ ingredientId: foreignItem.id, quantity: 1, purchasePrice: 999 }] });
  });
  // Historical default-warehouse documents still have a null location.
  await db.purchase.update({ where: { id: selected.id }, data: { warehouseId: null } });
  const query = { suppliers: [supplier, 'Поставщик, ООО'], categories: ['Напитки, холодные'], search: '=2+2',
    warehouseId: warehouse.id, from: '2026-11-15', to: '2026-11-15', status: 'draft', dateSort: 'asc' };
  const list = await purchases.findAll(query);
  assert.deepEqual(list.map(({ id }) => id), [selected.id, supplierTwo.id]);
  assert.deepEqual((await purchases.findAll({ ...query, dateSort: 'desc' })).map(({ id }) => id), [supplierTwo.id, selected.id]);
  assert.equal((await purchases.findAll({ ...query, suppliers: [supplier.toLowerCase()] })).length, 0, 'supplier match is exact');
  assert.equal((await purchases.findAll({ ...query, categories: ['Напитки'] })).length, 0, 'category comma is part of its exact name');
  assert.equal((await purchases.findAll({ ...query, categories: ['Сырьё', 'Другое'] })).length, 2);
  assert.equal((await purchases.findAll({ ...query, search: `ЗКП-${selected.number}` }))[0].id, selected.id);

  const buffer = await purchases.exportXlsx(query);
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  const book = XLSX.read(buffer, { type: 'buffer', cellNF: true });
  assert.deepEqual(book.SheetNames, ['Поставки', 'Позиции']);
  const summary = XLSX.utils.sheet_to_json(book.Sheets['Поставки'], { header: 1 });
  assert.deepEqual(summary[0], ['№', 'Дата', 'Поставщик', 'Склад', 'Товары', 'Комментарий', 'Статус', 'Сумма']);
  assert.equal(summary.length, list.length + 1);
  assert.equal(summary[1][3], warehouse.name);
  assert.equal(summary[1][7], 40, 'entire purchase including nonmatching-category sugar, less document discount');
  assert.equal(summary[2][7], 45);
  assert.equal(book.Sheets['Поставки'].B2.t, 'n', 'Excel date is a typed numeric date');
  assert.equal(XLSX.SSF.format('yyyy-mm-dd hh:mm', summary[1][1]), '2026-11-15 00:00');
  assert.equal(book.Sheets['Поставки'].H2.t, 'n');
  for (const address of ['C2', 'E2', 'F2']) {
    assert.equal(book.Sheets['Поставки'][address].t, 's');
    assert.equal(book.Sheets['Поставки'][address].f, undefined, 'user strings must never become Excel formulas');
  }
  const lines = XLSX.utils.sheet_to_json(book.Sheets['Позиции'], { header: 1 });
  assert.equal(lines.length, 5, 'export includes all lines of selected documents');
  assert.deepEqual(lines.slice(1, 3).map((line) => line[7]).sort((a, b) => a - b), [1.25, 2.5]);
  assert.equal(lines.slice(1, 3).reduce((sum, line) => sum + line[10], 0), 40);
  assert.equal(book.Sheets['Позиции'].H2.t, 'n');
  const selectedColumns = XLSX.read(await purchases.exportXlsx({ ...query, columns: 'supplier,totalAmount,number' }), { type: 'buffer' });
  assert.deepEqual(XLSX.utils.sheet_to_json(selectedColumns.Sheets['Поставки'], { header: 1 })[0], ['Поставщик', 'Сумма', '№']);
  const exact = await purchases.findAll({ ...query, from: '2026-11-14T18:00:00.000Z', to: '2026-11-14T18:00:00.000Z' });
  assert.deepEqual(exact.map(({ id }) => id), [selected.id]);
  const empty = XLSX.read(await purchases.exportXlsx({ ...query, suppliers: ['Нет такого'] }), { type: 'buffer' });
  assert.equal(XLSX.utils.sheet_to_json(empty.Sheets['Поставки'], { header: 1 }).length, 1);
}));
