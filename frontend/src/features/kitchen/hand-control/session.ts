import { handMetrics, recognitionInterval, type HandSample } from './gesture';
import type { HandDelegate, HandWorkerResponse } from './worker-types';

export type HandStatus = 'off' | 'loading' | 'searching' | 'found' | 'paused' | 'error';
export type HandDiagnostics = { width?: number; height?: number; frameRate?: number; inferenceMs?: number };

type SessionOptions = {
  createWorker: () => Worker;
  loadModel: () => Promise<ArrayBuffer>;
  onStatus: (status: HandStatus, error?: string) => void;
  onSample: (sample: HandSample | null, now: number) => void;
  onDiagnostics: (diagnostics: HandDiagnostics) => void;
};

export function cameraError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Нет доступа к камере. Разрешите камеру в настройках браузера и включите управление снова.';
  if (name === 'NotFoundError') return 'Камера не найдена. Управление касанием доступно.';
  if (name === 'NotReadableError') return 'Камера занята или недоступна. Закройте использующее её приложение и повторите.';
  return error instanceof Error ? error.message : 'Не удалось включить управление рукой. Управление касанием доступно.';
}

/** Owns every capture resource. Generation checks close streams/bitmaps arriving after stop(). */
export class HandCameraSession {
  private generation = 0;
  private active = false;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private lastVideoTime = -1;
  private lastFrameAt = -Infinity;
  private inferenceMs = 0;
  private found = false;
  private diagnostics: HandDiagnostics = {};

  constructor(private readonly options: SessionOptions) {}

  pause() { if (this.active) this.stop('paused'); }

  stop(status: HandStatus = 'off') {
    this.active = false;
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.timer = this.watchdog = null;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove(); }
    this.video = null;
    // Termination releases the complete inference runtime even if inference or initialization stalled.
    this.worker?.terminate();
    this.worker = null;
    this.found = false;
    this.lastVideoTime = -1;
    this.lastFrameAt = -Infinity;
    this.options.onSample(null, performance.now());
    this.options.onStatus(status);
  }

  async start(delegate: HandDelegate) {
    this.stop();
    const generation = this.generation;
    this.active = true;
    this.options.onStatus('loading');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Камера доступна только в поддерживаемом браузере по HTTPS (или localhost).');
      }
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
        throw new Error('Этот браузер не поддерживает фоновое распознавание. Обновите браузер или используйте касание.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 15 } },
      });
      if (!this.isCurrent(generation)) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('Камера не предоставила видеопоток.');
      track.onended = () => { if (this.isCurrent(generation)) this.fail('Поток камеры прерван. Включите управление снова.'); };
      const settings = track.getSettings();
      this.diagnostics = { width: settings.width, height: settings.height, frameRate: settings.frameRate };
      this.options.onDiagnostics(this.diagnostics);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('aria-hidden', 'true');
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0';
      video.srcObject = stream;
      // An attached, playing video is necessary on iPad Safari; no preview or recording is produced.
      document.body.appendChild(video);
      this.video = video;
      this.watchdog = setTimeout(() => {
        if (this.isCurrent(generation)) this.fail('Камера или загрузка модели не отвечают. Включите управление снова.');
      }, 30_000);
      await video.play();
      if (!this.isCurrent(generation)) return;
      const model = await this.options.loadModel();
      if (!this.isCurrent(generation)) return;
      const worker = this.options.createWorker();
      this.worker = worker;
      if (this.watchdog !== null) clearTimeout(this.watchdog);
      worker.onerror = () => { if (this.isCurrent(generation)) this.fail('Ошибка модели управления рукой. Попробуйте снова или выберите CPU.'); };
      worker.onmessage = ({ data }: MessageEvent<HandWorkerResponse>) => {
        if (!this.isCurrent(generation)) return;
        if (this.watchdog !== null) clearTimeout(this.watchdog);
        this.watchdog = null;
        if (data.type === 'error') { this.fail(`Не удалось распознать руку. ${data.message}`); return; }
        if (data.type === 'ready') { this.options.onStatus('searching'); this.schedule(generation, 0); return; }
        this.inferenceMs = this.inferenceMs ? this.inferenceMs * 0.7 + data.duration * 0.3 : data.duration;
        this.found = performance.now() - data.timestamp <= 450 && handMetrics(data.sample) !== null;
        this.options.onStatus(this.found ? 'found' : 'searching');
        this.options.onSample(this.found ? data.sample : null, data.timestamp);
        this.options.onDiagnostics({ ...this.diagnostics, inferenceMs: this.inferenceMs });
        const elapsed = performance.now() - data.timestamp;
        this.schedule(generation, Math.max(0, recognitionInterval(this.found, this.inferenceMs) - elapsed));
      };
      this.watchdog = setTimeout(() => { if (this.isCurrent(generation)) this.fail('Загрузка модели заняла слишком много времени. Повторите включение.'); }, 30_000);
      // Structured clone preserves the session cache; frames below are transferred without copying.
      worker.postMessage({ type: 'init', model, delegate });
    } catch (error) {
      if (this.isCurrent(generation)) this.fail(cameraError(error));
    }
  }

  private isCurrent(generation: number) { return this.active && generation === this.generation; }
  private fail(message: string) { this.stop('error'); this.options.onStatus('error', message); }
  private schedule(generation: number, delay: number) {
    this.timer = setTimeout(() => { this.timer = null; void this.capture(generation); }, delay);
  }
  private async capture(generation: number) {
    if (!this.isCurrent(generation) || !this.video || !this.worker) return;
    const video = this.video;
    if (video.readyState < 2 || video.currentTime === this.lastVideoTime) {
      if (performance.now() - this.lastFrameAt > 450) this.options.onSample(null, performance.now());
      this.schedule(generation, 100);
      return;
    }
    this.lastVideoTime = video.currentTime;
    const timestamp = performance.now();
    this.lastFrameAt = timestamp;
    let bitmap: ImageBitmap | null = null;
    try {
      const scale = Math.min(320 / video.videoWidth, 240 / video.videoHeight, 1);
      bitmap = await createImageBitmap(video, {
        resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
        resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
      });
      if (!this.isCurrent(generation) || !this.worker) { bitmap.close(); return; }
      this.watchdog = setTimeout(() => { if (this.isCurrent(generation)) this.fail('Распознавание не отвечает. Включите управление снова.'); }, 8_000);
      this.worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
      bitmap = null;
      // No next capture is scheduled until this worker reply: at most one in-flight frame.
    } catch (error) { bitmap?.close(); if (this.isCurrent(generation)) this.fail(cameraError(error)); }
  }
}
