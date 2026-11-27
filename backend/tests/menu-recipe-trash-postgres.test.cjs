require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { CatalogService } = require('../src/admin/catalog.service.ts');
const { MenuEntryService } = require('../src/admin/menu-entry.service.ts');
const { RecipesService } = require('../src/warehouse/recipes.service.ts');
const { MenuModifiersService } = require('../src/warehouse/menu-modifiers.ts');
const { WarehouseDocumentsService } = require('../src/warehouse/documents.service.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Dedicated local test database required');

test('Recipe trash preserves identities, closed orders, safety of open orders and 30-day restoration', { skip: !url }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: randomUUID() } });
  const foreign = await db.cafe.create({ data: { name: randomUUID() } });
  const events = { emitBroadcast() {} }, audit = { async log() {} };
  const catalog = new CatalogService(db, events, audit);
  const recipes = new RecipesService(db), modifiers = new MenuModifiersService(db);
  const menu = new MenuEntryService(db, recipes, modifiers, events, audit);
  const docs = new WarehouseDocumentsService(db);
  const actor = { id: randomUUID(), cafeId: cafe.id, role: 'OWNER', name: 'QA' };
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      const category = await db.category.create({ data: { name: 'Горячее' } });
      const dish = await db.dish.create({ data: { name: 'Суп', categoryId: category.id, price: 150 } });
      const ingredient = await db.ingredient.create({ data: { name: 'Соль' } });
      const recipeItem = await db.recipeItem.create({ data: { dishId: dish.id, ingredientId: ingredient.id, amount: 1 } });
      const variant = await db.dishVariant.create({ data: { dishId: dish.id, name: 'Маленькая порция', price: 100 } });
      const group = await db.menuModifierGroup.create({ data: { dishId: dish.id, name: 'Добавки', options: { create: { name: 'Перец' } } }, include: { options: true } });
      const hall = await db.hall.create({ data: { name: 'Зал' } });
      const table = await db.table.create({ data: { hallId: hall.id, number: 1 } });
      const order = await db.order.create({ data: { tableId: table.id, orderNumber: randomUUID(),
        items: { create: { dishId: dish.id, dishVariantId: variant.id, dishNameSnapshot: dish.name, priceSnapshot: 100, finalPrice: 100 } } }, include: { items: true } });
      await t.test('open checks and set compositions are protected', async () => {
        await assert.rejects(catalog.deleteDish(dish.id, actor), /открытом заказе/);
        await db.order.update({ where: { id: order.id }, data: { status: 'paid', paymentStatus: 'paid' } });
        const set = await db.dish.create({ data: { name: 'Обед', categoryId: category.id, price: 200, isSet: true,
          setComponents: { create: { dishId: dish.id, dishVariantId: variant.id } } } });
        await assert.rejects(catalog.deleteDish(dish.id, actor), /входит в сет/);
        await catalog.deleteDish(set.id, actor);
      });
      await t.test('trash hides the dish from new orders and edits and restores original related ids', async () => {
        const asOf = new Date().toISOString();
        await catalog.deleteDish(dish.id, actor);
        assert.equal((await catalog.dishesAll({})).length, 0);
        assert.equal((await docs.writeoffOptions()).dishes.length, 0);
        assert.equal((await docs.writeoffOptions(asOf)).dishes[0].id, dish.id);
        const archived = (await catalog.trashedRecipes())[0];
        assert.deepEqual([archived.id, archived.category.id, archived.prepStation], [dish.id, category.id, category.prepStation]);
        await assert.rejects(menu.get(dish.id), /не найдена/);
        await assert.rejects(catalog.updateDish(dish.id, { isActive: true }, actor), /не найдено/);
        await assert.rejects(recipes.removeItem(recipeItem.id), /отсутствует в меню/);
        await runWithTenant({ cafeId: foreign.id }, async () => {
          assert.deepEqual(await catalog.trashedRecipes(), []);
          await assert.rejects(catalog.restoreRecipe(dish.id, actor), /отсутствует/);
        });
        await catalog.restoreRecipe(dish.id, actor);
        const entry = await db.dish.findUniqueOrThrow({ where: { id: dish.id }, include: { variants: true, recipeItems: true, modifierGroups: { include: { options: true } } } });
        assert.deepEqual([entry.isActive, entry.variants[0].id, entry.recipeItems[0].id, entry.modifierGroups[0].options[0].id],
          [true, variant.id, recipeItem.id, group.options[0].id]);
        const sold = await db.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } });
        assert.deepEqual([sold.dishId, sold.dishVariantId], [dish.id, variant.id]);
      });
      await t.test('deleting the original category preserves the trash; restoring preserves disabled state', async () => {
        await db.dish.update({ where: { id: dish.id }, data: { isActive: false } });
        await catalog.deleteCategory(category.id, { strategy: 'delete' }, actor);
        assert.deepEqual(await catalog.trashedRecipes(), []);
        await assert.rejects(catalog.restoreRecipe(dish.id, actor), /отсутствует/);
        assert.equal((await catalog.trashedCategories())[0].id, category.id);
        await catalog.restoreCategory(category.id, actor);
        assert.equal((await db.dish.findUniqueOrThrow({ where: { id: dish.id } })).isActive, false);
        assert.equal((await catalog.dishesAll({}))[0].id, dish.id);
        await catalog.deleteDish(dish.id, actor);
        await db.dish.update({ where: { id: dish.id }, data: { archivedAt: new Date(Date.now() - 31 * 86400_000) } });
        assert.deepEqual(await catalog.trashedRecipes(), []);
        await assert.rejects(catalog.restoreRecipe(dish.id, actor), /срок восстановления/);
      });
    });
  } finally {
    const where = { cafeId: cafe.id };
    await db.order.deleteMany({ where });
    await db.table.deleteMany({ where });
    await db.hall.deleteMany({ where });
    await db.dish.deleteMany({ where });
    await db.ingredient.deleteMany({ where });
    await db.category.deleteMany({ where });
    await db.cafe.deleteMany({ where: { id: { in: [cafe.id, foreign.id] } } });
    await db.$disconnect();
  }
});
