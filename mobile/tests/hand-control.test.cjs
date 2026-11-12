const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/features/hand-control', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.React } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, setTimeout, clearTimeout, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return module.exports;
}
const { PinchGesture, handMetrics } = load('gesture.ts');
const { waitForCameraForeground } = load('cameraLifecycle.ts');
const { HandTargetRegistry, updateHandTarget } = load('targets.tsx', { react: { createContext: () => ({}) } });
const arm = g => { g.update(0.8, 0, 'A'); g.update(0.8, 80, 'A'); g.update(0.8, 160, 'A'); };

test('permission grant waits for Android activity resume before camera startup', async () => {
  let listener; let removed = 0;
  const state = { currentState: 'background', addEventListener: (_, fn) => { listener = fn; return { remove: () => removed++ }; } };
  let settled = false;
  const ready = waitForCameraForeground(state).then(value => { settled = true; return value; });
  await Promise.resolve();
  assert.equal(settled, false);
  listener('inactive');
  await Promise.resolve();
  assert.equal(settled, false);
  state.currentState = 'active'; listener('active');
  assert.equal(await ready, true);
  assert.equal(removed, 1);
});

test('camera stays stopped if permission result leaves app in background', async () => {
  let removed = 0;
  const state = { currentState: 'background', addEventListener: () => ({ remove: () => removed++ }) };
  assert.equal(await waitForCameraForeground(state, 5), false);
  assert.equal(removed, 1);
  state.currentState = 'active';
  assert.equal(await waitForCameraForeground(state), true);
  assert.equal(removed, 1);
});

test('PWA pinch captures one target and does not repeat while fingers stay closed', () => {
  const g = new PinchGesture(); arm(g);
  assert.equal(g.update(0.1, 240, 'A'), null);
  for (let now = 320; now <= 1600; now += 80) assert.equal(g.update(0.1, now, 'B'), null);
  assert.equal(g.lockedTarget, 'A');
  assert.equal(g.update(0.8, 1680, 'B'), null);
  assert.equal(g.update(0.8, 1760, 'B'), 'A');
  assert.equal(g.update(0.8, 1840, 'B'), null);
});
test('lost or stale hand disarms a pending action and requires an intentional new gesture', () => {
  for (const lose of [g => g.update(null, 340, 'B'), g => g.update(0.1, 1000, 'B')]) {
    const g = new PinchGesture(); arm(g); g.update(0.1, 240, 'A'); g.update(0.1, 320, 'A'); lose(g);
    assert.equal(g.lockedTarget, null);
    for (const now of [1080, 1160, 1240]) assert.equal(g.update(0.8, now, 'B'), null);
  }
});
test('uncertain hands and a closed pinch on first detection cannot click', () => {
  const g = new PinchGesture();
  for (let now = 0; now < 1000; now += 80) assert.equal(g.update(0.1, now, 'A'), null);
  assert.equal(handMetrics({ confidence: 0.6, landmarks: Array(21).fill({ x: 0.5, y: 0.5 }), aspect: 4 / 3 }), null);
  assert.equal(handMetrics({ confidence: 1, landmarks: [], aspect: 4 / 3 }), null);
});
function add(registry, { layer = 'board', x = 0, y = 0, width = 100, height = 100, disabled = false, clip, exclude, measure } = {}) {
  let clicks = 0;
  const target = { id: Symbol(), revision: 0, layer, disabled, clip, exclude, press: () => clicks++, view: { measureInWindow: measure || (callback => callback(x, y, width, height)) } };
  registry.targets.set(target.id, target);
  return { target, clicks: () => clicks };
}
test('modal layer prevents clicks through the popup and nested buttons beat cards', async () => {
  const registry = new HandTargetRegistry();
  const card = add(registry);
  const button = add(registry, { width: 30, height: 30 });
  const hit = await registry.hit({ x: 10, y: 10 });
  assert.equal(hit.target, button.target);
  registry.activeLayer = 'voice';
  assert.equal(await registry.activate(hit), false);
  assert.equal(card.clicks(), 0); assert.equal(button.clicks(), 0);
  const toggle = add(registry, { layer: 'voice' });
  assert.equal(await registry.activate(await registry.hit({ x: 10, y: 10 })), true);
  assert.equal(toggle.clicks(), 1);
});
test('an order changed or removed during a pinch cannot activate its old action', async () => {
  const registry = new HandTargetRegistry();
  const action = add(registry);
  const hit = await registry.hit({ x: 20, y: 20 });
  action.target.revision++;
  assert.equal(await registry.activate(hit), false);
  const next = await registry.hit({ x: 20, y: 20 });
  registry.targets.delete(action.target.id);
  assert.equal(await registry.activate(next), false);
  assert.equal(action.clicks(), 0);
});
test('disabled and scrolled-out controls are not targets even when native frames overlap', async () => {
  const registry = new HandTargetRegistry();
  add(registry, { disabled: true });
  add(registry, { clip: { current: { getNativeScrollRef: () => ({ measureInWindow: callback => callback(0, 40, 100, 60) }) } } });
  assert.equal(await registry.hit({ x: 20, y: 20 }), null);
  assert.ok(await registry.hit({ x: 20, y: 60 }));
});

test('a shared scroll boundary is measured once per scan and remeasured before clicking', async () => {
  const registry = new HandTargetRegistry();
  let measurements = 0;
  let clipTop = 0;
  const clip = { current: { measureInWindow(callback) { measurements++; callback(0, clipTop, 100, 100); } } };
  const outer = add(registry, { clip });
  const button = add(registry, { width: 30, height: 30, clip });
  const hit = await registry.hit({ x: 20, y: 20 });
  assert.equal(hit.target, button.target);
  assert.equal(measurements, 1);
  clipTop = 40;
  assert.equal(await registry.activate(hit), false);
  assert.equal(measurements, 2);
  assert.equal(outer.clicks() + button.clicks(), 0);
});
test('a late geometry measurement after layer change is discarded', async () => {
  const registry = new HandTargetRegistry();
  let reply;
  add(registry, { measure: callback => { reply = callback; } });
  const hit = registry.hit({ x: 10, y: 10 });
  registry.activeLayer = 'voice';
  reply(0, 0, 100, 100);
  assert.equal(await hit, null);
});

test('a clock rerender refreshes the callback without cancelling the same action', async () => {
  const registry = new HandTargetRegistry();
  const { target } = add(registry);
  let value;
  const context = { registry, layer: 'board', identity: 'order-1:in_work:item-1' };
  updateHandTarget(target, { onPress: () => { value = 'old'; } }, context);
  const hit = await registry.hit({ x: 20, y: 20 });
  updateHandTarget(target, { onPress: () => { value = 'latest'; } }, { ...context });
  assert.equal(await registry.activate(hit), true);
  assert.equal(value, 'latest');
  const held = await registry.hit({ x: 20, y: 20 });
  updateHandTarget(target, { onPress: () => { value = 'changed order'; } }, { ...context, identity: 'order-1:ready:item-1' });
  assert.equal(await registry.activate(held), false);
  assert.equal(value, 'latest');
});

test('checked state changes invalidate a held toggle, equivalent rerenders do not', async () => {
  const registry = new HandTargetRegistry();
  const { target } = add(registry);
  const context = { registry, layer: 'board' };
  updateHandTarget(target, { onPress() {}, accessibilityState: { checked: false } }, context);
  const hit = await registry.hit({ x: 20, y: 20 });
  updateHandTarget(target, { onPress() {}, accessibilityState: { checked: false } }, context);
  assert.equal(await registry.activate(hit), true);
  updateHandTarget(target, { onPress() {}, accessibilityState: { checked: true } }, context);
  assert.equal(await registry.activate(hit), false);
});

test('cards hidden during column measurement cannot receive hand presses', async () => {
  const registry = new HandTargetRegistry();
  const action = add(registry);
  const context = { registry, layer: 'board', enabled: false };
  updateHandTarget(action.target, { onPress: action.target.press }, context);
  assert.equal(await registry.hit({ x: 20, y: 20 }), null);
  updateHandTarget(action.target, { onPress: action.target.press }, { ...context, enabled: true });
  assert.ok(await registry.hit({ x: 20, y: 20 }));
});

test('modal panel blocks backdrop activation through blank content but allows outside dismissal', async () => {
  const registry = new HandTargetRegistry();
  const backdrop = add(registry, { exclude: { current: { measureInWindow: callback => callback(30, 30, 70, 70) } } });
  assert.equal(await registry.hit({ x: 60, y: 60 }), null);
  assert.equal(await registry.activate(await registry.hit({ x: 10, y: 10 })), true);
  assert.equal(backdrop.clicks(), 1);
  add(registry, { x: 40, y: 40, width: 20, height: 20 });
  assert.ok(await registry.hit({ x: 50, y: 50 }));
});

test('nested native modal wins regardless of effect order and blocks until actual unmount', async () => {
  const registry = new HandTargetRegistry();
  const board = add(registry);
  const stale = await registry.hit({ x: 10, y: 10 });
  // React mounts descendant layout effects before their parent effects.
  const closeCalendar = registry.mountModal('calendar', 2);
  const closeDetails = registry.mountModal('details', 1);
  const details = add(registry, { layer: 'details' });
  const calendar = add(registry, { layer: 'calendar' });
  registry.activeLayer = 'board';
  assert.equal((await registry.hit({ x: 10, y: 10 })).target, calendar.target);
  closeCalendar();
  assert.equal((await registry.hit({ x: 10, y: 10 })).target, details.target);
  closeDetails();
  assert.equal((await registry.hit({ x: 10, y: 10 })).target, board.target);
  assert.equal(await registry.activate(stale), false);
});

test('stop, background or lost hand during final measurement cancels activation', async () => {
  const registry = new HandTargetRegistry();
  const action = add(registry);
  const hit = await registry.hit({ x: 10, y: 10 });
  let completeMeasurement;
  action.target.view.measureInWindow = callback => { completeMeasurement = callback; };
  let requested = true;
  const activated = registry.activate(hit, () => requested);
  requested = false;
  completeMeasurement(0, 0, 100, 100);
  assert.equal(await activated, false);
  assert.equal(action.clicks(), 0);
});
