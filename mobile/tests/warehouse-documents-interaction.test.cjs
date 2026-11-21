const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(canApprove = true) {
  const slots = []; let cursor = 0; let saveBody; let saved; let transitionCount = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: factory => factory(), useEffect() {},
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/screens/admin/WarehouseDocumentsTab.tsx'), 'utf8').replace('function DocumentForm(', 'export function DocumentForm(');
  const module = { exports: {} };
  function pure(file) {
    const result = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: result, exports: result.exports });
    return result.exports;
  }
  const primitives = new Proxy({}, { get: (_value, name) => name });
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, require(name) {
      if (name === 'react') return react;
      if (name === 'react-native') return { StyleSheet: { create: value => value } };
      if (name === '@/components/themed' || name === '@/components/ui') return primitives;
      if (name === '@/components/typography') return { Text: 'Text', Alert: { alert(_title, _text, actions) { actions.at(-1)?.onPress?.(); } } };
      if (name === '@/hooks/usePermissions') return { usePermissions: () => ({ canAction: key => key === 'warehouseApprove' ? canApprove : true }) };
      if (name === '@/lib/api') return { apiError: error => String(error) };
      if (name === '@/lib/i18n') return { useT: () => value => value };
      if (name === '@/services/api/stockDocuments') return { useStockDocumentMutations: () => ({
        save: { isPending: false, mutateAsync: async body => { saveBody = JSON.parse(JSON.stringify(body)); return { ...saved, revision: saved.revision + 1, status: body.finalize === 'post' ? 'posted' : body.finalize === 'submit' ? 'submitted' : 'draft', items: saved.items.map(row => ({ ...row, quantity: body.items.find(item => item.ingredientId === row.ingredientId).quantity })) }; } },
        transition: { isPending: false, mutateAsync: async ({ action }) => {
          transitionCount++;
          return action === 'reopen' && saved.status === 'posted'
            ? { ...saved, status: 'draft', reopenedAt: '2026-11-03T10:00:00Z', revision: saved.revision + 1 }
            : saved;
        } },
      }) };
      if (name === '@/services/api/warehouse') return { useIngredients: () => ({ data: [] }), qty: (value, unit) => `${value} ${unit}` };
      if (name === '@/theme') return { colors: {}, spacing: {}, fontSize: {} };
      if (name === '@/utils/format') return { money: String };
      if (name === '@/utils/warehouseDocumentForm') return pure('warehouseDocumentForm.ts');
      if (name === '@/utils/warehouseTiming') return pure('warehouseTiming.ts');
      if (name === './WarehouseWriteoffLines') return { WarehouseWriteoffLines: 'WarehouseWriteoffLines', useWarehouseWriteoffLines: () => ({ ready: true, dirty: false, adopt() {}, input: () => [] }) };
      return primitives;
    },
  });
  const render = (document) => { cursor = 0; saved = document; return module.exports.DocumentForm({ incoming: document, warehouseName: 'Основной', onClose() {} }); };
  function flatten(tree, result = []) {
    if (!tree || typeof tree !== 'object') return result;
    if (Array.isArray(tree)) { tree.forEach(value => flatten(value, result)); return result; }
    result.push(tree);
    flatten(tree.props?.children, result); flatten(tree.props?.footer, result); flatten(tree.props?.ListHeaderComponent, result);
    if (tree.props?.renderItem) tree.props.data.forEach(item => flatten(tree.props.renderItem({ item }), result));
    return result;
  }
  return { render, flatten, get body() { return saveBody; }, get transitionCount() { return transitionCount; } };
}

const doc = () => ({ id: 'inventory', warehouseId: 'warehouse', kind: 'inventory', mode: 'partial', reason: null, note: null, status: 'draft', revision: 7,
  createdAt: '2026-11-01T10:00:00Z', submittedAt: null, postedAt: null, countedAt: null, effectiveAt: null, varianceValue: null,
  items: [{ ingredientId: 'rice', name: 'Рис', unit: 'кг', expected: 5, quantity: 2, difference: -3, value: null }, { ingredientId: 'oil', name: 'Масло', unit: 'л', expected: 1, quantity: null, difference: null, value: null }] });
const wait = () => new Promise(resolve => setImmediate(resolve));
const fields = (h, tree) => h.flatten(tree).filter(node => node.type === 'Field' && node.props.label?.startsWith('Фактический остаток'));
const button = (h, tree, title) => h.flatten(tree).find(node => node.type === 'Button' && node.props.title === title);

test('native partial draft sends zero and selected null without silently dropping a position', async () => {
  const h = harness(); const document = doc(); let tree = h.render(document);
  fields(h, tree)[0].props.onChangeText('0'); tree = h.render(document);
  assert.equal(button(h, tree, 'Провести').props.disabled, true);
  button(h, tree, 'Сохранить черновик').props.onPress(); await wait();
  assert.deepEqual(h.body.items, [{ ingredientId: 'rice', quantity: 0 }, { ingredientId: 'oil', quantity: null }]);
  assert.equal(h.body.revision, 7); assert.equal(h.body.finalize, undefined); assert.equal(h.transitionCount, 0);
});

test('native finalize sends the current revision and all counts atomically', async () => {
  const h = harness(); const document = doc(); let tree = h.render(document);
  fields(h, tree)[1].props.onChangeText('0'); tree = h.render(document);
  assert.equal(button(h, tree, 'Провести').props.disabled, false);
  button(h, tree, 'Провести').props.onPress(); await wait();
  assert.equal(h.body.finalize, 'post'); assert.equal(h.body.revision, 7);
  assert.deepEqual(h.body.items, [{ ingredientId: 'rice', quantity: 2 }, { ingredientId: 'oil', quantity: 0 }]);
  assert.equal(h.transitionCount, 0);
});

test('filtering uncounted products leaves hidden counts intact when saving the draft', async () => {
  const h = harness(); const document = doc(); let tree = h.render(document);
  h.flatten(tree).find(node => node.type === 'Select' && node.props.title === 'Позиции инвентаризации').props.onChange('uncounted');
  tree = h.render(document);
  assert.equal(fields(h, tree).length, 1);
  fields(h, tree)[0].props.onFocus();
  fields(h, tree)[0].props.onChangeText('0');
  tree = h.render(document);
  assert.equal(fields(h, tree).length, 1);
  fields(h, tree)[0].props.onBlur();
  tree = h.render(document);
  assert.equal(fields(h, tree).length, 0);
  button(h, tree, 'Сохранить черновик').props.onPress(); await wait();
  assert.deepEqual(h.body.items, [{ ingredientId: 'rice', quantity: 2 }, { ingredientId: 'oil', quantity: 0 }]);
});

test('staff without approval submits instead of posting', async () => {
  const h = harness(false); const document = doc(); let tree = h.render(document);
  fields(h, tree)[1].props.onChangeText('1'); tree = h.render(document);
  button(h, tree, 'На утверждение').props.onPress(); await wait();
  assert.equal(h.body.finalize, 'submit'); assert.equal(h.transitionCount, 0);
});

test('posted inventory opens at the original date and corrects only the saved positions', async () => {
  const h = harness();
  const document = { ...doc(), status: 'posted', postedAt: '2026-11-02T10:00:00Z', countedAt: '2026-11-01T10:25:00Z' };
  document.items[1].quantity = 1;
  let tree = h.render(document);
  button(h, tree, 'Открыть период и редактировать').props.onPress();
  await wait();
  tree = h.render(document);
  assert.equal(h.transitionCount, 1);
  assert.ok(!h.flatten(tree).some(node => node.type === 'WarehouseTimingField'
    || node.type === 'Select' && node.props.title === 'Добавить продукт'));
  fields(h, tree)[0].props.onChangeText('0');
  tree = h.render(document);
  button(h, tree, 'Провести повторно').props.onPress();
  await wait();
  assert.equal(h.body.revision, 8);
  assert.equal(h.body.finalize, 'post');
  assert.equal(h.body.countedAt, undefined);
  assert.equal(h.body.recount, undefined);
  assert.deepEqual(h.body.items, [{ ingredientId: 'rice', quantity: 0 }, { ingredientId: 'oil', quantity: 1 }]);
});

test('concurrent revision preserves typed values and blocks a stale save', () => {
  const h = harness(); const document = doc(); let tree = h.render(document);
  fields(h, tree)[0].props.onChangeText('9'); tree = h.render({ ...document, revision: 8 });
  assert.equal(fields(h, tree)[0].props.value, '9');
  assert.equal(button(h, tree, 'Сохранить черновик').props.disabled, true);
});

test('historical count date must be applied before posting and retains actual counts', async () => {
  const h = harness(); const document = doc(); let tree = h.render(document);
  fields(h, tree)[1].props.onChangeText('0');
  h.flatten(tree).find(node => node.type === 'WarehouseTimingField').props.onChange({ mode: 'past', date: '2026-11-01', time: '10:25' });
  tree = h.render(document);
  assert.equal(button(h, tree, 'Провести').props.disabled, true);
  assert.equal(button(h, tree, 'Применить дату и остатки').props.disabled, false);
  button(h, tree, 'Применить дату и остатки').props.onPress(); await wait();
  assert.equal(h.body.countedAt, '2026-11-01T04:25:00.000Z');
  assert.equal(h.body.finalize, undefined);
  assert.deepEqual(h.body.items, [{ ingredientId: 'rice', quantity: 2 }, { ingredientId: 'oil', quantity: 0 }]);
});

test('an older inventory-context response cannot roll back our saved revision', async () => {
  const h = harness(); const document = doc(); let tree = h.render(document);
  fields(h, tree)[0].props.onChangeText('4'); tree = h.render(document);
  button(h, tree, 'Сохранить черновик').props.onPress(); await wait();
  tree = h.render(document);
  fields(h, tree)[0].props.onChangeText('5'); tree = h.render(document);
  assert.equal(button(h, tree, 'Сохранить черновик').props.disabled, false);
  button(h, tree, 'Сохранить черновик').props.onPress(); await wait();
  assert.equal(h.body.revision, 8);
});
