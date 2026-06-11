/**
 * Озвучка кухни через self-hosted Silero TTS (backend `/tts/synthesize`).
 *
 * Web Speech API / speechSynthesis НЕ используется (полностью удалён).
 * Если TTS-сервис недоступен — ошибка логируется, голос устройства не включается,
 * кухня продолжает работать без озвучки.
 *
 * Очередь: озвучки проигрываются строго по очереди и не перебивают друг друга.
 */
import { api } from '@/lib/api';

class KitchenVoice {
  private queue: string[] = [];
  private pumping = false;
  private current: HTMLAudioElement | null = null;
  /** Текст последнего озвученного заказа — для голосовой команды «повтори заказ». */
  private lastOrderText = '';

  /** Добавить текст в очередь озвучки. Текст формирует backend. */
  enqueue(text: string | null | undefined) {
    const t = (text ?? '').trim();
    if (!t) return;
    this.queue.push(t);
    void this.pump();
  }

  /** Запомнить текст заказа (для «повтори заказ»). */
  remember(text: string | null | undefined) {
    const t = (text ?? '').trim();
    if (t) this.lastOrderText = t;
  }

  /** Повторить последний озвученный заказ. true — если было что повторять. */
  repeatLast(): boolean {
    if (!this.lastOrderText) return false;
    this.enqueue(this.lastOrderText);
    return true;
  }

  /** Немедленно остановить речь и очистить очередь («замолчи» / «заткнись»). */
  stopAll() {
    this.queue = [];
    if (this.current) {
      try {
        this.current.pause();
        this.current.currentTime = 0;
      } catch {
        // элемент уже мог быть освобождён
      }
      this.current = null;
    }
  }

  /** Произнести фразу немедленно (вне очереди), дождаться окончания — для голосовых подсказок. */
  async say(text: string): Promise<void> {
    const t = (text ?? '').trim();
    if (!t) return;
    await this.playText(t);
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const text = this.queue.shift()!;
        try {
          await this.playText(text);
        } catch (err) {
          // Сервис недоступен или браузер заблокировал — без голоса устройства.
          console.error('[kitchen-tts] озвучка не удалась:', err);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async playText(text: string): Promise<void> {
    const res = await api.post('/tts/synthesize', { text }, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    try {
      await this.playUrl(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private playUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      this.current = audio;
      const done = () => {
        if (this.current === audio) this.current = null;
      };
      audio.onended = () => {
        done();
        resolve();
      };
      audio.onerror = () => {
        done();
        reject(new Error('Ошибка воспроизведения аудио'));
      };
      audio.play().catch((err) => {
        done();
        reject(err);
      });
    });
  }
}

export const kitchenVoice = new KitchenVoice();
export default kitchenVoice;
