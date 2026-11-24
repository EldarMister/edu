const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');

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
    const counter = await createUser('ADMIN', { sections: { warehouse: true }, actions: {
      warehouseCount: true, warehouseWriteoff: true, warehouseApprove: false, warehouseCosts: false, exportReports: true,
    } });
    const chefPermissions = { sections: { warehouse: true }, actions: {
      warehouseProduce: true, warehouseRecipes: false, warehouseReports: false, warehouseCosts: false,
    } };
    const chef = await createUser('KITCHEN', { ...chefPermissions, adminAccess: true });
    const stationOnlyChef = await createUser('KITCHEN', chefPermissions);
    const reader = await createUser('KITCHEN', { adminAccess: true, sections: { warehouse: true },
      actions: { warehouseProduce: false, warehouseRecipes: true, warehouseReports: false, warehouseCosts: false } });
    const outsider = await createUser('WAITER', { sections: { warehouse: true }, actions: { warehouseApprove: true } });
    const reportReader = await createUser('ADMIN', { sections: { warehouse: true }, actions: {
      warehouseReports: true, warehouseCosts: true, warehouseReceive: false, exportReports: false,
    } });
    const reportBlocked = await createUser('ADMIN', { actions: { warehouseReports: false } });
    const login = async (user) => {
      const response = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: user.phone, password }) });
      assert.equal(response.status, 200);
      return (await response.json()).accessToken;
    };
    const ownerToken = await login(owner), keeperToken = await login(keeper), outsiderToken = await login(outsider);
    const chefToken = await login(chef), readerToken = await login(reader), counterToken = await login(counter);
    const stationOnlyChefToken = await login(stationOnlyChef);
    const reportReaderToken = await login(reportReader);
    const reportBlockedToken = await login(reportBlocked);
    const request = (token, path, method = 'GET', body) => fetch(`${api}/api${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const settings = await Promise.all(Array.from({ length: 5 }, () => request(ownerToken, '/settings')));
    assert.ok(settings.every(response => response.status === 200), 'first-use settings must be race safe');
    const created = await request(ownerToken, '/admin/warehouse/ingredients', 'POST', {
      name: 'HTTP позиция', unit: 'pcs', kind: 'goods', category: 'Напитки, холодные', stock: 5, avgCost: 7,
    });
    assert.equal(created.status, 201);
    const ingredient = await created.json();
    const list = await request(keeperToken, '/admin/warehouse/ingredients');
    assert.equal(list.status, 200);
    const [row] = await list.json();
    assert.equal(row.stock, 5);
    assert.equal(row.avgCost, null);
    assert.equal(row.avgCostBase, null);
    assert.equal((await request(keeperToken, '/admin/warehouse/purchases')).status, 403);
    const supplyPath = `/admin/warehouse/ingredients/${ingredient.id}/supplies`;
    assert.equal((await request(reportReaderToken, supplyPath)).status, 200, 'reading supplies does not require receiving permission');
    assert.equal((await request(reportReaderToken, '/admin/warehouse/purchases')).status, 200, 'reading purchases requires costs, not receiving permission');
    for (const token of [keeperToken, chefToken, outsiderToken]) {
      assert.equal((await request(token, supplyPath)).status, 403);
    }
    for (const query of ['page=0', 'page=1000001', 'pageSize=101', 'pageSize=-1', 'page=1.5']) {
      assert.equal((await request(ownerToken, `${supplyPath}?${query}`)).status, 400);
    }
    assert.equal((await request(keeperToken, '/admin/warehouse/reports/export.csv')).status, 403);
    const excelPath = '/admin/warehouse/reports/export.xlsx';
    for (const token of [keeperToken, reportReaderToken, reportBlockedToken]) {
      assert.equal((await request(token, excelPath)).status, 403);
    }
    for (const query of ['view=purchases', 'columns=kind', 'columns=name,name', 'columns=name,unexpected']) {
      assert.equal((await request(ownerToken, `${excelPath}?${query}`)).status, 400);
    }
    const nameValue = encodeURIComponent('http ПоЗиЦиЯ');
    const excel = await request(ownerToken, `${excelPath}?nameCondition=equals&nameValue=${nameValue}&columns=name,closingQuantity,closingAvgCost`);
    assert.equal(excel.status, 200);
    assert.equal(excel.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(excel.headers.get('content-disposition'), 'attachment; filename="warehouse-movement.xlsx"');
    const workbook = XLSX.read(Buffer.from(await excel.arrayBuffer()), { type: 'buffer' });
    assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }), [
      ['Название', 'Итог. остаток', 'Средняя себестоимость на конец'],
      ['HTTP позиция', 5, 7],
    ]);
    for (const [name, kind, category] of [
      ['Мука', 'raw', 'Сырьё'], ['Пакет', 'consumable', 'Сырьё'], ['Сок', 'goods', 'Горячие напитки'],
    ]) {
      const response = await request(ownerToken, '/admin/warehouse/ingredients', 'POST', { name, kind, category, unit: 'pcs' });
      assert.equal(response.status, 201);
    }
    const reportPath = '/admin/warehouse/reports';
    const facets = new URLSearchParams([
      ['view', 'movement_summary'], ['kinds', 'raw'], ['kinds', 'goods'],
      ['categories', 'Напитки, холодные'], ['categories', 'Сырьё'],
    ]);
    const readNames = async (parameters) => {
      const response = await request(ownerToken, `${reportPath}?${parameters}`);
      assert.equal(response.status, 200);
      return (await response.json()).rows.map(({ name }) => name).sort();
    };
    assert.deepEqual(await readNames(facets), ['HTTP позиция', 'Мука']);
    assert.deepEqual(await readNames(new URLSearchParams({ view: 'movement_summary', kinds: 'raw', categories: 'Сырьё' })), ['Мука']);
    assert.deepEqual(await readNames(new URLSearchParams({ view: 'movement_summary', kind: 'consumable', category: 'Сырьё' })), ['Пакет']);
    const filteredExcel = await request(ownerToken, `${excelPath}?${facets}&columns=name`);
    assert.equal(filteredExcel.status, 200);
    const filteredWorkbook = XLSX.read(Buffer.from(await filteredExcel.arrayBuffer()), { type: 'buffer' });
    const [, ...filteredRows] = XLSX.utils.sheet_to_json(filteredWorkbook.Sheets[filteredWorkbook.SheetNames[0]], { header: 1 });
    assert.deepEqual(filteredRows.map(([name]) => name).sort(), ['HTTP позиция', 'Мука']);
    const invalidFacets = ['kinds=raw&kinds=unknown', 'categories=', `categories=${'x'.repeat(121)}`,
      Array(7).fill('kinds=raw').join('&'), Array(101).fill('categories=x').join('&')];
    for (const query of invalidFacets) {
      assert.equal((await request(ownerToken, `${reportPath}?view=movement_summary&${query}`)).status, 400);
    }
    for (const token of [keeperToken, ownerToken]) assert.equal((await request(token, `/admin/warehouse/ingredients/${ingredient.id}/adjust`, 'POST', { mode: 'set', quantity: 99, unit: 'pcs' })).status, 404);
    assert.equal((await request(outsiderToken, '/admin/warehouse/ingredients')).status, 403);
    const check = await db.ingredient.findUnique({ where: { id: ingredient.id } });
    assert.equal(check.stock.toNumber(), 5, 'denied requests cannot change stock');

    // Final-save endpoints enforce the same approval boundary as the separate legacy transition.
    const receiptWarehouse = await db.warehouse.findFirstOrThrow({ where: { cafeId: cafe.id, isDefault: true } });
    const atomicIngredient = await (await request(ownerToken, '/admin/warehouse/ingredients', 'POST', {
      name: 'Atomic save item', unit: 'pcs', stock: 3, avgCost: 7,
    })).json();
    const documentBody = { warehouseId: receiptWarehouse.id, kind: 'writeoff', reason: 'damage',
      items: [{ ingredientId: atomicIngredient.id, quantity: 1 }] };
    const beforeDocuments = await db.warehouseDocument.count({ where: { cafeId: cafe.id } });
    assert.equal((await request(counterToken, '/admin/warehouse/documents', 'POST', { ...documentBody, finalize: 'post' })).status, 403);
    assert.equal(await db.warehouseDocument.count({ where: { cafeId: cafe.id } }), beforeDocuments);
    const draftResponse = await request(counterToken, '/admin/warehouse/documents', 'POST', documentBody);
    assert.equal(draftResponse.status, 201); const draft = await draftResponse.json();
    assert.equal((await request(counterToken, `/admin/warehouse/documents/${draft.id}`, 'PATCH', { revision: draft.revision, finalize: 'post' })).status, 403);
    const finalResponse = await request(ownerToken, `/admin/warehouse/documents/${draft.id}`, 'PATCH', { revision: draft.revision, finalize: 'post' });
    assert.equal(finalResponse.status, 200); assert.equal((await finalResponse.json()).status, 'posted');
    const forApprovalResponse = await request(counterToken, '/admin/warehouse/documents', 'POST', { ...documentBody, finalize: 'submit' });
    assert.equal(forApprovalResponse.status, 201); assert.equal((await forApprovalResponse.json()).status, 'submitted');
    assert.equal(Number((await db.ingredient.findUniqueOrThrow({ where: { id: atomicIngredient.id } })).stock), 2);

    const uncountedResponse = await request(counterToken, '/admin/warehouse/documents', 'POST', {
      warehouseId: receiptWarehouse.id, kind: 'inventory', mode: 'partial',
      items: [{ ingredientId: atomicIngredient.id, quantity: null }],
    });
    assert.equal(uncountedResponse.status, 201, 'HTTP validation accepts an explicitly selected uncounted inventory position');
    const uncounted = await uncountedResponse.json();
    assert.equal(uncounted.items[0].quantity, null);
    const inventoryPath = `/admin/warehouse/documents/${uncounted.id}`;
    const withContext = await request(counterToken, `${inventoryPath}?includeInventoryContext=true`);
    assert.equal(withContext.status, 200);
    const inventory = await withContext.json();
    assert.ok(Number.isFinite(Date.parse(inventory.inventoryContext.cutoffAt)));
    assert.deepEqual(inventory.inventoryContext.rows, [{
      ingredientId: atomicIngredient.id, lastCountAt: null, openingQuantity: 3,
      incomingQuantity: 0, consumptionQuantity: 0, writeoffQuantity: -1, otherQuantity: 0,
    }]);
    assert.equal((await (await request(counterToken, inventoryPath)).json()).inventoryContext, undefined);
    const workbookPath = `${inventoryPath}/inventory.xlsx`;
    assert.equal((await request(reportReaderToken, workbookPath)).status, 403);
    const inventoryExport = async (token, showCosts) => {
      const response = await request(token, workbookPath);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()));
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Инвентаризация'], { header: 1, defval: null });
      const header = rows.find(([title]) => title === 'Наименование');
      assert.equal(header.includes('Разница в деньгах'), showCosts);
      assert.equal(header.includes('Себестоимость за ед.'), showCosts);
    };
    await inventoryExport(ownerToken, true);
    await inventoryExport(counterToken, false);
    assert.equal((await request(counterToken, `${inventoryPath}?includeInventoryContext=invalid`)).status, 400);
    assert.equal((await request(counterToken, `/admin/warehouse/documents/${uncounted.id}/submit`, 'POST', {
      revision: uncounted.revision,
    })).status, 400, 'a partial inventory cannot silently skip selected uncounted positions');
    assert.equal((await request(counterToken, `/admin/warehouse/documents/${uncounted.id}`, 'PATCH', {
      revision: uncounted.revision, items: [{ ingredientId: atomicIngredient.id }],
    })).status, 400, 'missing quantity must be explicit null, not silently accepted');
    assert.equal((await request(counterToken, '/admin/warehouse/documents', 'POST', {
      ...documentBody, items: [{ ingredientId: atomicIngredient.id, quantity: null }],
    })).status, 400, 'uncounted quantities are only valid for inventory drafts');

    const sourceLines = [{ sourceLineId: randomUUID(), kind: 'ingredient', sourceId: atomicIngredient.id, quantity: 1, unit: 'pcs' }];
    assert.equal((await request(counterToken, '/admin/warehouse/documents/writeoff-options')).status, 200);
    const hiddenPreviewResponse = await request(counterToken, '/admin/warehouse/documents/writeoff-preview', 'POST', {
      warehouseId: receiptWarehouse.id, sourceLines,
    });
    assert.equal(hiddenPreviewResponse.status, 201);
    const hiddenPreview = await hiddenPreviewResponse.json();
    assert.equal(hiddenPreview.total, null); assert.equal(hiddenPreview.sourceLines[0].total, null);
    assert.equal(hiddenPreview.sourceLines[0].parts[0].unitCost, null, 'recipe previews respect cost visibility');
    const sourceResponse = await request(ownerToken, '/admin/warehouse/documents', 'POST', {
      warehouseId: receiptWarehouse.id, kind: 'writeoff', reason: 'tasting', finalize: 'post',
      sourceLines: sourceLines.map((line) => ({ ...line, recipeSignature: hiddenPreview.sourceLines[0].recipeSignature })),
    });
    assert.equal(sourceResponse.status, 201);
    const sourceDocument = await sourceResponse.json();
    assert.equal(sourceDocument.sourceLines[0].name, 'Atomic save item');
    assert.equal(sourceDocument.sourceTotal, 7);
    assert.equal((await request(ownerToken, `/admin/warehouse/documents/${sourceDocument.id}/reverse`, 'POST', {
      revision: sourceDocument.revision, note: 'HTTP snapshot reversal',
    })).status, 201);
    assert.equal(Number((await db.ingredient.findUniqueOrThrow({ where: { id: atomicIngredient.id } })).stock), 2);

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
    const producePath = `/admin/warehouse/preparation/${output.id}/batches`;
    const produceBody = { quantity: 1, unit: 'pcs', warehouseId: main.id, requestKey: randomUUID(), batchNumber: 'CHEF-HTTP' };
    assert.equal((await request(stationOnlyChefToken, producePath, 'POST', produceBody)).status, 403);
    const produceResponse = await request(chefToken, producePath, 'POST', produceBody);
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
    assert.equal((await request(readerToken, '/admin/warehouse/preparation/batches')).status, 200, 'reading production does not require posting permission');
    assert.equal((await request(outsiderToken, '/admin/warehouse/preparation/batches')).status, 403);

    await checkReadonlyWarehouse({ db, request, actor: reportReader, token: reportReaderToken, ingredient });
    await checkPurchaseExport({ db, request, ownerToken, actor: reportReader, actorToken: reportReaderToken, outsiderToken });
  } finally {
    await db.stockMovement.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.preparationBatch.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.warehouseDocument.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.preparationRecipe.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.purchase.deleteMany({ where: { cafeId: cafe.id } });
    await db.ingredient.deleteMany({ where: { cafeId: { in: [cafe.id, foreign.id] } } });
    await db.settings.deleteMany({ where: { cafeId: cafe.id } });
    await db.user.deleteMany({ where: { cafeId: cafe.id } });
    await db.cafe.delete({ where: { id: cafe.id } });
    await db.cafe.delete({ where: { id: foreign.id } });
    await db.$disconnect();
  }
});

async function checkPurchaseExport({ db, request, ownerToken, actor, actorToken, outsiderToken }) {
  const base = '/admin/warehouse/purchases';
  const exportPath = `${base}/export.xlsx`;
  // Switch one test user's grants to exercise each guard without consuming
  // more distinct logins from the local application's shared rate limiter.
  const setPermission = (excluded) => db.user.update({ where: { id: actor.id }, data: {
    permissions: { sections: { warehouse: excluded !== 'section' }, actions: {
      warehouseReceive: excluded !== 'receive', warehouseCosts: excluded !== 'costs', exportReports: excluded !== 'export',
    } },
  } });
  for (const excluded of ['export', 'receive', 'costs', 'section']) {
    await setPermission(excluded);
    assert.equal((await request(actorToken, exportPath)).status, excluded === 'receive' ? 200 : 403);
    assert.equal((await request(actorToken, base)).status, ['export', 'receive'].includes(excluded) ? 200 : 403);
  }
  assert.equal((await request(outsiderToken, exportPath)).status, 403);
  await setPermission();

  const ingredientResponse = await request(ownerToken, '/admin/warehouse/ingredients', 'POST', {
    name: 'Фильтр XLSX', unit: 'kg', category: 'Сырьё, сыпучее',
  });
  assert.equal(ingredientResponse.status, 201);
  const product = await ingredientResponse.json();
  const supplier = 'ООО Поставка, первая';
  const created = await request(ownerToken, base, 'POST', {
    supplier, date: '2026-11-14T18:00:00.000Z',
    items: [{ ingredientId: product.id, quantity: 1.25, unit: 'kg', purchasePrice: 20 }],
  });
  assert.equal(created.status, 201);
  const purchase = await created.json();
  const query = new URLSearchParams([
    ['suppliers', 'Не выбран'], ['suppliers', supplier], ['categories', 'Сырьё, сыпучее'], ['categories', 'Другая'],
    ['from', '2026-11-15'], ['to', '2026-11-15'], ['status', 'draft'], ['dateSort', 'asc'], ['search', 'Фильтр XLSX'],
  ]);
  const list = await request(actorToken, `${base}?${query}`);
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).map(({ id }) => id), [purchase.id]);
  query.set('columns', 'number,supplier,totalAmount');
  for (const token of [actorToken, ownerToken]) {
    const response = await request(token, `${exportPath}?${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="warehouse-purchases.xlsx"');
    const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['Поставки'], { header: 1 }), [
      ['№', 'Поставщик', 'Сумма'], [`ЗКП-${String(purchase.number).padStart(6, '0')}`, supplier, 25],
    ]);
    assert.equal(workbook.Sheets['Позиции'].H2.t, 'n');
  }
  for (const invalid of ['columns=number,unexpected', 'columns=number,number', 'columns=', 'from=2026-02-30', 'dateSort=random', 'status=deleted', 'suppliers=', 'categories=']) {
    assert.equal((await request(ownerToken, `${exportPath}?${invalid}`)).status, 400, invalid);
  }
}

async function checkReadonlyWarehouse({ db, request, actor, token, ingredient }) {
  const permissions = { sections: { warehouse: true }, readOnlySections: ['warehouse'], actions: {
    warehouseCosts: true, warehouseReports: true, warehouseReceive: true, warehouseSettings: true,
    warehouseCount: true, warehouseWriteoff: true, warehouseProduce: true, warehouseApprove: true,
  } };
  await db.user.update({ where: { id: actor.id }, data: { permissions } });
  for (const path of ['purchases', 'purchases/overview', `purchases/last-prices?ingredientIds=${ingredient.id}`, 'documents', 'documents/writeoff-options',
    'preparation/batches', 'processing', 'suppliers', 'packages', 'locations']) {
    assert.equal((await request(token, `/admin/warehouse/${path}`)).status, 200, `read-only warehouse can read ${path}`);
  }
  const draft = await db.warehouseDocument.findFirstOrThrow({ where: { cafeId: actor.cafeId } });
  assert.equal((await request(token, `/admin/warehouse/documents/${draft.id}`)).status, 200);
  for (const [path, method] of [
    ['purchases', 'POST'], ['documents', 'POST'], ['processing', 'POST'], ['suppliers', 'POST'],
    ['packages', 'POST'], ['locations', 'POST'], [`ingredients/${ingredient.id}`, 'PATCH'],
    [`documents/${draft.id}/reverse`, 'POST'],
  ]) {
    assert.equal((await request(token, `/admin/warehouse/${path}`, method, {})).status, 403,
      `read-only warehouse cannot ${method} ${path}, even with a stale explicit action grant`);
  }
  await db.user.update({ where: { id: actor.id }, data: {
    permissions: { ...permissions, actions: { ...permissions.actions, warehouseCosts: false } },
  } });
  assert.equal((await request(token, '/admin/warehouse/purchases')).status, 403, 'view-only does not grant cost access');
  const stock = await (await request(token, '/admin/warehouse/ingredients')).json();
  assert.equal(stock.find((row) => row.id === ingredient.id).avgCost, null);
}
