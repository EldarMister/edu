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
import { getKitchenVoiceSettings } from './kitchenVoiceSettings';

class KitchenVoice {
  private queue: string[] = [];
  private pumping = false;
  private current: HTMLAudioElement | null = null;

  /** Добавить текст в очередь озвучки. Текст формирует backend. */
  enqueue(text: string | null | undefined) {
    const t = (text ?? '').trim();
    if (!t) return;
    if (!getKitchenVoiceSettings().voiceEnabled) return;
    this.queue.push(t);
    void this.pump();
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
    const settings = getKitchenVoiceSettings();
    if (!settings.voiceEnabled) return;
    const res = await api.post(
      '/tts/synthesize',
      {
        text,
        speaker: settings.speaker,
        preferredModel: settings.preferredModel,
        fallbackModel: settings.fallbackModel,
      },
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(res.data as Blob);
    try {
      await this.playUrl(url, settings.speechRate);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private playUrl(url: string, playbackRate: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audio.playbackRate = playbackRate;
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
