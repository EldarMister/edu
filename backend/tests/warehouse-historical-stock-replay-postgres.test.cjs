require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { postStockMovement } = require('../src/warehouse/stock-posting.ts');
const { lockIngredients } = require('../src/warehouse/stock-lock.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}
const decimal = (value) => new Prisma.Decimal(value);

test('PostgreSQL: backdated receipt reprices two warehouse transfers, writeoff, sale, and return atomically', { skip: !url }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Historical replay ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const actor = await db.user.create({ data: { name: 'Owner', role: 'OWNER', phone: randomUUID(), passwordHash: 'unused' } });
      const ingredients = new IngredientsService(db);
      const docs = new WarehouseDocumentsService(db);
      const purchases = new PurchasesService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const [base] = (await locations.list(cafe.id)).locations;
      const main = { ...base, cafeId: cafe.id };
      const bar = { ...await locations.save(cafe.id, 'Bar'), cafeId: cafe.id };
      const kitchen = { ...await locations.save(cafe.id, 'Kitchen'), cafeId: cafe.id };
      const other = { ...await locations.save(cafe.id, 'Unrelated'), cafeId: cafe.id };
      const product = await ingredients.create({ name: 'Coffee', unit: 'pcs', stock: 10, avgCost: 10 });
      const opening = new Date(Date.now() - 60_000);
      const effective = new Date(Date.now() - 30_000);
      await db.ingredient.update({ where: { id: product.id }, data: { createdAt: opening } });
      await db.stockMovement.updateMany({ where: { ingredientId: product.id }, data: { createdAt: opening } });
      const locked = (operation) => db.$transaction(async (tx) => {
        await lockIngredients(tx, [product.id]);
        return operation(tx);
      });
      await locked((tx) => postStockMovement(tx, { ingredientId: product.id, warehouse: bar,
        change: decimal(4), cost: decimal(40), costKnown: true, valuation: 'average',
        movement: { createdAt: opening, type: 'correction', sourceType: 'manual', sourceId: product.id, comment: 'Начальный остаток' } }));
      const transfer = (from, to, quantity) => docs.create(actor, { kind: 'transfer', warehouseId: from.id,
        destinationWarehouseId: to.id, items: [{ ingredientId: product.id, quantity }], finalize: 'post' });
      const dispatch = await transfer(main, bar, 4);
      const onward = await transfer(bar, kitchen, 2);
      const waste = await docs.create(actor, { kind: 'writeoff', warehouseId: bar.id,
        reason: 'damage', items: [{ ingredientId: product.id, quantity: 1 }], finalize: 'post' });
      await docs.create(actor, { kind: 'inventory', mode: 'partial', warehouseId: other.id,
        items: [{ ingredientId: product.id, quantity: 0 }], finalize: 'post' });
      const orderId = randomUUID();
      const lineId = randomUUID();
      const returnId = randomUUID();
      const sale = await locked((tx) => postStockMovement(tx, { ingredientId: product.id, warehouse: kitchen,
        change: decimal(-1), movement: { type: 'sale', sourceType: 'order', sourceId: orderId, orderItemId: lineId } }));
      await locked((tx) => postStockMovement(tx, { ingredientId: product.id, warehouse: kitchen,
        change: decimal('0.5'), cost: sale.cost, costKnown: sale.movement.costKnown, valuation: 'average',
        movement: { type: 'return', sourceType: 'order', sourceId: orderId, orderItemId: returnId, saleLineId: lineId } }));

      const receiptInput = { supplier: 'Historical supplier', warehouseId: main.id, complete: true,
        effectiveAt: effective.toISOString(), items: [{ ingredientId: product.id, quantity: 10, purchasePrice: 30 }] };
      const receipt = await purchases.create(receiptInput, actor);
      const receiptMovement = await db.stockMovement.findFirstOrThrow({ where: { sourceId: receipt.id } });
      assert.equal(+receiptMovement.createdAt, +effective);
      assert.ok(receiptMovement.recordedAt > receiptMovement.createdAt);
      assert.equal(Number(receiptMovement.receiptValue), 300);
      assert.equal(Number(receiptMovement.costAtMoment), 30);
      const repriced = async (sourceId) => (await db.stockMovement.findMany({ where: { sourceId } }))
        .map((row) => Number(row.costAtMoment)).sort((a, b) => a - b);
      assert.deepEqual(await repriced(dispatch.id), [20, 20]);
      assert.deepEqual(await repriced(onward.id), [30, 30]);
      assert.deepEqual(await repriced(orderId), [30, 30]);
      assert.equal((await docs.get(waste.id)).items[0].unitCost, 30);
      const balances = (await ingredients.findOne(product.id)).balances;
      const perWarehouse = Object.fromEntries(balances.map((row) => [row.warehouseId, [row.stock, row.avgCost]]));
      assert.deepEqual(perWarehouse[main.id], [16, 20]);
      assert.deepEqual(perWarehouse[bar.id], [5, 30]);
      assert.deepEqual(perWarehouse[kitchen.id], [1.5, 30]);

      const pastWriteoff = await docs.create(actor, { kind: 'writeoff', warehouseId: main.id,
        effectiveAt: new Date(+effective + 1).toISOString(), reason: 'damage',
        items: [{ ingredientId: product.id, quantity: 2 }], finalize: 'post' });
      assert.equal(pastWriteoff.items[0].expected, 20);
      assert.equal(pastWriteoff.items[0].unitCost, 20);
      assert.ok(pastWriteoff.postedAt > pastWriteoff.effectiveAt);
      const pastTransfer = await docs.create(actor, { kind: 'transfer', warehouseId: bar.id, destinationWarehouseId: kitchen.id,
        effectiveAt: new Date(+effective - 1).toISOString(),
        items: [{ ingredientId: product.id, quantity: 1 }], finalize: 'post' });
      assert.deepEqual(await repriced(pastTransfer.id), [40, 40]);
      assert.deepEqual(await repriced(onward.id), [28.57142857, 28.57142857]);
      assert.deepEqual(await repriced(orderId), [32.38095238, 32.38095238]);
      await assert.rejects(docs.create(actor, { kind: 'writeoff', warehouseId: kitchen.id, reason: 'damage',
        effectiveAt: new Date(+effective - 2).toISOString(), items: [{ ingredientId: product.id, quantity: 1 }],
        finalize: 'post' }), /историческом периоде недостаточно/);

      // A production output distributes cost across ingredients. Refusing an
      // unsupported suffix must roll back the staged receipt and balances.
      await locked((tx) => postStockMovement(tx, { ingredientId: product.id, warehouse: main,
        change: decimal(-1), movement: { type: 'production', sourceType: 'production', sourceId: randomUUID() } }));
      const before = await db.stockMovement.findMany({ where: { ingredientId: product.id }, orderBy: { id: 'asc' } });
      const inventoryBefore = await ingredients.findOne(product.id);
      await assert.rejects(purchases.create(receiptInput, actor), /были производство или переработка/);
      assert.deepEqual(await db.stockMovement.findMany({ where: { ingredientId: product.id }, orderBy: { id: 'asc' } }), before);
      assert.deepEqual((await ingredients.findOne(product.id)).balances, inventoryBefore.balances);
      assert.equal(await db.purchase.count({ where: { supplier: receiptInput.supplier } }), 1);

      const onHand = inventoryBefore.balances.find(({ warehouseId }) => warehouseId === main.id).stock;
      const noOp = await docs.create(actor, { kind: 'inventory', mode: 'partial', warehouseId: main.id,
        items: [{ ingredientId: product.id, quantity: onHand }], finalize: 'post' });
      assert.equal(await db.stockMovement.count({ where: { sourceId: noOp.id } }), 0);
      await assert.rejects(purchases.create(receiptInput, actor), /проведена инвентаризация/);
      const untracked = await ingredients.create({ name: 'Untracked opening', unit: 'pcs' });
      await db.ingredient.update({ where: { id: untracked.id }, data: { stock: 6, avgCost: 2 } });
      await assert.rejects(purchases.create({ ...receiptInput, items: [{ ingredientId: untracked.id, quantity: 3, purchasePrice: 2 }] }, actor),
        /журнал не подтверждает начальный остаток/);
      assert.equal(Number((await db.ingredient.findUniqueOrThrow({ where: { id: untracked.id } })).stock), 6);

      const empty = await ingredients.create({ name: 'Backdated transfer from empty stock', unit: 'pcs' });
      const moved = await docs.create(actor, { kind: 'transfer', warehouseId: main.id, destinationWarehouseId: bar.id,
        effectiveAt: effective.toISOString(), items: [{ ingredientId: empty.id, quantity: 3 }], finalize: 'post' });
      assert.equal(moved.items[0].expected, 0);
      const restock = await purchases.create({ ...receiptInput, supplier: 'Partial restock', effectiveAt: new Date(+effective + 1).toISOString(),
        items: [{ ingredientId: empty.id, quantity: 1, purchasePrice: 30 }] }, actor);
      const receiptEntry = await db.stockMovement.findFirstOrThrow({ where: { sourceId: restock.id } });
      assert.equal(Number(receiptEntry.beforeStock), -3);
      assert.equal(Number(receiptEntry.afterStock), -2);
      const backdatedBalances = (await ingredients.findOne(empty.id)).balances;
      assert.equal(backdatedBalances.find(({ warehouseId }) => warehouseId === main.id).stock, -2);
      assert.equal(backdatedBalances.find(({ warehouseId }) => warehouseId === bar.id).stock, 3);

      const formerShortage = await ingredients.create({ name: 'Older negative stock policy', unit: 'pcs', stock: 2, avgCost: 10 });
      await db.stockMovement.updateMany({ where: { ingredientId: formerShortage.id }, data: { createdAt: opening } });
      await db.settings.upsert({ where: { cafeId: cafe.id }, create: { cafeId: cafe.id, allowNegativeIngredientStock: true },
        update: { allowNegativeIngredientStock: true } });
      const earlierWaste = await docs.create(actor, { kind: 'writeoff', warehouseId: main.id, reason: 'damage',
        items: [{ ingredientId: formerShortage.id, quantity: 5 }], finalize: 'post' });
      await db.settings.update({ where: { cafeId: cafe.id }, data: { allowNegativeIngredientStock: false } });
      await purchases.create({ ...receiptInput, supplier: 'Historically allowed shortage',
        items: [{ ingredientId: formerShortage.id, quantity: 1, purchasePrice: 30 }] }, actor);
      assert.equal((await ingredients.findOne(formerShortage.id)).stock, -2);
      assert.deepEqual(await repriced(earlierWaste.id), [16.66666667]);
    });
  } finally {
    await db.auditLog.deleteMany({ where: { cafeId: cafe.id } });
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.settings.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
