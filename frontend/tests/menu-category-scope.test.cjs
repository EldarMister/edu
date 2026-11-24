const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');

const source = readFileSync(resolve(__dirname, '../src/lib/menu-category-scope.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const helpers = {};
new Function('exports', compiled.outputText)(helpers);

test('nested menu categories keep same-named branches distinct and exclude descendants from the parent picker', () => {
  const tree = [
    { id: 'menu-root:1', name: 'Главный экран' },
    { id: 'bar', name: 'Бар' }, { id: 'cafe', name: 'Кафе' },
    { id: 'bar-coffee', name: 'Кофе', parentId: 'bar', ancestorIds: ['bar'] },
    { id: 'cafe-coffee', name: 'Кофе', parentId: 'cafe', ancestorIds: ['cafe'] },
    { id: 'iced', name: 'Со льдом', parentId: 'bar-coffee', ancestorIds: ['bar','bar-coffee'] },
  ];
  assert.deepEqual(helpers.menuCategoryOptions(tree, { excludeId: 'bar' }).map(({ label }) => label), ['Кафе', 'Кафе / Кофе']);
  assert.equal(helpers.menuCategoryOptions(tree, { includeMain: true })[0].value, 'menu-root:1');
  assert.deepEqual([...helpers.menuCategoryScope(tree, 'bar')], ['bar', 'bar-coffee', 'iced']);
  assert.deepEqual([...helpers.menuCategoryScope(tree, 'iced')], ['iced']);
});
