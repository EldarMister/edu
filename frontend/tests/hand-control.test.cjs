const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(name, globals = {}, requireMock = require) {
  const source = fs.readFileSync(path.join(__dirname, '../src/features/kitchen/hand-control', name), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: requireMock, console, ...globals });
  return exports;
}
const { PinchGesture, handMetrics, recognitionInterval } = load('gesture.ts');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function arm(g, start = 0) { g.update(0.8, start, 'A'); g.update(0.8, start + 80, 'A'); g.update(0.8, start + 160, 'A'); }
function complete(g, start, hover = 'A') {
  return [g.update(0.1, start, hover), g.update(0.1, start + 80, 'B'), g.update(0.8, start + 160, 'B'), g.update(0.8, start + 240, 'B')];
}

test('one completed pinch clicks the locked target once; hold does not repeat', () => {
  const g = new PinchGesture(); arm(g);
  assert.equal(g.update(0.1, 240, 'A'), null);
  for (let at = 320; at <= 1600; at += 80) assert.equal(g.update(0.1, at, 'B'), null);
  assert.equal(g.lockedTarget, 'A');
  assert.equal(g.update(0.8, 1680, 'B'), null);
  assert.equal(g.update(0.8, 1760, 'B'), 'A');
  assert.equal(g.update(0.8, 1840, 'B'), null);
  assert.deepEqual(Array.from(complete(g, 2240, 'B')).filter(Boolean), ['B']);
});
test('brief jitter, intermediate thresholds and cooldown cannot duplicate clicks', () => {
  const g = new PinchGesture(); arm(g);
  assert.equal(g.update(0.1, 240, 'A'), null);
  assert.equal(g.update(0.8, 270, 'B'), null);
  assert.equal(g.locked, false);
  assert.deepEqual(Array.from(complete(g, 320)).filter(Boolean), ['A']);
  assert.deepEqual(Array.from(complete(g, 600)).filter(Boolean), []);
});
test('lost hand or a stale sample disarms until an intentional open then new pinch', () => {
  for (const lose of [(g) => g.update(null, 340, 'B'), (g) => g.update(0.1, 1000, 'B')]) {
    const g = new PinchGesture(); arm(g); g.update(0.1, 240, 'A'); g.update(0.1, 320, 'A'); lose(g);
    assert.equal(g.update(0.8, 1080, 'B'), null);
    assert.equal(g.update(0.8, 1160, 'B'), null);
    assert.equal(g.update(0.8, 1240, 'B'), null);
    assert.deepEqual(Array.from(complete(g, 1320, 'B')).filter(Boolean), ['B']);
  }
});
test('pinch at first detection cannot click, and invalid/low-confidence hands are rejected', () => {
  const g = new PinchGesture();
  for (let at = 0; at < 800; at += 80) assert.equal(g.update(0.1, at, 'A'), null);
  assert.equal(g.locked, false);
  assert.equal(handMetrics({ confidence: 0.5, landmarks: Array(21).fill({ x: 0.5, y: 0.5 }), aspect: 4 / 3 }), null);
  assert.equal(handMetrics({ confidence: 1, landmarks: [], aspect: 4 / 3 }), null);
});
test('palm normalization is distance invariant and front-camera coordinates are mirrored', () => {
  const points = Array.from({ length: 21 }, () => ({ x: 0.4, y: 0.6 }));
  points[0] = { x: 0.4, y: 0.8 }; points[9] = { x: 0.4, y: 0.5 };
  points[5] = { x: 0.3, y: 0.5 }; points[17] = { x: 0.5, y: 0.5 };
  points[8] = { x: 0.3, y: 0.3 }; points[4] = { x: 0.33, y: 0.3 };
  const a = handMetrics({ confidence: 0.9, landmarks: points, aspect: 4 / 3 });
  const b = handMetrics({ confidence: 0.9, landmarks: points.map((p) => ({ x: p.x * 0.5, y: p.y * 0.5 })), aspect: 4 / 3 });
  assert.ok(Math.abs(a.pinch - b.pinch) < 1e-9);
  assert.ok(a.point.x > 0.5);
  assert.equal(recognitionInterval(true, 20), 80);
  assert.equal(recognitionInterval(false, 20), 400);
  assert.equal(recognitionInterval(true, 200), 300);
});

function harness() {
  let clock = 1000, sequence = 0;
  const timers = new Map(), workers = [], states = [], samples = [], videos = [], bitmaps = [];
  let cameraResolve = null, bitmapResolve = null;
  const tracks = [{ stopped: 0, onended: null, stop() { this.stopped++; }, getSettings: () => ({ width: 320, height: 240, frameRate: 15 }) }];
  const stream = { getTracks: () => tracks, getVideoTracks: () => tracks };
  const workerFactory = () => {
    const worker = { messages: [], terminated: false, postMessage(value) { this.messages.push(value); }, terminate() { this.terminated = true; }, onmessage: null };
    workers.push(worker); return worker;
  };
  const globals = {
    performance: { now: () => clock }, window: { isSecureContext: true }, Worker: function () {}, OffscreenCanvas: function () {}, Error,
    navigator: { mediaDevices: { getUserMedia: () => cameraResolve === true ? new Promise((resolve) => { cameraResolve = resolve; }) : Promise.resolve(stream) } },
    document: { body: { appendChild() {} }, createElement() {
      const video = { muted: false, playsInline: false, style: {}, srcObject: null, currentTime: 1, readyState: 2, videoWidth: 320, videoHeight: 240, setAttribute() {}, play: async () => {}, pause() { this.paused = true; }, remove() { this.removed = true; } };
      videos.push(video); return video;
    } },
    createImageBitmap: (_, { resizeWidth, resizeHeight }) => {
      const bitmap = { width: resizeWidth, height: resizeHeight, closed: false, close() { this.closed = true; } }; bitmaps.push(bitmap);
      return bitmapResolve === true ? new Promise((resolve) => { bitmapResolve = () => resolve(bitmap); }) : Promise.resolve(bitmap);
    },
    setTimeout: (fn, delay) => { timers.set(++sequence, { fn, delay }); return sequence; }, clearTimeout: (id) => timers.delete(id),
  };
  const { HandCameraSession } = load('session.ts', globals, (name) => name === './gesture' ? { handMetrics, recognitionInterval } : require(name));
  const session = new HandCameraSession({ createWorker: workerFactory, loadModel: async () => new ArrayBuffer(4), onStatus: (...value) => states.push(value), onSample: (...value) => samples.push(value), onDiagnostics() {} });
  return { session, timers, workers, states, tracks, samples, videos, bitmaps,
    delayCamera() { cameraResolve = true; }, resolveCamera() { cameraResolve(stream); },
    delayBitmap() { bitmapResolve = true; }, resolveBitmap() { bitmapResolve(); },
    ready() { workers[0].onmessage({ data: { type: 'ready' } }); },
    runCapture() { const entry = [...timers].find(([, value]) => value.delay < 8000); assert.ok(entry); timers.delete(entry[0]); entry[1].fn(); },
    result(sample = null, duration = 20) { clock += duration; workers[0].onmessage({ data: { type: 'result', timestamp: clock - duration, duration, sample } }); },
  };
}
test('explicit activation creates resources; off stops every track, worker, video and timer', async () => {
  const h = harness(); assert.equal(h.workers.length, 0); h.session.pause(); assert.equal(h.states.length, 0);
  await h.session.start('CPU'); h.ready(); h.runCapture(); await flush();
  assert.equal(h.workers[0].messages.filter((m) => m.type === 'frame').length, 1);
  assert.equal([...h.timers.values()].filter((t) => t.delay < 8000).length, 0, 'no queued frames while inference runs');
  h.result(); assert.ok([...h.timers.values()].some((t) => t.delay === 380));
  h.session.stop();
  assert.equal(h.tracks[0].stopped, 1); assert.equal(h.workers[0].terminated, true);
  assert.equal(h.videos[0].srcObject, null); assert.equal(h.videos[0].paused, true); assert.equal(h.videos[0].removed, true);
  assert.equal(h.timers.size, 0); assert.equal(h.states.at(-1)[0], 'off');
});
test('camera permission resolving after disable cannot reactivate the camera', async () => {
  const h = harness(); h.delayCamera(); const start = h.session.start('CPU'); h.session.stop(); h.resolveCamera(); await start;
  assert.equal(h.tracks[0].stopped, 1); assert.equal(h.workers.length, 0); assert.equal(h.timers.size, 0);
});
test('a bitmap resolving after pause is closed and never delivered', async () => {
  const h = harness(); await h.session.start('CPU'); h.ready(); h.delayBitmap(); h.runCapture(); await flush();
  h.session.pause(); h.resolveBitmap(); await flush();
  assert.equal(h.bitmaps[0].closed, true); assert.equal(h.workers[0].messages.filter((m) => m.type === 'frame').length, 0);
  assert.equal(h.states.at(-1)[0], 'paused'); assert.equal(h.timers.size, 0);
});

test('slow tracking reduces the frame size and hand loss restores full-size search', async () => {
  const h = harness();
  await h.session.start('CPU');
  h.ready(); h.runCapture(); await flush();
  assert.equal(h.bitmaps[0].width, 320);
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[0] = { x: 0.5, y: 0.8 };
  h.result({ landmarks, confidence: 0.9, aspect: 4 / 3 }, 150);
  h.videos[0].currentTime = 2;
  h.runCapture(); await flush();
  assert.equal(h.bitmaps[1].width, 256);
  assert.equal(h.bitmaps[1].height, 192);
  h.result(null, 150);
  h.videos[0].currentTime = 3;
  h.runCapture(); await flush();
  assert.equal(h.bitmaps[2].width, 320);
  assert.equal(h.bitmaps[2].height, 240);
});
