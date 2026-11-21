const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../src/utils/floorPlan.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(compiled, { exports: exportsObject });
const { floorPlanBounds, layoutFloorTables, shiftFloorTable, tableLabel } = exportsObject;
const plain = (value) => JSON.parse(JSON.stringify(value));
const rectangle = (tableId, x, y, width = 4, height = 4) => ({ tableId, x, y, width, height, shape: 'rectangle' });

test('preexisting table positions and labels survive when another table is added', () => {
  const saved = { ...rectangle('second', 1, 1), label: 'VIP', shape: 'round' };
  const placed = plain(layoutFloorTables([{ id: 'first' }, { id: 'second' }], [saved, rectangle('removed', 7, 1)]));
  assert.deepEqual(placed, [rectangle('first', 7, 1), saved]);
  assert.deepEqual(plain(floorPlanBounds(placed, true)), { x: 0, y: 0, columns: 12, rows: 6 });
});

test('dragging and resizing constrain the complete table to the grid', () => {
  const table = rectangle('table', 17, 590, 5, 5);
  assert.deepEqual(plain(shiftFloorTable(table, 30, 30, false)), { x: 19, y: 595 });
  assert.deepEqual(plain(shiftFloorTable(table, 30, 30, true)), { width: 7, height: 10 });
  assert.deepEqual(plain(shiftFloorTable(table, -30, -30, true)), { width: 4, height: 4 });
});

test('a filled plan stops fallback placement so terminal can show all tables as buttons', () => {
  const saved = rectangle('first', 0, 0, 24, 600);
  assert.deepEqual(plain(layoutFloorTables([{ id: 'first' }, { id: 'second' }], [saved])), [saved]);
  assert.equal(tableLabel({ number: 8 }), 'Стол 8');
  assert.equal(tableLabel({ number: 8, name: '  Терраса  ' }), 'Терраса');
});
