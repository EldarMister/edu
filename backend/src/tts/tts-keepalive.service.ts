import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

/**
 * Keep-alive для tts-service на Railway Serverless (Scale to Zero).
 *
 * Днём (по умолчанию 09:00–00:00 по Asia/Bishkek) backend каждые N минут шлёт
 * лёгкий `GET /health` на TTS, чтобы контейнер не засыпал и кухня работала без
 * cold start. Ночью (00:00–09:00) keep-alive молчит — Railway сам усыпит TTS
 * после ~10 минут без запросов, экономя RAM. В момент входа в дневное окно
 * (09:00) сразу шлётся пробуждающий ping.
 *
 * Заказы это никак не ломает: озвучка идёт отдельным запросом с фронта, а сам
 * keep-alive ловит любые ошибки и пишет только warning.
 */
@Injectable()
export class TtsKeepaliveService {
  private readonly log = new Logger('TtsKeepalive');

  private readonly enabled = (process.env.TTS_KEEPALIVE_ENABLED ?? 'true') !== 'false';
  private readonly baseUrl = (process.env.TTS_SERVICE_URL ?? '').replace(/\/$/, '');
  private readonly timezone = process.env.TTS_TIMEZONE ?? 'Asia/Bishkek';
  private readonly startMin = this.parseHhMm(process.env.TTS_KEEPALIVE_START, 9 * 60); // 09:00
  private readonly endMin = this.parseHhMm(process.env.TTS_KEEPALIVE_END, 0); // 00:00
  private readonly intervalMs =
    Math.max(1, Number(process.env.TTS_KEEPALIVE_INTERVAL_MINUTES ?? 8)) * 60_000;
  // Короткий таймаут (3–5 c): keep-alive не должен блокировать event loop, а сам
  // факт запроса уже будит Railway-контейнер, даже если ответ не успел прийти.
  private readonly pingTimeoutMs = Math.min(
    5000,
    Math.max(3000, Number(process.env.TTS_KEEPALIVE_TIMEOUT_MS ?? 5000)),
  );

  private lastPingAt = 0;
  private wasActive = false;

  /**
   * Каждую минуту проверяем дневное окно. Минутная гранулярность нужна, чтобы
   * пробуждающий ping ушёл сразу в начале окна (в 09:00), а не «когда-нибудь
   * в течение интервала».
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!this.enabled || !this.baseUrl) return;

    const active = this.isActiveWindow(this.nowMinutesInTz());
    if (!active) {
      this.wasActive = false;
      return;
    }

    const justEntered = !this.wasActive;
    this.wasActive = true;

    if (justEntered || Date.now() - this.lastPingAt >= this.intervalMs) {
      await this.ping(justEntered);
    }
  }

  /** Лёгкий GET /health. Любую ошибку гасим в warning — заказы не страдают. */
  private async ping(wake: boolean): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.pingTimeoutMs);
    // Отмечаем попытку сразу, чтобы при недоступности не долбить каждую минуту.
    this.lastPingAt = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
      if (res.ok) {
        if (wake) this.log.log('TTS разбужен (вход в дневное окно keep-alive).');
        else this.log.debug('keep-alive: TTS активен.');
      } else {
        this.log.warn(`keep-alive: TTS вернул ${res.status}.`);
      }
    } catch (e) {
      // Холодный старт может не успеть за таймаут — это нормально: запрос всё
      // равно разбудил контейнер, следующий ping застанет его готовым.
      this.log.warn(`keep-alive: TTS не ответил (${(e as Error).message}). На заказы не влияет.`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Текущее время в TTS_TIMEZONE как минуты от полуночи (0–1439). */
  private nowMinutesInTz(): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  }

  /** В дневном окне ли время t (минуты). 00:00 трактуется как конец суток (24:00). */
  private isActiveWindow(t: number): boolean {
    const start = this.startMin;
    const end = this.endMin === 0 ? 1440 : this.endMin;
    return start < end ? t >= start && t < end : t >= start || t < end;
  }

  /** Парсит "HH:MM" в минуты от полуночи; при ошибке — fallback. */
  private parseHhMm(value: string | undefined, fallback: number): number {
    const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
    if (!m) return fallback;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return fallback;
    return h * 60 + min;
  }
}
