/**
 * TtsService — озвучка на кухне через Web Speech API.
 *
 * Особенности:
 *  1. Голос выбирается автоматически: приоритет у Google/Microsoft/Apple
 *     (они гораздо естественнее дефолтного синтезатора).
 *  2. speakAfterDelay(ms) — воспроизводит текст через задержку,
 *     чтобы голос звучал ПОСЛЕ звукового уведомления.
 *  3. Очередь: если несколько уведомлений пришли одновременно,
 *     они не перебивают друг друга.
 */
class TtsService {
  private readonly lang = 'ru-RU';
  private voiceCache: SpeechSynthesisVoice | null | undefined = undefined; // undefined = ещё не искали
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  /** Произнести текст немедленно. */
  speak(text: string) {
    this.enqueue(text);
  }

  /**
   * Произнести текст через `delayMs` мс.
   * На кухне: сначала звук уведомления, потом голос.
   */
  speakAfterDelay(text: string, delayMs: number) {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.enqueue(text);
    }, delayMs);
  }

  /** Срочно: прервать текущую речь и произнести немедленно. */
  speakUrgent(text: string) {
    const synthesis = this.getSynthesis();
    if (!synthesis) return;
    synthesis.cancel();
    this.enqueue(text, { urgent: true });
  }

  /** Срочно с задержкой (для отмены заказа после сигнала). */
  speakUrgentAfterDelay(text: string, delayMs: number) {
    if (this.pendingTimer !== null) clearTimeout(this.pendingTimer);
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

    // rate 1.07 — немного живее стандартного, разборчиво и не роботизировано
    // urgent 1.1 — чуть быстрее для срочных сообщений
    utterance.rate = options.urgent ? 1.1 : 1.07;
    utterance.pitch = 1.0;

    const voice = this.getBestVoice(synthesis);
    if (voice) utterance.voice = voice;

    synthesis.speak(utterance);
  }

  /**
   * Выбирает наиболее естественный русский голос.
   *
   * Приоритет:
   *  1. «Google русский» / «Google Russian» (Android Chrome — нейросетевой)
   *  2. Любой другой Google ru-RU голос
   *  3. Microsoft ru-RU голос (Windows/Edge — тоже хороший)
   *  4. Apple ru-RU голос (iOS/macOS)
   *  5. Любой онлайн (не локальный) ru-RU голос
   *  6. Первый доступный ru-RU голос
   *  7. null — браузер использует дефолтный
   */
  private getBestVoice(synthesis: SpeechSynthesis): SpeechSynthesisVoice | null {
    // Уже нашли (или убедились что нет) — возвращаем кэш
    if (this.voiceCache !== undefined) return this.voiceCache;

    const voices = synthesis.getVoices();

    if (voices.length === 0) {
      // Голоса ещё не загружены асинхронно — подпишемся один раз
      synthesis.onvoiceschanged = () => {
        this.voiceCache = this.selectVoice(synthesis.getVoices());
        synthesis.onvoiceschanged = null;
      };
      return null;
    }

    this.voiceCache = this.selectVoice(voices);
    return this.voiceCache;
  }

  private selectVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const ru = voices.filter(
      (v) => v.lang === 'ru-RU' || v.lang === 'ru' || v.lang.startsWith('ru-'),
    );
    if (ru.length === 0) return null;

    // 1. Точные имена Google-голосов на Android Chrome
    const googleExact = ru.find(
      (v) => v.name === 'Google русский' || v.name === 'Google Russian',
    );
    if (googleExact) return googleExact;

    // 2. Любой Google-голос
    const google = ru.find((v) => v.name.toLowerCase().includes('google'));
    if (google) return google;

    // 3. Microsoft (Edge/Windows — Neural голоса очень качественные)
    const microsoft = ru.find((v) => v.name.toLowerCase().includes('microsoft'));
    if (microsoft) return microsoft;

    // 4. Apple (iOS/macOS)
    const apple = ru.find((v) => v.name.toLowerCase().includes('apple'));
    if (apple) return apple;

    // 5. Онлайн-голоса лучше локальных
    const remote = ru.find((v) => !v.localService);
    if (remote) return remote;

    // 6. Хоть что-то
    return ru[0] ?? null;
  }

  private getSynthesis(): SpeechSynthesis | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
    return window.speechSynthesis;
  }
}

export const tts = new TtsService();
export default tts;
