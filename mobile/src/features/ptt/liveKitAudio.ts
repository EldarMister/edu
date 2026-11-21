import { AndroidAudioTypePresets, AudioSession } from '@livekit/react-native';
import { AppState } from 'react-native';
import type { Room } from 'livekit-client';
import { playPttCue } from './sounds';

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

export function radioCue(_side: 'sender' | 'receiver') {
  void playPttCue('start').catch(() => undefined);
}
