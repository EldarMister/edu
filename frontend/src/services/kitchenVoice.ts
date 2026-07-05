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
import { getKitchenVoiceSettings, type KitchenVoiceSettings } from './kitchenVoiceSettings';
import {
  KITCHEN_SAMPLES_BASE,
  type KitchenSamplesManifest,
  type KitchenVoiceScenario,
} from './kitchenVoiceScenarios';

/**
 * Озвучка актуальна только в реальном времени. Если TTS тормозит (холодный старт/
 * ночной сон) или вкладка была свёрнута, очередь копится и позже проигрывается разом —
 * повар слышит давно неактуальные заказы. Фразы старше этого возраста отбрасываем.
 */
const MAX_VOICE_AGE_MS = 30_000;

class KitchenVoice {
  private queue: { text: string; at: number }[] = [];
  private pumping = false;
  private current: HTMLAudioElement | null = null;
  // Манифест предзаписанных озвучек (какие голоса доступны без запроса на TTS).
  private manifestPromise: Promise<KitchenSamplesManifest | null> | null = null;

  /** Добавить текст в очередь озвучки. Текст формирует backend. */
  enqueue(text: string | null | undefined) {
    const t = (text ?? '').trim();
    if (!t) return;
    if (!getKitchenVoiceSettings().voiceEnabled) return;
    this.queue.push({ text: t, at: Date.now() });
    void this.pump();
  }

  /** Проиграть тестовую фразу сразу, с текущей конфигурацией, без проверки voiceEnabled. */
  async test(text: string, settings: KitchenVoiceSettings = getKitchenVoiceSettings()) {
    const t = text.trim();
    if (!t) return;
    this.queue = [];
    this.current?.pause();
    this.current = null;
    await this.playText(t, settings, true);
  }

  /**
   * Проиграть тестовый сценарий из ПРЕДЗАПИСАННОГО аудио (без запроса на TTS).
   * Если для выбранного голоса предзаписи нет — мягкий fallback на синтез через TTS.
   */
  async testScenario(
    scenario: KitchenVoiceScenario,
    settings: KitchenVoiceSettings = getKitchenVoiceSettings(),
  ) {
    this.queue = [];
    this.current?.pause();
    this.current = null;

    const manifest = await this.loadSamplesManifest();
    if (manifest && manifest.speakers.includes(settings.speaker) && manifest.scenarioIds.includes(scenario.id)) {
      const url = `${KITCHEN_SAMPLES_BASE}/${settings.speaker}/${scenario.id}.${manifest.format}`;
      try {
        await this.playUrl(url, settings.speechRate);
        return;
      } catch (err) {
        // Файл повреждён/недоступен — падаем на TTS, чтобы тест всё равно сработал.
        console.warn('[kitchen-tts] предзапись не проигралась, fallback на TTS:', err);
      }
    }
    await this.playText(scenario.text, settings, true);
  }

  /** Манифест предзаписей — грузится один раз; при отсутствии файла → null (всегда TTS). */
  private loadSamplesManifest(): Promise<KitchenSamplesManifest | null> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(`${KITCHEN_SAMPLES_BASE}/manifest.json`, { cache: 'force-cache' })
        .then((res) => (res.ok ? (res.json() as Promise<KitchenSamplesManifest>) : null))
        .catch(() => null);
    }
    return this.manifestPromise;
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
          // Сервис недоступен или браузер заблокировал — без голоса устройства.
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
  ): Promise<void> {
    if (!force && !settings.voiceEnabled) return;
    const res = await api.post(
      '/tts/synthesize',
      {
        text,
        speaker: settings.speaker,
        preferredModel: settings.preferredModel,
        fallbackModel: settings.fallbackModel,
      },
      { responseType: 'blob', timeout: 45_000 },
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
