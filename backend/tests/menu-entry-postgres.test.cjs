require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { MenuEntryService } = require('../src/admin/menu-entry.service.ts');
const { CatalogController } = require('../src/admin/catalog.controller.ts');
const { RecipesService } = require('../src/warehouse/recipes.service.ts');
const { MenuModifiersService } = require('../src/warehouse/menu-modifiers.ts');
const { redactWarehouseCosts } = require('../src/warehouse/warehouse-cost.interceptor.ts');
const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
const { Reflector } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { MenuEntryDto } = require('../src/admin/menu-entry.dto.ts');
const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (
  url &&
  (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    !new URL(url).pathname.includes('test'))
)
  throw new Error('Only a dedicated local test database is allowed');

test(
  'Menu pages: one atomic save, stable goods identity and recipe rollback',
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
        ['findFirst', 'findUnique'].includes(params.action)
      ) {
        const update = afterDishRead;
        afterDishRead = null;
        await update();
      }
      return result;
    });
    const cafe = await db.cafe.create({
      data: { name: 'Menu entry QA ' + randomUUID() },
    });
    try {
      await runWithTenant({ cafeId: cafe.id }, async () => {
        const events = { emitBroadcast() {} },
          audit = { async log() {} };
        const service = new MenuEntryService(
          db,
          new RecipesService(db),
          new MenuModifiersService(db),
          events,
          audit,
        );
        const actor = {
          id: randomUUID(),
          role: 'OWNER',
          name: 'QA',
          cafeId: cafe.id,
        };
        const category = await db.category.create({
          data: { name: 'Напитки', prepStation: 'none' },
        });
        const product = {
          catalogKind: 'goods',
          requestKey: randomUUID(),
          dish: {
            name: 'Бутылка воды',
            categoryId: category.id,
            price: 50,
            unit: 'шт',
            prepStation: 'none',
            variants: [],
          },
        };
        let goods;
        await t.test(
          'concurrent retry creates exactly one product and one linked stock item',
          async () => {
            const [first, second] = await Promise.all([
              service.save(null, product, actor),
              service.save(null, product, actor),
            ]);
            goods = first;
            assert.equal(first.dish.id, second.dish.id);
            assert.equal(first.dish.catalogKind, 'goods');
            assert.ok(first.dish.stockIngredientId);
            assert.equal(await db.dish.count(), 1);
            assert.equal(await db.ingredient.count(), 1);
            assert.equal(
              Number(
                (
                  await db.ingredient.findUniqueOrThrow({
                    where: { id: first.dish.stockIngredientId },
                  })
                ).stock,
              ),
              0,
            );
            await assert.rejects(
              service.save(null, { ...product, dish: { ...product.dish, price: 75 } }, actor),
              /другим содержимым/,
            );
          },
        );
        await t.test(
          'editing an existing product preserves dish and stock identities',
          async () => {
            const result = await service.save(
              goods.dish.id,
              {
                ...product,
                expectedVersion: goods.recipe.version,
                dish: { ...product.dish, name: 'Вода 0,5 л', price: 60 },
              },
              actor,
            );
            assert.equal(result.dish.id, goods.dish.id);
            assert.equal(result.dish.stockIngredientId, goods.dish.stockIngredientId);
            assert.equal(result.recipe.version, goods.recipe.version + 1);
            assert.equal(await db.ingredient.count(), 1);
            await assert.rejects(
              service.save(
                goods.dish.id,
                { ...product, expectedVersion: goods.recipe.version },
                actor,
              ),
              /уже изменена/,
            );
          },
        );
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
        const recipeDto = {
          catalogKind: 'recipe',
          requestKey: randomUUID(),
          dish: {
            name: 'Капучино',
            categoryId: category.id,
            price: 150,
            prepStation: 'none',
            variants: [],
          },
          recipe: {
            metadata: { outputQuantity: 250, outputUnit: 'мл' },
            items: [
              {
                ingredientId: milk.id,
                amount: 0.2,
                unit: 'l',
                netAmount: 0.19,
              },
            ],
          },
          modifiers: {
            allowIngredientExclusions: true,
            groups: [
              {
                name: 'Молоко',
                minSelections: 0,
                maxSelections: 1,
                options: [
                  {
                    name: 'Добавить молоко',
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
        let recipe;
        await t.test(
          'recipe metadata, composition and modifiers are created by one save',
          async () => {
            recipe = await service.save(null, recipeDto, actor);
            assert.equal(recipe.dish.catalogKind, 'recipe');
            assert.equal(recipe.dish.stockIngredientId, null);
            assert.equal(recipe.recipe.items.length, 1);
            assert.equal(recipe.recipe.items[0].amount, 0.2);
            assert.equal(recipe.recipe.metadata.outputQuantity, 250);
            assert.equal(recipe.modifiers.groups[0].options[0].name, 'Добавить молоко');
          },
        );
        await t.test(
          'invalid modifier rolls back changed name, composition and revision',
          async () => {
            const previousRow = await db.recipeItem.findFirst({
              where: { dishId: recipe.dish.id },
            });
            await assert.rejects(
              service.save(
                recipe.dish.id,
                {
                  ...recipeDto,
                  expectedVersion: recipe.recipe.version,
                  dish: { ...recipeDto.dish, name: 'Не должно сохраниться' },
                  recipe: {
                    items: [{ ingredientId: milk.id, amount: 1, unit: 'l' }],
                  },
                  modifiers: {
                    allowIngredientExclusions: false,
                    groups: [{ name: 'Ошибка', minSelections: 1, options: [] }],
                  },
                },
                actor,
              ),
              /Недостаточно/,
            );
            const after = await service.get(recipe.dish.id);
            assert.equal(after.dish.name, 'Капучино');
            assert.equal(after.recipe.version, recipe.recipe.version);
            assert.equal(after.recipe.items[0].amount, 0.2);
            assert.equal(after.recipe.items[0].id, previousRow.id);
            assert.equal(
              await db.recipeRevision.count({
                where: { dishId: recipe.dish.id },
              }),
              0,
            );
          },
        );
        await t.test(
          'editing recipe preserves row and modifier IDs, rejects stale save',
          async () => {
            const modifiers = recipe.modifiers;
            const result = await service.save(
              recipe.dish.id,
              {
                ...recipeDto,
                expectedVersion: recipe.recipe.version,
                modifiers,
                recipe: {
                  ...recipeDto.recipe,
                  items: [{ ingredientId: milk.id, amount: 0.25, unit: 'l' }],
                },
              },
              actor,
            );
            assert.equal(result.recipe.items[0].id, recipe.recipe.items[0].id);
            assert.equal(result.modifiers.groups[0].id, modifiers.groups[0].id);
            assert.equal(
              result.modifiers.groups[0].options[0].id,
              modifiers.groups[0].options[0].id,
            );
            assert.equal(result.recipe.items[0].amount, 0.25);
            assert.equal(
              await db.recipeRevision.count({
                where: { dishId: recipe.dish.id },
              }),
              1,
            );
            await assert.rejects(
              service.save(
                recipe.dish.id,
                { ...recipeDto, expectedVersion: recipe.recipe.version },
                actor,
              ),
              /уже изменена/,
            );
          },
        );
        await t.test(
          'menu-only employee can create goods but cannot alter recipe composition',
          async () => {
            const controller = new CatalogController({}, service);
            const employee = {
              ...actor,
              role: 'ADMIN',
              permissions: {
                sections: { menu: true },
                actions: { editMenu: true, warehouseRecipes: false },
              },
            };
            assert.throws(() => controller.createMenuEntry(recipeDto, employee), /Нет права/);
            const allowed = await controller.createMenuEntry(
              {
                ...product,
                requestKey: randomUUID(),
                dish: { ...product.dish, name: 'Сок' },
              },
              employee,
            );
            assert.equal(allowed.dish.catalogKind, 'goods');
            const redacted = redactWarehouseCosts(allowed);
            assert.equal(Number(redacted.dish.price), 50);
            assert.equal(redacted.recipe.foodCost, null);
            const guard = new PermissionsGuard(new Reflector());
            const context = {
              getHandler: () => controller.createMenuEntry,
              getClass: () => CatalogController,
              switchToHttp: () => ({ getRequest: () => ({ user: employee }) }),
            };
            assert.equal(guard.canActivate(context), true);
            employee.permissions.actions.editMenu = false;
            assert.throws(() => guard.canActivate(context), /нет доступа/);
          },
        );
        await t.test(
          'weighted goods preserve physical quantity when price base changes',
          async () => {
            const dto = {
              ...product,
              requestKey: randomUUID(),
              dish: {
                ...product.dish,
                name: 'Орехи',
                isWeighted: true,
                weightedMeasure: 'weight',
                weightedPriceBase: 100,
              },
            };
            const initial = await service.save(null, dto, actor);
            assert.equal(Number(initial.dish.stockAmount), 100);
            assert.equal(
              Number(initial.dish.stockAmount) * (500 / initial.dish.weightedPriceBase),
              500,
            );
            const updated = await service.save(
              initial.dish.id,
              {
                ...dto,
                expectedVersion: initial.recipe.version,
                dish: { ...dto.dish, weightedPriceBase: 1000 },
              },
              actor,
            );
            assert.equal(updated.dish.stockIngredientId, initial.dish.stockIngredientId);
            assert.equal(Number(updated.dish.stockAmount), 1000);
            assert.equal(
              Number(updated.dish.stockAmount) * (500 / updated.dish.weightedPriceBase),
              500,
            );
            await assert.rejects(
              service.save(
                updated.dish.id,
                {
                  ...dto,
                  expectedVersion: updated.recipe.version,
                  dish: { ...dto.dish, weightedMeasure: 'volume' },
                },
                actor,
              ),
              /массу на объём/,
            );
            await assert.rejects(
              service.save(
                updated.dish.id,
                {
                  ...dto,
                  expectedVersion: updated.recipe.version,
                  dish: { ...dto.dish, isWeighted: false },
                },
                actor,
              ),
              /весовой режим/,
            );
          },
        );
        await t.test(
          'new recipe variants accept their individual ingredient quantities in the first save',
          async () => {
            const result = await service.save(
              null,
              {
                ...recipeDto,
                requestKey: randomUUID(),
                dish: {
                  ...recipeDto.dish,
                  variants: [
                    { clientKey: 'small', name: '250 мл', price: 150 },
                    { clientKey: 'large', name: '400 мл', price: 200 },
                  ],
                },
                recipe: {
                  items: [
                    {
                      ingredientId: milk.id,
                      amount: 0.2,
                      unit: 'l',
                      variantAmounts: { small: 0.2, large: 0.35 },
                    },
                  ],
                },
              },
              actor,
            );
            const large = result.dish.variants.find((variant) => variant.name === '400 мл');
            assert.equal(result.recipe.items[0].variantAmounts[large.id], 0.35);
            assert.equal(result.recipe.items[0].variantAmounts.large, undefined);
          },
        );
        await t.test(
          'removing a sole goods variant preserves its stock; ambiguous stocked merges are rejected',
          async () => {
            const singleDto = {
              ...product,
              requestKey: randomUUID(),
              dish: {
                ...product.dish,
                name: 'Сок с вариантом',
                variants: [{ name: '0,5 л', price: 80 }],
              },
            };
            const single = await service.save(null, singleDto, actor);
            const binding = single.dish.variants[0].stockIngredientId;
            await db.ingredient.update({ where: { id: binding }, data: { stock: 12 } });
            const result = await service.save(
              single.dish.id,
              {
                ...singleDto,
                expectedVersion: single.recipe.version,
                dish: { ...singleDto.dish, variants: [] },
              },
              actor,
            );
            assert.equal(result.dish.stockIngredientId, binding);
            assert.equal(
              Number((await db.ingredient.findUniqueOrThrow({ where: { id: binding } })).stock),
              12,
            );
            const multiDto = {
              ...singleDto,
              requestKey: randomUUID(),
              dish: {
                ...singleDto.dish,
                name: 'Лимонад',
                variants: [
                  { name: '0,5 л', price: 80 },
                  { name: '1 л', price: 120 },
                ],
              },
            };
            const multi = await service.save(null, multiDto, actor);
            await db.ingredient.update({
              where: { id: multi.dish.variants[0].stockIngredientId },
              data: { stock: 5 },
            });
            await assert.rejects(
              service.save(
                multi.dish.id,
                {
                  ...multiDto,
                  expectedVersion: multi.recipe.version,
                  dish: { ...multiDto.dish, variants: [] },
                },
                actor,
              ),
              /есть остаток/,
            );
            assert.equal((await service.get(multi.dish.id)).dish.variants.length, 2);
          },
        );
        await t.test(
          'aggregate editor detail stays in one snapshot across a concurrent save',
          async () => {
            const baseline = await service.get(recipe.dish.id);
            afterDishRead = () =>
              service.save(
                recipe.dish.id,
                {
                  ...recipeDto,
                  expectedVersion: baseline.recipe.version,
                  dish: { ...recipeDto.dish, name: 'После параллельной правки', price: 999 },
                  recipe: {
                    ...recipeDto.recipe,
                    metadata: { outputQuantity: 999, outputUnit: 'мл' },
                  },
                  modifiers: baseline.modifiers,
                },
                actor,
              );
            const snapshot = await service.get(recipe.dish.id);
            assert.equal(afterDishRead, null, 'concurrent write occurred between detail reads');
            assert.equal(snapshot.dish.name, baseline.dish.name);
            assert.equal(snapshot.recipe.version, baseline.recipe.version);
            assert.equal(
              snapshot.recipe.metadata.outputQuantity,
              baseline.recipe.metadata.outputQuantity,
            );
            assert.equal(
              (await service.get(recipe.dish.id)).dish.name,
              'После параллельной правки',
            );
          },
        );
        await t.test(
          'existing modifiers round-trip through validation and unchanged archived modifiers do not block menu edits',
          async () => {
            const baseline = await service.get(recipe.dish.id);
            const pipe = new ValidationPipe({
              transform: true,
              whitelist: true,
              forbidNonWhitelisted: true,
            });
            const request = {
              ...recipeDto,
              expectedVersion: baseline.recipe.version,
              modifiers: {
                allowIngredientExclusions: baseline.modifiers.allowIngredientExclusions,
                groups: baseline.modifiers.groups,
              },
            };
            const validated = await pipe.transform(request, {
              type: 'body',
              metatype: MenuEntryDto,
            });
            const updated = await service.save(recipe.dish.id, validated, actor);
            assert.equal(
              updated.modifiers.groups[0].options[0].id,
              baseline.modifiers.groups[0].options[0].id,
            );
            await db.ingredient.update({ where: { id: milk.id }, data: { isActive: false } });
            const { modifiers: _unchanged, ...withoutModifiers } = request;
            const result = await service.save(
              recipe.dish.id,
              {
                ...withoutModifiers,
                expectedVersion: updated.recipe.version,
                dish: { ...request.dish, price: 175 },
              },
              actor,
            );
            assert.equal(Number(result.dish.price), 175);
            assert.equal(
              result.modifiers.groups[0].options[0].id,
              baseline.modifiers.groups[0].options[0].id,
            );
          },
        );
      });
    } finally {
      await db.$transaction(async (tx) => {
        await tx.dish.deleteMany({ where: { cafeId: cafe.id } });
        await tx.category.deleteMany({ where: { cafeId: cafe.id } });
        await tx.ingredient.deleteMany({ where: { cafeId: cafe.id } });
        await tx.cafe.delete({ where: { id: cafe.id } });
      });
      await db.$disconnect();
    }
  },
);
