require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { PreparationProductionService } = require('../src/warehouse/preparation-production.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))
)
  throw new Error('Only a dedicated local test database is allowed');

test(
  'Preparation card: one transactional save for metadata, composition and output',
  { skip: !url },
  async (t) => {
    const db = new PrismaClient({ datasourceUrl: url });
    db.$use(tenantPrismaMiddleware);
    const cafe = await db.cafe.create({
      data: { name: `Preparation card ${randomUUID()}` },
    });
    const foreignCafe = await db.cafe.create({
      data: { name: `Foreign ${randomUUID()}` },
    });
    try {
      const foreign = await runWithTenant({ cafeId: foreignCafe.id }, () =>
        new IngredientsService(db).create({ name: 'Чужое сырьё', unit: 'kg' }),
      );
      await runWithTenant({ cafeId: cafe.id }, async () => {
        const ingredients = new IngredientsService(db);
        const service = new PreparationProductionService(db);
        const flour = await ingredients.create({ name: 'Мука', unit: 'kg' });
        const payload = {
          name: 'Тесто',
          category: 'Заготовки',
          unit: 'kg',
          outputQuantity: 0.8,
          outputUnit: 'kg',
          mode: 'virtual',
          instructions: 'Замесить',
          requestKey: randomUUID(),
          items: [{ ingredientId: flour.id, quantity: 1, unit: 'kg', netAmount: 0.9 }],
        };
        let card;
        await t.test(
          'create and concurrent replay create one complete card without stock movements',
          async () => {
            const [a, b] = await Promise.all([service.saveCard(payload), service.saveCard(payload)]);
            card = a;
            assert.equal(a.id, b.id);
            assert.equal(a.category, 'Заготовки');
            assert.equal(a.items.length, 1);
            assert.equal(a.outputQuantity, 0.8);
            assert.equal(await db.ingredient.count({ where: { isPrepared: true } }), 1);
            assert.equal(await db.preparationRecipe.count(), 1);
            assert.equal(await db.stockMovement.count(), 0);
            await assert.rejects(service.saveCard({ ...payload, outputQuantity: 0.5 }), /Ключ создания/);
            await assert.rejects(
              service.saveCard({
                ...payload,
                items: [{ ...payload.items[0], quantity: 2 }],
              }),
              /Ключ создания/,
            );
          },
        );
        await t.test('invalid new composition leaves no empty preparation', async () => {
          const count = await db.ingredient.count();
          await assert.rejects(
            service.saveCard({
              ...payload,
              name: 'Не сохранится',
              requestKey: randomUUID(),
              items: [{ ingredientId: randomUUID(), quantity: 1, unit: 'kg' }],
            }),
            /не найден/,
          );
          assert.equal(await db.ingredient.count(), count);
        });
        await t.test('invalid edit rolls name, category and composition back together', async () => {
          await assert.rejects(
            service.saveCard(
              {
                ...payload,
                name: 'Повреждённое имя',
                expectedUpdatedAt: card.updatedAt,
                category: 'Другая категория',
                items: [{ ingredientId: foreign.id, quantity: 1, unit: 'kg' }],
              },
              card.id,
            ),
            /не найден/,
          );
          const current = await service.getRecipe(card.id);
          assert.equal(current.name, 'Тесто');
          assert.equal(current.category, 'Заготовки');
          assert.equal(current.items[0].ingredientId, flour.id);
        });
        await t.test('successful edit updates metadata, output and instructions together', async () => {
          const updated = await service.saveCard(
            {
              ...payload,
              name: 'Тесто пельменное',
              expectedUpdatedAt: card.updatedAt,
              category: 'Тесто',
              outputQuantity: 0.9,
              instructions: 'Замесить и оставить',
            },
            card.id,
          );
          assert.equal(updated.name, 'Тесто пельменное');
          assert.equal(updated.category, 'Тесто');
          assert.equal(updated.outputQuantity, 0.9);
          assert.equal(updated.instructions, 'Замесить и оставить');
          await assert.rejects(
            service.saveCard({ ...payload, expectedUpdatedAt: updated.updatedAt, unit: 'l' }, card.id),
            /не меняется/,
          );
          await assert.rejects(
            service.saveCard({ ...payload, expectedUpdatedAt: card.updatedAt }, card.id),
            /уже изменён/,
          );
          card = updated;
        });
        await t.test('recipe cycle rejection also rolls metadata back', async () => {
          const nested = await service.saveCard({
            ...payload,
            name: 'Начинка',
            requestKey: randomUUID(),
            items: [{ ingredientId: card.id, quantity: 1, unit: 'kg' }],
          });
          await assert.rejects(
            service.saveCard(
              {
                ...payload,
                name: 'Цикл',
                expectedUpdatedAt: card.updatedAt,
                items: [{ ingredientId: nested.id, quantity: 1, unit: 'kg' }],
              },
              card.id,
            ),
            /циклическую/,
          );
          assert.equal((await service.getRecipe(card.id)).name, 'Тесто пельменное');
        });
        await t.test(
          'virtual catalogue costs come from recipe leaves, including nested units and unknown prices',
          async () => {
            const rice = await ingredients.create({
              name: 'Рис по 100 за кг',
              unit: 'kg',
              stock: 10,
              avgCost: 100,
            });
            const cooked = await service.saveCard({
              name: 'Рис отварной',
              unit: 'kg',
              outputQuantity: 1,
              outputUnit: 'kg',
              mode: 'virtual',
              requestKey: randomUUID(),
              items: [{ ingredientId: rice.id, quantity: 0.5, unit: 'kg' }],
            });
            const [catalogue] = await ingredients.findAll({ search: 'Рис отварной' });
            assert.equal(catalogue.id, cooked.id);
            assert.equal(catalogue.recipeUnitCost, 50);
            assert.equal(catalogue.recipeOutputQuantity, 1);
            assert.equal(catalogue.recipeOutputUnit, 'kg');
            assert.equal(catalogue.recipeTotalCost, 50);
            assert.equal(catalogue.avgCost, null, 'recipe cost must not become stock valuation');
            assert.equal(catalogue.stock, 0);
            await service.saveCard({
              name: 'Рис для производства',
              unit: 'kg',
              outputQuantity: 1,
              outputUnit: 'kg',
              mode: 'stocked',
              requestKey: randomUUID(),
              items: [{ ingredientId: rice.id, quantity: 0.5, unit: 'kg' }],
            });
            const [stocked] = await ingredients.findAll({ search: 'Рис для производства' });
            assert.equal(stocked.recipeTotalCost, 50);
            assert.equal(stocked.avgCost, null, 'recipe costing must not create production stock valuation');
            const nested = await service.saveCard({
              name: 'Рис вложенный',
              unit: 'g',
              outputQuantity: 250,
              outputUnit: 'g',
              mode: 'virtual',
              requestKey: randomUUID(),
              items: [{ ingredientId: cooked.id, quantity: 0.5, unit: 'kg' }],
            });
            const [nestedRow] = await ingredients.findAll({ search: 'Рис вложенный' });
            assert.equal(nestedRow.id, nested.id);
            assert.equal(nestedRow.recipeUnitCost, 0.1, '25 som recipe / 250 g = 0.1 som per display gram');
            assert.equal(nestedRow.recipeTotalCost, 25);
            assert.equal(nestedRow.recipeOutputQuantity, 250);
            assert.equal(nestedRow.recipeOutputUnit, 'g');
            const unknown = await ingredients.create({ name: 'Без цены', unit: 'pcs' });
            await service.saveCard({
              name: 'Неизвестная стоимость',
              unit: 'pcs',
              outputQuantity: 1,
              outputUnit: 'pcs',
              mode: 'virtual',
              requestKey: randomUUID(),
              items: [{ ingredientId: unknown.id, quantity: 1, unit: 'pcs' }],
            });
            assert.equal(
              (await ingredients.findAll({ search: 'Неизвестная стоимость' }))[0].recipeUnitCost,
              null,
            );
            const free = await ingredients.create({
              name: 'Бесплатный ингредиент',
              unit: 'pcs',
              stock: 1,
              avgCost: 0,
            });
            await db.ingredient.update({ where: { id: free.id }, data: { valuationKnown: true } });
            await service.saveCard({
              name: 'Бесплатный полуфабрикат',
              unit: 'pcs',
              outputQuantity: 1,
              outputUnit: 'pcs',
              mode: 'virtual',
              requestKey: randomUUID(),
              items: [{ ingredientId: free.id, quantity: 1, unit: 'pcs' }],
            });
            assert.equal(
              (await ingredients.findAll({ search: 'Бесплатный полуфабрикат' }))[0].recipeUnitCost,
              0,
            );
            const warehouse = await db.warehouse.create({ data: { name: 'Другой склад' } });
            await db.warehouseStock.create({
              data: {
                warehouseId: warehouse.id,
                ingredientId: rice.id,
                stock: 1000,
                avgCost: 0.2,
                valuationKnown: true,
              },
            });
            assert.equal(
              (await ingredients.findAll({ search: 'Рис отварной', warehouseId: warehouse.id }))[0]
                .recipeUnitCost,
              100,
            );
            const { redactWarehouseCosts } = require('../src/warehouse/warehouse-cost.interceptor.ts');
            assert.equal(redactWarehouseCosts(catalogue).recipeTotalCost, null);
            assert.equal(
              redactWarehouseCosts(catalogue).recipeUnitCost,
              null,
              'new cost field must respect cost visibility',
            );
          },
        );
      });
    } finally {
      for (const cafeId of [cafe.id, foreignCafe.id]) {
        await runWithTenant({ cafeId }, async () => {
          await db.stockMovement.deleteMany({ where: { cafeId } });
          await db.preparationRecipeItem.deleteMany({ where: { cafeId } });
          await db.preparationRecipe.deleteMany({ where: { cafeId } });
          await db.ingredient.deleteMany({ where: { cafeId } });
        });
        await db.cafe.delete({ where: { id: cafeId } });
      }
      await db.$disconnect();
    }
  },
);
