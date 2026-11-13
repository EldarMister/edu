/**
 * Голосовые уведомления официанта через self-hosted Silero TTS (`/tts/synthesize`).
 *
 * Озвучивает события кухни по заказам официанта (принят / готов / отмена), называя
 * НОМЕР СТОЛА. Очередь — фразы проигрываются по очереди, не перебивая друг друга.
 * Если TTS недоступен или браузер заблокировал автозвук — тихо логируем, без сбоев.
 */
import { api } from '@/lib/api';
import { AudioPlayer } from '@/lib/audio';
import { useAuth } from '@/store/auth';
import { getWaiterVoiceSettings } from './kitchenVoiceSettings';

/**
 * Голосовое уведомление актуально только «здесь и сейчас». Если TTS-сервис тормозит
 * (холодный старт/ночной сон) или вкладка была свёрнута, очередь копится, а потом
 * разом проигрывается — официант слышит «отменили заказ N» спустя час. Поэтому фразы
 * старше этого возраста при разборе очереди отбрасываем.
 */
const MAX_VOICE_AGE_MS = 30_000;

class WaiterVoice {
  private player = new AudioPlayer();
  private queue: { text: string; at: number; userId: string }[] = [];
  private pumping = false;

  enqueue(text: string | null | undefined) {
    const t = (text ?? '').trim();
    const userId = useAuth.getState().user?.id;
    if (!t || !userId) return;
    this.queue.push({ text: t, at: Date.now(), userId });
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
          await this.playText(item.text, item.userId);
        } catch (err) {
          console.error('[waiter-tts] озвучка не удалась:', err);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async playText(text: string, userId: string): Promise<void> {
    if (useAuth.getState().user?.id !== userId) return;
    const { speaker, speechRate } = getWaiterVoiceSettings(userId);
    const res = await api.post('/tts/synthesize', { text, speaker }, { responseType: 'blob', timeout: 45_000 });
    if (useAuth.getState().user?.id !== userId) return;
    const url = URL.createObjectURL(res.data as Blob);
    try {
      await this.player.play(url, speechRate);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

}

export const waiterVoice = new WaiterVoice();
export default waiterVoice;
