MediaPipe hand tracker for the native kitchen/bar client

Runtime: @mediapipe/tasks-vision 1.2.2 (Apache-2.0).
Model: Hand Landmarker float16 v1, copied byte-for-byte from PWA main 011c187.
Source URLs and SHA-256 digests are in provenance.json. License is in LICENSE.

tracker.html is generated from scripts/hand-tracker.html and scripts/hand-tracker-worker.js,
plus the pinned PWA runtime/model. Rebuild from mobile/ with:
  node scripts/build-hand-tracker.cjs /absolute/path/to/frontend

This is only the local camera inference runtime. The kitchen UI and business logic
remain React Native. The model, WASM and worker are embedded; no camera frames or
model requests are sent over the network. Loading starts only after the user enables
hand control and allows camera access. Backgrounding or leaving the kitchen tears
down the WebView, camera stream and worker. The UI remains usable by touch.
