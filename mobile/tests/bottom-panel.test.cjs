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
const { resistPanelOffset, shouldDismissPanel, canStartPanelDrag, remainingKeyboardOverlap, PanelCompletion } = load('geometry.ts');
const { PanelHistory } = load('history.ts');
const entry = (id, parent, persistent = false, inline = false) => ({ id, parent, persistent, inline });

test('downward movement is 1:1 and upward movement has bounded continuous resistance', () => {
  assert.equal(resistPanelOffset(87, 400), 87);
  assert.equal(resistPanelOffset(0, 400), 0);
  for (const x of [-1, -80, -1000]) {
    const value = resistPanelOffset(x, 400);
    assert.ok(value < 0 && value > x && value > -400);
    assert.equal(value, x * 400 * .55 / (400 + .55 * Math.abs(x)));
  }
});
test('dismissal uses measured travel and both distance and velocity thresholds', () => {
  assert.equal(shouldDismissPanel(95, 100, 400), false);
  assert.equal(shouldDismissPanel(97, 100, 400), true);
  assert.equal(shouldDismissPanel(161, 0, 1000), true);
  assert.equal(shouldDismissPanel(12, 1000, 400), false);
  assert.equal(shouldDismissPanel(13, 851, 400), true);
  assert.equal(shouldDismissPanel(13, -1000, 400), false);
});
test('scrolling can hand off only at the top and in the first 128 logical pixels', () => {
  assert.equal(canStartPanelDrag(1, 128), true);
  assert.equal(canStartPanelDrag(2, 20), false);
  assert.equal(canStartPanelDrag(0, 129), false);
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
test('temporary panels wait for the previous exit before opening, then return through history', () => {
  const history = new PanelHistory();
  history.add(entry('cart')); history.add(entry('picker', 'cart'));
  assert.equal(history.getSnapshot().active, 'cart');
  assert.equal(history.getSnapshot().desired, 'picker');
  history.yield('cart'); assert.equal(history.getSnapshot().active, 'picker');
  history.remove('picker'); assert.equal(history.getSnapshot().active, 'cart');
});
test('nested layout effects registering a child before its parent retain correct order', () => {
  const history = new PanelHistory();
  history.add(entry('variant', 'replacement')); history.add(entry('replacement', 'set')); history.add(entry('set'));
  assert.equal(history.getSnapshot().desired, 'variant');
  history.remove('variant'); assert.equal(history.getSnapshot().desired, 'replacement');
  history.remove('replacement'); assert.equal(history.getSnapshot().desired, 'set');
});
test('cancelling a queued panel cannot steal the active panel from its replacement', () => {
  const history = new PanelHistory(); history.add(entry('a')); history.add(entry('b')); history.remove('b');
  history.yield('b'); assert.equal(history.getSnapshot().active, 'a');
  history.add(entry('c')); history.yield('a'); history.yield('a');
  assert.equal(history.getSnapshot().active, 'c');
});
test('persistent map panel remains registered below temporary details and does not isolate the map', () => {
  const history = new PanelHistory(); history.add(entry('map', undefined, true, true));
  assert.equal(history.getSnapshot().temporary, 0);
  history.add(entry('details', 'map')); history.yield('map');
  assert.equal(history.getSnapshot().temporary, 1);
  history.remove('details'); assert.equal(history.getSnapshot().active, 'map');
  assert.equal(history.getSnapshot().temporary, 0);
});
