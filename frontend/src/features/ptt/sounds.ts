import { AudioPlayer } from '@/lib/audio';

export const PTT_START_SOUND = '/sounds/ptt1.mp3';
const players = { sender: new AudioPlayer(), receiver: new AudioPlayer() };

/** Optional cues must not stall microphone startup or incoming speech. */
export async function playPttCue(
  kind: 'start' | 'end',
  side: 'sender' | 'receiver' = 'sender',
  { signal, timeoutMs = 3000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  if (signal?.aborted) return;
  const player = players[side];
  const stop = () => player.stop();
  signal?.addEventListener('abort', stop, { once: true });
  let timer: number | undefined;
  try {
    await Promise.race([
      player.play(kind === 'start' ? PTT_START_SOUND : '/sounds/ptt2.mp3'),
      new Promise<void>((resolve) => { timer = window.setTimeout(() => { stop(); resolve(); }, timeoutMs); }),
    ]);
  } catch (error) {
    console.warn('[ptt] Не удалось воспроизвести сигнал:', error);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

export async function playPttMessage(playVoice: () => Promise<void>): Promise<void> {
  await playPttCue('start', 'receiver');
  try { await playVoice(); }
  finally { await playPttCue('end', 'receiver'); }
}
