let detector;
onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const model = Uint8Array.from(atob(data.model), char => char.charCodeAt(0));
      detector = await Vision.HandLandmarker.createFromOptions({ wasmLoaderPath: data.loader, wasmBinaryPath: data.wasm }, {
        baseOptions: { modelAssetBuffer: model, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1,
        minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7,
      });
      postMessage({ type: 'ready' });
    } else if (data.type === 'frame') {
      try {
        const started = performance.now();
        const result = detector.detectForVideo(data.bitmap, data.timestamp);
        postMessage({ type: 'sample', timestamp: data.timestamp, duration: performance.now() - started,
          sample: result.landmarks[0] ? { landmarks: result.landmarks[0], confidence: result.handedness[0]?.[0]?.score || 0, aspect: data.bitmap.width / data.bitmap.height } : null });
      } finally { data.bitmap.close(); }
    }
  } catch (error) { postMessage({ type: 'error', message: error.message }); }
};
