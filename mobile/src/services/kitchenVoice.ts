import { Audio } from 'expo-av';
import { api } from '@/lib/api';
import { configureAudioPlayback } from '@/lib/sound';
import { deleteTempFile, wavBufferToTempFile } from '@/lib/ttsFile';
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
class KitchenVoice {
  private queue: string[] = [];
  private pumping = false;
  private current: Audio.Sound | null = null;

  /** Добавить текст в очередь озвучки. Текст формирует backend. */
  enqueue(text: string | null | undefined) {
    const value = (text ?? '').trim();
    if (!value) return;
    if (!getKitchenVoiceSettings().voiceEnabled) return;
    this.queue.push(value);
    void this.pump();
  }

  /** Проиграть тестовый сценарий сразу, без проверки voiceEnabled (в мобильном — всегда через TTS). */
  async testScenario(
    scenario: KitchenVoiceScenario,
    settings: KitchenVoiceSettings = getKitchenVoiceSettings(),
  ) {
    this.queue = [];
    await this.stopCurrent();
    await this.playText(scenario.text, settings, true);
  }

  private async stopCurrent() {
    const sound = this.current;
    this.current = null;
    if (sound) await sound.stopAsync().catch(() => undefined);
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const text = this.queue.shift();
        if (!text) continue;
        try {
          await this.playText(text);
        } catch (err) {
          // Сервис недоступен — без голоса устройства, кухня продолжает работать.
          console.error('[kitchen-tts] озвучка не удалась:', err);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private async playText(
    text: string,
    settings: KitchenVoiceSettings = getKitchenVoiceSettings(),
    force = false,
  ) {
    if (!force && !settings.voiceEnabled) return;
    const res = await api.post<ArrayBuffer>(
      '/tts/synthesize',
      {
        text,
        speaker: settings.speaker,
        preferredModel: settings.preferredModel,
        fallbackModel: settings.fallbackModel,
      },
      { responseType: 'arraybuffer', timeout: 45_000 },
    );
    const path = await wavBufferToTempFile(res.data);
    try {
      await this.playFile(path, settings.speechRate);
    } finally {
      await deleteTempFile(path);
    }
  }

  private async playFile(uri: string, rate: number) {
    await configureAudioPlayback();
    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: false, volume: 1, rate, shouldCorrectPitch: true },
    );
    this.current = sound;
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
      if (this.current === sound) this.current = null;
      void sound.unloadAsync().catch(() => undefined);
    });
  }
}

export const kitchenVoice = new KitchenVoice();
