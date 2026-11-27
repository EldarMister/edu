require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { CatalogService } = require('../src/admin/catalog.service.ts');
const { CategoriesService } = require('../src/categories/categories.service.ts');
const { DishesService } = require('../src/dishes/dishes.service.ts');
const { DeliveryIntegrationService } = require('../src/delivery-integration/delivery-integration.service.ts');
const { OrdersService } = require('../src/orders/orders.service.ts');
const { QrService } = require('../src/qr/qr.service.ts');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) {
  throw new Error('Dedicated local test database required');
}

test('Category trash restores the subtree and only its archived menu items', { skip: !url }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: randomUUID() } });
  const foreign = await db.cafe.create({ data: { name: randomUUID() } });
  const catalog = new CatalogService(db, { emitBroadcast() {} }, { async log() {} });
  const pos = new CategoriesService(db);
  const dishes = new DishesService(db);
  const delivery = new DeliveryIntegrationService(db, undefined, { emitBroadcast() {} });
  const actor = { id: randomUUID(), cafeId: cafe.id, role: 'OWNER', name: 'QA' };
  try {
    await runWithTenant({ cafeId: cafe.id }, async () => {
      await db.settings.create({ data: { taxesEnabled: true } });
      const beforeTax = await db.menuTax.create({ data: { name: 'Первый', rate: 10, type: 'turnover' } });
      const afterTax = await db.menuTax.create({ data: { name: 'Второй', rate: 5, type: 'turnover' } });
      const parent = await catalog.createCategory({ name: 'Меню', taxId: beforeTax.id }, actor);
      const root = await catalog.createCategory({ name: 'Напитки', parentId: parent.id }, actor);
      const child = await catalog.createCategory({ name: 'Кофе', parentId: root.id }, actor);
      await catalog.updateCategory(child.id, { isActive: false }, actor);
      const hidden = await catalog.createCategory({ name: 'Снято отдельно', parentId: child.id }, actor);
      await catalog.deleteCategory(hidden.id, { strategy: 'delete' }, actor);
      const ingredient = await db.ingredient.create({ data: { name: 'Кофе' } });
      const good = await db.dish.create({
        data: { name: 'Бутилированная вода', categoryId: root.id, catalogKind: 'goods', price: 100, isAvailable: false, stockIngredientId: ingredient.id },
      });
      const dish = await db.dish.create({
        data: { name: 'Латте', categoryId: child.id, price: 200, isActive: false,
          variants: { create: { name: '350 мл', price: 200 } }, recipeItems: { create: { ingredientId: ingredient.id, amount: 10 } } },
        include: { variants: true, recipeItems: true },
      });
      const standalone = await catalog.createDish({ name: 'Удалено отдельно', categoryId: child.id, price: 150 }, actor);
      await catalog.deleteDish(standalone.id, actor);
      const hall = await db.hall.create({ data: { name: 'Зал' } });
      const table = await db.table.create({ data: { hallId: hall.id, number: 1 } });
      const order = await db.order.create({ data: { tableId: table.id, orderNumber: randomUUID(),
        items: { create: { dishId: good.id, dishNameSnapshot: good.name, priceSnapshot: 100, finalPrice: 100 } } },
        include: { items: true } });

      await t.test('open order protects the entire archive and category trash is scoped to the tenant', async () => {
        await assert.rejects(catalog.deleteCategory(root.id, { strategy: 'delete' }, actor), /открытом заказе/);
        assert.equal((await db.category.findUniqueOrThrow({ where: { id: root.id } })).archivedAt, null);
        await db.order.update({ where: { id: order.id }, data: { status: 'paid', paymentStatus: 'paid' } });
        await catalog.deleteCategory(root.id, { strategy: 'delete' }, actor);
        assert.deepEqual((await catalog.categoriesAll()).map(({ id }) => id), [parent.id]);
        assert.deepEqual((await pos.findAll()).map(({ id }) => id), [parent.id]);
        assert.deepEqual(await catalog.dishesAll({}), []);
        assert.deepEqual(await catalog.trashedRecipes(), []);
        const archive = (await catalog.trashedCategories()).find(({ id }) => id === root.id);
        assert.equal(archive.itemCount, 2);
        assert.equal((await catalog.trashedCategories()).find(({ id }) => id === hidden.id).parentInTrash, root.name);
        assert.equal((await db.dish.findUniqueOrThrow({ where: { id: dish.id } })).archivedWithCategoryId, root.id);
        await assert.rejects(catalog.restoreRecipe(dish.id, actor), /отсутствует/);
        await assert.rejects(catalog.restoreCategory(child.id, actor), /отсутствует/);
        await assert.rejects(catalog.restoreCategory(hidden.id, actor), /родительскую категорию «Напитки»/);
        await assert.rejects(catalog.createCategory({ name: 'Чужая подкатегория', parentId: root.id }, actor), /не найдена/);
        await assert.rejects(catalog.createDish({ name: 'Недопустимо', categoryId: root.id, price: 100 }, actor), /не найдена/);
        await runWithTenant({ cafeId: foreign.id }, async () => {
          assert.deepEqual(await catalog.trashedCategories(), []);
          await assert.rejects(catalog.restoreCategory(root.id, actor), /отсутствует/);
        });
      });

      await t.test('restore preserves hierarchy, visibility, tax inheritance, recipe IDs and paid order links', async () => {
        await catalog.updateCategory(parent.id, { taxId: afterTax.id }, actor);
        await catalog.restoreCategory(root.id, actor);
        const categories = new Map((await catalog.categoriesAll()).map(category => [category.id, category]));
        assert.deepEqual([categories.get(root.id).parentId, categories.get(root.id).taxId], [parent.id, afterTax.id]);
        assert.deepEqual([categories.get(child.id).parentId, categories.get(child.id).taxId, categories.get(child.id).isActive],
          [root.id, afterTax.id, false]);
        assert.equal(categories.has(hidden.id), false);
        const item = await db.dish.findUniqueOrThrow({ where: { id: dish.id }, include: { variants: true, recipeItems: true } });
        assert.deepEqual([item.isActive, item.archivedAt, item.variants[0].id, item.recipeItems[0].id],
          [false, null, dish.variants[0].id, dish.recipeItems[0].id]);
        const restoredGood = await db.dish.findUniqueOrThrow({ where: { id: good.id } });
        assert.deepEqual([restoredGood.categoryId, restoredGood.isAvailable, restoredGood.isActive, restoredGood.stockIngredientId],
          [root.id, false, true, ingredient.id]);
        assert.equal((await db.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).dishId, good.id);
        assert.deepEqual((await catalog.trashedRecipes()).map(({ id }) => id), [standalone.id]);
        assert.deepEqual((await catalog.trashedCategories()).map(({ id, parentInTrash }) => [id, parentInTrash]), [[hidden.id, null]]);
        await assert.rejects(catalog.restoreCategory(root.id, actor), /отсутствует/);
      });

      await t.test('move option keeps items in their destination and 30-day cutoff retains order history', async () => {
        const target = await catalog.createCategory({ name: 'Перенос' }, actor);
        await catalog.deleteCategory(root.id, { strategy: 'move', targetCategoryId: target.id }, actor);
        assert.equal((await catalog.trashedCategories()).find(({ id }) => id === root.id).itemCount, 0);
        await catalog.restoreCategory(root.id, actor);
        assert.equal((await db.dish.findUniqueOrThrow({ where: { id: good.id } })).categoryId, target.id);
        assert.equal((await db.category.findUniqueOrThrow({ where: { id: child.id } })).parentId, parent.id);
        await catalog.deleteCategory(target.id, { strategy: 'delete' }, actor);
        await db.category.update({ where: { id: target.id }, data: { archivedAt: new Date(Date.now() - 31 * 86400_000) } });
        assert.equal((await catalog.trashedCategories()).some(({ id }) => id === target.id), false);
        await assert.rejects(catalog.restoreCategory(target.id, actor), /срок восстановления/);
        assert.equal((await db.orderItem.findUniqueOrThrow({ where: { id: order.items[0].id } })).dishId, good.id);
      });

      await t.test('hidden category is respected by POS, public QR, order submission and delivery', async () => {
        const hiddenCategory = await catalog.createCategory({ name: 'Сезонное', prepStation: 'none' }, actor);
        const seasonal = await catalog.createDish({ name: 'Сезонное блюдо', categoryId: hiddenCategory.id, price: 100 }, actor);
        const settings = { getPublic: async () => ({ cafeName: 'QA' }), getQrGeoConfig: async () => ({ enabled: false, radius: 0 }) };
        const orders = new OrdersService(db);
        const qr = new QrService(db, settings, dishes, pos, orders);
        assert.deepEqual((await dishes.findAll({ categoryId: hiddenCategory.id })).map(({ id }) => id), [seasonal.id]);
        await catalog.updateCategory(hiddenCategory.id, { isActive: false }, actor);
        assert.deepEqual(await dishes.findAll({ categoryId: hiddenCategory.id }), []);
        assert.deepEqual(await dishes.findAll({ search: seasonal.name }), []);
        await assert.rejects(dishes.modifiers(seasonal.id), /Блюдо не найдено/);
        assert.equal((await qr.getMenu(table.qrToken)).dishes.some(({ id }) => id === seasonal.id), false);
        await assert.rejects(qr.addItem(table.qrToken, { dishId: seasonal.id, quantity: 1, guestKey: randomUUID() }), /Блюдо не найдено/);
        await assert.rejects(orders.createFromQr({ tableId: table.id, items: [{ dishId: seasonal.id, quantity: 1 }] }), /Блюдо недоступно/);
        assert.equal((await delivery.getMenu()).categories.some(({ id }) => id === hiddenCategory.id), false);
        await catalog.updateDish(seasonal.id, { isAvailable: false }, actor);
        assert.equal((await delivery.getStopList()).dishes.some(({ id }) => id === seasonal.id), false);
        await catalog.updateCategory(hiddenCategory.id, { isActive: true }, actor);
        assert.equal((await delivery.getStopList()).dishes.some(({ id }) => id === seasonal.id), true);
        await catalog.deleteCategory(hiddenCategory.id, { strategy: 'move', targetCategoryId: '__main_screen__' }, actor);
        await catalog.restoreCategory(hiddenCategory.id, actor);
        assert.match((await db.dish.findUniqueOrThrow({ where: { id: seasonal.id } })).categoryId, /^menu-root:/);
      });

      await t.test('delivery menu refresh preserves local hide choices and rejects archived IDs', async () => {
        const category = await catalog.createCategory({ name: 'Летнее меню', prepStation: 'none' }, actor);
        const item = await catalog.createDish({ name: 'Летний десерт', categoryId: category.id, price: 100 }, actor);
        await catalog.updateCategory(category.id, { isActive: false }, actor);
        await catalog.updateDish(item.id, { isActive: false }, actor);
        const product = {
          id: item.id, sourceId: 1, slug: 'summer-dessert', name: 'Летний десерт', description: '', composition: '',
          imageUrl: '', price: 150, available: true, soldByWeight: false, sortOrder: 0, modifiers: [],
        };
        const refresh = {
          source: 'nakta-sushi', regionSlug: 'qa', menuSourceRegionSlug: 'qa', exportedAt: new Date().toISOString(),
          categories: [{ id: category.id, sourceId: 1, slug: 'summer-menu', name: 'Летний сезон', imageUrl: '', sortOrder: 0, products: [product] }],
        };
        await delivery.importMenu(refresh);
        const refreshedCategory = await db.category.findUniqueOrThrow({ where: { id: category.id } });
        const refreshedItem = await db.dish.findUniqueOrThrow({ where: { id: item.id } });
        assert.deepEqual([refreshedCategory.name, refreshedCategory.isActive, Number(refreshedItem.price), refreshedItem.isActive],
          ['Летний сезон', false, 150, false]);
        assert.equal((await delivery.getMenu()).categories.some(({ id }) => id === category.id), false);

        await catalog.deleteCategory(category.id, { strategy: 'delete' }, actor);
        await assert.rejects(delivery.importMenu(refresh), /Сначала восстановите категорию/);
        const remoteCategory = { ...refresh.categories[0], id: randomUUID() };
        await assert.rejects(delivery.importMenu({ ...refresh, categories: [remoteCategory] }), /Сначала восстановите категорию/);
        assert.equal(await db.category.findUnique({ where: { id: remoteCategory.id } }), null);
        await catalog.restoreCategory(category.id, actor);
        assert.equal((await db.category.findUniqueOrThrow({ where: { id: category.id } })).isActive, false);
        assert.equal((await db.dish.findUniqueOrThrow({ where: { id: item.id } })).isActive, false);

        await catalog.deleteDish(item.id, actor);
        const remoteProduct = { ...product, id: randomUUID() };
        await assert.rejects(delivery.importMenu({ ...refresh, categories: [{ ...refresh.categories[0], products: [remoteProduct] }] }),
          /Сначала восстановите позицию/);
        assert.equal(await db.dish.findUnique({ where: { id: remoteProduct.id } }), null);
      });

      await t.test('archived sets permit further archives but restore waits for their components', async () => {
        const sets = await catalog.createCategory({ name: 'Комбо' }, actor);
        const components = await catalog.createCategory({ name: 'Закуски' }, actor);
        const component = await catalog.createDish({ name: 'Закуска', categoryId: components.id, price: 120 }, actor);
        const set = await db.dish.create({
          data: { name: 'Комбо', categoryId: sets.id, isSet: true, price: 200, setComponents: { create: { dishId: component.id } } },
        });
        await assert.rejects(catalog.deleteCategory(components.id, { strategy: 'delete' }, actor), /входит в сет/);
        await catalog.deleteCategory(sets.id, { strategy: 'delete' }, actor);
        await catalog.deleteCategory(components.id, { strategy: 'delete' }, actor);
        await assert.rejects(catalog.restoreCategory(sets.id, actor), /использует позицию «Закуска» из корзины/);
        assert.deepEqual(await catalog.setsAll(), []);
        await catalog.restoreCategory(components.id, actor);
        await catalog.restoreCategory(sets.id, actor);
        assert.equal((await catalog.setsAll()).find(({ id }) => id === set.id).setComponents[0].dish.id, component.id);
      });
    });
  } finally {
    const where = { cafeId: cafe.id };
    await db.order.deleteMany({ where });
    await db.qrTableSession.deleteMany({ where });
    await db.table.deleteMany({ where });
    await db.hall.deleteMany({ where });
    await db.dish.deleteMany({ where });
    await db.ingredient.deleteMany({ where });
    await db.category.deleteMany({ where });
    await db.menuTax.deleteMany({ where });
    await db.settings.deleteMany({ where });
    await db.cafe.deleteMany({ where: { id: { in: [cafe.id, foreign.id] } } });
    await db.$disconnect();
  }
});
