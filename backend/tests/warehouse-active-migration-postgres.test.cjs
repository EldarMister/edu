require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientStockService } = require('../src/warehouse/ingredient-stock.service.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('migration: legacy open direct orders preserve allocation, station stock and safe cancellation', { skip: !url }, async t => {
  const db = new PrismaClient({ datasourceUrl: url }); db.$use(tenantPrismaMiddleware);
  try {
    if (!await db.order.findUnique({ where: { id: 'migration-active-order' } })) { t.skip('Requires the pre-migration warehouse-active-legacy.sql fixture'); return; }
    const rollback = new Error('rollback migration verification');
    await runWithTenant({ cafeId: 'warehouse-migration-fixture' }, async () => {
      await assert.rejects(db.$transaction(async tx => {
        const stock = new IngredientStockService();
        const qty = async ingredientId => Number((await tx.warehouseStock.findUniqueOrThrow({ where: { warehouseId_ingredientId: { warehouseId: 'migration-bar', ingredientId } } })).stock);
        const sales = await tx.stockMovement.findMany({ where: { sourceType: 'order', type: 'sale', sourceId: 'migration-active-order' } });
        assert.equal(sales.length, 3);
        assert.ok(sales.every(m => m.warehouseId === 'migration-bar' && m.recipeSnapshot.legacyMigration && m.recipeSnapshot.costKnown === false));
        assert.equal(await tx.stockMovement.count({ where: { sourceType: 'order', sourceId: { in: ['migration-paid-order', 'migration-draft-order'] } } }), 0);
        assert.deepEqual([await qty('legacy:dish:migration-cola'), await qty('legacy:variant:migration-small'), await qty('legacy:variant:migration-large')], [24, 12, 7]);
        assert.equal(Number((await tx.ingredient.findUniqueOrThrow({ where: { id: 'legacy:dish:migration-cola' } })).stock), 0);
        const lines = await tx.orderItem.findMany({ where: { orderId: 'migration-active-order' } });
        assert.ok(lines.every(line => line.stockAccountingSnapshot?.legacyRecorded === true));
        const draftLine = await tx.orderItem.findUniqueOrThrow({ where: { id: 'migration-draft-cola' } });
        assert.equal(draftLine.stockAccountingSnapshot, null);
        await stock.restoreDishSale(tx, 'migration-active-order', lines, 'Проверка перехода');
        assert.deepEqual([await qty('legacy:dish:migration-cola'), await qty('legacy:variant:migration-small')], [27, 14]);
        const loss = await tx.stockMovement.findFirstOrThrow({ where: { sourceId: 'migration-active-order', orderItemId: 'migration-ready-cola', type: 'writeoff' } });
        assert.equal(Number(loss.change), 0); assert.equal(loss.recipeSnapshot.lossQuantity, '1');
        await stock.restoreDishSale(tx, 'migration-active-order', lines, 'Повтор');
        assert.deepEqual([await qty('legacy:dish:migration-cola'), await qty('legacy:variant:migration-small')], [27, 14]);
        throw rollback;
      }, { timeout: 20000 }), err => err === rollback);
    });
  } finally { await db.$disconnect(); }
});
