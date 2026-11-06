const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const moduleLayout = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/layout.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: moduleLayout, exports: moduleLayout.exports });
const { gridLayout } = moduleLayout.exports;
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

test('compact tablet keeps rotation even below 600 logical pixels',async()=>{
 const calls=[];const module={exports:{}};
 const source=fs.readFileSync('src/lib/orientation.ts','utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,require:id=>({
  'react-native':{Dimensions:{get:()=>({width:534,height:893})}},
  'expo-device':{deviceType:2,DeviceType:{TABLET:2}},
  'expo-screen-orientation':{unlockAsync:async()=>calls.push('unlock'),lockAsync:async()=>calls.push('lock'),OrientationLock:{PORTRAIT_UP:1}}
 }[id])});
 await module.exports.restoreAppOrientation();assert.deepEqual(calls,['unlock']);
});
