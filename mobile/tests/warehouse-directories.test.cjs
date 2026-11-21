const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function services(file = 'warehouse') {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'api', `${file}.ts`), 'utf8');
  const program = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const calls = [];
  const cache = [];
  const record = (method) => async (url, body) => {
    calls.push([method, url, body === undefined ? undefined : JSON.parse(JSON.stringify(body))]);
    return { data: { id: 'row' } };
  };
  vm.runInNewContext(program, {
    exports, URLSearchParams,
    require(name) {
      if (name === '@/lib/api') return { api: {
        get: record('GET'), patch: record('PATCH'), post: record('POST'), delete: record('DELETE'),
      } };
      if (name === '@tanstack/react-query') return {
        useQuery: (options) => options,
        useMutation: (options) => options,
        useQueryClient: () => ({
          setQueryData: (key, item) => cache.push(['update', [...key], item]),
          invalidateQueries: ({ queryKey }) => cache.push(['invalidate', [...queryKey]]),
        }),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { exports, calls, cache };
}

test('supplier directory lists archived records on request and preserves clearing contact fields', async () => {
  const { exports, calls, cache } = services();
  assert.equal(exports.useWarehouseSuppliers(false).enabled, false);
  await exports.useWarehouseSuppliers().queryFn();
  await exports.useWarehouseSuppliers(true, true).queryFn();
  const { save, archive } = exports.useWarehouseSupplierMutations();
  await save.mutationFn({ name: 'Поставщик', phone: '+996555000000', email: null });
  await save.mutationFn({ id: 'supplier/1', name: 'Поставщик', phone: null, note: null });
  await archive.mutationFn('supplier/1');
  await save.mutationFn({ id: 'supplier/1', name: 'Поставщик', isActive: true });
  save.onSuccess();
  archive.onSuccess();

  assert.deepEqual(calls, [
    ['GET', '/admin/warehouse/suppliers', undefined],
    ['GET', '/admin/warehouse/suppliers?includeInactive=true', undefined],
    ['POST', '/admin/warehouse/suppliers', { name: 'Поставщик', phone: '+996555000000', email: null }],
    ['PATCH', '/admin/warehouse/suppliers/supplier%2F1', { name: 'Поставщик', phone: null, note: null }],
    ['DELETE', '/admin/warehouse/suppliers/supplier%2F1', undefined],
    ['PATCH', '/admin/warehouse/suppliers/supplier%2F1', { name: 'Поставщик', isActive: true }],
  ]);
  assert.deepEqual(cache, [['invalidate', ['admin', 'warehouse']], ['invalidate', ['admin', 'warehouse']]]);
});

test('packaging queries separate active lists from archived mass variants; writes preserve unit and amount', async () => {
  const { exports, calls } = services();
  const active = exports.useWarehousePackages(true);
  const archive = exports.useWarehousePackages(true, { includeInactive: true, unitType: 'mass' });
  assert.equal(exports.useWarehousePackages(false).enabled, false);
  assert.notDeepEqual([...active.queryKey], [...archive.queryKey]);
  await active.queryFn();
  await archive.queryFn();
  const { save, archive: remove } = exports.useWarehousePackageMutations();
  const pack = { name: 'Пакет', unit: 'kg', quantity: 0.0125 };
  await save.mutationFn(pack);
  await remove.mutationFn('box/1');
  await save.mutationFn({ id: 'box/1', ...pack, isActive: true });

  assert.deepEqual(calls, [
    ['GET', '/admin/warehouse/packages', undefined],
    ['GET', '/admin/warehouse/packages?includeInactive=true&unitType=mass', undefined],
    ['POST', '/admin/warehouse/packages', pack],
    ['DELETE', '/admin/warehouse/packages/box%2F1', undefined],
    ['PATCH', '/admin/warehouse/packages/box%2F1', { ...pack, isActive: true }],
  ]);
});

test('policy and location requests can be disabled and policy writes retain explicit false', async () => {
  const { exports, calls, cache } = services();
  assert.equal(exports.useWarehouseLocations(false).enabled, false);
  assert.equal(exports.useWarehousePolicy(false).enabled, false);
  await exports.useWarehousePolicy().queryFn();
  await exports.useWarehouseLocations().queryFn();
  const update = exports.useUpdateWarehousePolicy();
  await update.mutationFn({ allowNegativeIngredientStock: false, warehouseProcessingEnabled: true });
  const policy = { warehouseProcessingEnabled: true, processingInUse: false, allowNegativeIngredientStock: false };
  update.onSuccess(policy);

  assert.deepEqual(calls, [
    ['GET', '/admin/warehouse/policy', undefined],
    ['GET', '/admin/warehouse/locations', undefined],
    ['PATCH', '/admin/warehouse/policy', { allowNegativeIngredientStock: false, warehouseProcessingEnabled: true }],
  ]);
  assert.deepEqual(cache, [['update', ['admin', 'warehouse', 'policy'], policy], ['invalidate', ['admin', 'warehouse']]]);
});
