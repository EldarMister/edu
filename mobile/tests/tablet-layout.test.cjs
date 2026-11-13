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

test('9 and 14 tables keep the same squares on the reference phone layouts', () => {
  const gap = 12;
  for (const [width, height] of [[368, 580], [384, 620], [414, 650]]) {
    const nine = tableGridLayout(9, width, height, gap);
    const fourteen = tableGridLayout(14, width, height, gap);
    assert.equal(nine.columns, 3);
    assert.equal(fourteen.columns, 3);
    assert.equal(fourteen.side, nine.side);
    assert.ok(fourteen.gridWidth <= width && width - fourteen.gridWidth < 3);
  }
});

test('eight tables keep two columns as the grid shrinks', () => {
  const gap = 12;
  const width = 368;
  const tall = tableGridLayout(8, width, 748, gap);
  assert.equal(tall.columns, 2);
  assert.equal(tall.gridWidth, width);
  assert.equal(4 * tall.side + 3 * gap, 748);
  for (const height of [380, 580, 747]) {
    const eight = tableGridLayout(8, width, height, gap);
    assert.equal(eight.columns, 2);
    assert.ok(eight.side < tall.side);
    assert.ok(eight.gridWidth <= width);
    assert.ok(4 * eight.side + 3 * gap <= height);
  }
  const crowded = tableGridLayout(32, 368, 580, gap);
  assert.equal(crowded.columns, 3);
  assert.equal(crowded.side, tableGridLayout(9, 368, 580, gap).side);
});

test('six tables fill the reference phone width in three rows', () => {
  const width = 378;
  const height = 574;
  const { columns, side, gap, gridWidth } = tableGridLayout(6, width, height, 12);
  assert.equal(columns, 2);
  assert.equal(gridWidth, width);
  assert.equal(gap, 12);
  assert.ok(3 * side + 2 * gap <= height);
});

test('each hall keeps its column count in narrow, portrait and wide windows', () => {
  const gap = 12;
  const stacked = tableGridLayout(2, 368, 580, gap);
  assert.equal(stacked.columns, 2);
  const wide = tableGridLayout(2, 620, 240, gap);
  assert.equal(wide.columns, 2);
  assert.ok(wide.side <= 240);
  for (const [width, height] of [[220, 560], [368, 580], [980, 560]]) {
    for (let count = 1; count <= 40; count++) {
      const layout = tableGridLayout(count, width, height, gap);
      assert.equal(layout.columns, tableGridLayout(count, 368, 580, gap).columns);
      assert.ok(layout.side > 0 && layout.gridWidth <= width);
    }
  }
});
