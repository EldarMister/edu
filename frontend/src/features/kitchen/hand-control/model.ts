// Keep only immutable model bytes between activations. Camera, worker and WASM are always disposed.
// Assets are served by this application; no camera data is sent to any service.
let modelBytes: Promise<ArrayBuffer> | null = null;
export function loadHandModel() {
  modelBytes ??= fetch(`${import.meta.env.BASE_URL}hand-control/hand_landmarker.task?v=fbc2a300`, { cache: 'force-cache' })
    .then((response) => {
      if (!response.ok) throw new Error('Не удалось загрузить модель. Проверьте подключение и повторите.');
      return response.arrayBuffer();
    })
    .catch((error) => { modelBytes = null; throw error; });
  return modelBytes;
}
