import { Injectable, Logger } from '@nestjs/common';
import type { TtsProvider } from './tts-provider.interface';

/**
 * Провайдер Silero: обращается к self-hosted Python-сервису (tts-service).
 * Логика выбора модели (v4_ru → fallback v3_1_ru) живёт внутри Python-сервиса,
 * здесь — только HTTP-вызов. Заменить модель = заменить этот провайдер.
 */
@Injectable()
export class SileroTtsProvider implements TtsProvider {
  private readonly log = new Logger('SileroTts');
  private readonly baseUrl = (process.env.TTS_SERVICE_URL ?? '').replace(/\/$/, '');
  private readonly timeoutMs = Number(process.env.TTS_TIMEOUT_MS ?? 15000);

  isConfigured(): boolean {
    return !!this.baseUrl;
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.baseUrl) {
      throw new Error('TTS_SERVICE_URL не задан — озвучка отключена');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`TTS-сервис вернул ${res.status}`);
      }
      const took = res.headers.get('x-tts-seconds');
      const model = res.headers.get('x-tts-model');
      if (took) this.log.log(`Синтез ${model ?? '?'}: ${took}s, ${text.length} симв.`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }
  }
}
