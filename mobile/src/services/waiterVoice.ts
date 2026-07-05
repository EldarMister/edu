import { Audio } from 'expo-av';
import { api } from '@/lib/api';
import { configureAudioPlayback } from '@/lib/sound';
import { deleteTempFile, wavBufferToTempFile } from '@/lib/ttsFile';

/**
 * Голосовое уведомление актуально только «здесь и сейчас». Если TTS тормозит
 * (холодный старт/ночной сон) или приложение было свёрнуто, очередь копится и потом
 * разом проигрывается — официант слышит «отменили заказ N» спустя час. Фразы старше
 * этого возраста при разборе очереди отбрасываем.
 */
const MAX_VOICE_AGE_MS = 30_000;

class WaiterVoice {
  private queue: { text: string; at: number }[] = [];
  private pumping = false;

  enqueue(text: string | null | undefined) {
    const value = (text ?? '').trim();
    if (!value) return;
    this.queue.push({ text: value, at: Date.now() });
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        if (Date.now() - item.at > MAX_VOICE_AGE_MS) continue; // устаревшая озвучка — пропускаем
        try {
          await this.playText(item.text);
        } catch {
          // Озвучка не должна ломать realtime-сценарий официанта.
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async playText(text: string) {
    const res = await api.post<ArrayBuffer>(
      '/tts/synthesize',
      { text },
      { responseType: 'arraybuffer', timeout: 45_000 },
    );
    const path = await wavBufferToTempFile(res.data);
    try {
      await this.playFile(path);
    } finally {
      await deleteTempFile(path);
    }
  }

  private async playFile(uri: string) {
    await configureAudioPlayback();
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false, volume: 1, rate: 1 });
    await new Promise<void>((resolve, reject) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          if ('error' in status && status.error) reject(new Error(status.error));
          return;
        }
        if (status.didJustFinish) resolve();
      });
      sound.playAsync().catch(reject);
    }).finally(() => {
      void sound.unloadAsync();
    });
  }
}

export const waiterVoice = new WaiterVoice();
