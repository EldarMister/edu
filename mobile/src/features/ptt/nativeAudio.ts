import { Platform } from 'react-native';
import type { AudioContext, AudioRecorder, AudioScheduledSourceNode } from 'react-native-audio-api';
import { FRAME_SAMPLES, SPEECH_RATE } from './opusAudio';

const FLUSH_TIMEOUT_MS = 250;
const START_BUFFER_SECONDS = 0.14;
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
    recorder = new (audioApi().AudioRecorder)({ sampleRate: SPEECH_RATE, bufferLengthInSamples: FRAME_SAMPLES });
    recorder.onAudioReady(({ buffer, numFrames }) => {
      const current = capture;
      if (!current) return;
      if (numFrames > 0) current.onSamples(buffer.getChannelData(0).slice(0, numFrames));
      // Both native platforms send a final short buffer on stop, including
      // a zero-length buffer when the last full frame was already delivered.
      if (numFrames < FRAME_SAMPLES) current.finish?.(true);
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
  private readonly sources = new Map<AudioScheduledSourceNode, () => void>();

  push(samples: Float32Array, newTalk: boolean) {
    if (!this.context) {
      if (!capture) configureRadioAudioSession(false);
      this.context = new (audioApi().AudioContext)();
    }
    const context = this.context;
    const buffer = context.createBuffer(1, samples.length, SPEECH_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const ahead = this.endAt - context.currentTime;
    // Leave room for network jitter and catch up after bursts without dropping words.
    const rate = ahead > 0.75 ? 1.2 : ahead > 0.36 ? 1.08 : 1;
    const startAt = ahead > 0
      ? this.endAt + (newTalk ? CUE_SECONDS : 0)
      : context.currentTime + START_BUFFER_SECONDS;
    if (newTalk) this.cue(context, startAt - CUE_SECONDS, 760);
    source.playbackRate.value = rate;
    source.start(startAt);
    this.track(source);
    this.endAt = startAt + buffer.duration / rate;
  }

  endCue() {
    if (!this.context) return;
    const startAt = Math.max(this.endAt, this.context.currentTime);
    this.cue(this.context, startAt, 510);
    this.endAt = startAt + CUE_SECONDS;
  }

  remainingMs() {
    return this.context ? Math.max(0, (this.endAt - this.context.currentTime) * 1000) : 0;
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
