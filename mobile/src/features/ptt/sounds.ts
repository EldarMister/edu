import { Audio } from 'expo-av';
import { configureAudioPlayback } from '@/lib/sound';

export const PTT_START_SOUND = require('../../../assets/sounds/ptt1.mp3');
const SOURCES = {
  start: PTT_START_SOUND,
  end: require('../../../assets/sounds/ptt2.mp3'),
};

/** The same PWA cues, with a deadline so an optional sound cannot stall the radio. */
export async function playPttCue(
  kind: 'start' | 'end',
  signal?: AbortSignal,
  { configureMode = true, timeoutMs = 3000 }: { configureMode?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  if (signal?.aborted) return;
  let sound: Audio.Sound | null = null;
  let expired = false;
  let finish = () => {};
  const done = new Promise<void>(resolve => { finish = resolve; });
  const cancel = () => { expired = true; finish(); };
  const timeout = setTimeout(cancel, timeoutMs);
  signal?.addEventListener('abort', cancel);
  const release = async (value: Audio.Sound) => {
    value.setOnPlaybackStatusUpdate(null);
    await value.unloadAsync().catch(() => undefined);
  };
  // Native asset creation can complete after the deadline/logout. It must never autoplay.
  void (async () => {
    try {
      if (configureMode) await configureAudioPlayback();
      if (expired) return;
      const created = await Audio.Sound.createAsync(SOURCES[kind], { shouldPlay: false, volume: 1 });
      if (expired) { await release(created.sound); return; }
      sound = created.sound;
      sound.setOnPlaybackStatusUpdate(status => {
        if ((!status.isLoaded && 'error' in status) || (status.isLoaded && status.didJustFinish)) finish();
      });
      await sound.playAsync();
    } catch { finish(); }
  })();
  try { await done; }
  finally {
    expired = true;
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    if (sound) await release(sound);
  }
}
