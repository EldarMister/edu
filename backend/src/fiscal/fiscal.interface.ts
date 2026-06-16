// Интерфейс провайдера ККМ (онлайн-кассы) для Кыргызстана.
// Провайдеры (eKassa, YaKassa) реализуют один контракт — FiscalService выбирает
// нужный по настройкам заведения. Без выбранного провайдера фискализация не выполняется.

/** Секция ККМ: 1 — наличные, 2 — безналичные (карта/QR). По НК КР. */
export type FiscalSection = 1 | 2;

export type FiscalPaymentType = 'cash' | 'card' | 'qr' | 'mixed';

export interface FiscalReceiptItem {
  /** Снимок названия позиции из заказа (dishNameSnapshot), не из текущего меню. */
  name: string;
  /** Снимок цены за единицу из заказа (priceSnapshot). */
  price: number;
  quantity: number;
}

export interface FiscalReceiptData {
  // В edu-pos идентификатор заказа — uuid (string), а не number как в исходном ТЗ.
  orderId: string;
  /** Дневной номер заказа — удобен для сопоставления с фискальным чеком. */
  orderNumber: string;
  items: FiscalReceiptItem[];
  totalAmount: number;
  paymentType: FiscalPaymentType;
  /** Внесённая наличность (для расчёта сдачи), если оплата включала наличные. */
  cashAmount?: number;
  /** Секция ККМ: 1 — наличные, 2 — безналичные. Для mixed провайдер разбивает сам. */
  section?: FiscalSection;
}

export interface FiscalResult {
  success: boolean;
  /** Номер фискального чека. */
  fiscalReceiptNumber?: string;
  /** Фискальный признак. */
  fiscalSign?: string;
  /** QR-код ГНС для проверки чека. */
  qrCode?: string;
  /** Текст ошибки, если success=false. */
  error?: string;
}

export interface IFiscalProvider {
  /** Пробить фискальный чек. Данные уходят в ГНС автоматически на стороне провайдера. */
  printReceipt(data: FiscalReceiptData): Promise<FiscalResult>;
  /** Проверка соединения/учётных данных — для кнопки «Проверить соединение». */
  testConnection(): Promise<boolean>;
}
