import { getAudioContext, resumeAudioContext } from '@/lib/audio';
import { PTT_CAPTURE_RATE, PTT_OPUS_PROFILES } from './opusAudio';
import { PTT_START_SOUND } from './sounds';

const START_BUFFER_SECONDS = 0.12;
const MAX_BUFFER_SECONDS = 0.3;
const SCHEDULING_MARGIN_SECONDS = 0.008;
const CUE_SECONDS = 0.05;
const FLUSH_TIMEOUT_MS = 250;

const modules = new WeakMap<AudioContext, Promise<void>>();

function prepareWorklet(ctx: AudioContext) {
  if (!ctx.audioWorklet) return Promise.reject(new Error('AudioWorklet unavailable'));
  let module = modules.get(ctx);
  if (!module) {
    module = ctx.audioWorklet.addModule('/ptt-capture.worklet.js?v=2').catch((error: unknown) => {
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
  const capture = new AudioWorkletNode(ctx, 'edu-ptt-capture', {
    channelCount: 1, channelCountMode: 'explicit', processorOptions: { sampleRate: PTT_CAPTURE_RATE },
  });
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

export class PttPlayback {
  private context?: AudioContext;
  private startCue?: AudioBuffer;
  private endAt = 0;
  private lastArrival?: number;
  private jitter = 0;
  private readonly sources = new Set<AudioScheduledSourceNode>();

  async prepareStartCue() {
    const ctx = getAudioContext();
    const response = await fetch(PTT_START_SOUND);
    if (!response.ok) return;
    this.startCue = await ctx.decodeAudioData(await response.arrayBuffer());
  }

  push(audio: unknown, startsTalk = false, sampleRate: number = PTT_OPUS_PROFILES.opus.sampleRate, framesInPacket = 1) {
    const frameSamples = sampleRate === PTT_CAPTURE_RATE
      ? PTT_OPUS_PROFILES['opus-hq'].frameSamples
      : PTT_OPUS_PROFILES.opus.frameSamples;
    if (!(audio instanceof ArrayBuffer && audio.byteLength === frameSamples * 2)
      && !(audio instanceof Float32Array && audio.length === frameSamples)) return false;
    const ctx = getAudioContext();
    if (ctx.state !== 'running') return false;
    if (this.context !== ctx) this.stop();
    this.context = ctx;

    const buffer = ctx.createBuffer(1, frameSamples, sampleRate);
    const samples = buffer.getChannelData(0);
    if (audio instanceof Float32Array) samples.set(audio);
    else {
      const input = new DataView(audio);
      for (let index = 0; index < samples.length; index++) samples[index] = input.getInt16(index * 2, true) / 32768;
    }
    const now = ctx.currentTime;
    if (framesInPacket > 0) {
      if (this.lastArrival !== undefined) {
        const elapsed = now - this.lastArrival;
        if (!startsTalk) {
          // Rebuffer after a stall based on recent jitter, then gradually return to the shorter delay.
          const expected = framesInPacket * buffer.duration;
          this.jitter = Math.min(MAX_BUFFER_SECONDS - START_BUFFER_SECONDS, Math.max(this.jitter * 0.96, elapsed - expected));
        } else if (elapsed > 1) {
          this.jitter *= Math.pow(0.5, elapsed);
        }
      }
      this.lastArrival = now;
    }
    const canContinue = this.endAt > 0 && this.endAt >= now - buffer.duration;
    const startCue = startsTalk ? this.startCue : undefined;
    const nextAt = Math.max(this.endAt, now + SCHEDULING_MARGIN_SECONDS);
    const cueEndAt = nextAt + (startCue?.duration ?? 0);
    const startAt = canContinue
      ? cueEndAt
      : Math.max(cueEndAt, now + START_BUFFER_SECONDS + this.jitter);
    if (startCue) this.playBuffer(ctx, startCue, startAt - startCue.duration);
    this.playBuffer(ctx, buffer, startAt);
    this.endAt = startAt + buffer.duration;
    return true;
  }

  endCue() {
    const ctx = this.context;
    if (ctx?.state !== 'running') return;
    const when = Math.max(this.endAt, ctx.currentTime);
    this.playCue(ctx, when, 510);
    this.endAt = when + CUE_SECONDS;
  }

  private playBuffer(ctx: AudioContext, buffer: AudioBuffer, when: number) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
    source.start(when);
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
    this.lastArrival = undefined;
    this.jitter = 0;
    this.context = undefined;
  }
}
