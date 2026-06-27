import { Audio } from 'expo-av';

export type SoundKind = 'notify' | 'newOrder' | 'payment' | 'accept';

const SOURCES: Record<SoundKind, number> = {
  notify: require('../../assets/sounds/notify.mp3'),
  newOrder: require('../../assets/sounds/new_order.mp3'),
  payment: require('../../assets/sounds/payment_sound.mp3'),
  accept: require('../../assets/sounds/accept.mp3'),
};

const activeSounds = new Set<Audio.Sound>();

export async function configureAudioPlayback() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
}

export async function beep(kind: SoundKind = 'notify'): Promise<boolean> {
  let sound: Audio.Sound | null = null;
  try {
    await configureAudioPlayback();
    const created = await Audio.Sound.createAsync(SOURCES[kind], {
      shouldPlay: true,
      volume: 1,
      rate: 1,
    });

    sound = created.sound;
    activeSounds.add(sound);

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timeout = setTimeout(finish, 2500);

      sound!.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          clearTimeout(timeout);
          finish();
          return;
        }
        if (status.didJustFinish) {
          clearTimeout(timeout);
          finish();
        }
      });
    });

    return true;
  } catch (err) {
    // Звук не должен ломать основной сценарий.
    console.warn('[sound] Не удалось воспроизвести звук:', err);
    return false;
  } finally {
    if (sound) {
      activeSounds.delete(sound);
      await sound.unloadAsync().catch(() => undefined);
    }
  }
}
