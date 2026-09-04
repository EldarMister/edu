import { api } from '@/lib/api';
import { AudioPlayer, unlockAudio } from '@/lib/audio';

const player = new AudioPlayer();

type AnnounceRef = { code?: string | null; cafe?: string | null };

/** Устаревшие озвучки табло не проигрываем: очередь могла скопиться при тормозящем TTS. */
const MAX_VOICE_AGE_MS = 30_000;

/**
 * Очередь озвучек табло. Тянет готовый WAV с публичного /queue/announce и
 * проигрывает строго по очереди, не перебивая. Включается жестом пользователя.
 */
class QueueVoice {
  private queue: { ref: AnnounceRef; orderId: string; at: number }[] = [];
  private pumping = false;
  enabled = false;

  /** Разблокировать аудио (вызывать из обработчика клика). */
  unlock() {
    this.enabled = true;
    unlockAudio();
  }

  disable() {
    this.enabled = false;
    this.queue = [];
    player.stop();
  }

  enqueue(ref: AnnounceRef, orderId: string) {
    if (!this.enabled) return;
    this.queue.push({ ref, orderId, at: Date.now() });
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const { ref, orderId, at } = this.queue.shift()!;
        if (Date.now() - at > MAX_VOICE_AGE_MS) continue; // устаревшая озвучка — пропускаем
        try {
          const params: Record<string, string> = { order: orderId };
          if (ref.code) params.code = ref.code;
          else if (ref.cafe) params.cafe = ref.cafe;
          const res = await api.get('/queue/announce', { params, responseType: 'blob' });
          if (!this.enabled || Date.now() - at > MAX_VOICE_AGE_MS) continue;
          const url = URL.createObjectURL(res.data as Blob);
          try {
            await player.play(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch (err) {
          console.error('[queue-tts] озвучка не удалась:', err);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}

export const queueVoice = new QueueVoice();
