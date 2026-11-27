require('ts-node/register/transpile-only');
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { runWithTenant, tenantPrismaMiddleware } = require('../src/tenant/tenant-context.ts');
const { CatalogService } = require('../src/admin/catalog.service.ts');
const { CategoriesService } = require('../src/categories/categories.service.ts');
const { recordOrderTaxes } = require('../src/settings/order-taxes.ts');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Dedicated local test database required');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXLsAAAAASUVORK5CYII=';

test('Menu category hierarchy, photos and receipt taxes', { skip: !url }, async t => {
  const db = new PrismaClient({ datasourceUrl: url });
  db.$use(tenantPrismaMiddleware);
  const cafe = await db.cafe.create({ data: { name: 'Menu tree ' + randomUUID() } });
  const foreign = await db.cafe.create({ data: { name: 'Foreign ' + randomUUID() } });
  const catalog = new CatalogService(db, { emitBroadcast() {} }, { async log() {} });
  const pos = new CategoriesService(db);
  const actor = { id: randomUUID(), cafeId: cafe.id, role: 'OWNER', name: 'QA' };
  try {
    const foreignCategory = await runWithTenant({ cafeId: foreign.id }, () => catalog.createCategory({ name: 'Чужая' }, actor));
    await runWithTenant({ cafeId: cafe.id }, async () => {
      await db.settings.create({ data: { taxesEnabled: true } });
      const rate = async (name, amount) => db.menuTax.create({ data: { name, rate: amount, type: 'turnover' } });
      const oldTax = await rate('Первый', 10), nextTax = await rate('Новый', 5);
      const parent = await catalog.createCategory({ name: 'Напитки', taxId: oldTax.id }, actor);
      const child = await catalog.createCategory({ name: 'Кофе', parentId: parent.id, taxMode: 'inherit', imageUrl: png }, actor);
      const leaf = await catalog.createCategory({ name: 'С молоком', parentId: child.id }, actor);
      const exempt = await catalog.createCategory({ name: 'Без налога', parentId: parent.id, taxMode: 'none' }, actor);
      const exemptLeaf = await catalog.createCategory({ name: 'Без налога, подкатегория', parentId: exempt.id, taxMode: 'inherit' }, actor);
      const overridden = await catalog.createCategory({ name: 'Свой налог', parentId: child.id, taxMode: 'explicit', taxId: nextTax.id }, actor);
      const lookup = async id => (await catalog.categoriesAll()).find(c => c.id === id);
      await t.test('flat legacy settings, paths, photo validation and visibility', async () => {
        assert.equal(parent.taxMode, 'explicit');
        assert.deepEqual([child.taxMode, child.taxId, leaf.taxId, overridden.taxId], ['inherit', oldTax.id, oldTax.id, nextTax.id]);
        const posLeaf = (await pos.findAll()).find(c => c.id === leaf.id);
        assert.deepEqual([posLeaf.pathLabel, posLeaf.parentId, posLeaf.ancestorIds], ['Напитки / Кофе / С молоком', child.id, [parent.id, child.id]]);
        assert.match(child.imageUrl, /^\/categories\/.+\/image\?v=/);
        assert.equal(Object.hasOwn(child, 'imageKey'), false);
        const version = new URL(child.imageUrl, 'http://localhost').searchParams.get('v');
        assert.equal((await pos.image(child.id, version)).buffer.toString('base64'), png.split(',')[1]);
        assert.equal(await pos.image(parent.id, version), null);
        await assert.rejects(catalog.updateCategory(child.id, { imageUrl: 'data:image/png;base64,dGVzdA==' }, actor), /Формат/);
        await assert.rejects(catalog.updateCategory(child.id, { imageUrl: 'https://example.com/image.png' }, actor), /Загрузите/);
        assert.equal((await lookup(child.id)).imageUrl, child.imageUrl);
        await catalog.updateCategory(parent.id, { isActive: false }, actor);
        assert.deepEqual((await pos.findAll()).find(c => c.id === leaf.id).ancestorIds, [child.id]);
        assert.equal((await lookup(child.id)).parentId, parent.id);
        await catalog.updateCategory(parent.id, { isActive: true }, actor);
        await catalog.updateCategory(child.id, { imageUrl: '' }, actor);
        assert.equal(await pos.image(child.id, version), null);
        assert.equal((await lookup(child.id)).imageUrl, null);
      });
      await t.test('parent and rate changes affect future receipts through inheritance; past receipts and explicit choices are preserved', async () => {
        const dish = await db.dish.create({ data: { name: 'Латте', categoryId: leaf.id, price: 100 } });
        const hall = await db.hall.create({ data: { name: 'Зал' } });
        const table = await db.table.create({ data: { hallId: hall.id, number: 1 } });
        const sale = () => db.$transaction(async tx => {
          const order = await tx.order.create({ data: { tableId: table.id, orderNumber: randomUUID(), status: 'paid', paymentStatus: 'paid', closedAt: new Date(),
            items: { create: { dishId: dish.id, status: 'served', dishNameSnapshot: dish.name, finalPrice: 100, priceSnapshot: 100 } } }, include: { items: true } });
          await recordOrderTaxes(tx, order.id, cafe.id, order.items, new Date());
          return tx.orderTax.findFirstOrThrow({ where: { orderId: order.id } });
        });
        const before = await sale();
        assert.deepEqual([before.taxId, Number(before.rate)], [oldTax.id, 10]);
        await catalog.updateCategory(parent.id, { taxMode: 'explicit', taxId: nextTax.id }, actor);
        assert.equal((await lookup(leaf.id)).taxId, nextTax.id);
        assert.equal((await lookup(exemptLeaf.id)).taxId, null);
        await db.menuTax.update({ where: { id: nextTax.id }, data: { rate: 7 } });
        const after = await sale();
        assert.deepEqual([after.taxId, Number(after.rate)], [nextTax.id, 7]);
        assert.equal(Number((await db.orderTax.findUniqueOrThrow({ where: { id: before.id } })).rate), 10);
        await catalog.updateCategory(parent.id, { taxId: null }, actor);
        assert.equal((await lookup(leaf.id)).taxId, null);
        assert.equal((await lookup(overridden.id)).taxId, nextTax.id);
      });
      await t.test('foreign parents and cycles are rejected, moving or deleting a parent updates surviving children', async () => {
        await assert.rejects(catalog.createCategory({ name: 'Недопустимая', parentId: foreignCategory.id }, actor), /не найдена/);
        await assert.rejects(catalog.updateCategory(parent.id, { parentId: leaf.id }, actor), /подкатегорию/);
        await assert.rejects(catalog.updateCategory(child.id, { parentId: child.id }, actor), /саму себя/);
        const replacement = await catalog.createCategory({ name: 'Бар', taxId: oldTax.id }, actor);
        await catalog.updateCategory(child.id, { parentId: replacement.id }, actor);
        assert.equal((await lookup(leaf.id)).taxId, oldTax.id);
        await catalog.deleteCategory(replacement.id, { strategy: 'move', targetCategoryId: parent.id }, actor);
        assert.deepEqual([(await lookup(child.id)).parentId, (await lookup(leaf.id)).taxId, (await lookup(overridden.id)).taxId], [null, null, nextTax.id]);
      });
    });
  } finally {
    const where = { cafeId: { in: [cafe.id, foreign.id] } };
    await db.order.deleteMany({ where });
    await db.table.deleteMany({ where });
    await db.hall.deleteMany({ where });
    await db.dish.deleteMany({ where });
    await db.category.deleteMany({ where });
    await db.menuTax.deleteMany({ where });
    await db.settings.deleteMany({ where });
    await db.cafe.deleteMany({ where: { id: where.cafeId } });
    await db.$disconnect();
  }
});
