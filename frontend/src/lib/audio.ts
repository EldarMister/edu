/** Shared audio resources must be unlocked inside a gesture, before any network await. */
const players = new Set<AudioPlayer>();
let context: AudioContext | null = null;
let recording = false;
let installed = false;
const blockedPlayers = new Set<AudioPlayer>();
const statusListeners = new Set<() => void>();

export const audioNeedsGesture = () => blockedPlayers.size > 0;
export function subscribeAudioStatus(listener: () => void) {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}
function setBlocked(player: AudioPlayer, blocked: boolean) {
  const previous = audioNeedsGesture();
  if (blocked) blockedPlayers.add(player); else blockedPlayers.delete(player);
  if (previous !== audioNeedsGesture()) statusListeners.forEach((listener) => listener());
}

function setSessionType(type: 'playback' | 'play-and-record') {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  try {
    if (session) session.type = type;
  } catch { /* Older Safari versions do not support every session type. */ }
}

export function setAudioRecording(value: boolean) {
  recording = value;
  setSessionType(value ? 'play-and-record' : 'playback');
  if (!value) void resumeAudioContext().catch(() => undefined);
}

export function getAudioContext(): AudioContext {
  if (!context || context.state === 'closed') {
    const Constructor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) throw new Error('AudioContext недоступен');
    context = new Constructor();
  }
  return context;
}

export async function resumeAudioContext(): Promise<AudioContext> {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') {
    // iOS can leave resume() pending until the next gesture. Never block a queue forever.
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Звук ожидает касания экрана')), 1500);
      ctx.resume().then(() => { clearTimeout(timer); resolve(); }, (error) => { clearTimeout(timer); reject(error); });
    });
  }
  return ctx;
}

// A real, non-empty PCM WAV; a header with zero samples is rejected by Safari.
function silentWav(): string {
  const buffer = new ArrayBuffer(204);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 196, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 160, true);
  return 'data:audio/wav;base64,' + btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export function unlockAudio() {
  if (!recording) setSessionType('playback');
  try {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => undefined);
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(ctx.destination);
      source.onended = () => source.disconnect();
      source.start();
    }
  } catch { /* HTML audio remains available without Web Audio. */ }
  players.forEach((player) => player.unlock());
}

export function installAudioUnlock() {
  if (installed) return;
  installed = true;
  // Keep listening: a phone call / screen lock can suspend audio again.
  for (const event of ['pointerdown', 'touchend', 'click', 'keydown']) {
    document.addEventListener(event, unlockAudio, { capture: true, passive: true });
  }
  const restore = () => {
    if (document.visibilityState !== 'visible') return;
    if (!recording) setSessionType('playback');
    if (context) void resumeAudioContext().catch(() => undefined);
    players.forEach((player) => player.resume());
  };
  document.addEventListener('visibilitychange', restore);
  window.addEventListener('pageshow', restore);
}

/** Reuse the SAME element: Safari's autoplay permission is per media element. */
export class AudioPlayer {
  private audio = new Audio();
  private unlocked = false;
  private priming = false;
  private finish: ((error?: Error) => void) | null = null;

  constructor() {
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    players.add(this);
  }

  unlock() {
    if (this.finish) { this.resume(); return; }
    if (this.unlocked || this.priming) return;
    this.priming = true;
    this.audio.src = silentWav();
    void this.audio.play().then(() => { this.unlocked = true; setBlocked(this, false); }, () => undefined)
      .finally(() => { this.priming = false; });
  }

  resume() {
    if (!this.finish || !this.audio.paused) return;
    const finish = this.finish;
    void this.audio.play().then(() => {
      if (this.finish !== finish) return;
      this.unlocked = true;
      setBlocked(this, false);
    }).catch((error: Error) => {
      if (this.finish !== finish) return;
      // Retry a blocked/interrupted play on the next gesture or foreground event.
      if (error.name === 'NotAllowedError') {
        this.unlocked = false;
        setBlocked(this, true);
      } else if (error.name !== 'AbortError') finish(error);
    });
  }

  stop() { this.finish?.(); }

  play(url: string, playbackRate = 1): Promise<void> {
    this.stop();
    if (!recording) setSessionType('playback');
    return new Promise((resolve, reject) => {
      // Bound both autoplay waits and stalled files so subsequent messages can play.
      let timer = window.setTimeout(() => done(new Error('Звук не запустился. Коснитесь экрана.')), 10_000);
      const done = (error?: Error) => {
        if (this.finish !== done) return;
        clearTimeout(timer);
        this.finish = null;
        this.audio.onended = this.audio.onerror = this.audio.onplaying = null;
        this.audio.pause();
        this.audio.removeAttribute('src');
        error ? reject(error) : resolve();
      };
      this.finish = done;
      this.audio.onended = () => done();
      this.audio.onerror = () => done(new Error('Ошибка воспроизведения аудио'));
      this.audio.onplaying = () => {
        clearTimeout(timer);
        const duration = Number.isFinite(this.audio.duration) ? this.audio.duration / playbackRate : 120;
        timer = window.setTimeout(() => done(new Error('Воспроизведение прервано')), (duration + 15) * 1000);
      };
      this.audio.pause();
      this.audio.src = url;
      this.audio.playbackRate = playbackRate;
      this.audio.volume = 1;
      this.resume();
    });
  }
}

/** Lift quiet speech, cap amplification, and leave headroom for loud syllables. */
export function speechGain(buffer: AudioBuffer): number {
  let peak = 0;
  let energy = 0;
  let count = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (const sample of samples) {
      peak = Math.max(peak, Math.abs(sample));
      energy += sample * sample;
      count++;
    }
  }
  const rms = Math.sqrt(energy / Math.max(1, count));
  if (rms < 0.001 || peak === 0) return 1;
  return Math.min(8, 0.95 / peak, Math.max(1, 0.16 / rms));
}

export function normalizedRadioWav(buffer: AudioBuffer): Blob {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const bytesPerFrame = channels.length * 2;
  const dataSize = buffer.length * bytesPerFrame;
  const bytes = new ArrayBuffer(44 + dataSize);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, dataSize, true);
  const gain = speechGain(buffer);
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[i] * gain));
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

// Use the same media playback path as notifications. Direct Web Audio output can
// use an ambient/quiet route on iOS, especially after microphone access.
const radioPlayer = new AudioPlayer();

export async function playRadioAudio(blob: Blob): Promise<void> {
  let playable = blob;
  try {
    // Decoding works even when the context is suspended; no resume() wait here.
    const buffer = await getAudioContext().decodeAudioData(await blob.arrayBuffer());
    playable = normalizedRadioWav(buffer);
  } catch (error) {
    console.warn('[ptt] Нормализация недоступна, воспроизводим исходную запись:', error);
  }
  const url = URL.createObjectURL(playable);
  try { await radioPlayer.play(url); } finally { URL.revokeObjectURL(url); }
}
