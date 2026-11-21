require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { WarehouseLocationsService } = require('../src/warehouse/locations.service.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');
const { lockRecipeGraph } = require('../src/warehouse/recipe-resolution.ts');
const { redactWarehouseCosts } = require('../src/warehouse/warehouse-cost.interceptor.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Dedicated local test database required');

test('PostgreSQL: recipe writeoffs retain source lines and immutable ingredient evidence', { skip: !url }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: `Recipe writeoff ${randomUUID()}` } });
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const owner = { id: randomUUID(), role: 'OWNER', name: 'Owner', cafeId: cafe.id };
      const ingredients = new IngredientsService(db);
      const locations = new WarehouseLocationsService(db, { emitBroadcast() {} });
      const docs = new WarehouseDocumentsService(db);
      const main = (await locations.list(cafe.id)).locations[0];
      const bar = await locations.save(cafe.id, 'Other warehouse');
      const flour = await ingredients.create({ name: 'Flour', unit: 'kg', stock: 10, avgCost: 100 });
      const water = await ingredients.create({ name: 'Water', unit: 'l', stock: 10, avgCost: 10 });
      const batch = await ingredients.create({ name: 'Stocked preparation', unit: 'kg', kind: 'preparation', stock: 2, avgCost: 60 });
      await db.warehouseStock.create({ data: { cafeId: cafe.id, warehouseId: bar.id, ingredientId: flour.id, stock: 2000, avgCost: 0.2, valuationKnown: true } });
      const virtual = await db.ingredient.create({ data: { name: 'Virtual preparation', unitType: 'mass', displayUnit: 'kg', kind: 'preparation', isPrepared: true, preparationMode: 'virtual' } });
      for (const ingredient of [virtual, batch]) await db.preparationRecipe.create({ data: {
        ingredientId: ingredient.id, outputAmount: 1000, outputUnit: 'kg', items: { create: [
          { ingredientId: flour.id, amount: 500, unit: 'g' }, { ingredientId: water.id, amount: 500, unit: 'ml' },
        ] },
      } });
      const category = await db.category.create({ data: { name: 'Writeoff recipes' } });
      const dish = await db.dish.create({ data: { name: 'Soup', price: 100, categoryId: category.id } });
      const variant = await db.dishVariant.create({ data: { dishId: dish.id, name: 'Large', price: 150 } });
      await db.recipeItem.create({ data: { dishId: dish.id, ingredientId: virtual.id, amount: 100,
        variantAmounts: { [variant.id]: '200' }, warehouseId: bar.id } });
      const source = (kind, sourceId, quantity, unit, variantId) => ({ sourceLineId: randomUUID(), kind, sourceId, quantity, unit, ...(variantId ? { variantId } : {}) });
      const inputs = [source('dish', dish.id, 2, 'pcs', variant.id), source('ingredient', virtual.id, 0.5, 'kg'),
        source('ingredient', batch.id, 0.5, 'kg'), source('ingredient', flour.id, 0.1, 'kg')];
      const withSignatures = (rows, preview) => rows.map((row) => ({ ...row, recipeSignature: preview.sourceLines.find((line) => line.sourceLineId === row.sourceLineId).recipeSignature }));
      const stock = async (id) => (await ingredients.findOne(id)).balances.find((balance) => balance.warehouseId === main.id).stock;
      let posted;
      await t.test('variant and virtual recipes expand; stocked preparations stay leaves; selected warehouse wins', async () => {
        const options = await docs.writeoffOptions();
        assert.equal(options.dishes.find((entry) => entry.id === dish.id).variants[0].name, 'Large');
        assert.ok(options.ingredients.some((entry) => entry.id === virtual.id));
        const preview = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: inputs });
        assert.equal(preview.sourceLines[0].name, 'Soup · Large');
        assert.equal(preview.sourceLines[0].parts.find((part) => part.ingredientId === flour.id).quantity, 0.2);
        assert.deepEqual(preview.sourceLines[2].parts.map((part) => part.ingredientId), [batch.id]);
        assert.equal(preview.total, 89.5);
        const body = { warehouseId: main.id, kind: 'writeoff', reason: 'staff_meal', finalize: 'post', requestKey: randomUUID(), sourceLines: withSignatures(inputs, preview) };
        const attempts = await Promise.all([docs.create(owner, body), docs.create(owner, body)]);
        posted = attempts[0]; assert.equal(attempts[1].id, posted.id);
        assert.equal(posted.sourceLines.length, 4); assert.equal(posted.items.length, 3);
        assert.equal(posted.varianceValue, -89.5);
        assert.deepEqual([await stock(flour.id), await stock(water.id), await stock(batch.id)], [9.45, 9.55, 1.5]);
        assert.equal(Number((await db.warehouseStock.findUnique({ where: { warehouseId_ingredientId: { warehouseId: bar.id, ingredientId: flour.id } } })).stock), 2000);
        assert.equal(await db.stockMovement.count({ where: { sourceId: posted.id } }), 3, 'duplicate requests do not post twice');
        assert.equal((await docs.list(main.id, 'writeoff')).find((entry) => entry.id === posted.id).productNames[0], 'Soup · Large');
        assert.deepEqual((await docs.list(main.id, 'writeoff', 'sOuP')).map((entry) => entry.id), [posted.id], 'search finds the visible dish name');
        assert.deepEqual((await docs.list(main.id, 'writeoff', 'lArGe')).map((entry) => entry.id), [posted.id], 'search finds the saved variant');
        assert.deepEqual(await docs.list(bar.id, 'writeoff', 'Soup'), [], 'source search respects the warehouse');
        assert.deepEqual(await docs.list(main.id, 'inventory', 'Soup'), [], 'source search respects the document kind');
        const hidden = redactWarehouseCosts(posted);
        assert.equal(hidden.sourceTotal, null); assert.equal(hidden.sourceLines[0].total, null);
        assert.equal(hidden.sourceLines[0].parts[0].unitCost, null);
        assert.equal(hidden.sourceLines[0].quantity, 2);
      });
      await t.test('posted sources and reversal remain historical after recipe edits', async () => {
        const historical = JSON.stringify(posted.sourceLines);
        await db.$transaction(async (tx) => {
          await lockRecipeGraph(tx);
          await tx.dish.update({ where: { id: dish.id }, data: { name: 'Changed soup', recipeVersion: { increment: 1 } } });
          await tx.preparationRecipeItem.update({ where: { recipeId_ingredientId: { recipeId: virtual.id, ingredientId: flour.id } }, data: { amount: 800 } });
        });
        assert.equal(JSON.stringify((await docs.get(posted.id)).sourceLines), historical);
        assert.deepEqual((await docs.list(main.id, 'writeoff', 'Soup · Large')).map((entry) => entry.id), [posted.id], 'search uses the historical source name');
        assert.deepEqual(await docs.list(main.id, 'writeoff', 'Changed soup'), [], 'renaming the recipe does not rewrite document search');
        const reversed = await docs.reverse(owner, posted.id, 'Wrong count', posted.revision);
        assert.equal(reversed.status, 'reversed');
        assert.deepEqual([await stock(flour.id), await stock(water.id), await stock(batch.id)], [10, 10, 2]);
        const evidence = await db.stockMovement.findMany({ where: { sourceId: posted.id } });
        assert.equal(evidence.length, 6);
        assert.ok(evidence.every((movement) => movement.recipeSnapshot.lines[0].name === 'Soup · Large'));
      });
      await t.test('changed recipe conflicts at final save and approval without partial mutation', async () => {
        const input = [source('dish', dish.id, 1, 'pcs', variant.id)];
        const preview = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: input });
        const signed = withSignatures(input, preview);
        const draft = await docs.create(owner, { warehouseId: main.id, kind: 'writeoff', reason: 'tasting', sourceLines: signed });
        await db.$transaction(async (tx) => { await lockRecipeGraph(tx); await tx.dish.update({ where: { id: dish.id }, data: { recipeVersion: { increment: 1 } } }); });
        await assert.rejects(docs.writeoffPreview({ warehouseId: main.id, sourceLines: signed }), /Состав изменился/);
        await assert.rejects(docs.update(owner, draft.id, { revision: draft.revision, finalize: 'post', sourceLines: signed }), /Состав изменился/);
        assert.equal((await docs.get(draft.id)).revision, draft.revision);
        assert.equal(await db.stockMovement.count({ where: { sourceId: draft.id } }), 0);
        const refreshed = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: input });
        const submitted = await docs.update(owner, draft.id, { revision: draft.revision, finalize: 'submit', sourceLines: withSignatures(input, refreshed) });
        await db.$transaction(async (tx) => { await lockRecipeGraph(tx); await tx.preparationRecipeItem.update({ where: { recipeId_ingredientId: { recipeId: virtual.id, ingredientId: water.id } }, data: { amount: 600 } }); });
        await assert.rejects(docs.approve(owner, draft.id, submitted.revision), /Состав изменился/);
        assert.equal((await docs.get(draft.id)).status, 'submitted');
        assert.equal(await db.stockMovement.count({ where: { sourceId: draft.id } }), 0);
      });
      await t.test('missing variants, empty recipes and unsigned final payloads are rejected', async () => {
        const emptyDraft = await docs.create(owner, { warehouseId: main.id, kind: 'writeoff', sourceLines: [] });
        assert.deepEqual(emptyDraft.sourceLines, []);
        assert.deepEqual(await docs.writeoffPreview({ warehouseId: main.id, sourceLines: [] }), { sourceLines: [], total: 0 });
        await assert.rejects(docs.submit(owner, emptyDraft.id, emptyDraft.revision), /Добавьте продукты/);
        await assert.rejects(docs.writeoffPreview({ warehouseId: main.id, sourceLines: [source('dish', dish.id, 1, 'pcs')] }), /вариант/);
        const empty = await db.dish.create({ data: { name: 'Empty recipe', price: 1, categoryId: category.id } });
        await assert.rejects(docs.writeoffPreview({ warehouseId: main.id, sourceLines: [source('dish', empty.id, 1, 'pcs')] }), /не настроен/);
        await assert.rejects(docs.create(owner, { warehouseId: main.id, kind: 'writeoff', reason: 'damage', finalize: 'post',
          sourceLines: [source('ingredient', flour.id, 1, 'kg')] }), /предварительный расчёт/);
        await assert.rejects(docs.create(owner, { warehouseId: main.id, kind: 'inventory', mode: 'partial', sourceLines: inputs }), /только для списания/);
      });
      await t.test('packaged ingredient drafts retain their factor after catalogue edits and archive; posted movements stay physical', async () => {
        const pack = await db.warehousePackage.create({ data: { cafeId: cafe.id, name: 'Half kilo bag', unit: 'kg', unitType: 'mass', quantity: 0.5, quantityBase: 500 } });
        const input = [{ ...source('ingredient', flour.id, 2, 'kg'), packageId: pack.id }];
        const preview = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: input });
        assert.equal(preview.sourceLines[0].physicalQuantity, 1);
        assert.equal(preview.sourceLines[0].parts[0].quantity, 1);
        assert.equal(preview.sourceLines[0].packageFactor, 500);
        assert.equal(preview.total, 100);
        const draft = await docs.create(owner, { warehouseId: main.id, kind: 'writeoff', reason: 'damage', sourceLines: withSignatures(input, preview) });
        await db.warehousePackage.update({ where: { id: pack.id }, data: { name: 'Two kilo bag', quantity: 2, quantityBase: 2000, isActive: false } });
        const next = [{ ...input[0], quantity: 3, packageSnapshotLineId: input[0].sourceLineId }];
        const recalculated = await docs.writeoffPreview({ warehouseId: main.id, documentId: draft.id, sourceLines: next });
        assert.equal(recalculated.sourceLines[0].packageName, 'Half kilo bag');
        assert.equal(recalculated.sourceLines[0].packageQuantity, 0.5);
        assert.equal(recalculated.sourceLines[0].physicalQuantity, 1.5);
        const before = await stock(flour.id);
        const postedPack = await docs.update(owner, draft.id, { revision: draft.revision, finalize: 'post', sourceLines: withSignatures(next, recalculated) });
        assert.equal(await stock(flour.id), before - 1.5);
        assert.equal(postedPack.sourceLines[0].quantity, 3);
        assert.equal(postedPack.items[0].quantity, 1.5);
        const movement = await db.stockMovement.findFirst({ where: { sourceId: postedPack.id, type: 'writeoff' } });
        assert.equal(Number(movement.change), -1500);
        const evidence = JSON.stringify(postedPack.sourceLines);
        assert.equal(JSON.stringify((await docs.get(postedPack.id)).sourceLines), evidence);
        await docs.reverse(owner, postedPack.id, 'Pack test reversal', postedPack.revision);
        assert.equal(await stock(flour.id), before, 'reversal uses the historical physical amount');
        await assert.rejects(docs.writeoffPreview({ warehouseId: main.id, sourceLines: input }), /архиве/);
        await db.warehousePackage.update({ where: { id: pack.id }, data: { isActive: true } });
        const current = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: input });
        assert.equal(current.sourceLines[0].physicalQuantity, 4, 'a new selection uses the current 2 kg definition');
        await assert.rejects(docs.writeoffPreview({ warehouseId: main.id, documentId: draft.id, sourceLines: [{ ...next[0], sourceId: water.id }] }), /не относится/);
      });
      await t.test('fractional portion and weighted-dish packages expand recipes without rounding portions to integers', async () => {
        const half = await db.warehousePackage.create({ data: { cafeId: cafe.id, name: 'Half portion', unit: 'pcs', unitType: 'count', quantity: 0.5, quantityBase: 0.5 } });
        const portions = [{ ...source('dish', dish.id, 1, 'pcs', variant.id), packageId: half.id }];
        const preview = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: portions });
        assert.equal(preview.sourceLines[0].physicalQuantity, 0.5);
        assert.equal(preview.sourceLines[0].parts.find((part) => part.ingredientId === flour.id).quantity, 0.08);
        const mass = await db.warehousePackage.create({ data: { cafeId: cafe.id, name: 'Half kilo tub', unit: 'kg', unitType: 'mass', quantity: 0.5, quantityBase: 500 } });
        const weighted = await db.dish.create({ data: { name: 'Weighted flour', price: 100, categoryId: category.id, isWeighted: true, weightedPriceBase: 100,
          recipeItems: { create: [{ ingredientId: flour.id, amount: 100 }] } } });
        const weightedPreview = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: [{ ...source('dish', weighted.id, 2, 'kg'), packageId: mass.id }] });
        assert.equal(weightedPreview.sourceLines[0].physicalQuantity, 1);
        assert.equal(weightedPreview.sourceLines[0].parts[0].quantity, 1);
        await assert.rejects(docs.writeoffPreview({ warehouseId: main.id, sourceLines: [{ ...portions[0], packageId: mass.id }] }), /единиц|единица|Единица/);
      });
      await t.test('changed unsaved package or forged snapshot references cannot silently change posted quantities', async () => {
        const pack = await db.warehousePackage.create({ data: { cafeId: cafe.id, name: 'Preview bag', unit: 'kg', unitType: 'mass', quantity: 0.25, quantityBase: 250 } });
        const input = [{ ...source('ingredient', flour.id, 2, 'kg'), packageId: pack.id }];
        const preview = await docs.writeoffPreview({ warehouseId: main.id, sourceLines: input });
        const before = await stock(flour.id);
        await db.warehousePackage.update({ where: { id: pack.id }, data: { quantity: 0.75, quantityBase: 750 } });
        await assert.rejects(docs.create(owner, { warehouseId: main.id, kind: 'writeoff', reason: 'damage', finalize: 'post', sourceLines: withSignatures(input, preview) }), /Состав изменился/);
        assert.equal(await stock(flour.id), before);
        await assert.rejects(docs.writeoffPreview({ warehouseId: main.id, sourceLines: [{ ...input[0], packageSnapshotLineId: input[0].sourceLineId }] }), /не относится/);
      });
      await t.test('register categories cover every selected source and legacy line without using dish components or another cafe', async () => {
        const selected = [];
        for (let index = 1; index <= 4; index++) selected.push(await ingredients.create({
          name: `Category line ${index}`, unit: 'pcs', category: `Selected category ${index}`,
        }));
        const expected = selected.map((_, index) => `Selected category ${index + 1}`);
        const legacy = await docs.create(owner, { warehouseId: main.id, kind: 'writeoff', items: selected.map(({ id }) => ({ ingredientId: id, quantity: 1 })) });
        const sourced = await docs.create(owner, { warehouseId: main.id, kind: 'writeoff', sourceLines: selected.map(({ id }) => source('ingredient', id, 1, 'pcs')) });
        await db.ingredient.update({ where: { id: flour.id }, data: { category: 'Recipe components only' } });
        await db.ingredient.update({ where: { id: water.id }, data: { category: 'Recipe components only' } });
        const dishOnly = await docs.create(owner, { warehouseId: main.id, kind: 'writeoff', sourceLines: [source('dish', dish.id, 1, 'pcs', variant.id)] });
        const listed = await docs.list(main.id, 'writeoff');
        for (const document of [legacy, sourced]) {
          const row = listed.find(({ id }) => id === document.id);
          assert.equal(row.productNames.length, 3);
          assert.deepEqual(row.categories, expected, 'fourth line contributes category despite the three-name preview');
        }
        assert.deepEqual(listed.find(({ id }) => id === dishOnly.id).categories, ['Writeoff recipes']);
        const foreign = await db.cafe.create({ data: { name: `Category isolation ${randomUUID()}` } });
        try {
          await runWithTenant({ cafeId: foreign.id }, async () => {
            assert.equal((await docs.list(undefined, 'writeoff')).length, 0);
            await assert.rejects(docs.list(main.id, 'writeoff'), /не найден/);
          });
        } finally { await db.cafe.delete({ where: { id: foreign.id } }); }
      });
    });
  } finally {
    await db.warehouseDocument.deleteMany({ where: { cafeId: cafe.id } });
    await db.stockMovement.deleteMany({ where: { cafeId: cafe.id } });
    await db.recipeItem.deleteMany({ where: { cafeId: cafe.id } });
    await db.dish.deleteMany({ where: { cafeId: cafe.id } });
    await db.category.deleteMany({ where: { cafeId: cafe.id } });
    await db.preparationRecipeItem.deleteMany({ where: { cafeId: cafe.id } });
    await db.preparationRecipe.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.$disconnect();
  }
});
