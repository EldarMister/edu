import { api } from '@/lib/api';

class AdminVoice {
  private queue: string[] = [];
  private pumping = false;

  enqueue(text: string | null | undefined) {
    const t = (text ?? '').trim();
    if (!t) return;
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
          console.error('[admin-tts] озвучка не удалась:', err);
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
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Ошибка воспроизведения аудио'));
      audio.play().catch(reject);
    });
  }
}

export const adminVoice = new AdminVoice();
