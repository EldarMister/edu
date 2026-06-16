import { Logger } from '@nestjs/common';
import type {
  FiscalReceiptData,
  FiscalResult,
  FiscalSection,
  IFiscalProvider,
} from '../fiscal.interface';
import {
  combineResults,
  lineSum,
  requestFiscalJson,
  round2,
  sectionedAmounts,
} from './fiscal-http';

export interface EkassaConfig {
  apiKey?: string | null;
  url?: string | null;
  /** ИНН заведения. */
  inn?: string | null;
}

/**
 * Провайдер eKassa (Telemedia Group, ekassa.kg) — приоритетный для КР.
 * Внесена в госреестр ККМ КР (пост. КМ КР №193 от 08.04.2022); данные уходят в ГНС
 * автоматически на стороне провайдера при формировании чека.
 *
 * Сетевой каркас (request/таймаут/секции/объединение) готов и менять не нужно.
 * По документации Telemedia Group (ekassa.kg/api, WhatsApp +996 555 979 242) останется
 * сверить ТОЛЬКО три помеченных места: пути эндпоинтов, `buildPayload` (тело запроса)
 * и `parseResponse` (имена полей ответа).
 */
export class EkassaProvider implements IFiscalProvider {
  private readonly logger = new Logger(EkassaProvider.name);

  // !!! Уточнить по документации eKassa.
  private static readonly RECEIPT_PATH = '/receipts';
  private static readonly PING_PATH = '/ping';

  constructor(private readonly config: EkassaConfig) {}

  async printReceipt(data: FiscalReceiptData): Promise<FiscalResult> {
    if (!this.config.apiKey || !this.config.url) {
      return {
        success: false,
        error: 'eKassa не настроена: укажите URL API и API-ключ в настройках.',
      };
    }

    try {
      // mixed → два фискальных документа по секциям (наличные / безнал). Иначе — один.
      const segments = sectionedAmounts(data);
      const results: FiscalResult[] = [];
      for (const seg of segments) {
        const json = await this.request('POST', EkassaProvider.RECEIPT_PATH, this.buildPayload(data, seg.section, seg.amount));
        results.push(this.parseResponse(json));
      }
      return combineResults(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка eKassa';
      this.logger.error(`eKassa: чек заказа ${data.orderNumber} не пробит: ${message}`);
      return { success: false, error: `eKassa: ${message}` };
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.config.apiKey || !this.config.url) return false;
    try {
      await this.request('GET', EkassaProvider.PING_PATH);
      return true;
    } catch (err) {
      this.logger.warn(`eKassa: проверка соединения не прошла: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  // ----- Точки, которые правятся по документации eKassa -----

  /** Тело запроса на пробитие чека. !!! Сверить поля со спецификацией eKassa. */
  private buildPayload(data: FiscalReceiptData, section: FiscalSection, amount: number): Record<string, unknown> {
    return {
      inn: this.config.inn ?? undefined,
      section, // 1 — наличные, 2 — безналичные
      externalId: data.orderId, // идемпотентность на стороне eKassa
      orderNumber: data.orderNumber,
      items: data.items.map((i) => ({
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        sum: lineSum(i.price, i.quantity),
      })),
      total: round2(amount),
      payment: { type: section === 1 ? 'cash' : 'cashless', amount: round2(amount) },
      // Наличные: сколько внесено (для сдачи) — только для секции 1.
      cashReceived: section === 1 ? data.cashAmount ?? undefined : undefined,
    };
  }

  /** Разбор ответа eKassa в FiscalResult. !!! Сверить имена полей со спецификацией. */
  private parseResponse(json: any): FiscalResult {
    const number = json?.fiscalReceiptNumber ?? json?.fiscalNumber ?? json?.number ?? json?.ddNumber;
    if (!number) {
      return { success: false, error: json?.message ?? 'eKassa: ответ без номера чека' };
    }
    const sign = json?.fiscalSign ?? json?.fp ?? json?.fiscalMark;
    return {
      success: true,
      fiscalReceiptNumber: String(number),
      fiscalSign: sign != null ? String(sign) : undefined,
      qrCode: json?.qrCode ?? json?.qr ?? json?.qrUrl ?? undefined,
    };
  }

  // ----- Инфраструктура (менять не нужно) -----

  private request(method: 'GET' | 'POST', path: string, body?: unknown) {
    return requestFiscalJson({
      baseUrl: this.config.url as string,
      path,
      method,
      // !!! Формат авторизации уточнить (Bearer / X-Api-Key / иной).
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body,
    });
  }
}
