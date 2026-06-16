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

export interface YakassaConfig {
  apiKey?: string | null;
  url?: string | null;
}

/**
 * Провайдер YaKassa (yakassa.kg) — альтернативный для КР. Внесена в реестр ЦТО ГНС КР.
 *
 * Как и eKassa: сетевой каркас готов, по документации YaKassa правятся ТОЛЬКО пути
 * эндпоинтов, `buildPayload` (тело запроса) и `parseResponse` (имена полей ответа).
 */
export class YakassaProvider implements IFiscalProvider {
  private readonly logger = new Logger(YakassaProvider.name);

  // !!! Уточнить по документации YaKassa.
  private static readonly RECEIPT_PATH = '/receipts';
  private static readonly PING_PATH = '/ping';

  constructor(private readonly config: YakassaConfig) {}

  async printReceipt(data: FiscalReceiptData): Promise<FiscalResult> {
    if (!this.config.apiKey || !this.config.url) {
      return {
        success: false,
        error: 'YaKassa не настроена: укажите URL API и API-ключ в настройках.',
      };
    }

    try {
      const segments = sectionedAmounts(data);
      const results: FiscalResult[] = [];
      for (const seg of segments) {
        const json = await this.request('POST', YakassaProvider.RECEIPT_PATH, this.buildPayload(data, seg.section, seg.amount));
        results.push(this.parseResponse(json));
      }
      return combineResults(results);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка YaKassa';
      this.logger.error(`YaKassa: чек заказа ${data.orderNumber} не пробит: ${message}`);
      return { success: false, error: `YaKassa: ${message}` };
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.config.apiKey || !this.config.url) return false;
    try {
      await this.request('GET', YakassaProvider.PING_PATH);
      return true;
    } catch (err) {
      this.logger.warn(`YaKassa: проверка соединения не прошла: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  // ----- Точки, которые правятся по документации YaKassa -----

  /** Тело запроса на пробитие чека. !!! Сверить поля со спецификацией YaKassa. */
  private buildPayload(data: FiscalReceiptData, section: FiscalSection, amount: number): Record<string, unknown> {
    return {
      section, // 1 — наличные, 2 — безналичные
      externalId: data.orderId,
      orderNumber: data.orderNumber,
      items: data.items.map((i) => ({
        name: i.name,
        price: i.price,
        quantity: i.quantity,
        sum: lineSum(i.price, i.quantity),
      })),
      total: round2(amount),
      payment: { type: section === 1 ? 'cash' : 'cashless', amount: round2(amount) },
      cashReceived: section === 1 ? data.cashAmount ?? undefined : undefined,
    };
  }

  /** Разбор ответа YaKassa в FiscalResult. !!! Сверить имена полей со спецификацией. */
  private parseResponse(json: any): FiscalResult {
    const number = json?.fiscalReceiptNumber ?? json?.fiscalNumber ?? json?.number ?? json?.ddNumber;
    if (!number) {
      return { success: false, error: json?.message ?? 'YaKassa: ответ без номера чека' };
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
      // !!! Формат авторизации уточнить.
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body,
    });
  }
}
