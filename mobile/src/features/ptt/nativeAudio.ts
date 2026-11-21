import { Platform } from 'react-native';
import type { AudioContext, AudioRecorder, AudioScheduledSourceNode } from 'react-native-audio-api';
import { CAPTURE_RATE, CAPTURE_SAMPLES } from './opusAudio';

const FLUSH_TIMEOUT_MS = 250;
const START_BUFFER_SECONDS = 0.10;
const MAX_BUFFER_SECONDS = 0.24;
const RENDER_GUARD_SECONDS = 0.008;
const OUTPUT_DRAIN_SECONDS = 0.06;
const CUE_SECONDS = 0.05;

function audioApi(): typeof import('react-native-audio-api') {
  return require('react-native-audio-api');
}

export function configureRadioAudioSession(recording: boolean) {
  if (Platform.OS !== 'ios') return;
  audioApi().AudioManager.setAudioSessionOptions(recording
    ? { iosCategory: 'playAndRecord', iosMode: 'voiceChat', iosOptions: ['defaultToSpeaker', 'allowBluetooth'] }
    : { iosCategory: 'playback', iosMode: 'default', iosOptions: ['mixWithOthers'] });
}

type Capture = {
  onSamples: (samples: Float32Array) => void;
  finish?: (flushed: boolean) => void;
};
let recorder: AudioRecorder | undefined;
let capture: Capture | undefined;

export function startRadioCapture(onSamples: Capture['onSamples']) {
  if (capture) throw new Error('Radio microphone already active');
  // One callback for the lifetime of the RN audio engine. This SDK's recorder
  // does not expose removal of an audioReady callback.
  if (!recorder) {
    recorder = new (audioApi().AudioRecorder)({ sampleRate: CAPTURE_RATE, bufferLengthInSamples: CAPTURE_SAMPLES });
    recorder.onAudioReady(({ buffer, numFrames }) => {
      const current = capture;
      if (!current) return;
      if (numFrames > 0) current.onSamples(buffer.getChannelData(0).slice(0, numFrames));
      // Both native platforms send a final short buffer on stop, including
      // a zero-length buffer when the last full frame was already delivered.
      if (numFrames < CAPTURE_SAMPLES) current.finish?.(true);
    });
  }
  const current: Capture = { onSamples };
  capture = current;
  try {
    recorder.start();
  } catch (error) {
    capture = undefined;
    throw error;
  }
  let drain: Promise<boolean> | undefined;
  return {
    stop() {
      drain ??= new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => current.finish?.(false), FLUSH_TIMEOUT_MS);
        current.finish = (flushed) => {
          clearTimeout(timer);
          current.finish = undefined;
          if (capture === current) capture = undefined;
          resolve(flushed);
        };
        try { recorder?.stop(); } catch { current.finish(false); }
      });
      return drain;
    },
  };
}

export class RadioPlayout {
  private context?: AudioContext;
  private endAt = 0;
  private expectedArrival?: number;
  private jitter = 0;
  private readonly sources = new Map<AudioScheduledSourceNode, () => void>();

  push(samples: Float32Array, newTalk: boolean, sampleRate: number) {
    if (!samples.length) return;
    if (!this.context) {
      if (!capture) configureRadioAudioSession(false);
      this.context = new (audioApi().AudioContext)();
    }
    const context = this.context;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const now = context.currentTime;
    if (!newTalk && this.expectedArrival !== undefined) {
      const deviation = Math.min(MAX_BUFFER_SECONDS, Math.abs(now - this.expectedArrival));
      this.jitter += (deviation - this.jitter) / 16;
    }
    this.expectedArrival = now + buffer.duration;

    let startAt = this.endAt;
    if (newTalk) {
      const headroom = Math.min(MAX_BUFFER_SECONDS, START_BUFFER_SECONDS + 4 * this.jitter);
      startAt = Math.max(startAt + CUE_SECONDS, now + headroom);
    } else if (startAt < now + RENDER_GUARD_SECONDS) {
      // Leave enough audio queued after a stall to avoid repeated underruns.
      // Packets already queued always play back-to-back at their original speed.
      const headroom = Math.min(MAX_BUFFER_SECONDS, Math.max(0.06, 0.03 + 4 * this.jitter));
      startAt = now + headroom;
    }
    if (newTalk) this.cue(context, startAt - CUE_SECONDS, 760);
    source.start(startAt);
    this.track(source);
    this.endAt = startAt + buffer.duration;
  }

  endCue() {
    if (!this.context) return;
    const startAt = Math.max(this.endAt, this.context.currentTime + RENDER_GUARD_SECONDS);
    this.cue(this.context, startAt, 510);
    this.endAt = startAt + CUE_SECONDS;
  }

  remainingMs() {
    return this.context
      ? Math.max(0, (this.endAt + OUTPUT_DRAIN_SECONDS - this.context.currentTime) * 1000)
      : 0;
  }

  stop() {
    for (const [source, release] of this.sources) {
      source.onEnded = null;
      source.stop();
      release();
    }
    this.sources.clear();
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.endAt = 0;
    this.expectedArrival = undefined;
  }

  private track(source: AudioScheduledSourceNode, after?: () => void) {
    const release = () => {
      source.disconnect();
      after?.();
    };
    this.sources.set(source, release);
    source.onEnded = () => {
      this.sources.delete(source);
      source.onEnded = null;
      release();
    };
  }

  private cue(context: AudioContext, when: number, frequency: number) {
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.06, when + 0.005);
    gain.gain.linearRampToValueAtTime(0, when + CUE_SECONDS);
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start(when);
    this.track(tone, () => gain.disconnect());
    tone.stop(when + CUE_SECONDS);
  }
}
