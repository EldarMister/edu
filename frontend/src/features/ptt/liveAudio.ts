import { getAudioContext, resumeAudioContext } from '@/lib/audio';

const SPEECH_RATE = 16000;
const FRAME_SAMPLES = 640;
const START_BUFFER_SECONDS = 0.14;
const CUE_SECONDS = 0.05;
const FLUSH_TIMEOUT_MS = 250;

const modules = new WeakMap<AudioContext, Promise<void>>();

function prepareWorklet(ctx: AudioContext) {
  if (!ctx.audioWorklet) return Promise.reject(new Error('AudioWorklet unavailable'));
  let module = modules.get(ctx);
  if (!module) {
    module = ctx.audioWorklet.addModule('/ptt-capture.worklet.js').catch((error: unknown) => {
      modules.delete(ctx);
      throw error;
    });
    modules.set(ctx, module);
  }
  return module;
}

export async function preparePttCapture() {
  await prepareWorklet(getAudioContext());
}

export async function createPttCapture(stream: MediaStream, onFrame: (audio: ArrayBuffer) => void, onError: () => void) {
  const ctx = await resumeAudioContext();
  await prepareWorklet(ctx);

  const source = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, 'edu-ptt-capture', { channelCount: 1, channelCountMode: 'explicit' });
  let timer: number | undefined;
  let drained: ((complete: boolean) => void) | undefined;
  function finishFlush(complete: boolean) {
    window.clearTimeout(timer);
    const resolve = drained;
    drained = undefined;
    resolve?.(complete);
  }
  capture.port.onmessage = (event: MessageEvent<ArrayBuffer | 'drained'>) => {
    if (event.data === 'drained') finishFlush(true);
    else onFrame(event.data);
  };
  capture.onprocessorerror = onError;
  return {
    connect() {
      // The worklet outputs silence. The microphone never plays through local speakers.
      source.connect(capture).connect(ctx.destination);
    },
    flush() {
      source.disconnect();
      return new Promise<boolean>((resolve) => {
        drained = resolve;
        timer = window.setTimeout(() => finishFlush(false), FLUSH_TIMEOUT_MS);
        capture.port.postMessage('flush');
      });
    },
    close() {
      finishFlush(false);
      capture.port.onmessage = null;
      capture.onprocessorerror = null;
      capture.port.close();
      source.disconnect();
      capture.disconnect();
    },
  };
}

function cue(ctx: AudioContext, when: number, frequency: number) {
  const tone = ctx.createOscillator();
  const gain = ctx.createGain();
  tone.frequency.value = frequency;
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(0.06, when + 0.005);
  gain.gain.linearRampToValueAtTime(0, when + CUE_SECONDS);
  tone.connect(gain).connect(ctx.destination);
  tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  tone.start(when);
  tone.stop(when + CUE_SECONDS);
  return tone;
}

export function playPttReadyCue() {
  const ctx = getAudioContext();
  if (ctx.state === 'running') cue(ctx, ctx.currentTime, 760);
}

export class PttPlayback {
  private context?: AudioContext;
  private endAt = 0;
  private readonly sources = new Set<AudioScheduledSourceNode>();

  push(audio: unknown, startsTalk = false) {
    if (!(audio instanceof ArrayBuffer && audio.byteLength === FRAME_SAMPLES * 2)
      && !(audio instanceof Float32Array && audio.length === FRAME_SAMPLES)) return false;
    const ctx = getAudioContext();
    if (ctx.state !== 'running') return false;
    if (this.context !== ctx) this.stop();
    this.context = ctx;

    const buffer = ctx.createBuffer(1, FRAME_SAMPLES, SPEECH_RATE);
    const samples = buffer.getChannelData(0);
    if (audio instanceof Float32Array) samples.set(audio);
    else {
      const input = new DataView(audio);
      for (let index = 0; index < samples.length; index++) samples[index] = input.getInt16(index * 2, true) / 32768;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };

    const ahead = this.endAt - ctx.currentTime;
    // Catch up after bursts by slightly speeding up queued speech, without discarding whole frames.
    const rate = ahead > 0.75 ? 1.2 : ahead > 0.36 ? 1.08 : 1;
    const startAt = ahead > 0
      ? this.endAt + (startsTalk ? CUE_SECONDS : 0)
      : ctx.currentTime + START_BUFFER_SECONDS;
    if (startsTalk) this.playCue(ctx, startAt - CUE_SECONDS, 760);
    source.playbackRate.value = rate;
    source.start(startAt);
    this.endAt = startAt + buffer.duration / rate;
    return true;
  }

  endCue() {
    const ctx = this.context;
    if (ctx?.state !== 'running') return;
    const when = Math.max(this.endAt, ctx.currentTime);
    this.playCue(ctx, when, 510);
    this.endAt = when + CUE_SECONDS;
  }

  private playCue(ctx: AudioContext, when: number, frequency: number) {
    const tone = cue(ctx, when, frequency);
    const disconnect = tone.onended;
    this.sources.add(tone);
    tone.onended = (event) => {
      this.sources.delete(tone);
      disconnect?.call(tone, event);
    };
  }

  remainingMs() {
    return this.context ? Math.max(0, (this.endAt - this.context.currentTime) * 1000) : 0;
  }

  stop() {
    for (const source of this.sources) {
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.endAt = 0;
    this.context = undefined;
  }
}
