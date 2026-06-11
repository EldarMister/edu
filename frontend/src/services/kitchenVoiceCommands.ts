/**
 * Распознавание голосовых команд кухни (Web Speech Recognition API, ru-RU).
 *
 * Браузерная поддержка: Chrome / Edge (webkitSpeechRecognition). На неподдерживаемых
 * браузерах `isSupported === false`, кухня работает как раньше.
 *
 * Сервис только слушает и отдаёт распознанный текст наверх — разбор команд и
 * подтверждения живут в useVoiceCommands. Распознавание непрерывное и
 * авто-перезапускается, пока активно. На время голосовых подсказок его можно
 * приостановить (`pause`/`resume`), чтобы микрофон не слышал собственную озвучку.
 */
type ResultCb = (transcript: string) => void;
type StateCb = (listening: boolean) => void;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
}

class KitchenVoiceCommands {
  private rec: SpeechRecognitionLike | null = null;
  private active = false; // пользователь включил микрофон
  private running = false; // распознавание сейчас запущено
  private paused = false; // временно приостановлено (на время озвучки)
  private resultCb: ResultCb | null = null;
  private stateCb: StateCb | null = null;

  get isSupported(): boolean {
    return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }
  get isActive(): boolean {
    return this.active;
  }
  get listening(): boolean {
    return this.running;
  }

  setHandlers(onResult: ResultCb, onState: StateCb) {
    this.resultCb = onResult;
    this.stateCb = onState;
  }

  private ensureRec(): SpeechRecognitionLike | null {
    if (this.rec) return this.rec;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return null;
    const rec: SpeechRecognitionLike = new SR();
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      const res = e.results?.[e.results.length - 1];
      if (!res || !res.isFinal) return;
      const text = String(res[0]?.transcript ?? '').toLowerCase().trim();
      if (text) this.resultCb?.(text);
    };
    rec.onend = () => {
      this.running = false;
      // Авто-перезапуск, пока команда активна и не на паузе.
      if (this.active && !this.paused) this.startRec();
      else this.stateCb?.(false);
    };
    rec.onerror = (e: any) => {
      // not-allowed / service-not-allowed — нет доступа к микрофону: выключаем совсем.
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        this.active = false;
      }
      // Остальные ошибки (no-speech, aborted, network) — перезапустится через onend.
    };
    this.rec = rec;
    return rec;
  }

  private startRec() {
    const rec = this.ensureRec();
    if (!rec || this.running) return;
    try {
      rec.start();
      this.running = true;
      this.stateCb?.(true);
    } catch {
      // already started — игнорируем
    }
  }

  /** Включить распознавание (требует жеста пользователя для доступа к микрофону). */
  start() {
    this.active = true;
    this.paused = false;
    this.startRec();
  }

  /** Полностью выключить. */
  stop() {
    this.active = false;
    this.paused = false;
    if (this.rec && this.running) {
      try {
        this.rec.stop();
      } catch {
        // noop
      }
    }
    this.stateCb?.(false);
  }

  /** Временно приостановить (на время произнесения подсказки). */
  pause() {
    this.paused = true;
    if (this.rec && this.running) {
      try {
        this.rec.stop();
      } catch {
        // noop
      }
    }
  }

  /** Возобновить после паузы. */
  resume() {
    this.paused = false;
    if (this.active) this.startRec();
  }
}

export const kitchenVoiceCommands = new KitchenVoiceCommands();
export default kitchenVoiceCommands;
