import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TTS_PROVIDER, type TtsProvider } from './tts-provider.interface';

/**
 * Озвучка: кэш + вызов провайдера (Silero). Один и тот же текст не генерируется
 * повторно — отдаётся из дискового кэша (ТЗ §8). Кухня не привязана к Silero
 * напрямую — всё идёт через TtsProvider (ТЗ §10).
 */
@Injectable()
export class TtsService {
  private readonly log = new Logger('TtsService');
  private readonly cacheDir = process.env.TTS_CACHE_DIR ?? path.join(os.tmpdir(), 'kitchen-tts-cache');
  // Защита от параллельной генерации одного и того же текста.
  private readonly inflight = new Map<string, Promise<Buffer>>();

  constructor(@Inject(TTS_PROVIDER) private readonly provider: TtsProvider) {}

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }

  private keyFor(text: string): string {
    return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
  }

  /** Возвращает WAV для текста: из кэша или сгенерировав через провайдера. */
  async synthesize(text: string): Promise<Buffer> {
    const normalized = text.trim();
    if (!normalized) throw new Error('Пустой текст');

    const key = this.keyFor(normalized);
    const file = path.join(this.cacheDir, `${key}.wav`);

    // 1. Кэш на диске.
    try {
      return await fs.readFile(file);
    } catch {
      /* нет в кэше — генерируем */
    }

    // 2. Уже генерируется этот же текст — дождёмся.
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const task = (async () => {
      const audio = await this.provider.synthesize(normalized);
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(file, audio).catch((e) => this.log.warn(`Не удалось сохранить кэш: ${e}`));
      return audio;
    })();
    this.inflight.set(key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }
}
