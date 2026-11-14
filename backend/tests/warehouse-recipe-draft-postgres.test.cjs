require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { Reflector } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { RecipesService } = require('../src/warehouse/recipes.service.ts');
const { RecipesController } = require('../src/warehouse/recipes.controller.ts');
const { RecipeDraftDto } = require('../src/warehouse/recipes.dto.ts');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
const { redactWarehouseCosts } = require('../src/warehouse/warehouse-cost.interceptor.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error('Only a dedicated local test database is allowed');

test(
  'Staff recipe pages save one complete draft without menu access',
  { skip: !url },
  async (t) => {
    const db = new PrismaClient({ datasourceUrl: url });
    db.$use(tenantPrismaMiddleware);
    let afterDishRead;
    db.$use(async (params, next) => {
      const result = await next(params);
      if (
        afterDishRead &&
        params.model === 'Dish' &&
        ['findUnique', 'findFirst'].includes(params.action)
      ) {
        const operation = afterDishRead;
        afterDishRead = null;
        await operation();
      }
      return result;
    });
    const cafe = await db.cafe.create({ data: { name: 'Staff recipe QA ' + randomUUID() } });
    try {
      await runWithTenant({ cafeId: cafe.id }, async () => {
        const service = new RecipesService(db);
        const category = await db.category.create({ data: { name: 'Кофе', prepStation: 'none' } });
        const milk = await db.ingredient.create({
          data: {
            name: 'Молоко',
            unitType: 'volume',
            displayUnit: 'l',
            stock: 10000,
            avgCost: 0.1,
            valuationKnown: true,
          },
        });
        const dish = await db.dish.create({
          data: {
            name: 'Капучино',
            categoryId: category.id,
            price: 150,
            variants: { create: [{ name: 'Большой', price: 190 }] },
          },
          include: { variants: true },
        });
        const input = {
          expectedVersion: 1,
          metadata: { instructions: 'Вспенить молоко', outputQuantity: 250, outputUnit: 'мл' },
          items: [
            {
              ingredientId: milk.id,
              amount: 0.2,
              unit: 'l',
              netAmount: 0.19,
              variantAmounts: { [dish.variants[0].id]: 0.3 },
            },
          ],
          modifiers: {
            allowIngredientExclusions: true,
            groups: [
              {
                name: 'Молоко',
                minSelections: 0,
                options: [
                  {
                    name: 'Дополнительное молоко',
                    price: 10,
                    ingredientId: milk.id,
                    amount: 0.05,
                    unit: 'l',
                  },
                ],
              },
            ],
          },
        };
        let saved;
        await t.test(
          'composition, output, instructions and modifiers commit together; menu fields stay intact',
          async () => {
            saved = await service.saveDraft(dish.id, input);
            assert.equal(saved.recipe.version, 2);
            assert.equal(saved.recipe.metadata.outputQuantity, 250);
            assert.equal(saved.recipe.items[0].amount, 0.2);
            assert.equal(saved.recipe.items[0].variantAmounts[dish.variants[0].id], 0.3);
            assert.equal(saved.modifiers.groups[0].options[0].name, 'Дополнительное молоко');
            assert.equal(
              (await db.dish.findUniqueOrThrow({ where: { id: dish.id } })).name,
              'Капучино',
            );
            assert.equal(
              Number((await db.dish.findUniqueOrThrow({ where: { id: dish.id } })).price),
              150,
            );
          },
        );
        await t.test(
          'invalid final modifier rolls back earlier rows, metadata and revision',
          async () => {
            await assert.rejects(
              service.saveDraft(dish.id, {
                ...input,
                expectedVersion: saved.recipe.version,
                metadata: { instructions: 'Не сохранится', outputQuantity: 999 },
                items: [{ ...input.items[0], amount: 0.8 }],
                modifiers: {
                  allowIngredientExclusions: false,
                  groups: [{ name: 'Недоступный выбор', minSelections: 1, options: [] }],
                },
              }),
              /Недостаточно/,
            );
            const result = await service.getDraft(dish.id);
            assert.equal(result.recipe.version, 2);
            assert.equal(result.recipe.items[0].amount, 0.2);
            assert.equal(result.recipe.metadata.instructions, 'Вспенить молоко');
            assert.equal(await db.recipeRevision.count({ where: { dishId: dish.id } }), 1);
          },
        );
        await t.test(
          'concurrent drafts allow one winner and preserve existing row/modifier IDs',
          async () => {
            const request = {
              ...input,
              expectedVersion: saved.recipe.version,
              modifiers: saved.modifiers,
              metadata: { instructions: 'Новая инструкция' },
            };
            const results = await Promise.allSettled([
              service.saveDraft(dish.id, request),
              service.saveDraft(dish.id, request),
            ]);
            assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
            const failure = results.find((result) => result.status === 'rejected');
            assert.match(failure.reason.message, /уже изменена/);
            const result = await service.getDraft(dish.id);
            assert.equal(result.recipe.items[0].id, saved.recipe.items[0].id);
            assert.equal(result.modifiers.groups[0].id, saved.modifiers.groups[0].id);
            assert.equal(
              result.modifiers.groups[0].options[0].id,
              saved.modifiers.groups[0].options[0].id,
            );
          },
        );
        await t.test(
          'staff rights do not require menu access; read-only staff cannot mutate',
          async () => {
            const controller = new RecipesController(service),
              guard = new PermissionsGuard(new Reflector());
            const user = {
              role: 'KITCHEN',
              permissions: {
                sections: { warehouse: true, menu: false },
                actions: { warehouseRecipes: true, editMenu: false, warehouseCosts: false },
              },
            };
            const context = (handler) => ({
              getHandler: () => handler,
              getClass: () => RecipesController,
              switchToHttp: () => ({ getRequest: () => ({ user }) }),
            });
            assert.equal(guard.canActivate(context(controller.saveDraft)), true);
            user.permissions.actions.warehouseRecipes = false;
            assert.throws(() => guard.canActivate(context(controller.saveDraft)), /нет доступа/);
            assert.equal(guard.canActivate(context(controller.getDraft)), true);
            const redacted = redactWarehouseCosts(await service.getDraft(dish.id));
            assert.equal(redacted.recipe.foodCost, null);
            assert.equal(redacted.recipe.items[0].lineCost, null);
            const pipe = new ValidationPipe({
              transform: true,
              whitelist: true,
              forbidNonWhitelisted: true,
            });
            await assert.rejects(
              pipe.transform(
                { ...input, price: 1, name: 'Чужие поля' },
                { type: 'body', metatype: RecipeDraftDto },
              ),
              /Bad Request/,
            );
          },
        );
        await t.test(
          'sets expose component pages and direct goods cannot be converted by staff',
          async () => {
            const set = await db.dish.create({
              data: {
                name: 'Завтрак',
                categoryId: category.id,
                price: 200,
                isSet: true,
                setComponents: { create: [{ dishId: dish.id, quantity: 1 }] },
              },
            });
            const setRecipe = await service.getDraft(set.id);
            assert.equal(setRecipe.recipe.isSet, true);
            assert.equal(setRecipe.recipe.components[0].dishId, dish.id);
            await assert.rejects(service.saveDraft(set.id, input), /изменяется в меню/);
            const goods = await db.dish.create({
              data: {
                name: 'Молоко в упаковке',
                categoryId: category.id,
                price: 100,
                catalogKind: 'goods',
                stockIngredientId: milk.id,
                stockAmount: 1000,
              },
            });
            assert.equal((await service.getDraft(goods.id)).recipe.stockItem.id, milk.id);
            await assert.rejects(service.saveDraft(goods.id, input), /изменяется в меню/);
          },
        );
        await t.test('draft detail reads one snapshot while another employee saves', async () => {
          const before = await service.getDraft(dish.id);
          afterDishRead = () =>
            service.saveDraft(dish.id, {
              ...input,
              expectedVersion: before.recipe.version,
              modifiers: before.modifiers,
              metadata: { instructions: 'Параллельная правка' },
            });
          const snapshot = await service.getDraft(dish.id);
          assert.equal(afterDishRead, null);
          assert.equal(snapshot.recipe.version, before.recipe.version);
          assert.equal(snapshot.recipe.metadata.instructions, before.recipe.metadata.instructions);
          assert.equal(
            (await service.getDraft(dish.id)).recipe.metadata.instructions,
            'Параллельная правка',
          );
        });
      });
    } finally {
      afterDishRead = null;
      await db.dish.deleteMany({ where: { cafeId: cafe.id } });
      await db.category.deleteMany({ where: { cafeId: cafe.id } });
      await db.ingredient.deleteMany({ where: { cafeId: cafe.id } });
      await db.cafe.delete({ where: { id: cafe.id } });
      await db.$disconnect();
    }
  },
);
