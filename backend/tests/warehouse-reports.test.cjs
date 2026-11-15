require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const XLSX = require('xlsx');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { WarehouseReportsService, csvCell } = require('../src/warehouse/reports.service.ts');
const { WarehouseOverviewService } = require('../src/warehouse/overview.service.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { warehouseDateRange } = require('../src/warehouse/report-range.ts');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
const { getDefaultPermissionsByRole } = require('../src/common/permissions.ts');
const { assertWarehousePermission } = require('../src/warehouse/warehouse-permissions.ts');
const { redactWarehouseCosts } = require('../src/warehouse/warehouse-cost.interceptor.ts');
const { preparedLossQuantity } = require('../src/warehouse/movement-cost.ts');
const { summarizeMovements } = require('../src/warehouse/movement-summary.ts');
const { postStockMovement } = require('../src/warehouse/stock-posting.ts');

test('calendar report filters use Bishkek days and reject invalid/reversed dates', () => {
  const range = warehouseDateRange('2026-11-14', '2026-11-14');
  assert.equal(range.gte.toISOString(), '2026-11-13T18:00:00.000Z');
  assert.equal(range.lte.toISOString(), '2026-11-14T17:59:59.999Z');
  assert.throws(() => warehouseDateRange('2026-02-30'));
  assert.throws(() => warehouseDateRange('2026-11-15', '2026-11-14'));
  assert.throws(() => warehouseDateRange('not-a-date'));
});

test('warehouse permissions require both section and specific action', () => {
  const permissions = getDefaultPermissionsByRole('ADMIN');
  assertWarehousePermission({ role: 'ADMIN', permissions }, 'warehouseReceive');
  assert.throws(() => assertWarehousePermission({ role: 'ADMIN', permissions }, 'warehouseApprove'));
  permissions.actions.warehouseApprove = true;
  assertWarehousePermission({ role: 'ADMIN', permissions }, 'warehouseApprove');
  permissions.sections.warehouse = false;
  assert.throws(() => assertWarehousePermission({ role: 'ADMIN', permissions }, 'warehouseReceive'));
  const handler = {}, controller = {};
  const guard = new PermissionsGuard({
    getAllAndOverride: () => undefined,
    get: (_, target) => target === handler ? 'actions.warehouseReceive' : 'sections.warehouse',
  });
  assert.throws(() => guard.canActivate({ getHandler: () => handler, getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { role: 'ADMIN', permissions } }) }) }));
});

test('CSV protects spreadsheet formulas and preserves negative numeric quantities', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"');
  assert.equal(csvCell('-3.25'), '"-3.25"');
  assert.equal(csvCell('a;b\nc'), '"a;b\nc"');
});

test('cost redaction preserves quantities while removing nested valuations', () => {
  const result = redactWarehouseCosts({ stock: 12, avgCost: 90, marginAmount: 210, items: [{ quantity: 3, costAtMoment: 8, recipeSnapshot: { totalCost: 24 } }] });
  assert.deepEqual(result, { stock: 12, avgCost: null, marginAmount: null, items: [{ quantity: 3, costAtMoment: null, recipeSnapshot: { totalCost: null } }] });
});

test('prepared loss evidence does not change physical stock and is valued from the original quantity', () => {
  const event = { type: 'writeoff', sourceType: 'order', change: 0, recipeSnapshot: { kind: 'prepared_loss', lossQuantity: '0.125' } };
  assert.equal(preparedLossQuantity(event).toString(), '0.125');
  assert.equal(preparedLossQuantity({ ...event, recipeSnapshot: { kind: 'prepared_loss', lossQuantity: 'NaN' } }).toString(), '0');
  assert.equal(preparedLossQuantity({ ...event, sourceType: 'writeoff' }).toString(), '0');
});

test('movement summary rewinds book values, including negative-stock revaluation and later receipts', () => {
  const d = (v) => new Prisma.Decimal(v);
  const evidence = [
    { createdAt: new Date('2026-11-12T00:00Z'), change: d(-2), costAtMoment: d(10), valuationAdjustment: d(0) },
    { createdAt: new Date('2026-11-13T00:00Z'), change: d(3), costAtMoment: d(20), valuationAdjustment: d(-20) },
    { createdAt: new Date('2026-11-15T00:00Z'), change: d(1), costAtMoment: d(40), valuationAdjustment: d(0) },
  ];
  const result = summarizeMovements({ stock: d(2), stockValue: d(60) }, evidence, new Date('2026-11-12'), new Date('2026-11-14'));
  assert.equal(result.openingQuantity.toString(), '0');
  assert.equal(result.openingValue.toString(), '0');
  assert.equal(result.incomingQuantity.toString(), '3');
  assert.equal(result.outgoingQuantity.toString(), '2');
  assert.equal(result.closingQuantity.toString(), '1');
  assert.equal(result.closingValue.toString(), '20');
  assert.equal(result.valuationAdjustment.toString(), '-20');
});

test('actual margin uses discounted retained revenue and historical costs, separating prepared losses', async () => {
  const d = (value) => new Prisma.Decimal(value);
  const report = new WarehouseReportsService({
    order: { findMany: async () => [
      { id: 'check', paymentStatus: 'paid', finalAmount: d(330), serviceChargeAmount: d(30),
        payments: [{ status: 'paid', amount: d(165) }, { status: 'refunded', amount: d(165) }], items: [{ id: 'line' }] },
      { id: 'refund', paymentStatus: 'refunded', finalAmount: d(100), serviceChargeAmount: d(0),
        payments: [{ status: 'refunded', amount: d(100) }], items: [{ id: 'split-line', stockSourceLineId: 'original-line' }] },
    ] },
    stockMovement: { findMany: async () => [
      { type: 'sale', sourceType: 'order', orderItemId: 'line', change: d(-3), costAtMoment: d(10), costKnown: true, recipeSnapshot: {} },
      { type: 'writeoff', sourceType: 'order', orderItemId: 'line', change: d(0), costAtMoment: d(10), costKnown: true, recipeSnapshot: { kind: 'prepared_loss', lossQuantity: '1' } },
      { type: 'sale', sourceType: 'order', orderItemId: 'original-line', change: d(-1), costAtMoment: d(25), costKnown: true, recipeSnapshot: {} },
    ] },
  });
  const summary = await report.salesPerformance({ view: 'sales' });
  assert.equal(summary.netRevenue, 150, 'refunds and service charges are excluded');
  assert.equal(summary.actualCost, 45, 'prepared loss is classified separately; refund does not restore ingredients');
  assert.equal(summary.grossMargin, 105);
  assert.equal(summary.marginPercent, 70);
  assert.equal(summary.complete, true);
});

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: movement detail groups all filtered rows before pagination with weighted historical costs', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafes = [];
  try {
    const cafe = await db.cafe.create({ data: { name: `Movement groups ${randomUUID()}` } });
    const other = await db.cafe.create({ data: { name: `Other movement groups ${randomUUID()}` } });
    cafes.push(cafe.id, other.id);
    const reports = new WarehouseReportsService(db);
    const fixture = await runWithTenant({ cafeId: cafe.id }, async () => {
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const main = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Other group warehouse');
      const ingredients = new IngredientsService(db);
      const flour = await ingredients.create({ name: 'Group flour', unit: 'kg', category: 'Groups' });
      const water = await ingredients.create({ name: 'Other group ingredient', unit: 'l' });
      const base = {
        cafeId: cafe.id, ingredientId: flour.id, warehouseId: main.id,
        beforeStock: 0, afterStock: 0, actorId: 'group-actor', actorName: 'Group actor',
        sourceId: randomUUID(), createdAt: new Date('2026-11-14T08:00:00Z'), costKnown: true,
      };
      const purchases = Array.from({ length: 25 }, (_, i) => ({
        ...base, type: 'purchase', sourceType: 'purchase', change: i === 24 ? 3000 : 1000,
        costAtMoment: i === 24 ? '0.03' : '0.01',
        // Include a legacy default-warehouse row and a sub-cent valuation correction.
        warehouseId: i === 0 ? null : main.id, valuationAdjustment: i === 0 ? '0.00123456' : 0,
      }));
      await db.stockMovement.createMany({ data: [
        ...purchases,
        { ...base, type: 'cancel', sourceType: 'purchase', change: -2000, costAtMoment: '0.025' },
        { ...base, type: 'writeoff', sourceType: 'writeoff', change: -1000, costAtMoment: '0.02' },
        { ...base, type: 'writeoff', sourceType: 'writeoff', change: -2000, costAtMoment: '0.03', costKnown: false },
        { ...base, type: 'cancel', sourceType: 'writeoff', change: 500, costAtMoment: '0.02' },
        { ...base, type: 'correction', sourceType: 'purchase', change: 0, costAtMoment: 0, valuationAdjustment: 999, costKnown: false },
        { ...base, type: 'purchase', sourceType: 'purchase', change: 999000, costAtMoment: 99, warehouseId: bar.id },
        { ...base, type: 'purchase', sourceType: 'purchase', change: 999000, costAtMoment: 99, ingredientId: water.id },
        { ...base, type: 'purchase', sourceType: 'purchase', change: 999000, costAtMoment: 99, createdAt: new Date('2026-11-12T08:00:00Z') },
        { ...base, type: 'purchase', sourceType: 'purchase', change: 999000, costAtMoment: 99, actorId: 'another-actor' },
      ] });
      const query = { view: 'movements', ingredientId: flour.id, warehouseId: main.id,
        from: '2026-11-14', to: '2026-11-14', employeeId: 'group-actor', pageSize: 20 };
      const result = await reports.report(query);
      assert.equal(result.totalRows, 30);
      assert.equal(result.rows.length, 20);
      const group = (direction, sourceType) => result.movementGroups.find((entry) => entry.direction === direction && entry.sourceType === sourceType);
      assert.equal(result.movementGroups.length, 4);
      assert.deepEqual(group('incoming', 'purchase'), {
        direction: 'incoming', sourceType: 'purchase', label: 'Поставки', quantity: 27,
        unit: 'кг', averageCost: 12.22222222, count: 25,
      });
      assert.deepEqual(group('outgoing', 'purchase'), {
        direction: 'outgoing', sourceType: 'purchase', label: 'Поставки', quantity: 2,
        unit: 'кг', averageCost: 25, count: 1,
      });
      assert.equal(group('outgoing', 'writeoff').quantity, 3);
      assert.equal(group('outgoing', 'writeoff').averageCost, null, 'one unknown movement makes the group cost unknown');
      assert.equal(group('outgoing', 'writeoff').count, 2);
      assert.equal(group('incoming', 'writeoff').quantity, 0.5, 'a reversal follows its physical sign');
      assert.equal(group('incoming', 'writeoff').averageCost, 20);
      const next = await reports.report({ ...query, page: 2 });
      assert.equal(next.rows.length, 10);
      assert.deepEqual(next.movementGroups, result.movementGroups, 'groups are independent of the visible page');
      assert.ok(result.rows.every((row) => !('exactQuantity' in row) && !('exactCost' in row)));
      assert.equal((await reports.report({ ...query, view: 'purchases' })).movementGroups, undefined);
      assert.equal((await reports.report({ ...query, ingredientId: undefined })).movementGroups, undefined, 'never aggregate quantities across ingredients');
      assert.deepEqual((await reports.report({ ...query, category: 'Unrelated category' })).movementGroups, []);
      return { ingredientId: flour.id, warehouseId: main.id };
    });
    await runWithTenant({ cafeId: other.id }, async () => {
      assert.deepEqual((await reports.report({ view: 'movements', ingredientId: fixture.ingredientId })).movementGroups, []);
      await assert.rejects(reports.report({ view: 'movements', ingredientId: fixture.ingredientId, warehouseId: fixture.warehouseId }), /Склад не найден/);
    });
  } finally {
    for (const cafeId of cafes) {
      await db.stockMovement.deleteMany({ where: { cafeId } });
      await db.ingredient.deleteMany({ where: { cafeId } });
      await db.cafe.delete({ where: { id: cafeId } });
    }
    await db.$disconnect();
  }
});

test('PostgreSQL: Poster movement summary preserves historical carry-in, warehouse isolation and unknown costs', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Summary test ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const ingredients = new IngredientsService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const main = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Бар');
      const flour = await ingredients.create({ name: 'Мука', kind: 'raw', unit: 'kg', stock: 5, avgCost: 2 });
      main.cafeId = cafe.id;
      await db.stockMovement.updateMany({ where: { ingredientId: flour.id }, data: { createdAt: new Date('2026-11-10T00:00Z') } });
      const d = (v) => new Prisma.Decimal(v);
      await db.$transaction(async (tx) => {
        await postStockMovement(tx, { ingredientId: flour.id, warehouse: main, change: d(3000), cost: d('0.004'), costKnown: true, valuation: 'average',
          movement: { type: 'purchase', sourceType: 'purchase', createdAt: new Date('2026-11-12T00:00Z') } });
        await postStockMovement(tx, { ingredientId: flour.id, warehouse: main, change: d(-1000),
          movement: { type: 'writeoff', sourceType: 'writeoff', createdAt: new Date('2026-11-13T00:00Z') } });
        await postStockMovement(tx, { ingredientId: flour.id, warehouse: main, change: d(4000), cost: d('0.006'), costKnown: true, valuation: 'average',
          movement: { type: 'purchase', sourceType: 'purchase', createdAt: new Date('2026-11-15T00:00Z') } });
      });
      const reports = new WarehouseReportsService(db);
      const query = { view: 'movement_summary', from: '2026-11-12', to: '2026-11-14', warehouseId: main.id };
      const result = await reports.report(query);
      assert.equal(result.rows.length, 1);
      assert.deepEqual([result.rows[0].openingQuantity, result.rows[0].incomingQuantity, result.rows[0].outgoingQuantity, result.rows[0].closingQuantity], [5, 3, 1, 7]);
      assert.equal(result.rows[0].openingValue, 10);
      assert.equal(result.rows[0].closingValue, 19.25);
      assert.equal(result.rows[0].closingAvgCost, 2.75, 'later receipt must not reprice the period');
      assert.equal((await reports.report({ ...query, warehouseId: bar.id, onlyWithMovement: 'true' })).totalRows, 0);
      assert.match(await reports.exportCsv(query), /Начальный остаток/);
      await ingredients.create({ name: 'Без цены', kind: 'raw', unit: 'pcs', stock: 2 });
      const unknown = await reports.report({ view: 'movement_summary', warehouseId: main.id, search: 'Без цены' });
      assert.equal(unknown.rows[0].closingAvgCost, null);
      assert.equal(unknown.rows[0].closingValue, null);
      assert.equal(unknown.closingValue, null);
      const xlsx = await reports.exportMovementXlsx({
        ...query, search: 'УК', nameCondition: 'equals', nameValue: 'мУка', page: 2, pageSize: 1,
        columns: 'closingValue,name,kind,closingQuantity,openingAvgCost',
      });
      const workbook = XLSX.read(xlsx, { type: 'buffer', cellNF: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 }), [
        ['Итог. сумма', 'Название', 'Тип', 'Итог. остаток', 'Средняя себестоимость на начало'],
        [19.25, 'Мука', 'Ингредиент', 7, 2],
      ]);
      assert.equal(sheet.A2.t, 'n');
      assert.equal(sheet.D2.z, '#,##0.000 "кг"');
      const unknownWorkbook = XLSX.read(await reports.exportMovementXlsx({
        ...query, from: undefined, to: undefined, search: 'Без цены', columns: 'name,openingAvgCost,closingQuantity,closingAvgCost,closingValue',
      }), { type: 'buffer', cellNF: true });
      const unknownSheet = unknownWorkbook.Sheets[unknownWorkbook.SheetNames[0]];
      assert.equal(unknownSheet.B2.v, 0, 'a known zero differs from unknown valuation');
      assert.equal(unknownSheet.C2.v, 2);
      assert.equal(unknownSheet.C2.z, '#,##0.00 "шт"');
      assert.equal(unknownSheet.D2, undefined);
      assert.equal(unknownSheet.E2, undefined);
      await assert.rejects(reports.report({ ...query, employeeId: 'someone' }), /Фильтр сотрудника/);
    });
  } finally {
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});

test('PostgreSQL: movement advanced name conditions combine with search and preserve literal text', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Name filter test ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const ingredients = new IngredientsService(db);
      for (const name of ['Сок', 'Сок 100%', 'Сок 1000', 'Вода', '=1+1']) {
        await ingredients.create({ name, kind: 'goods', unit: 'pcs' });
      }
      const reports = new WarehouseReportsService(db);
      const query = { view: 'movement_summary' };
      const names = async (filters) => (await reports.report({ ...query, ...filters })).rows.map((row) => row.name);
      assert.deepEqual(await names({ search: 'сОк', nameCondition: 'equals', nameValue: ' СОК ' }), ['Сок']);
      assert.deepEqual(await names({ search: 'сок', nameCondition: 'contains', nameValue: '100%' }), ['Сок 100%']);
      assert.deepEqual(await names({ search: '100%', nameCondition: 'equals', nameValue: 'СОК 100%' }), ['Сок 100%']);
      assert.deepEqual(await names({ search: '100%', nameCondition: 'notEquals', nameValue: 'сок 100%' }), []);
      assert.equal((await names({ search: 'сок', nameCondition: 'equals', nameValue: ' ' })).length, 3);
      assert.equal((await names({ nameCondition: 'empty' })).length, 0);
      assert.equal((await names({ nameCondition: 'notEmpty' })).length, 5);
      assert.doesNotMatch(await reports.exportCsv({ ...query, search: 'сок', nameCondition: 'notEquals', nameValue: 'Сок 100%' }), /Сок 100%/);
      const workbook = XLSX.read(await reports.exportMovementXlsx({ ...query, search: '=1+1', columns: 'name' }), { type: 'buffer' });
      const cell = workbook.Sheets[workbook.SheetNames[0]].A2;
      assert.equal(cell.t, 's');
      assert.equal(cell.v, '=1+1');
      assert.equal(cell.f, undefined);
    });
  } finally {
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});

test('PostgreSQL: movement summary includes preparations once physically stocked within the warehouse and report dates', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Preparation visibility ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const ingredients = new IngredientsService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const [main] = (await locations.list(cafe.id)).locations;
      const bar = await locations.save(cafe.id, 'Бар');
      const neverStocked = await ingredients.create({ name: 'Без производства', kind: 'preparation', unit: 'pcs' });
      const later = await ingredients.create({ name: 'Будущая партия', kind: 'prepared_dish', unit: 'pcs' });
      const depleted = await ingredients.create({ name: 'Расходованная партия', kind: 'preparation', unit: 'pcs' });
      const imported = await db.ingredient.create({
        data: { cafeId: cafe.id, name: 'Перенесённый остаток', kind: 'preparation', stock: 4, avgCost: 2, valuationKnown: true },
      });
      const goods = await ingredients.create({ name: 'Обычный товар', kind: 'goods', unit: 'pcs' });
      const d = (value) => new Prisma.Decimal(value);
      await db.$transaction(async (tx) => {
        for (const [ingredient, quantity, type, date] of [
          [depleted, 2, 'production', '2026-11-10'],
          [depleted, -2, 'writeoff', '2026-11-11'],
          [later, 3, 'production', '2026-11-15'],
        ]) {
          await postStockMovement(tx, {
            ingredientId: ingredient.id, warehouse: { ...main, cafeId: cafe.id }, change: d(quantity),
            ...(quantity > 0 ? { cost: d(2), costKnown: true, valuation: 'average' } : {}),
            movement: { type, sourceType: type, createdAt: new Date(date + 'T00:00Z') },
          });
        }
      });
      const reports = new WarehouseReportsService(db);
      const query = { view: 'movement_summary', warehouseId: main.id, from: '2026-11-12', to: '2026-11-14' };
      const beforeProduction = await reports.report(query);
      const byId = new Map(beforeProduction.rows.map((row) => [row.ingredientId, row]));
      assert.deepEqual(new Set(byId.keys()), new Set([depleted.id, imported.id, goods.id]));
      assert.equal(byId.get(depleted.id).closingQuantity, 0);
      assert.equal(byId.get(imported.id).closingQuantity, 4);
      assert.equal((await reports.report({ ...query, onlyWithMovement: 'true' })).totalRows, 0);
      const afterProduction = await reports.report({ ...query, to: '2026-11-15' });
      assert.equal(afterProduction.rows.find((row) => row.ingredientId === later.id).closingQuantity, 3);
      assert.equal(afterProduction.rows.some((row) => row.ingredientId === neverStocked.id), false);
      assert.deepEqual((await reports.report({ ...query, warehouseId: bar.id })).rows.map((row) => row.ingredientId), [goods.id]);
    });
  } finally {
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});

test('PostgreSQL: movement summary keeps one product row and nets only transfers within the selected scope', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Transfer summary ${randomUUID()}` } });
  const foreignCafe = await db.cafe.create({ data: { name: `Foreign scope ${randomUUID()}` } });
  try {
    const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
    const foreign = await runWithTenant({ cafeId: foreignCafe.id }, () => locations.save(foreignCafe.id, 'Another cafe'));
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const reports = new WarehouseReportsService(db);
      const ingredients = new IngredientsService(db);
      const main = { ...(await locations.list(cafe.id)).locations[0], cafeId: cafe.id };
      const bar = { ...await locations.save(cafe.id, 'Бар'), cafeId: cafe.id };
      const patio = { ...await locations.save(cafe.id, 'Терраса'), cafeId: cafe.id };
      const rice = await ingredients.create({ name: 'Рис 2', unit: 'kg', stock: 10, avgCost: 2 });
      const flour = await ingredients.create({ name: 'Рис 10', unit: 'kg', stock: 4, avgCost: 1 });
      const old = new Date('2026-11-10T08:00:00Z');
      const day = new Date('2026-11-14T08:00:00Z');
      await db.stockMovement.updateMany({ where: { ingredientId: { in: [rice.id, flour.id] } }, data: { createdAt: old } });
      const d = (n) => new Prisma.Decimal(n);
      const transferId = randomUUID();
      await db.$transaction(async (tx) => {
        for (const [warehouse, quantity, price] of [[bar, 5000, '0.006'], [patio, 100000, '0.01']]) {
          await postStockMovement(tx, { ingredientId: rice.id, warehouse, change: d(quantity), cost: d(price), costKnown: true,
            valuation: 'average', movement: { type: 'purchase', sourceType: 'purchase', createdAt: old } });
        }
        await postStockMovement(tx, { ingredientId: rice.id, warehouse: main, change: d(-2000),
          movement: { type: 'transfer', sourceType: 'transfer', sourceId: transferId, createdAt: day } });
        await postStockMovement(tx, { ingredientId: rice.id, warehouse: bar, change: d(2000), cost: d('0.002'), costKnown: true,
          valuation: 'average', movement: { type: 'transfer', sourceType: 'transfer', sourceId: transferId, createdAt: day } });
        await postStockMovement(tx, { ingredientId: rice.id, warehouse: main, change: d(0), costKnown: true,
          movement: { type: 'writeoff', sourceType: 'order', createdAt: day, recipeSnapshot: { kind: 'prepared_loss', lossQuantity: '1000' } } });
        await postStockMovement(tx, { ingredientId: flour.id, warehouse: main, change: d(-1000),
          movement: { type: 'inventory', sourceType: 'inventory', createdAt: day } });
        await postStockMovement(tx, { ingredientId: flour.id, warehouse: bar, change: d(1000), cost: d('0.002'), costKnown: true,
          valuation: 'average', movement: { type: 'inventory', sourceType: 'inventory', createdAt: day } });
        await postStockMovement(tx, { ingredientId: rice.id, warehouse: main, change: d(5000), cost: d('0.020'), costKnown: true,
          valuation: 'average', movement: { type: 'purchase', sourceType: 'purchase', createdAt: new Date('2026-11-15T08:00:00Z') } });
      });
      const query = { view: 'movement_summary', from: '2026-11-14', to: '2026-11-14' };
      const scope = { warehouseIds: `${main.id},${bar.id}` };
      const summary = await reports.report({ ...query, ...scope });
      assert.equal(summary.totalRows, 2);
      const [riceRow, flourRow] = summary.rows;
      assert.deepEqual([riceRow.name, riceRow.warehouseId, riceRow.openingQuantity, riceRow.incomingQuantity,
        riceRow.outgoingQuantity, riceRow.closingQuantity, riceRow.movementCount],
      ['Рис 2', null, 15, 0, 0, 15, 0]);
      assert.deepEqual([riceRow.openingValue, riceRow.closingValue], [50, 50]);
      assert.ok(Math.abs(riceRow.closingAvgCost - 50 / 15) < 0.00001);
      assert.deepEqual([flourRow.openingQuantity, flourRow.incomingQuantity, flourRow.outgoingQuantity, flourRow.closingQuantity],
        [4, 1, 1, 4], 'opposite inventory changes are not an internal transfer');
      assert.equal((await reports.report({ ...query, ...scope, nameSort: 'desc', pageSize: 1 })).rows[0].name, 'Рис 10');
      assert.deepEqual((await reports.report({ ...query, ...scope, onlyWithMovement: 'true' })).rows.map((row) => row.ingredientId), [flour.id]);
      assert.equal((await reports.report(query)).rows[0].closingQuantity, 115);
      assert.equal((await reports.report({ ...query, warehouseId: main.id, ingredientId: rice.id })).rows[0].outgoingQuantity, 2);
      assert.equal((await reports.report({ ...query, warehouseIds: bar.id, ingredientId: rice.id })).rows[0].incomingQuantity, 2);
      const detail = await reports.report({ ...query, ...scope, view: 'movements', ingredientId: rice.id, pageSize: 1 });
      assert.equal(detail.totalRows, 3, 'transfer and prepared loss remain available in document history');
      assert.deepEqual(detail.movementGroups, []);
      const oneLocation = await reports.report({ ...query, view: 'movements', warehouseId: main.id, ingredientId: rice.id });
      assert.deepEqual(oneLocation.movementGroups.map(({ direction, sourceType, quantity, averageCost }) =>
        [direction, sourceType, quantity, averageCost]), [['outgoing', 'transfer', 2, 2]]);
      const inventory = await reports.report({ ...query, ...scope, view: 'movements', ingredientId: flour.id });
      assert.deepEqual(inventory.movementGroups.map(({ direction, sourceType, quantity }) =>
        [direction, sourceType, quantity]), [['incoming', 'inventory', 1], ['outgoing', 'inventory', 1]]);
      const csv = await reports.exportCsv({ ...query, ...scope });
      assert.equal(csv.split('\r\n').length, 3);
      assert.match(csv, /"Рис 2";"raw";"";"Выбранные склады";"кг";"15";/);
      await assert.rejects(reports.report({ ...query, warehouseIds: `${main.id},${foreign.id}` }), /Склад не найден/);
      await assert.rejects(reports.report({ ...query, ...scope, warehouseId: main.id }), /Укажите один способ выбора/);
    });
  } finally {
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.cafe.delete({ where: { id: foreignCafe.id } });
    await db.$disconnect();
  }
});

test('PostgreSQL: reports reconcile stock and historical cost, never mixing sales with losses', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Report test ${randomUUID()}` } });
  const other = await db.cafe.create({ data: { name: `Other report test ${randomUUID()}` } });
  try {
    const reports = new WarehouseReportsService(db);
    const overview = new WarehouseOverviewService(db);
    const ingredients = new IngredientsService(db);
    const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
    const purchases = new PurchasesService(db);
    const identifiers = await runWithTenant({ cafeId: cafe.id }, async () => {
      const main = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Бар');
      const rice = await ingredients.create({ name: '=Rice', category: 'Крупы', kind: 'raw', unit: 'kg' });
      for (const price of [80, 100]) {
        const purchase = await purchases.create({ supplier: 'Поставщик', warehouseId: main.id,
          items: [{ ingredientId: rice.id, unit: 'kg', quantity: 10, purchasePrice: price }] });
        await purchases.complete(purchase.id);
      }
      let report = await reports.report({ view: 'balances', warehouseId: main.id });
      assert.equal(report.totalCost, 1800);
      assert.equal(report.rows[0].quantity, 20);
      assert.equal(report.rows[0].unitCost, 90);
      report = await reports.report({ view: 'purchases', category: 'Крупы', pageSize: 1 });
      assert.equal(report.totalRows, 2);
      assert.equal(report.rows.length, 1);
      assert.equal(report.totalCost, 1800, 'pagination must not change the total');
      assert.ok(report.rows[0].sourceId);
      assert.match(await reports.exportCsv({ view: 'purchases' }), /'=Rice/);
      // Historical movements retain original cost even if the current price changes.
      await db.stockMovement.createMany({ data: [
        { cafeId: cafe.id, ingredientId: rice.id, warehouseId: main.id, type: 'sale', sourceType: 'order', sourceId: randomUUID(),
          beforeStock: 20000, change: -1000, afterStock: 19000, costAtMoment: '0.09', costKnown: true, actorId: 'cook', actorName: 'Повар' },
        { cafeId: cafe.id, ingredientId: rice.id, warehouseId: main.id, type: 'writeoff', sourceType: 'writeoff', sourceId: randomUUID(),
          beforeStock: 19000, change: -2000, afterStock: 17000, costAtMoment: '0.09', costKnown: true, actorId: 'admin', actorName: 'Администратор' },
      ] });
      await db.ingredient.update({ where: { id: rice.id }, data: { stock: 17000, avgCost: '0.2' } });
      assert.equal((await reports.report({ view: 'sales' })).totalCost, 90);
      assert.equal((await reports.report({ view: 'losses' })).totalCost, 180);
      assert.equal((await reports.report({ view: 'movements', employeeId: 'cook' })).totalRows, 1);
      assert.equal((await reports.report({ view: 'movements', warehouseId: bar.id })).totalRows, 0);
      const snapshot = await overview.getOverview({});
      assert.equal(snapshot.lossesTotal, 180);
      assert.equal(snapshot.ingredientWriteOffTotal, 270);
      assert.equal(snapshot.itemCount, 1);
      return { warehouseId: main.id, ingredientId: rice.id };
    });
    await runWithTenant({ cafeId: other.id }, async () => {
      assert.equal((await reports.report({ view: 'movements' })).totalRows, 0);
      assert.equal((await reports.report({ view: 'movements', ingredientId: identifiers.ingredientId })).totalRows, 0);
      await assert.rejects(reports.report({ warehouseId: identifiers.warehouseId }));
    });
  } finally {
    for (const cafeId of [cafe.id, other.id]) {
      await db.stockMovement.deleteMany({ where: { cafeId } });
      await db.purchase.deleteMany({ where: { cafeId } });
      await db.ingredient.deleteMany({ where: { cafeId } });
      await db.cafe.delete({ where: { id: cafeId } });
    }
    await db.$disconnect();
  }
});

test('PostgreSQL: migration fixture preserves legacy quantities and recipe identity', { skip: !url }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const cafe = await db.cafe.findUnique({ where: { id: 'warehouse-migration-fixture' } });
    if (!cafe) return t.skip('Load the legacy fixture before running migrations for this check');
    const cola = await db.dish.findUnique({ where: { id: 'migration-cola' }, include: { stockIngredient: true } });
    assert.equal(cola.stock, 24);
    const totalStock = async (ingredient) => ingredient.stock.add((await db.warehouseStock.aggregate({ where: { ingredientId: ingredient.id }, _sum: { stock: true } }))._sum.stock ?? 0).toNumber();
    assert.equal(await totalStock(cola.stockIngredient), 24);
    const variants = await db.dishVariant.findMany({ where: { dishId: 'migration-sizes' }, include: { stockIngredient: true } });
    assert.deepEqual((await Promise.all(variants.map(v => totalStock(v.stockIngredient)))).sort((a,b) => a-b), [7, 12]);
    const recipe = await db.dish.findUnique({ where: { id: 'migration-recipe' }, include: { recipeItems: true } });
    assert.equal(recipe.stockIngredientId, null);
    assert.equal(recipe.recipeItems[0].id, 'migration-recipe-line');
    const syrup = await db.ingredient.findUnique({ where: { id: 'migration-syrup' } });
    assert.equal(syrup.stock.toNumber(), 5000);
    assert.equal(syrup.avgCost.toNumber(), 0.2);
    assert.equal(await db.stockMovement.count({ where: { sourceId: 'migration:unified-warehouse', cafeId: cafe.id } }), 3);
  } finally { await db.$disconnect(); }
});
