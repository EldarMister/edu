require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { PurchasesService } = require('../src/warehouse/purchases.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehousePackagesService } = require('../src/warehouse/packages.ts');
const { ProcessingService } = require('../src/warehouse/processing.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Only a dedicated local test database is allowed');

test('PostgreSQL: shared packages and multi-output processing preserve quantities, value and history', { skip: !url }, async t => {
  const db = new PrismaClient({ datasourceUrl: url }); db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Processing ' + randomUUID() } });
  const foreign = await db.cafe.create({ data: { name: 'Isolated ' + randomUUID() } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const actor = { id: randomUUID(), name: 'Владелец', role: 'OWNER', cafeId: cafe.id };
      const ingredients = new IngredientsService(db), purchases = new PurchasesService(db), packages = new WarehousePackagesService(db), processing = new ProcessingService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const main = (await locations.list(cafe.id)).locations.find(x => x.isDefault);
      const bar = await locations.save(cafe.id, 'Бар переработки', undefined, 'Стойка');
      const stock = async (id, warehouseId = main.id) => (await ingredients.findAll({ warehouseId })).find(row => row.id === id);
      const flour = await ingredients.create({ name: 'Мука', unit: 'kg', stock: 10, avgCost: 50, purchaseUnits: [{ name: 'Мешок', factor: 25 }], processingLosses: { cleaning: 2.5 } });
      const water = await ingredients.create({ name: 'Вода', unit: 'l', warehouseId: bar.id, stock: 10, avgCost: 10 });
      const bread = await ingredients.create({ name: 'Хлеб', unit: 'pcs', kind: 'prepared_dish' });
      const crumbs = await ingredients.create({ name: 'Крошка', unit: 'kg', kind: 'preparation' });
      await t.test('shared package normalization, old card promotion and immutable receipt factor', async () => {
        const bag = (await packages.list('mass')).find(item => item.name === 'Мешок');
        assert.equal(bag.quantityBase, 25000);
        await assert.rejects(packages.save({ name: 'мешок', unit: 'g', quantity: 25000 }), /уже существует/);
        const request = { requestKey: randomUUID(), supplier: 'Мельница', complete: true, items: [{ ingredientId: flour.id, packageId: bag.id, quantity: 2, purchasePrice: 1250 }] };
        const receipt = await purchases.create(request);
        assert.equal(receipt.items[0].packageFactor, 25000);
        assert.equal((await stock(flour.id)).stock, 60);
        await packages.save({ name: 'Мешок', unit: 'kg', quantity: 30 }, bag.id);
        const historical = await purchases.findOne(receipt.id);
        assert.equal(historical.items[0].packageFactor, 25000);
        assert.equal(historical.items[0].quantityBase, 50000);
        await assert.rejects(purchases.create({ supplier: 'Ошибка', items: [{ ingredientId: water.id, packageId: bag.id, quantity: 1, purchasePrice: 10 }] }), /несовместима/);
        await packages.archive(bag.id);
        assert.equal((await purchases.create(request)).id, receipt.id);
        assert.equal((await stock(flour.id)).stock, 60);
        await assert.rejects(purchases.create({ supplier: 'Ошибка', items: [{ ingredientId: flour.id, packageId: bag.id, quantity: 1, purchasePrice: 10 }] }), /архиве/);
        assert.equal((await ingredients.findOne(flour.id)).processingLosses.cleaning, 2.5);
        await assert.rejects(ingredients.update(flour.id, { processingLosses: { boiling: 100 } }), /Потери/);
      });
      const dto = { requestKey: randomUUID(), note: 'Выпечка и крошка',
        inputs: [{ ingredientId: flour.id, warehouseId: main.id, quantity: 2, unit: 'kg' }, { ingredientId: water.id, warehouseId: bar.id, quantity: 1, unit: 'l' }],
        outputs: [{ ingredientId: bread.id, warehouseId: main.id, quantity: 4, unit: 'pcs', costSharePercent: 80 }, { ingredientId: crumbs.id, warehouseId: bar.id, quantity: 0.5, unit: 'kg', costSharePercent: 20 }],
      };
      let posted;
      await t.test('draft, concurrent posting and create retry are idempotent; costs allocated by exact shares', async () => {
        const [a, b] = await Promise.all([processing.create(actor, dto), processing.create(actor, dto)]);
        assert.equal(a.id, b.id); assert.equal(a.status, 'draft');
        assert.equal(await db.stockMovement.count({ where: { sourceId: a.id } }), 0);
        assert.equal(a.totalCost, 110);
        const results = await Promise.all([processing.post(actor, a.id, a.revision), processing.post(actor, a.id, a.revision)]);
        posted = results[0]; assert.equal(results[1].status, 'posted');
        assert.equal(await db.stockMovement.count({ where: { sourceId: a.id } }), 4);
        assert.equal(posted.outputs[0].lineCost, 88); assert.equal(posted.outputs[0].unitCost, 22);
        assert.equal(posted.outputs[1].lineCost, 22); assert.equal(posted.outputs[1].unitCost, 44);
        assert.deepEqual([(await stock(flour.id)).stock, (await stock(water.id, bar.id)).stock, (await stock(bread.id)).stock, (await stock(crumbs.id, bar.id)).stock], [58, 9, 4, 0.5]);
        assert.equal((await processing.create(actor, dto)).id, a.id);
        await assert.rejects(processing.create(actor, { ...dto, note: 'Другая операция' }), /уже использован/);
        await assert.rejects(processing.update(actor, a.id, { ...dto, revision: posted.revision }), /неизменяема/);
      });
      await t.test('failed reversal when output consumed rolls back every effect; repeated successful reversal is safe', async () => {
        const documents = new WarehouseDocumentsService(db);
        const writeoff = await documents.create(actor, { kind: 'writeoff', reason: 'damage', warehouseId: main.id, items: [{ ingredientId: bread.id, quantity: 1 }] });
        const submitted = await documents.submit(actor, writeoff.id, writeoff.revision);
        await documents.approve(actor, writeoff.id, submitted.revision);
        await assert.rejects(processing.reverse(actor, posted.id, { revision: posted.revision, note: 'Отмена' }), /недостаточно/);
        assert.equal((await stock(flour.id)).stock, 58);
        assert.equal((await processing.findOne(posted.id)).status, 'posted');
        assert.equal(await db.stockMovement.count({ where: { sourceId: posted.id } }), 4);
        await purchases.create({ supplier: 'Возврат хлеба', complete: true, items: [{ ingredientId: bread.id, quantity: 1, purchasePrice: 22 }] });
        const result = await processing.reverse(actor, posted.id, { revision: posted.revision, note: 'Ошибочный выпуск' });
        assert.equal(result.status, 'reversed');
        assert.equal((await processing.reverse(actor, posted.id, { revision: posted.revision, note: 'Повтор запроса' })).status, 'reversed');
        assert.equal(await db.stockMovement.count({ where: { sourceId: posted.id } }), 8);
        assert.deepEqual([(await stock(flour.id)).stock, (await stock(water.id, bar.id)).stock, (await stock(bread.id)).stock, (await stock(crumbs.id, bar.id)).stock], [60, 10, 0, 0]);
      });
      await t.test('post revalues at current warehouse cost and enforces shares and revisions', async () => {
        const draft = await processing.create(actor, { ...dto, requestKey: undefined });
        await assert.rejects(processing.update(actor, draft.id, { ...dto, revision: 99 }), /Обновите/);
        const incomplete = await processing.update(actor, draft.id, { ...dto, revision: draft.revision, outputs: dto.outputs.map(x => ({ ...x, costSharePercent: 10 })) });
        await assert.rejects(processing.post(actor, draft.id, incomplete.revision), /100%/);
        const saved = await processing.update(actor, draft.id, { ...dto, revision: incomplete.revision });
        await purchases.create({ supplier: 'Мельница', complete: true, items: [{ ingredientId: flour.id, quantity: 60, unit: 'kg', purchasePrice: 70 }] });
        const changed = await processing.post(actor, draft.id, saved.revision);
        assert.equal(changed.totalCost, 130);
        assert.equal(changed.outputs.reduce((sum, row) => sum + row.lineCost, 0), 130);
      });
      await t.test('insufficient second input rolls back first input and no document survives complete failure', async () => {
        const before = (await stock(flour.id)).stock;
        const key = randomUUID();
        await assert.rejects(processing.create(actor, { ...dto, requestKey: key, complete: true, inputs: [dto.inputs[0], { ...dto.inputs[1], quantity: 100 }] }), /недостаточно/);
        assert.equal((await stock(flour.id)).stock, before);
        assert.equal(await db.processingDocument.count({ where: { requestKey: key } }), 0);
        await assert.rejects(processing.create({ ...actor, role: 'KITCHEN', permissions: { sections: { warehouse: true }, actions: { warehouseProduce: false } } }, dto), /разрешения/);
        await runWithTenant({ cafeId: foreign.id }, async () => {
          await assert.rejects(processing.findOne(posted.id), /не найдена/);
          assert.equal((await packages.list()).length, 0);
          await assert.rejects(processing.create({ ...actor, cafeId: foreign.id }, { ...dto, requestKey: undefined }), /не найден/);
        });
      });
      await t.test('immutable movement quantities and adjusted values reconcile to every warehouse balance', async () => {
        for (const id of [flour.id, water.id, bread.id, crumbs.id]) for (const location of [main, bar]) {
          const row = await stock(id, location.id);
          const moves = await db.stockMovement.findMany({ where: { ingredientId: id, warehouseKey: location.isDefault ? 'default' : location.id } });
          const quantity = moves.reduce((sum, m) => sum.add(m.change), new Prisma.Decimal(0));
          const value = moves.reduce((sum, m) => sum.add(m.change.mul(m.costAtMoment)).add(m.valuationAdjustment), new Prisma.Decimal(0));
          assert.equal(Number(quantity), row.stockBase);
          const raw = location.isDefault ? await db.ingredient.findUniqueOrThrow({ where: { id } }) : await db.warehouseStock.findUnique({ where: { warehouseId_ingredientId: { warehouseId: location.id, ingredientId: id } } });
          assert.ok(value.sub(new Prisma.Decimal(row.stockBase).mul(raw?.avgCost ?? 0)).abs().lte('0.00000001'));
        }
      });
      await t.test('unknown opening value survives a priced receipt, transfer, processing and reversal; a known free receipt after depletion resets provenance', async () => {
        const documents = new WarehouseDocumentsService(db);
        const post = async input => {
          const draft = await documents.create(actor, { warehouseId: main.id, ...input });
          const submitted = await documents.submit(actor, draft.id, draft.revision);
          return documents.approve(actor, draft.id, submitted.revision);
        };
        const mixed = await ingredients.create({ name: 'Неоценённый начальный остаток', unit: 'pcs', stock: 10 });
        const output = await ingredients.create({ name: 'Выход из неоценённого сырья', unit: 'pcs' });
        assert.equal(mixed.valuationKnown, false); assert.equal(mixed.avgCost, null);
        const purchase = await purchases.create({ supplier: 'Известная поставка', complete: true, items: [{ ingredientId: mixed.id, quantity: 10, purchasePrice: 100 }] });
        const raw = await db.ingredient.findUniqueOrThrow({ where: { id: mixed.id } });
        assert.equal(Number(raw.avgCost), 50); assert.equal(raw.valuationKnown, false);
        assert.equal((await stock(mixed.id)).avgCost, null);
        const movement = await db.stockMovement.findFirstOrThrow({ where: { sourceId: purchase.id } });
        assert.equal(movement.costKnown, true); assert.equal(movement.beforeValuationKnown, false); assert.equal(movement.valuationKnown, false);
        const transfer = await post({ kind: 'transfer', destinationWarehouseId: bar.id, items: [{ ingredientId: mixed.id, quantity: 2 }] });
        assert.equal((await stock(mixed.id, bar.id)).valuationKnown, false);
        const operation = await processing.create(actor, { complete: true,
          inputs: [{ ingredientId: mixed.id, warehouseId: bar.id, quantity: 1, unit: 'pcs' }],
          outputs: [{ ingredientId: output.id, warehouseId: main.id, quantity: 1, unit: 'pcs' }],
        });
        assert.equal(operation.hasUnknownCost, true); assert.equal(operation.totalCost, null);
        assert.equal((await stock(output.id)).valuationKnown, false);
        await processing.reverse(actor, operation.id, { revision: operation.revision, note: 'Проверка происхождения оценки' });
        await documents.reverse(actor, transfer.id, 'Проверка переноса оценки');
        assert.equal((await stock(mixed.id)).valuationKnown, false);
        await post({ kind: 'writeoff', reason: 'damage', items: [{ ingredientId: mixed.id, quantity: 20 }] });
        await purchases.create({ supplier: 'Бесплатная подтверждённая поставка', complete: true, items: [{ ingredientId: mixed.id, quantity: 2, purchasePrice: 0 }] });
        assert.equal((await stock(mixed.id)).valuationKnown, true);
        assert.equal((await stock(mixed.id)).avgCost, 0);
      });
    });
  } finally {
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.processingDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.deleteMany({ where: { id: { in: [cafe.id, foreign.id] } } });
    await db.$disconnect();
  }
});
