import { Audio } from 'expo-av';

export type SoundKind = 'notify' | 'newOrder' | 'payment' | 'accept';

const SOURCES: Record<SoundKind, number> = {
  notify: require('../../assets/sounds/notify.mp3'),
  newOrder: require('../../assets/sounds/new-order.mp3'),
  payment: require('../../assets/sounds/payment sound.mp3'),
  accept: require('../../assets/sounds/accept.mp3'),
};

export async function beep(kind: SoundKind = 'notify') {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    });
    const { sound } = await Audio.Sound.createAsync(SOURCES[kind], { shouldPlay: true });
    sound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) {
        void sound.unloadAsync();
      }
    });
  } catch {
    // Звук не должен ломать основной сценарий.
  }
}
