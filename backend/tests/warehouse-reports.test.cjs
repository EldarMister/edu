require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
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
      await assert.rejects(reports.report({ ...query, employeeId: 'someone' }), /Фильтр сотрудника/);
    });
  } finally {
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
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
