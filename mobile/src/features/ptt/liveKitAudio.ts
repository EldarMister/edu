import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { AppState, Platform } from 'react-native';
import type { Room } from 'livekit-client';
import { playPttCue } from './sounds';
import { loadRadioStartCue } from './nativeAudio';

let sessions = 0;
let audioMode = Promise.resolve();

export async function activateRadioAudio() {
  sessions++;
  if (sessions === 1) {
    audioMode = audioMode.catch(() => undefined).then(async () => {
      await AudioSession.configureAudio({
        android: {
          audioTypeOptions: AndroidAudioTypePresets.communication,
          preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
        },
      });
      await AudioSession.startAudioSession();
    });
  }
  const release = () => {
    sessions--;
    if (sessions === 0) {
      audioMode = audioMode.catch(() => undefined).then(() => AudioSession.stopAudioSession());
      void audioMode.catch(() => undefined);
    }
  };
  try {
    await audioMode;
    prepareRadioCue();
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

// The native WebRTC audio device renders subscribed tracks directly.
export function attachRemoteAudio(_room: Room) {
  return () => {};
}

export function observeRadioInterruption(interrupt: () => void) {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') interrupt();
  });
  return () => subscription.remove();
}

export function prepareRadioCue() {
  if (Platform.OS === 'android') void loadRadioStartCue();
}

const CUE_TIMEOUT_MS = 425;

export async function radioCue(_side: 'sender' | 'receiver', signal?: AbortSignal) {
  if (signal?.aborted) return;
  if (Platform.OS !== 'android') {
    await playPttCue('start', signal, { configureMode: false, timeoutMs: CUE_TIMEOUT_MS });
    return;
  }

  // Use local PCM playback without Expo AV taking the WebRTC audio focus.
  let expired = false;
  let context: import('react-native-audio-api').AudioContext | undefined;
  let finish = () => {};
  const done = new Promise<void>(resolve => { finish = resolve; });
  const timer = setTimeout(finish, CUE_TIMEOUT_MS);
  signal?.addEventListener('abort', finish, { once: true });
  void loadRadioStartCue().then(buffer => {
    if (!buffer || expired) { finish(); return; }
    const { AudioContext } = require('react-native-audio-api') as typeof import('react-native-audio-api');
    context = new AudioContext();
    const source = context.createBufferSource();
    const volume = context.createGain();
    volume.gain.value = 0.45;
    source.buffer = buffer;
    source.connect(volume);
    volume.connect(context.destination);
    source.onEnded = finish;
    source.start();
  }).catch(finish);
  try {
    await done;
  } finally {
    expired = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', finish);
    await context?.close().catch(() => undefined);
  }
}
