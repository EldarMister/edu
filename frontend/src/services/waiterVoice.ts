/**
 * Голосовые уведомления официанта через self-hosted Silero TTS (`/tts/synthesize`).
 *
 * Озвучивает события кухни по заказам официанта (принят / готов / отмена), называя
 * НОМЕР СТОЛА. Очередь — фразы проигрываются по очереди, не перебивая друг друга.
 * Если TTS недоступен или браузер заблокировал автозвук — тихо логируем, без сбоев.
 */
import { api } from '@/lib/api';
import { AudioPlayer } from '@/lib/audio';

/**
 * Голосовое уведомление актуально только «здесь и сейчас». Если TTS-сервис тормозит
 * (холодный старт/ночной сон) или вкладка была свёрнута, очередь копится, а потом
 * разом проигрывается — официант слышит «отменили заказ N» спустя час. Поэтому фразы
 * старше этого возраста при разборе очереди отбрасываем.
 */
const MAX_VOICE_AGE_MS = 30_000;

class WaiterVoice {
  private player = new AudioPlayer();
  private queue: { text: string; at: number }[] = [];
  private pumping = false;

  enqueue(text: string | null | undefined) {
    const t = (text ?? '').trim();
    if (!t) return;
    this.queue.push({ text: t, at: Date.now() });
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        if (Date.now() - item.at > MAX_VOICE_AGE_MS) continue; // устаревшая озвучка — пропускаем
        try {
          await this.playText(item.text);
        } catch (err) {
          console.error('[waiter-tts] озвучка не удалась:', err);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async playText(text: string): Promise<void> {
    const res = await api.post('/tts/synthesize', { text }, { responseType: 'blob', timeout: 45_000 });
    const url = URL.createObjectURL(res.data as Blob);
    try {
      await this.playUrl(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private playUrl(url: string): Promise<void> {
    return this.player.play(url);
  }
}

export const waiterVoice = new WaiterVoice();
export default waiterVoice;
