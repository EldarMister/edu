import { Audio } from 'expo-av';
import { api } from '@/lib/api';
import { configureAudioPlayback } from '@/lib/sound';
import { deleteTempFile, wavBufferToTempFile } from '@/lib/ttsFile';
import { registerSessionCleanup } from '@/store/auth';
import {
  getKitchenVoiceSettings,
  type KitchenVoiceScenario,
  type KitchenVoiceSettings,
} from './kitchenVoiceSettings';

/**
 * Озвучка кухни через self-hosted Silero TTS (backend `/tts/synthesize`) — как в PWA.
 * Очередь: озвучки проигрываются строго по очереди и не перебивают друг друга.
 * Если TTS-сервис недоступен — ошибка логируется, кухня продолжает работать без озвучки.
 */
/**
 * Озвучка актуальна только в реальном времени. Если TTS тормозит (холодный старт/
 * ночной сон) или приложение было свёрнуто, очередь копится и позже проигрывается
 * разом — повар слышит давно неактуальные заказы. Фразы старше этого возраста отбрасываем.
 */
const MAX_VOICE_AGE_MS = 30_000;

class KitchenVoice {
  private queue: { text: string; at: number }[] = [];
  private epoch = 0;
  private pumpingEpoch: number | null = null;
  private requests = new Set<AbortController>();
  private current: Audio.Sound | null = null;
  private finishCurrent: (() => void) | null = null;
  private disposals = new WeakMap<Audio.Sound, Promise<void>>();

  /** Добавить текст в очередь озвучки. Текст формирует backend. */
  enqueue(text: string | null | undefined) {
    const value = (text ?? '').trim();
    if (!value) return;
    if (!getKitchenVoiceSettings().voiceEnabled) return;
    this.queue.push({ text: value, at: Date.now() });
    void this.pump();
  }

  /** Проиграть тестовый сценарий сразу, без проверки voiceEnabled (в мобильном — всегда через TTS). */
  async testScenario(
    scenario: KitchenVoiceScenario,
    settings: KitchenVoiceSettings = getKitchenVoiceSettings(),
  ) {
    const stopped = this.clear();
    const epoch = this.epoch;
    this.pumpingEpoch = epoch;
    try {
      await stopped;
      if (epoch === this.epoch) await this.playText(scenario.text, epoch, settings, true);
    } catch (err) {
      if (epoch === this.epoch) throw err;
    } finally {
      if (this.pumpingEpoch === epoch) {
        this.pumpingEpoch = null;
        void this.pump();
      }
    }
  }

  /** Invalidate synchronously; late network/native completions cannot play in the next session. */
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
        } catch (err) {
          // Сервис недоступен — без голоса устройства, кухня продолжает работать.
          if (epoch === this.epoch) console.error('[kitchen-tts] озвучка не удалась:', err);
        }
      }
    } finally {
      if (this.pumpingEpoch === epoch) this.pumpingEpoch = null;
    }
  }

  private async playText(
    text: string,
    epoch: number,
    settings: KitchenVoiceSettings = getKitchenVoiceSettings(),
    force = false,
  ) {
    if (epoch !== this.epoch || (!force && !settings.voiceEnabled)) return;
    const request = new AbortController();
    this.requests.add(request);
    let data: ArrayBuffer;
    try {
      const res = await api.post<ArrayBuffer>(
        '/tts/synthesize',
        {
          text,
          speaker: settings.speaker,
          preferredModel: settings.preferredModel,
          fallbackModel: settings.fallbackModel,
        },
        { responseType: 'arraybuffer', timeout: 45_000, signal: request.signal },
      );
      data = res.data;
    } finally {
      this.requests.delete(request);
    }
    if (epoch !== this.epoch) return;
    const path = await wavBufferToTempFile(data);
    try {
      if (epoch === this.epoch) await this.playFile(path, settings.speechRate, epoch);
    } finally {
      await deleteTempFile(path);
    }
  }

  private async playFile(uri: string, rate: number, epoch: number) {
    await configureAudioPlayback();
    if (epoch !== this.epoch) return;
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: false, volume: 1, rate, shouldCorrectPitch: true },
    );
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

export const kitchenVoice = new KitchenVoice();
registerSessionCleanup(() => { void kitchenVoice.clear(); });
