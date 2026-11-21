const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/utils/anchoredSelect.ts'), 'utf8');
const loaded = { exports: {} };
new Function('module', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(loaded, loaded.exports);
const { anchoredSelectPosition: position, selectSearchMatches } = loaded.exports;
const insets = { top: 0, bottom: 0, left: 0, right: 0 };

test('warehouse selector stays attached below its trigger and inside screen edges', () => {
  const location = position({ x: 274, y: 116, width: 92, height: 36 }, { width: 411, height: 860 },
    { width: 260, height: 192 }, insets);
  assert.deepEqual(location, { left: 143, top: 158, width: 260, height: 192 });
});

test('warehouse selector flips upwards in the keyboard’s remaining viewport', () => {
  const location = position({ x: 12, y: 385, width: 320, height: 36 }, { width: 411, height: 435 },
    { width: 160, height: 210 }, { ...insets, top: 16 });
  assert.deepEqual(location, { left: 12, top: 169, width: 320, height: 210 });
});

test('warehouse selector can search labels and barcode metadata without changing stored IDs', () => {
  const option = { label: 'Рис QA', searchText: '469013 Бакалея' };
  assert.equal(selectSearchMatches(option, '  рИс '), true);
  assert.equal(selectSearchMatches(option, '469013'), true);
  assert.equal(selectSearchMatches(option, 'молоко'), false);
  assert.equal(selectSearchMatches({ label: 'Основной склад' }, ''), true);
});
