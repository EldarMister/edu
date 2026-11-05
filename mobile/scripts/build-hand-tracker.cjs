// Rebuild the self-contained, offline camera worker from the exact PWA runtime.
// node scripts/build-hand-tracker.cjs /absolute/path/to/frontend
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const frontend = path.resolve(process.argv[2] || '../frontend');
const runtime = path.join(frontend, 'node_modules/@mediapipe/tasks-vision');
const pkg = JSON.parse(fs.readFileSync(path.join(runtime, 'package.json'), 'utf8'));
if (pkg.version !== '1.2.2') throw new Error('Use the pinned PWA MediaPipe 1.2.2 runtime.');
const engine = fs.readFileSync(path.join(runtime, 'vision_bundle.js'), 'utf8');
const loader = fs.readFileSync(path.join(runtime, 'wasm/vision_wasm_internal.js'));
const wasm = fs.readFileSync(path.join(runtime, 'wasm/vision_wasm_internal.wasm'));
const model = fs.readFileSync(path.join(frontend, 'public/hand-control/hand_landmarker.task'));
const worker = `${engine}\n${fs.readFileSync(path.join(__dirname, 'hand-tracker-worker.js'), 'utf8')}`;
const template = fs.readFileSync(path.join(__dirname, 'hand-tracker.html'), 'utf8');
const html = template.replace('/* BUNDLED_ASSETS */', `const assets = ${JSON.stringify({
  worker, loader: `data:application/javascript;base64,${loader.toString('base64')}`,
  wasm: `data:application/wasm;base64,${wasm.toString('base64')}`, model: model.toString('base64'),
})};`.replace(/<\/script/gi, '<\\/script'));
const destination = path.join(__dirname, '../assets/hand-control');
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, 'tracker.html'), html);
fs.writeFileSync(path.join(destination, 'provenance.json'), JSON.stringify({
  runtime: '@mediapipe/tasks-vision', version: pkg.version, license: 'Apache-2.0',
  runtimeSource: 'https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.2.2',
  modelSource: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  modelSha256: crypto.createHash('sha256').update(model).digest('hex'),
  wasmSha256: crypto.createHash('sha256').update(wasm).digest('hex'),
  htmlSha256: crypto.createHash('sha256').update(html).digest('hex'),
}, null, 2) + '\n');
console.log(`Bundled offline hand tracker (${Buffer.byteLength(html)} bytes).`);
