const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function load(file) {
  const module = { exports: {} };
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/components/bottom-panel', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports });
  return module.exports;
}
const { resistPanelOffset, panelDragOrigin, shouldDismissPanel, remainingKeyboardOverlap, PanelCompletion } = load('geometry.ts');
const { PanelHistory } = load('history.ts');
const entry = (id, parent, persistent = false, inline = false) => ({ id, parent, persistent, inline });

test('movement is 1:1 between the stops and has bounded resistance beyond both', () => {
  assert.equal(resistPanelOffset(87, 400), 87);
  assert.equal(resistPanelOffset(0, 400), 0);
  for (const x of [-1, -80, -1000]) {
    const value = resistPanelOffset(x, 400);
    assert.ok(value < 0 && value > x && value > -400);
    assert.equal(value, x * 400 * .55 / (400 + .55 * Math.abs(x)));
  }
  assert.ok(resistPanelOffset(450, 400) > 400 && resistPanelOffset(450, 400) < 450);
  for (const x of [-80, 0, 87, 450]) {
    assert.ok(Math.abs(panelDragOrigin(resistPanelOffset(x, 400), 400) - x) < 0.001);
  }
});
test('dismissal uses measured travel and both distance and velocity thresholds', () => {
  assert.equal(shouldDismissPanel(95, 100, 400), false);
  assert.equal(shouldDismissPanel(97, 100, 400), true);
  assert.equal(shouldDismissPanel(161, 0, 1000), true);
  assert.equal(shouldDismissPanel(12, 1000, 400), false);
  assert.equal(shouldDismissPanel(13, 851, 400), true);
  assert.equal(shouldDismissPanel(13, -1000, 400), false);
  assert.equal(shouldDismissPanel(5, 1000, 400, 15), true);
  assert.equal(shouldDismissPanel(120, -1000, 400), false);
});
test('adjustResize keyboard compensation only adds remaining overlap', () => {
  assert.equal(remainingKeyboardOverlap(0, 600, 600), 0);
  assert.equal(remainingKeyboardOverlap(100, 500, 600), 0);
  assert.equal(remainingKeyboardOverlap(100, 700, 600), 200);
});
test('duplicate close requests and repeated callbacks complete once', () => {
  const guard = new PanelCompletion(); guard.open();
  const token = guard.close();
  assert.notEqual(token, null);
  assert.equal(guard.close(), null);
  assert.equal(guard.finish(token), true);
  assert.equal(guard.finish(token), false);
});
test('reopen and unmount invalidate old animation completions', () => {
  const guard = new PanelCompletion(); guard.open(); const old = guard.close(); guard.open();
  assert.equal(guard.finish(old), false);
  const next = guard.close(); guard.invalidate();
  assert.equal(guard.finish(next), false);
});
test('temporary panels become active as soon as they are registered, then return through history', () => {
  const history = new PanelHistory();
  history.add(entry('cart')); history.add(entry('picker', 'cart'));
  assert.equal(history.getSnapshot().active, 'picker');
  history.remove('picker'); assert.equal(history.getSnapshot().active, 'cart');
});
test('nested layout effects registering a child before its parent retain correct order', () => {
  const history = new PanelHistory();
  history.add(entry('variant', 'replacement')); history.add(entry('replacement', 'set')); history.add(entry('set'));
  assert.equal(history.getSnapshot().active, 'variant');
  history.remove('variant'); assert.equal(history.getSnapshot().active, 'replacement');
  history.remove('replacement'); assert.equal(history.getSnapshot().active, 'set');
});
test('removing a suspended panel keeps the replacement active', () => {
  const history = new PanelHistory(); history.add(entry('a')); history.add(entry('b')); history.remove('b');
  assert.equal(history.getSnapshot().active, 'a');
  history.add(entry('c')); history.remove('a');
  assert.equal(history.getSnapshot().active, 'c');
});
test('persistent map panel remains registered below temporary details and does not isolate the map', () => {
  const history = new PanelHistory(); history.add(entry('map', undefined, true, true));
  assert.equal(history.getSnapshot().temporary, 0);
  history.add(entry('details', 'map'));
  assert.equal(history.getSnapshot().temporary, 1);
  history.remove('details'); assert.equal(history.getSnapshot().active, 'map');
  assert.equal(history.getSnapshot().temporary, 0);
});
