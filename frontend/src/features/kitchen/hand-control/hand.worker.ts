import { HandLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import type { HandWorkerRequest, HandWorkerResponse } from './worker-types';

let detector: HandLandmarker | null = null;
const reply = (message: HandWorkerResponse) => self.postMessage(message);

self.onmessage = async ({ data }: MessageEvent<HandWorkerRequest>) => {
  try {
    if (data.type === 'close') { detector?.close(); detector = null; return; }
    if (data.type === 'init') {
      detector?.close();
      detector = await HandLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
        baseOptions: { modelAssetBuffer: new Uint8Array(data.model), delegate: data.delegate },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.7,
        minHandPresenceConfidence: 0.7,
        minTrackingConfidence: 0.7,
      });
      reply({ type: 'ready' });
      return;
    }
    try {
      if (!detector) throw new Error('Модель ещё не готова');
      const started = performance.now();
      const result = detector.detectForVideo(data.bitmap, data.timestamp);
      const landmarks = result.landmarks[0];
      reply({
        type: 'result', timestamp: data.timestamp, duration: performance.now() - started,
        sample: landmarks ? {
          landmarks,
          // Presence and tracking gates are enforced by the model; ambiguous handedness is also blocked.
          confidence: result.handedness[0]?.[0]?.score ?? 0,
          aspect: data.bitmap.width / data.bitmap.height,
        } : null,
      });
    } finally { data.bitmap.close(); }
  } catch (error) {
    reply({ type: 'error', message: error instanceof Error ? error.message : 'Ошибка распознавания' });
  }
};
