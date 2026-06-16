import type { FiscalReceiptData, FiscalResult, FiscalSection } from '../fiscal.interface';

export const DEFAULT_FISCAL_TIMEOUT_MS = 10_000;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Сумма позиции (цена × количество). */
export function lineSum(price: number, quantity: number): number {
  return round2(price * quantity);
}

/**
 * Разбивка оплаты по секциям ККМ: 1 — наличные, 2 — безналичные.
 * Для mixed возвращает две части (наличная + безналичная) — это и есть «два запроса по
 * секциям» из ТЗ. Для остальных способов — одна секция на всю сумму.
 */
export function sectionedAmounts(data: FiscalReceiptData): Array<{ section: FiscalSection; amount: number }> {
  if (data.paymentType === 'mixed') {
    const cash = round2(data.cashAmount ?? 0);
    const cashless = round2(data.totalAmount - cash);
    const segments: Array<{ section: FiscalSection; amount: number }> = [];
    if (cash > 0) segments.push({ section: 1, amount: cash });
    if (cashless > 0) segments.push({ section: 2, amount: cashless });
    return segments.length ? segments : [{ section: 2, amount: data.totalAmount }];
  }
  const section: FiscalSection = data.section ?? (data.paymentType === 'cash' ? 1 : 2);
  return [{ section, amount: data.totalAmount }];
}

/** Объединяет результаты по секциям в один (для mixed — два чека). */
export function combineResults(results: FiscalResult[]): FiscalResult {
  if (results.length === 0) {
    return { success: false, error: 'ККМ: пустой результат' };
  }
  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    return {
      success: false,
      error: failed.map((r) => r.error).filter(Boolean).join('; ') || 'Ошибка ККМ',
    };
  }
  const join = (vals: Array<string | undefined>) => vals.filter(Boolean).join(' + ') || undefined;
  return {
    success: true,
    fiscalReceiptNumber: join(results.map((r) => r.fiscalReceiptNumber)),
    fiscalSign: join(results.map((r) => r.fiscalSign)),
    qrCode: results.find((r) => r.qrCode)?.qrCode,
  };
}

/**
 * Унифицированный JSON-запрос к ККМ: таймаут через AbortController, разбор тела,
 * ошибка на !ok. Не зависит от конкретного провайдера — менять не нужно.
 */
export async function requestFiscalJson(opts: {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_FISCAL_TIMEOUT_MS);
  try {
    const url = `${opts.baseUrl.replace(/\/+$/, '')}/${opts.path.replace(/^\/+/, '')}`;
    const res = await fetch(url, {
      method: opts.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}
