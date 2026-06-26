import { Audio } from 'expo-av';

export type SoundKind = 'notify' | 'newOrder' | 'payment' | 'accept';

const SOURCES: Record<SoundKind, number> = {
  notify: require('../../assets/sounds/notify.mp3'),
  newOrder: require('../../assets/sounds/new-order.mp3'),
  payment: require('../../assets/sounds/payment sound.mp3'),
  accept: require('../../assets/sounds/accept.mp3'),
};

export async function configureAudioPlayback() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

export async function beep(kind: SoundKind = 'notify') {
  try {
    await configureAudioPlayback();
    const { sound } = await Audio.Sound.createAsync(SOURCES[kind], {
      shouldPlay: false,
      volume: 1,
      rate: 1,
    });
    sound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) {
        void sound.unloadAsync();
      }
    });
    await sound.playAsync();
  } catch {
    // Звук не должен ломать основной сценарий.
  }
}
