const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const moduleLayout = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/layout.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: moduleLayout, exports: moduleLayout.exports });
const { gridLayout, tableGridLayout } = moduleLayout.exports;
test('menu cards fit phone, tablet portrait, landscape and split screen without last-row stretching', () => {
  for (const width of [320, 390, 599, 600, 768, 800, 1024, 1280, 1600]) {
    const grid = gridLayout(width, 12, 10, 210, 5, 2);
    assert.ok(grid.columns >= 2 && grid.columns <= 5);
    assert.ok(Math.abs(grid.itemWidth * grid.columns + 10 * (grid.columns - 1) + 24 - width) < 0.001);
    if (width >= 768) assert.ok(grid.columns >= 3);
  }
});
test('order cards remain readable through rotation and narrow split-screen', () => {
  for (const width of [390, 600, 768, 1024, 1280]) {
    const grid = gridLayout(width, 14, 12, 360, 3);
    if (grid.columns > 1) assert.ok(grid.itemWidth >= 360);
    assert.ok(grid.itemWidth * grid.columns + 12 * (grid.columns - 1) <= width - 28 + .001);
  }
});

test('compact 8.7 inch kitchen uses readable columns through rotation',()=>{
 for(const width of [534,600,640,800,960,1005,1340]){
  const padding=width>=600?20:16;
  const grid=gridLayout(width,padding,16,264,4);
  assert.ok(grid.itemWidth>=264);
  assert.ok(grid.itemWidth*grid.columns+16*(grid.columns-1)+padding*2<=width+.001);
  if(width===600)assert.equal(grid.columns,2);
 }
});

test('9 and 14 tables have the same large cards in three columns on phones', () => {
  for (const width of [304, 368, 378, 414]) {
    const nine = tableGridLayout(9, width, 530, 12);
    const fourteen = tableGridLayout(14, width, 530, 12);
    assert.equal(nine.columns, 3);
    assert.equal(fourteen.columns, 3);
    assert.equal(fourteen.side, nine.side);
    assert.ok(fourteen.gridWidth <= width && width - fourteen.gridWidth < 3);
  }
});

test('shorter viewports scroll rather than reducing the cards or changing columns', () => {
  for (const count of [8, 14, 32]) {
    const layout = tableGridLayout(count, 378, 400, 12);
    const tall = tableGridLayout(count, 378, 650, 12);
    assert.equal(layout.columns, 3);
    assert.equal(layout.side, tall.side);
    assert.equal(layout.gap, 12);
    assert.ok(layout.gridWidth <= 378);
    const rows = Math.ceil(count / layout.columns);
    assert.equal(rows * layout.side + (rows - 1) * layout.gap > 400, count >= 14);
  }
});

test('all six squares stay visible in two columns on the reference phone', () => {
  for (const height of [400, 530, 650]) {
    const layout = tableGridLayout(6, 378, height, 12);
    assert.equal(layout.columns, 2);
    assert.equal(layout.gap, 12);
    assert.ok(layout.side > 0 && layout.gridWidth <= 378);
    assert.ok(3 * layout.side + 2 * layout.gap <= height);
  }
});
