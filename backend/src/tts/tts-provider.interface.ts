/**
 * Слой-обёртка над конкретной TTS-реализацией.
 * Кухня и backend зависят от этого интерфейса, а не от Silero напрямую,
 * чтобы модель можно было заменить без переписывания логики.
 */
export interface TtsProvider {
  /** Синтезирует переданный текст в WAV (audio/wav). Бросает ошибку, если сервис недоступен. */
  synthesize(text: string): Promise<Buffer>;
  /** Доступен ли провайдер (для health/диагностики). */
  isConfigured(): boolean;
}

export const TTS_PROVIDER = Symbol('TTS_PROVIDER');
