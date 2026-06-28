import { Audio } from 'expo-av';
import { Asset } from 'expo-asset';

export type SoundKind = 'notify' | 'newOrder' | 'payment' | 'accept';

const SOURCES: Record<SoundKind, number> = {
  notify: require('../../assets/sounds/notify.mp3'),
  newOrder: require('../../assets/sounds/new_order.mp3'),
  payment: require('../../assets/sounds/payment_sound.mp3'),
  accept: require('../../assets/sounds/accept.mp3'),
};

const activeSounds = new Set<Audio.Sound>();
const loadedAssets: Partial<Record<SoundKind, Asset>> = {};

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

    const created = await Audio.Sound.createAsync(
      SOURCES[kind],
      {
        shouldPlay: true,
        volume: 1,
        rate: 1,
        progressUpdateIntervalMillis: 100,
      },
      undefined,
      true,
    );
    sound = created.sound;
    const playbackSound = sound;

    activeSounds.add(playbackSound);
    playbackSound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded || status.didJustFinish) {
        activeSounds.delete(playbackSound);
        playbackSound.setOnPlaybackStatusUpdate(null);
        void playbackSound.unloadAsync().catch(() => undefined);
      }
    });

    return true;
  } catch (err) {
    if (sound) {
      activeSounds.delete(sound);
      await sound.unloadAsync().catch(() => undefined);
    }
    try {
      const asset = loadedAssets[kind] ?? Asset.fromModule(SOURCES[kind]);
      if (!asset.localUri) await asset.downloadAsync();
      loadedAssets[kind] = asset;

      const created = await Audio.Sound.createAsync(
        { uri: asset.localUri ?? asset.uri },
        {
          shouldPlay: true,
          volume: 1,
          rate: 1,
          progressUpdateIntervalMillis: 100,
        },
      );
      const fallbackSound = created.sound;
      activeSounds.add(fallbackSound);
      fallbackSound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded || status.didJustFinish) {
          activeSounds.delete(fallbackSound);
          fallbackSound.setOnPlaybackStatusUpdate(null);
          void fallbackSound.unloadAsync().catch(() => undefined);
        }
      });
      return true;
    } catch (fallbackErr) {
      // Звук не должен ломать основной сценарий.
      console.warn('[sound] Не удалось воспроизвести звук:', fallbackErr);
      return false;
    }
  }
}
