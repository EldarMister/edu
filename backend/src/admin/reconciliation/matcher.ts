import type { BankOp, OrderLite, ReconResult, ReconRow, ReconStatus } from './reconciliation.types';

const AMOUNT_EPS = 0.01;
/** Если две ближайшие операции отличаются по времени меньше этого порога — это «требует проверки». */
const AMBIGUOUS_MS = 60_000;

function sameAmount(a: number, b: number) {
  return Math.abs(a - b) < AMOUNT_EPS;
}

/** Числовой токен номера заказа («№25» → "25") для поиска в тексте операции. */
function orderNumberToken(orderNumber: string): string | null {
  const m = orderNumber.match(/\d+/);
  return m ? m[0] : null;
}

/**
 * Сопоставление оплаченных заказов POS с операциями банковской выписки.
 * Главное правило: точное совпадение суммы + время в пределах ±tolerance.
 * Личные операции, не похожие ни на один заказ, не попадают в результат.
 */
export function reconcile(orders: OrderLite[], ops: BankOp[], toleranceMin: number): ReconResult {
  const tolMs = Math.max(0, toleranceMin) * 60_000;
  const timed = ops.filter((o) => o.time instanceof Date && !Number.isNaN(o.time.getTime()));
  const used = new Set<number>();
  const rows: ReconRow[] = [];

  // Обрабатываем заказы в хронологическом порядке (стабильное жадное сопоставление).
  const sortedOrders = [...orders].sort((a, b) => a.time.getTime() - b.time.getTime());

  for (const order of sortedOrders) {
    const cands = timed
      .map((op, i) => ({ op, i, dist: Math.abs(op.time!.getTime() - order.time.getTime()) }))
      .filter((c) => !used.has(c.i) && c.dist <= tolMs && sameAmount(c.op.amount, order.amount))
      .sort((a, b) => a.dist - b.dist);

    if (cands.length === 0) {
      // Нет совпадения по сумме. Проверяем явную связь по номеру заказа → «сумма отличается».
      const token = orderNumberToken(order.orderNumber);
      const linked = token
        ? timed
            .map((op, i) => ({ op, i, dist: Math.abs(op.time!.getTime() - order.time.getTime()) }))
            .filter(
              (c) =>
                !used.has(c.i) &&
                c.dist <= tolMs &&
                new RegExp(`(^|\\D)${token}(\\D|$)`).test(c.op.raw) &&
                !sameAmount(c.op.amount, order.amount),
            )
            .sort((a, b) => a.dist - b.dist)[0]
        : undefined;

      if (linked) {
        used.add(linked.i);
        rows.push(orderRow(order, linked.op, linked.dist, 'amount_mismatch', 'Связь по номеру заказа, сумма отличается'));
      } else {
        rows.push(orderRow(order, null, null, 'not_found', 'Подходящей операции в выписке нет'));
      }
      continue;
    }

    const nearest = cands[0];
    const ambiguous = cands.length >= 2 && cands[1].dist - nearest.dist <= AMBIGUOUS_MS;
    used.add(nearest.i);

    if (ambiguous) {
      rows.push(
        orderRow(order, nearest.op, nearest.dist, 'needs_review', `Найдено несколько похожих операций (${cands.length})`),
      );
    } else {
      rows.push(orderRow(order, nearest.op, nearest.dist, 'matched', ''));
    }
  }

  // «Лишние» операции: не связаны, но по сумме+времени похожи на какой-то заказ (дубли/переплаты).
  for (let i = 0; i < timed.length; i++) {
    if (used.has(i)) continue;
    const op = timed[i];
    const looksLikeOrder = orders.some(
      (o) => sameAmount(o.amount, op.amount) && Math.abs(op.time!.getTime() - o.time.getTime()) <= tolMs,
    );
    if (!looksLikeOrder) continue; // нерелевантные/личные операции игнорируем (приватность)
    rows.push({
      orderId: null,
      orderNumber: null,
      orderTime: null,
      posAmount: null,
      bankAmount: round2(op.amount),
      bankTime: op.time!.toISOString(),
      timeDiffSec: null,
      paymentMethod: null,
      waiter: null,
      status: 'extra',
      comment: 'Похожа на оплату, но не связана с заказом',
    });
  }

  const stats = {
    paidCount: orders.length,
    matched: rows.filter((r) => r.status === 'matched').length,
    notFound: rows.filter((r) => r.status === 'not_found').length,
    needsReview: rows.filter((r) => r.status === 'needs_review').length,
    amountMismatch: rows.filter((r) => r.status === 'amount_mismatch').length,
    extra: rows.filter((r) => r.status === 'extra').length,
  };

  return { from: null, to: null, toleranceMin, stats, rows };
}

function orderRow(
  order: OrderLite,
  op: BankOp | null,
  dist: number | null,
  status: ReconStatus,
  comment: string,
): ReconRow {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderTime: order.time.toISOString(),
    posAmount: round2(order.amount),
    bankAmount: op ? round2(op.amount) : null,
    bankTime: op?.time ? op.time.toISOString() : null,
    timeDiffSec: dist != null ? Math.round(dist / 1000) : null,
    paymentMethod: order.paymentMethod,
    waiter: order.waiter,
    status,
    comment,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
