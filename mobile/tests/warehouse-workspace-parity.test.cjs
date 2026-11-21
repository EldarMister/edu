const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadSource(file, dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URLSearchParams,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error('Unexpected dependency ' + name);
    },
  });
  return module.exports;
}

const { menuNavigation, warehouseNavigation } = loadSource('navigation/adminWorkspaceNavigation.ts');
const { balanceValue, balanceQuantity } = loadSource('utils/warehouseBalance.ts');
const ids = (entries) => Array.from(entries, ({ key }) => key);

test('warehouse navigation follows PWA order while hiding inactive operations and restricted costs', () => {
  const visible = warehouseNavigation(() => true, 2, {
    warehouseProductionEnabled: false, warehouseProcessingEnabled: true, productionInUse: true, processingInUse: false,
  });
  assert.deepEqual(ids(visible), [
    'balances', 'supplies', 'processing', 'transfers', 'writeoffs', 'movement',
    'inventory', 'suppliers', 'locations', 'packages', 'production',
  ]);
  assert.deepEqual(ids(warehouseNavigation((permission) => !['warehouseCosts', 'warehouseSettings'].includes(permission), 1)),
    ['balances', 'writeoffs', 'inventory']);
  assert.deepEqual(ids(menuNavigation(false)), ['goods', 'recipes', 'categories', 'stations']);
  assert.deepEqual(ids(menuNavigation(true)), ['goods', 'recipes', 'preparations', 'ingredients', 'categories', 'ingredientCategories', 'stations']);
});

test('balance valuation uses unrounded base cost and preserves unknown versus zero', () => {
  assert.equal(balanceValue({ stock: 23.74, stockBase: 23740, avgCostBase: 0.050505476 }), 1199);
  assert.equal(balanceValue({ stock: 0, stockBase: 0, avgCostBase: null }), 0);
  assert.equal(balanceValue({ stock: 5, stockBase: 5, avgCostBase: null }), null);
  assert.equal(balanceQuantity(2, 'шт', 'count'), '2,00 шт');
  assert.equal(balanceQuantity(2, 'кг', 'mass'), '2,000 кг');
});

test('movement and supply Excel exports carry the same filters as the lists', () => {
  const urls = [];
  const { useWarehouseReport, usePurchases, movementWorkbookUrl, purchaseWorkbookUrl } = loadSource('services/api/warehouse.ts', {
    '@tanstack/react-query': { useQuery: (query) => query.queryFn() },
    '@/lib/api': { api: { get: (url) => { urls.push(url); return Promise.resolve({ data: [] }); } } },
  });
  const movement = { view: 'movement_summary', warehouseId: 'default', warehouseIds: ['bar', 'kitchen', 'bar'],
    kinds: ['goods', 'beverage'], categories: ['Чай и кофе', 'Бар'], from: '2026-11-11', onlyWithMovement: true };
  const supplies = { suppliers: ['Поставщик №1', 'Поставщик №2'], warehouseId: 'bar', dateSort: 'asc' };
  useWarehouseReport(movement);
  usePurchases(supplies);
  const query = (url) => new URLSearchParams(url.split('?')[1]);
  assert.equal(query(urls[0]).get('warehouseId'), null);
  assert.equal(query(urls[0]).get('warehouseIds'), 'bar,kitchen');
  assert.deepEqual(query(urls[0]).getAll('kinds'), ['goods', 'beverage']);
  for (const [index, exported] of [
    movementWorkbookUrl(movement, ['name', 'closingValue']),
    purchaseWorkbookUrl(supplies, ['number', 'date']),
  ].entries()) {
    const exportQuery = query(exported);
    assert.ok(exportQuery.get('columns'));
    exportQuery.delete('columns');
    assert.deepEqual([...exportQuery], [...query(urls[index])]);
  }
});

test('movement CSV downloads the server export with the journal filters and preserves its bytes for sharing', async () => {
  const response = '\ufeff"Дата";"Товар"\r\n"2026-11-15";"\'=SUM(1;2)"';
  const requests = [];
  const { getMovementCsv } = loadSource('services/api/warehouse.ts', {
    '@tanstack/react-query': {},
    '@/lib/api': { api: { get: async (url, config) => { requests.push({ url, config }); return { data: response }; } } },
  });
  const signal = new AbortController().signal;
  const csv = await getMovementCsv({
    view: 'movements', ingredientId: 'item', warehouseId: 'default', warehouseIds: ['bar', 'kitchen', 'bar'],
    from: '2026-11-11', to: '2026-11-15', employeeId: 'staff', type: 'writeoff', page: 3, pageSize: 100,
  }, signal);
  const [request] = requests;
  const [pathname, query] = request.url.split('?');
  assert.equal(pathname, '/admin/warehouse/reports/export.csv');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(query)), {
    view: 'movements', ingredientId: 'item', warehouseIds: 'bar,kitchen',
    from: '2026-11-11', to: '2026-11-15', employeeId: 'staff', type: 'writeoff', page: '3', pageSize: '100',
  });
  assert.equal(request.config.responseType, 'text');
  assert.equal(request.config.signal, signal);

  const written = [];
  const shared = [];
  const { shareCsvText } = loadSource('screens/admin/print.ts', {
    'expo-print': {},
    'expo-file-system': {
      cacheDirectory: 'file:///cache/', EncodingType: { UTF8: 'utf8' },
      writeAsStringAsync: async (uri, content) => written.push({ uri, content }),
    },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri) => shared.push(uri) },
    qrcode: {},
    '@/lib/i18n': {}, '@/lib/receipt': {},
    '@/utils/format': {},
    './nativePrintLifecycle': {},
  });
  await shareCsvText('Склад-movements-2026-11-11', csv, signal);
  await shareCsvText('Склад-movements-всё-время', csv.slice(1), signal);
  assert.deepEqual(written.map(({ content }) => content), [response, response]);
  assert.deepEqual(shared, ['file:///cache/Склад-movements-2026-11-11.csv', 'file:///cache/Склад-movements-всё-время.csv']);
});

test('movement print shows only the current page with report totals and escaped document fields', async () => {
  let print;
  const { printWarehouseMovement } = loadSource('screens/admin/warehouseMovementPrint.ts', {
    'expo-print': { Orientation: { landscape: 'landscape' }, printAsync: async (options) => { print = options; } },
    '@/utils/warehouseBalance': loadSource('utils/warehouseBalance.ts'),
    '@/utils/warehouseTiming': loadSource('utils/warehouseTiming.ts'),
    './nativePrintLifecycle': { waitForNativePrintReturn: (perform) => perform() },
  });
  await printWarehouseMovement({
    totalRows: 130, page: 2, pageSize: 100, totalCost: 300, totalValuationAdjustment: 70,
    rows: [{ ingredientName: 'Суп <сыр>', warehouseName: 'Бар & кухня', quantity: -1.25, unit: 'кг',
      totalCost: null, unitCost: null, valuationAdjustment: 10, documentLabel: '<img src=x>',
      employeeName: '"Маша"', createdAt: '2026-11-14T22:12:00Z' }],
  }, { ingredientName: 'Суп <сыр>', warehouseLabel: 'Склады: Бар & кухня' });
  assert.equal(print.orientation, 'landscape');
  assert.match(print.html, /130 строк .*Итого: 300,00 с · корректировка оценки 70,00 с/);
  const [, tableBody] = print.html.match(/<tbody>([^]*?)<\/tbody>/);
  assert.equal([...tableBody.matchAll(/<tr>/g)].length, 1);
  assert.match(tableBody, /15\.11\.2026, 04:12/);
  assert.match(tableBody, /-1,250 кг/);
  assert.match(tableBody, /Неизвестно/);
  assert.match(tableBody, /&lt;img src=x&gt;<small>&quot;Маша&quot;<\/small>/);
  assert.doesNotMatch(print.html, /<img src=x>|Экспорт CSV|<script/);
});
