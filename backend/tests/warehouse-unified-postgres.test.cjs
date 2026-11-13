require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { CatalogService } = require('../src/admin/catalog.service.ts');
const { WarehouseSuppliersService } = require('../src/warehouse/suppliers.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Only a dedicated local test database is allowed');
}

test('PostgreSQL: unified catalog, precise receipts, transfers, returns and reversals reconcile', { skip: !url }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Unified warehouse ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const items = new IngredientsService(db);
      const purchases = new PurchasesService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const docs = new WarehouseDocumentsService(db);
      const owner = { id: randomUUID(), name: 'Владелец', role: 'OWNER', cafeId: cafe.id };
      const admin = { ...owner, id: randomUUID(), role: 'ADMIN' };
      const main = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Бар');
      const stock = async (id, warehouseId = main.id) => (await items.findAll({ warehouseId })).find((row) => row.id === id);
      const post = async (dto) => {
        const created = await docs.create(owner, { warehouseId: main.id, ...dto });
        const submitted = await docs.submit(owner, created.id, created.revision);
        return docs.approve(owner, created.id, submitted.revision);
      };
      const rice = await items.create({ name: 'Рис', unit: 'kg', kind: 'raw', category: 'Крупы', barcode: 'RICE', supplier: 'Мельница' });
      let receipt;
      await t.test('10 kg at 80 plus 10 kg at 100 gives 20 kg at 90', async () => {
        await purchases.create({ supplier: 'Мельница', complete: true, items: [{ ingredientId: rice.id, quantity: 10, unit: 'kg', purchasePrice: 80 }] });
        receipt = await purchases.create({ supplier: 'Мельница', complete: true, items: [{ ingredientId: rice.id, quantity: 10, unit: 'kg', purchasePrice: 100 }] });
        assert.equal((await stock(rice.id)).stock, 20);
        assert.equal((await stock(rice.id)).avgCost, 90);
        assert.equal((await items.findAll({ search: 'RICE' }))[0].id, rice.id);
        const card = await items.findOne(rice.id);
        assert.equal(card.lastPurchasePrice, 100);
        assert.equal(card.balances.length, 2);
        await assert.rejects(items.update(rice.id, { unit: 'l' }), /Нельзя менять/);
        await assert.rejects(purchases.update(receipt.id, { supplier: 'Незаметная правка' }), /неизменяем/);
      });
      const cola = await items.create({ name: 'Кола', unit: 'pcs', kind: 'beverage', purchaseUnit: 'коробка', purchaseFactor: 24 });
      await t.test('individual package factors and exact supplier discounts', async () => {
        const p = await purchases.create({ supplier: 'Напитки', complete: true, discount: 24,
          items: [{ ingredientId: cola.id, quantity: 1, unit: 'коробка', purchasePrice: 240 }], note: 'Скидка за коробку', attachments: ['https://example.com/invoice.pdf'] });
        assert.equal(p.totalAmount, 216);
        assert.equal((await stock(cola.id)).stock, 24);
        assert.equal((await stock(cola.id)).avgCost, 9);
        const pennies = await purchases.create({ supplier: 'Округление', discount: 0.01, items: [
          { ingredientId: cola.id, quantity: 1, total: 0.01 }, { ingredientId: cola.id, quantity: 1, total: 0.01 },
          { ingredientId: cola.id, quantity: 1, total: 0.01 }, { ingredientId: cola.id, quantity: 1, total: 0 },
        ] });
        assert.equal(pennies.totalAmount, 0.02);
        assert.ok(pennies.items.every((line) => line.total >= 0));
      });
      await t.test('transfer posts once and preserves warehouse-specific cost; reversal has evidence', async () => {
        const key = randomUUID();
        const payload = { kind: 'transfer', warehouseId: main.id, destinationWarehouseId: bar.id,
          requestKey: key, items: [{ ingredientId: cola.id, quantity: 12 }] };
        const [a, b] = await Promise.all([docs.create(admin, payload), docs.create(admin, payload)]);
        assert.equal(a.id, b.id);
        const sent = await docs.submit(admin, a.id, a.revision);
        const attempts = await Promise.allSettled([docs.approve(admin, a.id, sent.revision), docs.approve(admin, a.id, sent.revision)]);
        assert.deepEqual(attempts.map((v) => v.status).sort(), ['fulfilled', 'rejected']);
        assert.deepEqual([(await stock(cola.id)).stock, (await stock(cola.id, bar.id)).stock], [12, 12]);
        assert.equal((await stock(cola.id, bar.id)).avgCost, 9);
        await assert.rejects(docs.create(admin, { ...payload, items: [{ ingredientId: cola.id, quantity: 13 }] }), /другими позициями/);
        const reversed = await docs.reverse(owner, a.id, 'Ошибочно выбран склад');
        assert.equal(reversed.status, 'reversed');
        assert.deepEqual([(await stock(cola.id)).stock, (await stock(cola.id, bar.id)).stock], [24, 0]);
        assert.equal(await db.stockMovement.count({ where: { sourceId: a.id } }), 4);
        await assert.rejects(docs.reverse(owner, a.id, 'Повторное сторно'));
      });
      await t.test('supplier return cannot exceed receipt; reversal restores original quantity and valuation', async () => {
        const returned = await post({ kind: 'supplier_return', sourcePurchaseId: receipt.id, items: [{ ingredientId: rice.id, quantity: 4 }] });
        assert.deepEqual([(await stock(rice.id)).stock, (await stock(rice.id)).avgCost], [16, 90]);
        await assert.rejects(post({ kind: 'supplier_return', sourcePurchaseId: receipt.id, items: [{ ingredientId: rice.id, quantity: 7 }] }), /превышает/);
        assert.equal((await stock(rice.id)).stock, 16);
        await docs.reverse(owner, returned.id, 'Поставщик заменил товар на месте');
        assert.deepEqual([(await stock(rice.id)).stock, (await stock(rice.id)).avgCost], [20, 90]);
      });
      await t.test('inventory rejects a negative outcome after concurrent consumption', async () => {
        const count = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'partial', items: [{ ingredientId: cola.id, quantity: 0 }] });
        await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: cola.id, quantity: 1 }] });
        const submitted = await docs.submit(owner, count.id, count.revision);
        await assert.rejects(docs.approve(owner, count.id, submitted.revision), /недостаточно/);
        assert.equal((await stock(cola.id)).stock, 23);
      });
      await t.test('inventory keeps its start snapshot before first entry and through later edits', async () => {
        const water = await items.create({ name: 'Вода для пересчёта', unit: 'pcs', stock: 24, kind: 'beverage' });
        const draft = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'full' });
        await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: water.id, quantity: 2 }] });
        const lines = draft.items.map((line) => ({ ingredientId: line.ingredientId, quantity: line.ingredientId === water.id ? 21 : line.expected }));
        const entered = await docs.update(owner, draft.id, { revision: draft.revision, items: lines });
        assert.equal(entered.items.find((line) => line.ingredientId === water.id).expected, 24);
        const submitted = await docs.submit(owner, draft.id, entered.revision);
        await docs.approve(owner, draft.id, submitted.revision);
        assert.equal((await stock(water.id)).stock, 19);
        const next = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'partial', items: [{ ingredientId: water.id, quantity: 18 }] });
        await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: water.id, quantity: 1 }] });
        const changed = await docs.update(owner, next.id, { revision: next.revision, items: [{ ingredientId: water.id, quantity: 17 }] });
        assert.equal(changed.items[0].expected, 19);
        const pending = await docs.submit(owner, next.id, changed.revision);
        await docs.approve(owner, next.id, pending.revision);
        assert.equal((await stock(water.id)).stock, 16);
      });
      await t.test('catalog cannot resurrect a separate stock system and item cards cannot bypass documents', async () => {
        const catalog = new CatalogService(db, { emitBroadcast() {} }, { async log() {} });
        const category = await db.category.create({ data: { name: 'Напитки' } });
        const dish = await db.dish.create({ data: { name: 'Кола', categoryId: category.id, price: 50, trackInventory: true, stock: 24, stockIngredientId: cola.id } });
        await catalog.updateDish(dish.id, { name: 'Кола 330 мл', trackInventory: true, stock: 24 }, owner);
        await assert.rejects(catalog.updateDish(dish.id, { stock: 30 }, owner), /документом/);
        await assert.rejects(catalog.createDish({ name: 'Второй учёт', categoryId: category.id, price: 10, trackInventory: true, stock: 5 }, owner), /Складской учёт/);
        await assert.rejects(items.update(cola.id, { avgCost: 1 }), /документом/);
        await assert.rejects(items.update(cola.id, { stock: 999 }), /документом/);
        assert.equal((await stock(cola.id)).stock, 23);
        await db.dish.delete({ where: { id: dish.id } });
        await db.category.delete({ where: { id: category.id } });
      });
      await t.test('supplier cards, multiple package units and receipt retries share one record', async () => {
        const suppliers = new WarehouseSuppliersService(db);
        const supplier = await suppliers.save({ name: 'Оптовый поставщик', phone: '+996555000000', email: 'supply@example.com' });
        await assert.rejects(suppliers.save({ name: 'оптовый поставщик' }), /уже существует/);
        await db.warehouseSupplier.create({ data: { cafeId: cafe.id, name: 'оптовый поставщик', isActive: false, note: 'Архивный псевдоним миграции' } });
        assert.equal((await suppliers.save({ name: 'Оптовый поставщик', phone: '+996555000001' }, supplier.id)).phone, '+996555000001');
        const water = await items.create({ name: 'Вода в упаковках', unit: 'pcs', kind: 'beverage', supplierId: supplier.id,
          purchaseUnits: [{ name: 'ящик', factor: 24 }, { name: 'упаковка', factor: 6 }] });
        assert.deepEqual(water.purchaseUnits.map((unit) => unit.factor), [24, 6]);
        assert.equal(water.purchaseUnit, 'ящик');
        const payload = { supplierId: supplier.id, requestKey: randomUUID(), complete: true,
          items: [{ ingredientId: water.id, quantity: 1, unit: 'упаковка', purchasePrice: 120 }] };
        const [a, b] = await Promise.all([purchases.create(payload), purchases.create(payload)]);
        assert.equal(a.id, b.id);
        assert.equal((await stock(water.id)).stock, 6);
        assert.equal((await stock(water.id)).avgCost, 20);
        assert.equal(await db.stockMovement.count({ where: { sourceId: a.id, type: 'purchase' } }), 1);
        await assert.rejects(purchases.create({ ...payload, items: [{ ...payload.items[0], quantity: 2 }] }), /другого прихода/);
        await suppliers.save({ name: 'Оптовик новое название' }, supplier.id);
        assert.equal((await purchases.findOne(a.id)).supplier, 'Оптовый поставщик');
        assert.equal((await items.findOne(water.id)).supplier, 'Оптовик новое название');
        await suppliers.archive(supplier.id);
        assert.ok(!(await suppliers.list()).some((row) => row.id === supplier.id));
        await assert.rejects(purchases.create({ ...payload, requestKey: randomUUID() }), /архиве/);
        await suppliers.save({ name: 'Оптовик новое название', isActive: true }, supplier.id);
        const flour = await items.create({ name: 'Фасованная мука', unit: 'kg', purchaseUnits: [{ name: 'мешок', factor: 25 }, { name: 'пакет', factor: 0.5 }] });
        await purchases.create({ supplierId: supplier.id, complete: true, items: [{ ingredientId: flour.id, quantity: 1, unit: 'пакет', purchasePrice: 40 }] });
        const grams = await items.update(flour.id, { unit: 'g' });
        assert.equal(grams.stock, 500);
        assert.deepEqual(grams.purchaseUnits.map((unit) => unit.factor), [25000, 500]);
        await assert.rejects(items.update(flour.id, { purchaseUnits: [{ name: 'коробка', factor: 0 }] }), /больше нуля/);
      });
      await t.test('explicit negative-stock policy records valuation adjustment without rewriting historical costs', async () => {
        await db.settings.upsert({ where: { cafeId: cafe.id }, create: { cafeId: cafe.id, allowNegativeIngredientStock: true }, update: { allowNegativeIngredientStock: true } });
        const item = await items.create({ name: 'Товар с разрешённым минусом', unit: 'pcs', stock: 0, avgCost: 12 });
        const waste = await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: item.id, quantity: 1 }] });
        assert.equal((await stock(item.id)).stock, -1);
        const receipt = await purchases.create({ supplier: 'Переоценка', complete: true,
          items: [{ ingredientId: item.id, quantity: 2, purchasePrice: 15 }] });
        const balance = await stock(item.id);
        assert.deepEqual([balance.stock, balance.avgCost], [1, 15]);
        const history = await db.stockMovement.findMany({ where: { ingredientId: item.id } });
        assert.equal(Number(history.find((row) => row.sourceId === waste.id).costAtMoment), 12);
        assert.equal(Number(history.find((row) => row.sourceId === receipt.id).valuationAdjustment), -3);
        const value = history.reduce((sum, row) => sum.add(row.change.mul(row.costAtMoment)).add(row.valuationAdjustment), new (require('@prisma/client').Prisma.Decimal)(0));
        assert.equal(Number(value), balance.stock * balance.avgCost);
        await db.settings.update({ where: { cafeId: cafe.id }, data: { allowNegativeIngredientStock: false } });
      });
      await t.test('opening and all stock movements reconcile to balances', async () => {
        const opening = await items.create({ name: 'Салфетки', unit: 'pcs', stock: 10, avgCost: 0.5, kind: 'consumable' });
        for (const id of [rice.id, cola.id, opening.id]) {
          const sums = await db.stockMovement.aggregate({ where: { ingredientId: id }, _sum: { change: true } });
          const aggregate = (await items.findAll({})).find((row) => row.id === id);
          assert.equal(Number(sums._sum.change), aggregate.stockBase);
        }
      });
    });
  } finally {
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.settings.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
