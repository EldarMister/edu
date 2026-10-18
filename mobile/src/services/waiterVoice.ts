import { Audio } from 'expo-av';
import { api } from '@/lib/api';
import { configureAudioPlayback } from '@/lib/sound';
import { deleteTempFile, wavBufferToTempFile } from '@/lib/ttsFile';
import { registerSessionCleanup } from '@/store/auth';

/**
 * Голосовое уведомление актуально только «здесь и сейчас». Если TTS тормозит
 * (холодный старт/ночной сон) или приложение было свёрнуто, очередь копится и потом
 * разом проигрывается — официант слышит «отменили заказ N» спустя час. Фразы старше
 * этого возраста при разборе очереди отбрасываем.
 */
const MAX_VOICE_AGE_MS = 30_000;

class WaiterVoice {
  private queue: { text: string; at: number }[] = [];
  private epoch = 0;
  private pumpingEpoch: number | null = null;
  private requests = new Set<AbortController>();
  private current: Audio.Sound | null = null;
  private finishCurrent: (() => void) | null = null;
  private disposals = new WeakMap<Audio.Sound, Promise<void>>();

  enqueue(text: string | null | undefined) {
    const value = (text ?? '').trim();
    if (!value) return;
    this.queue.push({ text: value, at: Date.now() });
    void this.pump();
  }

  /** Cancel both active and queued audio before another account can sign in. */
  clear(): Promise<void> {
    this.epoch += 1;
    this.queue = [];
    this.pumpingEpoch = null;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    const sound = this.current;
    const finish = this.finishCurrent;
    this.current = null;
    this.finishCurrent = null;
    finish?.();
    return sound ? this.releaseSound(sound) : Promise.resolve();
  }

  private releaseSound(sound: Audio.Sound): Promise<void> {
    const existing = this.disposals.get(sound);
    if (existing) return existing;
    sound.setOnPlaybackStatusUpdate(null);
    const disposal = (async () => {
      await sound.stopAsync().catch(() => undefined);
      await sound.unloadAsync().catch(() => undefined);
    })();
    this.disposals.set(sound, disposal);
    return disposal;
  }

  private async pump() {
    if (this.pumpingEpoch !== null) return;
    const epoch = this.epoch;
    this.pumpingEpoch = epoch;
    try {
      while (epoch === this.epoch && this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        if (Date.now() - item.at > MAX_VOICE_AGE_MS) continue; // устаревшая озвучка — пропускаем
        try {
          await this.playText(item.text, epoch);
        } catch {
          // Озвучка не должна ломать realtime-сценарий официанта.
        }
      }
    } finally {
      if (this.pumpingEpoch === epoch) this.pumpingEpoch = null;
    }
  }

  private async playText(text: string, epoch: number) {
    if (epoch !== this.epoch) return;
    const request = new AbortController();
    this.requests.add(request);
    let data: ArrayBuffer;
    try {
      const res = await api.post<ArrayBuffer>(
        '/tts/synthesize',
        { text },
        { responseType: 'arraybuffer', timeout: 45_000, signal: request.signal },
      );
      data = res.data;
    } finally {
      this.requests.delete(request);
    }
    if (epoch !== this.epoch) return;
    const path = await wavBufferToTempFile(data);
    try {
      if (epoch === this.epoch) await this.playFile(path, epoch);
    } finally {
      await deleteTempFile(path);
    }
  }

  private async playFile(uri: string, epoch: number) {
    await configureAudioPlayback();
    if (epoch !== this.epoch) return;
    const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false, volume: 1, rate: 1 });
    if (epoch !== this.epoch) {
      await this.releaseSound(sound);
      return;
    }
    this.current = sound;
    await new Promise<void>((resolve, reject) => {
      this.finishCurrent = resolve;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          if ('error' in status && status.error) reject(new Error(status.error));
          return;
        }
        if (status.didJustFinish) resolve();
      });
      sound.playAsync().catch(reject);
    }).finally(async () => {
      if (this.current === sound) {
        this.current = null;
        this.finishCurrent = null;
      }
      await this.releaseSound(sound);
    });
  }
}

export const waiterVoice = new WaiterVoice();
registerSessionCleanup(() => { void waiterVoice.clear(); });
