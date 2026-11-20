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
const { movementSummary } = require('../src/warehouse/movement-summary.ts');
const { WarehouseReportsService } = require('../src/warehouse/reports.service.ts');
const { warehouseDay } = require('../src/warehouse/report-range.ts');

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
      const rice = await items.create({ name: 'Рис', unit: 'kg', kind: 'raw', category: 'Крупы', supplier: 'Мельница' });
      await t.test('legacy barcodes stay stored without appearing in article searches or being updated', async () => {
        await db.ingredient.update({ where: { id: rice.id }, data: { barcode: 'LEGACY-RICE' } });
        assert.equal((await items.findAll({ search: 'Рис' }))[0].id, rice.id);
        assert.deepEqual(await items.findAll({ search: 'LEGACY-RICE' }), []);
        assert.equal('barcode' in (await items.findOne(rice.id)), false);
        await items.update(rice.id, { barcode: 'STALE-CLIENT-CODE' });
        assert.equal((await db.ingredient.findUnique({ where: { id: rice.id } })).barcode, 'LEGACY-RICE');
      });
      let receipt;
      await t.test('10 kg at 80 plus 10 kg at 100 gives 20 kg at 90', async () => {
        await purchases.create({ supplier: 'Мельница', complete: true, items: [{ ingredientId: rice.id, quantity: 10, unit: 'kg', purchasePrice: 80 }] });
        receipt = await purchases.create({ supplier: 'Мельница', complete: true, items: [{ ingredientId: rice.id, quantity: 10, unit: 'kg', purchasePrice: 100 }] });
        assert.equal((await stock(rice.id)).stock, 20);
        assert.equal((await stock(rice.id)).avgCost, 90);
        const card = await items.findOne(rice.id);
        assert.equal(card.lastPurchasePrice, 100);
        assert.equal(card.balances.length, 2);
        await assert.rejects(items.update(rice.id, { unit: 'l' }), /Нельзя менять/);
        await assert.rejects(purchases.update(receipt.id, { supplier: 'Незаметная правка' }), /изменилась/);
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
        const posted = attempts.find(({ status }) => status === 'fulfilled').value;
        const transferLegs = await db.stockMovement.findMany({ where: { sourceId: a.id, type: 'transfer' } });
        assert.equal(transferLegs.length, 2);
        assert.ok(transferLegs.every(({ createdAt }) => +createdAt === +posted.postedAt), 'one document belongs to one report day');
        assert.deepEqual([(await stock(cola.id)).stock, (await stock(cola.id, bar.id)).stock], [12, 12]);
        assert.equal((await stock(cola.id, bar.id)).avgCost, 9);
        await assert.rejects(docs.create(admin, { ...payload, items: [{ ingredientId: cola.id, quantity: 13 }] }), /другими позициями/);
        const reversed = await docs.reverse(owner, a.id, 'Ошибочно выбран склад');
        assert.equal(reversed.status, 'reversed');
        assert.deepEqual([(await stock(cola.id)).stock, (await stock(cola.id, bar.id)).stock], [24, 0]);
        assert.equal(await db.stockMovement.count({ where: { sourceId: a.id } }), 4);
        const reversals = await db.stockMovement.findMany({ where: { sourceId: a.id, type: 'cancel' } });
        assert.ok(reversals.every(({ createdAt }) => +createdAt === +reversed.reversedAt));
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
      await t.test('zero physical count is applied to current stock after concurrent consumption', async () => {
        const counted = await items.create({ name: 'Проверка нулевого факта', unit: 'pcs', stock: 24 });
        const count = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'partial', items: [{ ingredientId: counted.id, quantity: 0 }] });
        await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: counted.id, quantity: 1 }] });
        const submitted = await docs.submit(owner, count.id, count.revision);
        const posted = await docs.approve(owner, count.id, submitted.revision);
        assert.equal(posted.items[0].expected, 23);
        assert.equal(posted.items[0].difference, -23);
        assert.equal((await stock(counted.id)).stock, 0);
      });
      await t.test('inventory preview and approval use current book stock without changing entered counts', async () => {
        const water = await items.create({ name: 'Вода для пересчёта', unit: 'pcs', stock: 24, kind: 'beverage' });
        const draft = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'full' });
        await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: water.id, quantity: 2 }] });
        const lines = draft.items.map((line) => ({ ingredientId: line.ingredientId, quantity: line.ingredientId === water.id ? 21 : line.expected }));
        const entered = await docs.update(owner, draft.id, { revision: draft.revision, items: lines });
        assert.equal(entered.items.find((line) => line.ingredientId === water.id).expected, 22);
        const submitted = await docs.submit(owner, draft.id, entered.revision);
        await docs.approve(owner, draft.id, submitted.revision);
        assert.equal((await stock(water.id)).stock, 21);
        const next = await docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'partial', items: [{ ingredientId: water.id, quantity: 18 }] });
        await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: water.id, quantity: 1 }] });
        const changed = await docs.update(owner, next.id, { revision: next.revision, items: [{ ingredientId: water.id, quantity: 17 }] });
        assert.equal(changed.items[0].expected, 20);
        const pending = await docs.submit(owner, next.id, changed.revision);
        await docs.approve(owner, next.id, pending.revision);
        assert.equal((await stock(water.id)).stock, 17);
      });
      await t.test('zero inventory clears carrying cost, preserves subsequent receipts and can reverse a deficit', async () => {
        const rawBalance = async (ingredientId) => {
          const balance = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
          return [Number(balance.stock), Number(balance.avgCost), balance.valuationKnown];
        };
        const countZero = (ingredient) => post({ kind: 'inventory', mode: 'partial', items: [{ ingredientId: ingredient.id, quantity: 0 }] });
        const receipt = (ingredient, quantity, purchasePrice) => purchases.create({ supplier: 'После пересчёта', complete: true,
          items: [{ ingredientId: ingredient.id, quantity, purchasePrice }] });

        const positive = await items.create({ name: 'Два на инвентаризации', unit: 'pcs', stock: 2, avgCost: 5 });
        const draft = await docs.create(owner, { kind: 'inventory', mode: 'partial', warehouseId: main.id,
          items: [{ ingredientId: positive.id, quantity: 0 }] });
        assert.deepEqual(await rawBalance(positive.id), [2, 5, true], 'entering zero in a draft does not clear quantity or price');
        const pending = await docs.submit(owner, draft.id, draft.revision);
        const zeroed = await docs.approve(owner, draft.id, pending.revision);
        assert.equal(zeroed.varianceValue, -10, 'the shortage uses the previous known price');
        assert.deepEqual(await rawBalance(positive.id), [0, 0, false]);
        const [emptyRow] = (await movementSummary(db, { ingredientId: positive.id, warehouseId: main.id })).rows;
        assert.deepEqual([emptyRow.closingQuantity, emptyRow.closingValue], [0, 0]);
        await receipt(positive, 3, 7);
        assert.deepEqual(await rawBalance(positive.id), [3, 7, true]);

        const noDeduction = await items.create({ name: 'Нулевой остаток с прежней ценой', unit: 'pcs', stock: 0, avgCost: 12 });
        const zeroMovement = await countZero(noDeduction);
        assert.deepEqual(await rawBalance(noDeduction.id), [0, 0, false]);
        const [reset] = await db.stockMovement.findMany({ where: { sourceId: zeroMovement.id } });
        assert.deepEqual([Number(reset.change), Number(reset.valuationAdjustment), Number(reset.costAtMoment)], [0, 0, 12]);
        assert.equal((await movementSummary(db, { ingredientId: noDeduction.id, onlyWithMovement: 'true' })).rows.length, 0);
        await docs.reverse(owner, zeroMovement.id, 'Пересчёт отменён');
        assert.deepEqual(await rawBalance(noDeduction.id), [0, 12, false]);
        const staleZero = await countZero(noDeduction);
        await receipt(noDeduction, 2, 18);
        await docs.reverse(owner, staleZero.id, 'Отмена прошлого нулевого пересчёта');
        assert.deepEqual(await rawBalance(noDeduction.id), [2, 18, true], 'reversing the old reset cannot erase a verified receipt');

        await db.settings.upsert({ where: { cafeId: cafe.id }, create: { cafeId: cafe.id, allowNegativeIngredientStock: true },
          update: { allowNegativeIngredientStock: true } });
        try {
          const deficit = await items.create({ name: 'Минус до инвентаризации', unit: 'pcs', stock: 1, avgCost: 12 });
          await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: deficit.id, quantity: 2 }] });
          assert.deepEqual(await rawBalance(deficit.id), [-1, 12, false]);
          const check = await countZero(deficit);
          assert.deepEqual(await rawBalance(deficit.id), [0, 0, false]);
          await docs.reverse(owner, check.id, 'Ошибочный нулевой факт');
          assert.deepEqual(await rawBalance(deficit.id), [-1, 12, false]);
        } finally {
          await db.settings.update({ where: { cafeId: cafe.id }, data: { allowNegativeIngredientStock: false } });
        }
      });
      await t.test('receipts, transfer, writeoff and inventory agree with both warehouse and combined reports', async () => {
        const flour = await items.create({ name: 'Мука для проверки склада', unit: 'kg', kind: 'raw',
          purchaseUnits: [{ name: 'мешок', factor: 5 }] });
        const draft = await purchases.create({ supplier: 'Мельница', warehouseId: main.id,
          items: [{ ingredientId: flour.id, quantity: 2, unit: 'мешок', purchasePrice: 500 }] });
        assert.equal((await stock(flour.id)).stock, 0, 'a receipt draft does not post any quantity');
        await purchases.complete(draft.id, owner);
        await purchases.create({ supplier: 'Мельница', warehouseId: main.id, complete: true,
          items: [{ ingredientId: flour.id, quantity: 10, unit: 'kg', purchasePrice: 120 }] });
        assert.deepEqual([(await stock(flour.id)).stock, (await stock(flour.id)).avgCost], [20, 110]);

        const transfer = await post({ kind: 'transfer', destinationWarehouseId: bar.id,
          items: [{ ingredientId: flour.id, quantity: 5 }] });
        assert.deepEqual([(await stock(flour.id)).stock, (await stock(flour.id, bar.id)).stock], [15, 5]);
        assert.equal((await stock(flour.id, bar.id)).avgCost, 110);
        assert.equal(transfer.items[0].value, -550);

        const writeoff = await post({ kind: 'writeoff', warehouseId: bar.id, reason: 'spoilage',
          items: [{ ingredientId: flour.id, quantity: 0.5 }] });
        assert.equal(writeoff.items[0].value, -55);
        const inventory = await post({ kind: 'inventory', warehouseId: bar.id, mode: 'partial',
          items: [{ ingredientId: flour.id, quantity: 4 }] });
        assert.deepEqual([inventory.items[0].expected, inventory.items[0].difference, inventory.items[0].value], [4.5, -0.5, -55]);

        const [combined, barOnly] = await Promise.all([
          movementSummary(db, { search: flour.name }),
          movementSummary(db, { search: flour.name, warehouseId: bar.id }),
        ]);
        const values = ({ rows: [row] }) => [row.incomingQuantity, row.outgoingQuantity, row.closingQuantity, row.closingAvgCost, row.closingValue];
        assert.deepEqual(values(combined), [20, 1, 19, 110, 2090], 'internal transfers do not increase turnover for both warehouses');
        assert.deepEqual(values(barOnly), [5, 1, 4, 110, 440], 'the receiving warehouse reports the transfer as a receipt');

        await post({ kind: 'inventory', warehouseId: bar.id, mode: 'partial',
          items: [{ ingredientId: flour.id, quantity: 0 }] });
        await purchases.create({ supplier: 'Мельница', warehouseId: bar.id, complete: true,
          items: [{ ingredientId: flour.id, quantity: 2, unit: 'kg', purchasePrice: 140 }] });
        assert.deepEqual([(await stock(flour.id, bar.id)).stock, (await stock(flour.id, bar.id)).avgCost], [2, 140]);
      });
      await t.test('three backdated documents reprice normal operations and agree with report dates and scopes', async () => {
        const operator = await db.user.create({ data: { name: 'Владелец', role: 'OWNER', phone: randomUUID(), passwordHash: 'unused' } });
        const reports = new WarehouseReportsService(db);
        const product = await items.create({ name: 'Лёд для исторических движений', kind: 'raw', unit: 'kg', stock: 10, avgCost: 100 });
        const pack = await db.warehousePackage.create({ data: { cafeId: cafe.id, name: 'Пакет 0,5 кг', unit: 'kg',
          unitType: 'mass', quantity: 0.5, quantityBase: 500 } });
        const now = Date.now();
        const daysAgo = (days) => new Date(now - days * 86_400_000);
        await db.ingredient.update({ where: { id: product.id }, data: { createdAt: daysAgo(4) } });
        await db.stockMovement.updateMany({ where: { ingredientId: product.id }, data: { createdAt: daysAgo(4) } });
        const transfer = (quantity, effectiveAt) => docs.create(operator, {
          kind: 'transfer', warehouseId: main.id, destinationWarehouseId: bar.id, effectiveAt,
          items: [{ ingredientId: product.id, quantity }], finalize: 'post',
        });
        const normalTransfer = await transfer(4);
        const normalWaste = await docs.create(operator, { kind: 'writeoff', warehouseId: bar.id, reason: 'damage',
          items: [{ ingredientId: product.id, quantity: 1 }], finalize: 'post' });
        assert.equal(normalWaste.items[0].unitCost, 100);

        const historicReceipt = await purchases.create({ supplier: 'Поставка за прошлый день', warehouseId: main.id,
          effectiveAt: daysAgo(3).toISOString(), complete: true,
          items: [{ ingredientId: product.id, quantity: 10, unit: 'kg', purchasePrice: 300 }] }, operator);
        const source = { kind: 'ingredient', sourceId: product.id, sourceLineId: randomUUID(), quantity: 2, unit: 'kg', packageId: pack.id };
        const preview = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: [source] });
        const historicWaste = await docs.create(operator, { kind: 'writeoff', warehouseId: main.id, reason: 'spoilage',
          effectiveAt: daysAgo(2).toISOString(), sourceLines: [{ ...source, recipeSignature: preview.sourceLines[0].recipeSignature }],
          finalize: 'post' });
        const historicTransfer = await transfer(3, daysAgo(1).toISOString());
        assert.equal(historicWaste.sourceLines[0].physicalQuantity, 1);
        assert.equal(historicWaste.sourceLines[0].packageFactor, 500);
        assert.equal(historicWaste.sourceTotal, 200);
        assert.equal(historicTransfer.items[0].unitCost, 200);
        assert.equal((await docs.get(normalTransfer.id)).items[0].unitCost, 200);
        assert.equal((await docs.get(normalWaste.id)).items[0].unitCost, 200);

        const baseQuery = { from: warehouseDay(daysAgo(3)), to: warehouseDay(daysAgo(0)), ingredientId: product.id };
        const ledger = await reports.report({ ...baseQuery, view: 'movements' });
        assert.deepEqual([...new Set(ledger.rows.map(({ sourceId }) => sourceId))],
          [normalWaste.id, normalTransfer.id, historicTransfer.id, historicWaste.id, historicReceipt.id]);
        for (const [id, date] of [[historicReceipt.id, daysAgo(3)], [historicWaste.id, daysAgo(2)], [historicTransfer.id, daysAgo(1)]]) {
          const dates = ledger.rows.filter(({ sourceId }) => sourceId === id).map(({ createdAt }) => +createdAt);
          assert.ok(dates.length && dates.every((stamp) => stamp === +date));
        }
        const values = (summary) => {
          const [row] = summary.rows;
          return [row.openingQuantity, row.incomingQuantity, row.outgoingQuantity, row.closingQuantity, row.closingAvgCost, row.closingValue];
        };
        const [combined, mainOnly, barOnly, historicOnly] = await Promise.all([
          reports.report({ ...baseQuery, view: 'movement_summary' }),
          reports.report({ ...baseQuery, view: 'movement_summary', warehouseId: main.id }),
          reports.report({ ...baseQuery, view: 'movement_summary', warehouseId: bar.id }),
          reports.report({ ...baseQuery, view: 'movement_summary', to: warehouseDay(daysAgo(1)) }),
        ]);
        assert.deepEqual(values(combined), [10, 10, 2, 18, 200, 3600]);
        assert.deepEqual(values(mainOnly), [10, 10, 8, 12, 200, 2400]);
        assert.deepEqual(values(barOnly), [0, 7, 1, 6, 200, 1200]);
        assert.deepEqual(values(historicOnly), [10, 10, 1, 19, 200, 3800]);
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
        assert.equal((await stock(cola.id)).stock, 24);
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
      await t.test('a shortage blocks both sides of a transfer unless the warehouse policy allows it', async () => {
        const item = await items.create({ name: 'Проверка перемещения в минус', unit: 'pcs', stock: 1, avgCost: 20 });
        const payload = { kind: 'transfer', warehouseId: main.id, destinationWarehouseId: bar.id,
          items: [{ ingredientId: item.id, quantity: 2 }], finalize: 'post' };
        await assert.rejects(docs.create(admin, payload), /недостаточно товара/);
        assert.deepEqual([(await stock(item.id)).stock, (await stock(item.id, bar.id)).stock], [1, 0]);

        await db.settings.update({ where: { cafeId: cafe.id }, data: { allowNegativeIngredientStock: true } });
        try {
          const document = await docs.create(admin, payload);
          assert.equal(document.status, 'posted');
          assert.deepEqual([(await stock(item.id)).stock, (await stock(item.id, bar.id)).stock], [-1, 2]);
          const legs = await db.stockMovement.findMany({ where: { sourceId: document.id } });
          assert.equal(legs.length, 2);
          assert.equal(legs.every(({ costKnown }) => !costKnown), true);
        } finally {
          await db.settings.update({ where: { cafeId: cafe.id }, data: { allowNegativeIngredientStock: false } });
        }
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
    await db.auditLog.deleteMany({ where: { cafeId: cafe.id } });
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.settings.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
