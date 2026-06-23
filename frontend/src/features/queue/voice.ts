import { api } from '@/lib/api';

/** Короткий «тихий» WAV — проигрываем в обработчике клика, чтобы разблокировать
 *  автоплей аудио на ТВ/в браузере (политика autoplay требует жеста). */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

type AnnounceRef = { code?: string | null; cafe?: string | null };

/**
 * Очередь озвучек табло. Тянет готовый WAV с публичного /queue/announce и
 * проигрывает строго по очереди, не перебивая. Включается жестом пользователя.
 */
class QueueVoice {
  private queue: { ref: AnnounceRef; orderId: string }[] = [];
  private pumping = false;
  enabled = false;

  /** Разблокировать аудио (вызывать из обработчика клика). */
  unlock() {
    this.enabled = true;
    const a = new Audio(SILENT_WAV);
    a.play().catch(() => {
      /* не критично — следующий жест разблокирует */
    });
  }

  disable() {
    this.enabled = false;
    this.queue = [];
  }

  enqueue(ref: AnnounceRef, orderId: string) {
    if (!this.enabled) return;
    this.queue.push({ ref, orderId });
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const { ref, orderId } = this.queue.shift()!;
        try {
          const params: Record<string, string> = { order: orderId };
          if (ref.code) params.code = ref.code;
          else if (ref.cafe) params.cafe = ref.cafe;
          const res = await api.get('/queue/announce', { params, responseType: 'blob' });
          const url = URL.createObjectURL(res.data as Blob);
          try {
            await playUrl(url);
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

function playUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Ошибка воспроизведения аудио'));
    audio.play().catch(reject);
  });
}

export const queueVoice = new QueueVoice();
