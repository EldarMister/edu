import { AudioPlayer } from '@/lib/audio';

const players = { sender: new AudioPlayer(), receiver: new AudioPlayer() };

/** Optional cues must not stall microphone startup or incoming speech. */
export async function playPttCue(kind: 'start' | 'end', side: 'sender' | 'receiver' = 'sender'): Promise<void> {
  const player = players[side];
  let timer: number | undefined;
  try {
    await Promise.race([
      player.play(kind === 'start' ? '/sounds/ptt1.mp3' : '/sounds/ptt2.mp3'),
      new Promise<void>((resolve) => { timer = window.setTimeout(() => { player.stop(); resolve(); }, 3000); }),
    ]);
  } catch (error) {
    console.warn('[ptt] Не удалось воспроизвести сигнал:', error);
  } finally {
    window.clearTimeout(timer);
  }
}

export async function playPttMessage(playVoice: () => Promise<void>): Promise<void> {
  await playPttCue('start', 'receiver');
  try { await playVoice(); }
  finally { await playPttCue('end', 'receiver'); }
}
