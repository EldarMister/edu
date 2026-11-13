const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const url = process.env.ORDER_FEATURE_TEST_DATABASE_URL;
const api = process.env.WAREHOUSE_TEST_API_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.includes('test'))) throw new Error('Dedicated local test database required');
if (api && !['localhost', '127.0.0.1'].includes(new URL(api).hostname)) throw new Error('Dedicated local test API required');

test('HTTP: warehouse action permissions and cost visibility are enforced by the running API', { skip: !url || !api }, async () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const cafe = await db.cafe.create({ data: { name: `Warehouse HTTP ${randomUUID()}` } });
  const foreign = await db.cafe.create({ data: { name: `Foreign production ${randomUUID()}` } });
  try {
    const password = randomUUID();
    const passwordHash = await bcrypt.hash(password, 4);
    const createUser = async (role, permissions) => db.user.create({ data: { cafeId: cafe.id, name: role,
      phone: `+9960${randomInt(10000000, 99999999)}`, role, passwordHash, permissions } });
    const owner = await createUser('OWNER', {});
    const keeper = await createUser('ADMIN', { sections: { warehouse: true }, actions: {
      warehouseCosts: false, warehouseReceive: false, warehouseApprove: false, warehouseSettings: false,
    } });
    const chef = await createUser('KITCHEN', { sections: { warehouse: true }, actions: { warehouseProduce: true, warehouseRecipes: false, warehouseReports: false, warehouseCosts: false } });
    const reader = await createUser('KITCHEN', { sections: { warehouse: true }, actions: { warehouseProduce: false, warehouseRecipes: true, warehouseReports: false, warehouseCosts: false } });
    const outsider = await createUser('WAITER', { sections: { warehouse: true }, actions: { warehouseApprove: true } });
    const login = async (user) => {
      const response = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: user.phone, password }) });
      assert.equal(response.status, 200);
      return (await response.json()).accessToken;
    };
    const ownerToken = await login(owner), keeperToken = await login(keeper), outsiderToken = await login(outsider);
    const chefToken = await login(chef), readerToken = await login(reader);
    const request = (token, path, method = 'GET', body) => fetch(`${api}/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const settings = await Promise.all(Array.from({ length: 5 }, () => request(ownerToken, '/settings')));
    assert.ok(settings.every(response => response.status === 200), 'first-use settings must be race safe');
    const created = await request(ownerToken, '/admin/warehouse/ingredients', 'POST', { name: 'HTTP item', unit: 'pcs', kind: 'goods', stock: 5, avgCost: 7 });
    assert.equal(created.status, 201);
    const ingredient = await created.json();
    const list = await request(keeperToken, '/admin/warehouse/ingredients');
    assert.equal(list.status, 200);
    const [row] = await list.json();
    assert.equal(row.stock, 5);
    assert.equal(row.avgCost, null);
    assert.equal(row.avgCostBase, null);
    assert.equal((await request(keeperToken, '/admin/warehouse/purchases')).status, 403);
    assert.equal((await request(keeperToken, '/admin/warehouse/reports/export.csv')).status, 403);
    for (const token of [keeperToken, ownerToken]) assert.equal((await request(token, `/admin/warehouse/ingredients/${ingredient.id}/adjust`, 'POST', { mode: 'set', quantity: 99, unit: 'pcs' })).status, 404);
    assert.equal((await request(outsiderToken, '/admin/warehouse/ingredients')).status, 403);
    const check = await db.ingredient.findUnique({ where: { id: ingredient.id } });
    assert.equal(check.stock.toNumber(), 5, 'denied requests cannot change stock');

    // A cook with production permission can post and read batches without gaining reports or costs.
    const main = await db.warehouse.findFirstOrThrow({ where: { cafeId: cafe.id, isDefault: true } });
    const emptyWarehouse = await db.warehouse.create({ data: { cafeId: cafe.id, name: 'Empty warehouse' } });
    const foreignWarehouse = await db.warehouse.create({ data: { cafeId: foreign.id, name: 'Foreign warehouse', isDefault: true } });
    const foreignOutput = await db.ingredient.create({ data: { cafeId: foreign.id, name: 'Foreign preparation', kind: 'preparation', isPrepared: true, unitType: 'count', displayUnit: 'pcs' } });
    const foreignBatch = await db.preparationBatch.create({ data: { cafeId: foreign.id, warehouseId: foreignWarehouse.id, ingredientId: foreignOutput.id, plannedQuantity: 1, actualQuantity: 1, totalCost: 77, costKnown: true, items: { actual: [] } } });
    const outputResponse = await request(ownerToken, '/admin/warehouse/ingredients', 'POST', { name: 'Chef production', unit: 'pcs', kind: 'preparation' });
    assert.equal(outputResponse.status, 201); const output = await outputResponse.json();
    const recipeResponse = await request(ownerToken, `/admin/warehouse/preparation/${output.id}/recipe`, 'PUT', { outputQuantity: 1, outputUnit: 'pcs', items: [{ ingredientId: ingredient.id, quantity: 1, unit: 'pcs' }] });
    assert.equal(recipeResponse.status, 200);
    assert.equal((await request(chefToken, '/admin/warehouse/movements')).status, 403);
    assert.equal((await request(chefToken, '/admin/warehouse/reports?view=movements')).status, 403);
    const produceResponse = await request(chefToken, `/admin/warehouse/preparation/${output.id}/batches`, 'POST', { quantity: 1, unit: 'pcs', warehouseId: main.id, requestKey: randomUUID(), batchNumber: 'CHEF-HTTP' });
    assert.equal(produceResponse.status, 201); const produced = await produceResponse.json();
    assert.equal(produced.totalCost, null); assert.equal(produced.unitCost, null);
    const journalResponse = await request(chefToken, '/admin/warehouse/preparation/batches');
    assert.equal(journalResponse.status, 200); const journal = await journalResponse.json();
    assert.equal(journal.length, 1); assert.equal(journal[0].id, produced.id);
    assert.equal(journal[0].ingredientName, 'Chef production'); assert.equal(journal[0].actualQuantity, 1); assert.equal(journal[0].unit, 'pcs');
    assert.equal(journal[0].totalCost, null); assert.equal(journal[0].unitCost, null); assert.equal(journal[0].items.actual[0].cost, null); assert.equal(journal[0].items.actorId, chef.id);
    const ownerJournal = await (await request(ownerToken, `/admin/warehouse/preparation/batches?warehouseId=${main.id}`)).json();
    assert.equal(ownerJournal[0].totalCost, 7);
    assert.deepEqual(await (await request(chefToken, `/admin/warehouse/preparation/batches?warehouseId=${emptyWarehouse.id}`)).json(), []);
    assert.equal((await request(chefToken, `/admin/warehouse/preparation/batches?warehouseId=${foreignWarehouse.id}`)).status, 404);
    assert.equal((await request(chefToken, `/admin/warehouse/preparation/batches/${foreignBatch.id}`)).status, 404);
    assert.equal((await request(readerToken, '/admin/warehouse/preparation/batches')).status, 403);
    assert.equal((await request(outsiderToken, '/admin/warehouse/preparation/batches')).status, 403);

  } finally {
    await db.stockMovement.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.preparationBatch.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.preparationRecipe.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.ingredient.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.settings.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.cafe.delete({ where: { id: foreign.id } });
    await db.$disconnect();
  }
});
