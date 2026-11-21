const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules = {}) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URLSearchParams,
    require(name) {
      if (!(name in modules)) throw new Error(`Unexpected import: ${name}`);
      return modules[name];
    },
  });
  return module.exports;
}

function services(file) {
  const calls = [];
  const invalidations = [];
  const record = method => async (url, data) => {
    const payload = data === undefined ? undefined : JSON.parse(JSON.stringify(data));
    calls.push({ method, url, payload });
    return { data: { id: 'document', kind: 'inventory', status: 'posted' } };
  };
  const exported = load(`src/services/api/${file}.ts`, {
    '@/lib/api': { api: { get: record('GET'), patch: record('PATCH'), post: record('POST') } },
    '@tanstack/react-query': {
      useQuery: options => options,
      useMutation: options => options,
      useQueryClient: () => ({
        setQueryData() {},
        invalidateQueries: ({ queryKey }) => invalidations.push([...queryKey]),
      }),
    },
  });
  return { exported, calls, invalidations };
}

test('purchase PATCH keeps revision, gross price and saved package identity in one final request', async () => {
  const { exported, calls } = services('warehouse');
  const { update } = exported.usePurchaseMutations();
  const patch = {
    id: 'purchase/123', expectedUpdatedAt: '2026-11-15T10:22:00.000Z',
    effectiveAt: '2026-11-14T13:00:00+06:00', complete: true, discount: 10.5,
    correctionReason: 'Исправление накладной',
    items: [{ ingredientId: 'coffee', purchaseItemId: 'saved-line', packageId: 'archived-box', quantity: 2, total: 123.45 }],
  };
  await update.mutationFn(patch);
  const { id, ...body } = patch;
  assert.deepEqual(calls, [{ method: 'PATCH', url: '/admin/warehouse/purchases/purchase%2F123', payload: body }]);
});

test('document endpoints retain empty and zero counts, opt-in history and reversal reason', async () => {
  const { exported, calls, invalidations } = services('stockDocuments');
  const defaultDetail = exported.useStockDocument('inv/1');
  const inventoryContext = exported.useStockDocument('inv/1', true);
  assert.notEqual(defaultDetail.queryKey.length, inventoryContext.queryKey.length);
  await defaultDetail.queryFn();
  await inventoryContext.queryFn();
  const counts = [{ ingredientId: 'uncounted', quantity: null }, { ingredientId: 'counted', quantity: 0 }];
  const { save, transition } = exported.useStockDocumentMutations();
  await save.mutationFn({ id: 'inv/1', revision: 4, items: counts, countedAt: '2026-11-13T10:30:00+06:00' });
  const reversed = await transition.mutationFn({ id: 'inv/1', revision: 6, action: 'reverse', note: 'Ошибка пересчёта' });
  transition.onSuccess({ ...reversed, id: 'inv/1', status: 'reversed' });
  assert.deepEqual(calls, [
    { method: 'GET', url: '/admin/warehouse/documents/inv%2F1', payload: undefined },
    { method: 'GET', url: '/admin/warehouse/documents/inv%2F1', payload: { params: { includeInventoryContext: 'true' } } },
    { method: 'PATCH', url: '/admin/warehouse/documents/inv%2F1', payload: {
      revision: 4, items: counts, countedAt: '2026-11-13T10:30:00+06:00',
    } },
    { method: 'POST', url: '/admin/warehouse/documents/inv%2F1/reverse', payload: { revision: 6, note: 'Ошибка пересчёта' } },
  ]);
  assert.ok(invalidations.some(key => key.at(-1) === 'inventory-context' && key.at(-2) === 'inv/1'));
  assert.ok(invalidations.some(key => key.join('/') === 'admin/warehouse'));
});

test('packaged writeoff preview sends document identity, signed source and preserved package snapshot', async () => {
  const { exported, calls } = services('stockDocuments');
  const sourceLines = [{ sourceId: 'coffee', kind: 'ingredient', sourceLineId: 'new', quantity: 2,
    packageId: 'archived', packageSnapshotLineId: 'saved', recipeSignature: 'expected-signature' }];
  const preview = exported.useWriteoffPreview('stock', sourceLines, true, 1, 'draft/1');
  assert.equal(preview.enabled, true);
  await preview.queryFn();
  assert.deepEqual(calls, [{
    method: 'POST', url: '/admin/warehouse/documents/writeoff-preview',
    payload: { warehouseId: 'stock', sourceLines, documentId: 'draft/1' },
  }]);
});

test('quick transfer posts one dated document with a stable key and quantity in the item unit', async () => {
  const { exported, calls } = services('stockDocuments');
  const { stockTransferInput } = load('src/screens/admin/WarehouseTransferForm.tsx', {
    react: {},
    'react-native': { StyleSheet: { create: (styles) => styles } },
    'expo-crypto': {},
    '@/components/themed': {},
    '@/components/FastPressable': {},
    '@/components/Select': {},
    '@/components/typography': {},
    '@/components/ui': {},
    '@/lib/api': {},
    '@/hooks/usePermissions': {},
    '@/services/api/stockDocuments': exported,
    '@/services/api/warehouse': {},
    '@/services/api/warehouseUnits': load('src/services/api/warehouseUnits.ts'),
    '@/theme': { colors: {}, fontSize: {}, spacing: {} },
    '@/utils/warehouseDocumentForm': load('src/utils/warehouseDocumentForm.ts'),
    '@/utils/warehouseTiming': load('src/utils/warehouseTiming.ts'),
    '@/utils/warehouseTransferForm': {},
    '@/utils/format': {},
    './WarehouseTimingField': {},
    './WarehouseWorkspace': {},
  });
  const fields = {
    warehouseId: 'main', destinationWarehouseId: 'bar', ingredientId: 'coffee', displayUnit: 'kg', unit: 'g',
    quantity: '500,5', requestKey: 'one-transfer', note: '  Для бара  ',
    timing: { mode: 'past', date: '2020-11-13', time: '10:30' },
  };
  const document = stockTransferInput(fields);
  assert.equal(document.requestKey, stockTransferInput(fields).requestKey);
  await exported.useStockDocumentMutations().create.mutationFn(document);
  assert.deepEqual(calls, [{ method: 'POST', url: '/admin/warehouse/documents', payload: {
    kind: 'transfer', finalize: 'post', warehouseId: 'main', destinationWarehouseId: 'bar', requestKey: 'one-transfer',
    effectiveAt: '2020-11-13T04:30:00.000Z', note: 'Для бара',
    items: [{ ingredientId: 'coffee', quantity: 0.5005 }],
  } }]);
  assert.equal(stockTransferInput({ ...fields, timing: { ...fields.timing, mode: 'current' } }).effectiveAt, null);
  assert.equal(stockTransferInput({ ...fields, warehouseId: '' }), null);
  assert.equal(stockTransferInput({ ...fields, destinationWarehouseId: 'main' }), null);
  assert.equal(stockTransferInput({ ...fields, unit: 'ml' }), null);
  assert.equal(stockTransferInput({ ...fields, quantity: '0,0001' }), null);
  assert.equal(stockTransferInput({ ...fields, timing: { mode: 'past', date: '2099-01-01', time: '00:00' } }), null);
});

test('reports use bounded page fields and repeated filters; purchase lists keep operation date sorting', async () => {
  const { exported, calls } = services('warehouse');
  await exported.useWarehouseReport({
    view: 'movement_summary', warehouseIds: ['main', 'bar', 'bar'], warehouseId: 'ignored',
    from: '2026-11-12', to: '2026-11-15', categories: ['Напитки, столовые', 'Кофе'], kinds: ['goods', 'raw'],
    page: 2, pageSize: 50, onlyWithMovement: false,
  }).queryFn();
  await exported.usePurchases({ suppliers: ['Поставщик, ИП'], from: '2026-11-14T00:00:00+06:00' }).queryFn();
  const report = new URL(calls[0].url, 'https://test.local');
  assert.equal(report.pathname, '/admin/warehouse/reports');
  assert.equal(report.searchParams.get('warehouseIds'), 'main,bar');
  assert.equal(report.searchParams.has('warehouseId'), false);
  assert.deepEqual(report.searchParams.getAll('categories'), ['Напитки, столовые', 'Кофе']);
  assert.deepEqual(report.searchParams.getAll('kinds'), ['goods', 'raw']);
  assert.equal(report.searchParams.get('onlyWithMovement'), 'false');
  assert.equal(report.searchParams.get('page'), '2');
  const purchases = new URL(calls[1].url, 'https://test.local');
  assert.equal(purchases.searchParams.get('dateSort'), 'desc');
  assert.equal(purchases.searchParams.get('from'), '2026-11-14T00:00:00+06:00');
  assert.equal(purchases.searchParams.get('suppliers'), 'Поставщик, ИП');
  assert.equal(purchases.searchParams.has('page'), false);
});

test('warehouse permissions mirror the services and preserve explicit denies from older sessions', () => {
  const { resolvePermissions, hasPermission } = load('src/lib/permissions.ts');
  const admin = resolvePermissions('ADMIN', { actions: { warehouseCosts: false, warehouseApprove: true } });
  assert.equal(hasPermission(admin, 'sections.warehouse'), true);
  assert.equal(hasPermission(admin, 'actions.warehouseReceive'), true);
  assert.equal(hasPermission(admin, 'actions.warehouseReports'), true);
  assert.equal(hasPermission(admin, 'actions.warehouseCosts'), false);
  assert.equal(hasPermission(admin, 'actions.warehouseApprove'), true);
  assert.equal(hasPermission(admin, 'actions.warehouseSettings'), false);
  assert.equal(resolvePermissions('ADMIN', null).actions.warehouseApprove, false);
  assert.equal(resolvePermissions('KITCHEN', null).actions.warehouseWriteoff, false);
  assert.equal(resolvePermissions('OWNER', { actions: { warehouseReceive: false } }).actions.warehouseReceive, true);
});
