require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { Reflector } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { RecipesService } = require('../src/warehouse/recipes.service.ts');
const { IngredientsService } = require('../src/warehouse/ingredients.service.ts');
const { RecipesController } = require('../src/warehouse/recipes.controller.ts');
const { MenuModifiersController, MenuModifiersService } = require('../src/warehouse/menu-modifiers.ts');
const { CatalogService } = require('../src/admin/catalog.service.ts');
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
        await t.test('draft reads preserve small recipe quantities and rates without display rounding', async () => {
          const water = await db.ingredient.create({
            data: { name: 'Вода', unitType: 'volume', displayUnit: 'l', stock: 1000, avgCost: 0.0025, valuationKnown: true },
          });
          const calculation = await db.dish.create({ data: { name: 'Проверка дозировки', categoryId: category.id, price: 15 } });
          const saved = await service.saveDraft(calculation.id, { expectedVersion: 1, items: [{
            ingredientId: water.id, amount: 0.0004, netAmount: 0.0003, unit: 'l',
          }] });
          const [item] = saved.recipe.items;
          assert.equal(item.amount, 0.0004);
          assert.equal(item.netAmount, 0.0003);
          assert.equal(item.avgCost, 2.5);
          const [millilitres] = (await service.saveDraft(calculation.id, { expectedVersion: saved.recipe.version, items: [{
            ingredientId: water.id, amount: 200, netAmount: 180, unit: 'ml',
          }] })).recipe.items;
          assert.equal(millilitres.avgCost, 0.0025);
          assert.equal(millilitres.lineCost, 0.5);
        });
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
            assert.equal(guard.canActivate(context(controller.revisions)), true);
            user.permissions.sections.warehouse = false;
            assert.throws(() => guard.canActivate(context(controller.revisions)), /нет доступа/);
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
        await t.test('composition history keeps prior measured amounts, archived names, editors and dates without exposing price fields', async () => {
          const volume = await db.ingredient.create({ data: { name: 'Молоко в старой версии', unitType: 'volume', displayUnit: 'l', avgCost: 5 } });
          const mass = await db.ingredient.create({ data: { name: 'Весовая норма', unitType: 'mass', displayUnit: 'kg' } });
          const target = await db.dish.create({ data: { name: 'История состава', categoryId: category.id, price: 175,
            variants: { create: { name: 'Большая', price: 225 } } }, include: { variants: true } });
          const variantId = target.variants[0].id;
          const author = { id: randomUUID(), name: 'Автор состава' };
          const replacement = { id: randomUUID(), name: 'Редактор состава' };
          const controller = new RecipesController(service);
          assert.deepEqual(await service.compositionRevisions(target.id), []);
          await controller.saveDraft(target.id, { expectedVersion: 1, metadata: { outputQuantity: 320, outputUnit: 'г', instructions: 'Смешать' },
            items: [{ ingredientId: volume.id, unit: 'l', amount: 0.2, netAmount: 0.19, measuredNetWeightGrams: 195,
              variantAmounts: { [variantId]: 0.28 } }, { ingredientId: mass.id, amount: 0.25, netAmount: 0.2, unit: 'kg', processingBasis: 'net',
              processingStages: [{ method: 'cleaning', lossPercent: 20 }] }],
            modifiers: { allowIngredientExclusions: false, groups: [{ name: 'Молоко', options: [{
              name: 'Дополнительное молоко', ingredientId: volume.id, price: 20, amount: 30, unit: 'ml',
            }] }] },
          }, author);
          await controller.saveDraft(target.id, { expectedVersion: 2, items: [{ ingredientId: volume.id, amount: 0.3, unit: 'l' }] }, replacement);
          author.name = 'Изменённое имя';
          await db.ingredient.update({ where: { id: volume.id }, data: { name: 'Новое название' } });
          const [old, first] = await controller.revisions(target.id, 'composition');
          assert.deepEqual([old.version, first.version], [2, 1]);
          assert.deepEqual(old.savedAt, first.replacedAt);
          assert.ok(old.replacedAt >= old.savedAt);
          assert.equal(first.savedAt, null);
          assert.deepEqual([old.savedBy, old.replacedBy, first.savedBy, first.replacedBy],
            ['Автор состава', 'Редактор состава', null, 'Автор состава']);
          const oldVolume = old.items.find(({ ingredientId }) => ingredientId === volume.id);
          assert.deepEqual(oldVolume, { ingredientId: volume.id, name: 'Молоко в старой версии', unit: 'l', amount: 0.2, netAmount: 0.19,
            measuredNetWeightGrams: 195, lossPercent: 5, processingMethod: null, processingBasis: null, processingStages: [],
            variantAmounts: [{ variantId, name: 'Большая', amount: 0.28 }] });
          const oldMass = old.items.find(({ ingredientId }) => ingredientId === mass.id);
          assert.deepEqual([oldMass.amount, oldMass.netAmount, oldMass.processingBasis, oldMass.processingStages],
            [0.25, 0.2, 'net', [{ method: 'cleaning', lossPercent: 20 }]]);
          assert.deepEqual(old.output, { amount: 320, unit: 'г' });
          assert.equal(old.instructions, 'Смешать');
          assert.equal(old.modifierGroups[0].options[0].ingredient.amount, 30);
          assert.doesNotMatch(JSON.stringify(old), /price|cost|actor|snapshot/i);
          const [raw] = await controller.revisions(target.id);
          assert.ok(raw.snapshot.items.length && raw.snapshot.modifierGroups[0].options[0].price);
          assert.deepEqual(raw.snapshot.replacedBy, replacement);
          assert.doesNotMatch(JSON.stringify(old), new RegExp(replacement.id));

          await new MenuModifiersController(new MenuModifiersService(db))
            .save(target.id, { allowIngredientExclusions: false, groups: [] }, { id: randomUUID(), name: 'Редактор модификаторов' });
          const [modifierVersion] = await controller.revisions(target.id, 'composition');
          assert.equal(modifierVersion.replacedBy, 'Редактор модификаторов');
          assert.equal(modifierVersion.savedBy, 'Редактор состава');

          const set = await db.dish.create({ data: { name: 'История сета', categoryId: category.id, price: 300, isSet: true,
            setComponents: { create: { dishId: target.id, dishVariantId: variantId, quantity: 2 } } } });
          const missingId = randomUUID();
          await db.recipeRevision.create({ data: { dishId: set.id, version: 1, snapshot: { items: [
            { ingredientId: volume.id, amount: '200', amountUnit: 'l', netAmount: null },
            { ingredientId: missingId, amount: '0', amountUnit: 'pcs' },
          ] } } });
          const [legacy] = await service.compositionRevisions(set.id);
          assert.equal(legacy.components, null);
          assert.equal(legacy.replacedBy, null);
          assert.deepEqual(legacy.items.map(({ ingredientId, name, amount, netAmount }) => [ingredientId, name, amount, netAmount]),
            [[volume.id, 'Новое название', 0.2, null], [missingId, null, 0, null]]);
          await db.dish.update({ where: { id: set.id }, data: { recipeVersion: 3 } });
          await service.updateSettings(set.id, { metadata: { instructions: 'Новая инструкция' } });
          const [setVersion] = await service.compositionRevisions(set.id);
          assert.equal(setVersion.savedAt, null, 'gaps should not be filled with a guessed date');
          assert.deepEqual(setVersion.components.map(({ name, variantName, quantity }) => [name, variantName, quantity]),
            [[target.name, 'Большая', 2]]);
        });
        await t.test('set composition changes archive only the replaced components with the editor', async () => {
          const set = await db.dish.create({ data: { name: 'Сет для сверки', categoryId: category.id, price: 300, isSet: true,
            setComponents: { create: { dishId: dish.id, dishVariantId: dish.variants[0].id, quantity: 2 } } } });
          const catalog = new CatalogService(db, { emitBroadcast() {} }, { async log() {} });
          const editor = { id: randomUUID(), name: 'Редактор сета' };
          const components = [{ dishId: dish.id, dishVariantId: dish.variants[0].id, quantity: 2 }];
          const originalLine = await db.setComponent.findFirstOrThrow({ where: { setId: set.id } });
          assert.equal((await catalog.updateSet(set.id, { price: 330, components }, editor)).recipeVersion, set.recipeVersion);
          assert.deepEqual(await service.compositionRevisions(set.id), []);
          assert.equal((await db.setComponent.findFirstOrThrow({ where: { setId: set.id } })).id, originalLine.id);
          assert.equal((await catalog.updateSet(set.id, { components: [{ ...components[0], quantity: 3 }] }, editor)).recipeVersion,
            set.recipeVersion + 1);
          const [previous] = await service.compositionRevisions(set.id);
          assert.equal(previous.replacedBy, editor.name);
          assert.equal(previous.components[0].quantity, 2);
          assert.equal((await service.getByDish(set.id)).components[0].quantity, 3);
          await assert.rejects(catalog.updateSet(set.id, { components: [{ ...components[0], dishVariantId: randomUUID() }] }, editor), /Вариант блюда/);
          assert.equal((await service.compositionRevisions(set.id)).length, 1);
          assert.equal((await service.getByDish(set.id)).components[0].quantity, 3);
        });
        await t.test('ingredient usage reports direct and variant sales, preparation recipes and archived modifiers', async () => {
          const ingredient = await db.ingredient.create({ data: { name: 'Сливки для связей', unitType: 'volume', displayUnit: 'l' } });
          const preparation = await db.ingredient.create({ data: { name: 'Крем', isPrepared: true, kind: 'preparation', unitType: 'mass', displayUnit: 'kg' } });
          await db.preparationRecipe.create({ data: { ingredientId: preparation.id, outputAmount: 1000, outputUnit: 'kg',
            items: { create: [{ ingredientId: ingredient.id, amount: 250, unit: 'l' }] } } });
          const drinks = await db.dish.create({ data: { name: 'Сливочный кофе', categoryId: category.id, price: 150,
            stockIngredientId: ingredient.id, stockAmount: 100,
            recipeItems: { create: [{ ingredientId: ingredient.id, amount: 75, amountUnit: 'ml' }] },
            variants: { create: [{ name: 'Большой', price: 200, stockIngredientId: ingredient.id, stockAmount: 175 }] },
            modifierGroups: { create: [{ name: 'Добавки', options: { create: [{ name: 'Сливки', isActive: false,
              ingredientId: ingredient.id, amount: 30, amountUnit: 'ml' }] } }] },
          } });
          const foreign = await db.cafe.create({ data: { name: 'Foreign usage ' + randomUUID() } });
          try {
            await runWithTenant({ cafeId: foreign.id }, async () => {
              const foreignCategory = await db.category.create({ data: { name: 'Чужая категория' } });
              // Even an imported cross-tenant reference must not disclose the other tenant's dish.
              await db.dish.create({ data: { name: 'Чужое блюдо', categoryId: foreignCategory.id, price: 100, stockIngredientId: ingredient.id } });
              await assert.rejects(new IngredientsService(db).findOne(ingredient.id), /не найден/i);
            });
            const { usage, usedInDishes } = await new IngredientsService(db).findOne(ingredient.id);
            assert.deepEqual(usedInDishes, [{ id: drinks.id, name: drinks.name }]);
            const values = Object.fromEntries(usage.map(({ kind, quantity, unit, active, label }) => [kind, [quantity, unit, active, label]]));
            assert.deepEqual(values, { preparation: [0.25, 'л', true, null], recipe: [75, 'мл', true, null], stock: [0.1, 'л', true, null],
              variant: [0.175, 'л', true, 'Большой'], modifier: [30, 'мл', false, 'Добавки · Сливки'] });
          } finally {
            await runWithTenant({ cafeId: foreign.id }, async () => {
              await db.dish.deleteMany();
              await db.category.deleteMany();
            });
            await db.cafe.delete({ where: { id: foreign.id } });
            await db.preparationRecipe.delete({ where: { ingredientId: preparation.id } });
          }
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
