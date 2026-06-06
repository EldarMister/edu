export type ReconStatus =
  | 'matched' // совпало
  | 'not_found' // не найдено
  | 'needs_review' // требует проверки
  | 'amount_mismatch' // сумма отличается
  | 'extra'; // лишняя операция

/** Операция из банковской выписки (после парсинга). */
export interface BankOp {
  amount: number; // абсолютное значение суммы
  time: Date | null;
  raw: string; // короткая строка-источник (для отображения, без личных данных по возможности)
}

/** Оплаченный заказ POS, участвующий в сверке. */
export interface OrderLite {
  id: string;
  orderNumber: string;
  time: Date; // closedAt ?? createdAt
  amount: number;
  paymentMethod: string | null;
  waiter: string;
  comment: string | null;
}

export interface ReconRow {
  orderId: string | null;
  orderNumber: string | null;
  orderTime: string | null;
  posAmount: number | null;
  bankAmount: number | null;
  bankTime: string | null;
  timeDiffSec: number | null;
  paymentMethod: string | null;
  waiter: string | null;
  status: ReconStatus;
  comment: string;
}

export interface ReconResult {
  from: string | null;
  to: string | null;
  toleranceMin: number;
  stats: {
    paidCount: number;
    matched: number;
    notFound: number;
    needsReview: number;
    amountMismatch: number;
    extra: number;
  };
  rows: ReconRow[];
}
