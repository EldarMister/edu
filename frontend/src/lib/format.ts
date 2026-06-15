/** Человекочитаемое название способа оплаты. */
export function paymentMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case 'qr':
      return 'QR-код';
    case 'cash':
      return 'Наличные';
    case 'card':
      return 'Карта';
    case 'mixed':
      return 'Смешанная';
    default:
      return '—';
  }
}

/** Короткое название способа оплаты для таблицы заказов: qr → «QR». */
export function paymentMethodShort(method: string | null | undefined): string {
  switch (method) {
    case 'qr':
      return 'QR';
    case 'cash':
      return 'Наличные';
    case 'card':
      return 'Карта';
    case 'mixed':
      return 'Смешанная';
    default:
      return '—';
  }
}

export function isSplitPayment(order: {
  payments?: { source?: string | null }[];
}): boolean {
  return (order.payments ?? []).some((p) => p.source === 'split');
}

export function splitPaymentSummary(order: {
  payments?: { amount: string }[];
}): string {
  const parts = (order.payments ?? []).map((p) => money(p.amount));
  return parts.length ? `Раздельная оплата: ${parts.join(' / ')}` : 'Раздельная оплата';
}

export function paymentDisplayLabel(order: {
  paymentMethod: string | null;
  payments?: { method: string; amount: string; source?: string | null }[];
}): string {
  if (isSplitPayment(order)) return 'Раздельная оплата';
  return paymentMethodLabel(order.paymentMethod);
}

/**
 * Ячейка способа оплаты для заказа. Для смешанной показывает разбивку:
 * «Смешанная (1 000 с / 1 300 с)» — сначала наличные, затем QR.
 */
export function paymentCell(order: {
  paymentMethod: string | null;
  payments?: { method: string; amount: string; source?: string | null }[];
}): string {
  if (!order.paymentMethod) return '—';
  if (isSplitPayment(order)) return splitPaymentSummary(order);
  if (order.paymentMethod !== 'mixed') return paymentMethodShort(order.paymentMethod);
  const sumBy = (m: string) =>
    (order.payments ?? [])
      .filter((p) => p.method === m)
      .reduce((acc, p) => acc + Number(p.amount), 0);
  const cash = sumBy('cash');
  const qr = sumBy('qr');
  if (!order.payments?.length) return 'Смешанная';
  return `Смешанная (${money(cash)} / ${money(qr)})`;
}

/** Форматирование суммы: 1063 → «1 063 с» (сом). */
export function money(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  const rounded = Math.round(n * 100) / 100;
  const intPart = Math.trunc(rounded);
  const formatted = intPart.toLocaleString('ru-RU');
  const frac = Math.round((rounded - intPart) * 100);
  return frac > 0 ? `${formatted},${String(frac).padStart(2, '0')} с` : `${formatted} с`;
}

/** Номер заказа без ведущих нулей: №000006 -> №6. */
export function displayOrderNumber(value: string): string {
  return value.replace(/^(\D*)0+(\d+)$/, (_, prefix: string, digits: string) => {
    const withoutLeadingZeros = digits.replace(/^0+/, '');
    return `${prefix}${withoutLeadingZeros || '0'}`;
  });
}

/** Время HH:MM из ISO. */
export function timeHM(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Дата DD.MM из ISO (для завершённых/отказанных заказов на кухне). */
export function dateDM(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

/** Прошедшее время mm:ss с момента iso (для таймера кухни). */
export function elapsed(iso: string, nowMs: number): string {
  const diff = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Итоговая цена единицы блюда с учётом скидки. */
export function dishUnitPrice(price: string, discountType: string, discountValue: string): number {
  const p = Number(price);
  const v = Number(discountValue);
  if (discountType === 'percent') return Math.max(0, p - (p * v) / 100);
  if (discountType === 'fixed') return Math.max(0, p - v);
  return p;
}

export function variantNamesLine(variants: { name: string }[]): string {
  return variants.map((variant) => variant.name).join(' / ');
}

export function minDishUnitPrice(dish: {
  price: string;
  discountType: string;
  discountValue: string;
  variants?: { price: string }[];
}): number {
  const prices = dish.variants?.length ? dish.variants.map((variant) => variant.price) : [dish.price];
  return Math.min(...prices.map((price) => dishUnitPrice(price, dish.discountType, dish.discountValue)));
}

export function orderItemDisplayName(item: {
  dishNameSnapshot: string;
  dishVariantNameSnapshot?: string | null;
}): string {
  return item.dishVariantNameSnapshot
    ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}`
    : item.dishNameSnapshot;
}
