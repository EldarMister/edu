/**
 * TtsService — озвучка на кухне через Web Speech API.
 *
 * Особенности:
 *  1. Голос выбирается автоматически: приоритет у Google/Microsoft/Apple
 *     голосов (они гораздо естественнее дефолтного синтезатора).
 *  2. speakAfterDelay(ms) — воспроизводит текст через задержку,
 *     чтобы голос звучал ПОСЛЕ звукового уведомления.
 *  3. Очередь: если несколько уведомлений пришли одновременно,
 *     они не перебивают друг друга.
 */
class TtsService {
  private readonly lang = 'ru-RU';
  private readonly fallbackLang = 'ru';
  private voiceCache: SpeechSynthesisVoice | null = null;
  private voiceLoaded = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  /** Произнести текст немедленно (добавить в очередь синтезатора). */
  speak(text: string) {
    this.enqueue(text);
  }

  /**
   * Произнести текст ПОСЛЕ задержки в `delayMs` миллисекунд.
   * Используется на кухне: сначала играет звук уведомления, потом голос.
   */
  speakAfterDelay(text: string, delayMs: number) {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.enqueue(text);
    }, delayMs);
  }

  /**
   * Срочное сообщение: прерывает текущую речь и произносит немедленно.
   */
  speakUrgent(text: string) {
    const synthesis = this.getSynthesis();
    if (!synthesis) return;
    synthesis.cancel();
    this.enqueue(text, { urgent: true });
  }

  /**
   * Срочное сообщение с задержкой (для отмены заказа после сигнала).
   */
  speakUrgentAfterDelay(text: string, delayMs: number) {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.speakUrgent(text);
    }, delayMs);
  }

  private enqueue(text: string, options: { urgent?: boolean } = {}) {
    const synthesis = this.getSynthesis();
    const normalizedText = text.trim();
    if (!synthesis || !normalizedText) return;

    const utterance = new SpeechSynthesisUtterance(normalizedText);
    utterance.lang = this.lang;
    utterance.volume = 1;

    // Параметры для естественного звучания:
    // rate 0.92 — чуть медленнее стандарта, лучше разборчивость
    // pitch 1.0 — натуральная высота, без роботизированного задирания
    utterance.rate = options.urgent ? 0.95 : 0.92;
    utterance.pitch = 1.0;

    // Попытаемся подобрать лучший голос
    const voice = this.getBestVoice();
    if (voice) utterance.voice = voice;

    synthesis.speak(utterance);
  }

  /**
   * Выбирает наиболее естественный русский голос из доступных.
   * Приоритеты:
   *  1. Google голоса (Android Chrome — самые естественные)
   *  2. Microsoft голоса (Windows/Edge)
   *  3. Apple голоса (iOS/macOS Safari)
   *  4. Любой другой ru-RU голос
   *  5. null — браузер использует дефолтный
   */
  private getBestVoice(): SpeechSynthesisVoice | null {
    if (this.voiceLoaded) return this.voiceCache;

    const synthesis = this.getSynthesis();
    if (!synthesis) return null;

    const voices = synthesis.getVoices();

    if (voices.length === 0) {
      // Голоса ещё не загружены — подпишемся один раз
      synthesis.onvoiceschanged = () => {
        this.voiceCache = this.selectVoice(synthesis.getVoices());
        this.voiceLoaded = true;
        synthesis.onvoiceschanged = null;
      };
      return null;
    }

    this.voiceCache = this.selectVoice(voices);
    this.voiceLoaded = true;
    return this.voiceCache;
  }

  private selectVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    // Фильтруем русские голоса
    const ruVoices = voices.filter(
      (v) => v.lang === this.lang || v.lang.startsWith(this.fallbackLang),
    );

    if (ruVoices.length === 0) return null;

    // Приоритет по производителю (самые естественные первыми)
    const preferred = ['Google', 'Microsoft', 'Apple', 'Yandex'];
    for (const brand of preferred) {
      const match = ruVoices.find((v) => v.name.includes(brand));
      if (match) return match;
    }

    // Fallback: любой не-локальный голос (онлайн голоса обычно лучше)
    const remote = ruVoices.find((v) => !v.localService);
    if (remote) return remote;

    // Последний вариант: первый доступный
    return ruVoices[0] ?? null;
  }

  private getSynthesis(): SpeechSynthesis | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return null;
    }
    return window.speechSynthesis;
  }
}

export const tts = new TtsService();
export default tts;
