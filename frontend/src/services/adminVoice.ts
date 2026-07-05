import { api } from '@/lib/api';

/** Устаревшие озвучки не проигрываем: очередь могла скопиться при тормозящем TTS. */
const MAX_VOICE_AGE_MS = 30_000;

class AdminVoice {
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
          console.error('[admin-tts] озвучка не удалась:', err);
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
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Ошибка воспроизведения аудио'));
      audio.play().catch(reject);
    });
  }
}

export const adminVoice = new AdminVoice();
