/** Форматирование — зеркало frontend/src/lib/format.ts. */

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

export function isSplitPayment(order: {
  payments?: { source?: string | null }[];
}): boolean {
  return (order.payments ?? []).some((payment) => payment.source === 'split');
}

/** Сумма: «1 250 с» или «1 250,50 с». */
export function money(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  const rounded = Math.round(n * 100) / 100;
  const intPart = Math.trunc(rounded);
  const formatted = intPart.toLocaleString('ru-RU');
  const frac = Math.round((rounded - intPart) * 100);
  return frac > 0 ? `${formatted},${String(frac).padStart(2, '0')} с` : `${formatted} с`;
}

/** Номер заказа без ведущих нулей: №000006 → №6. */
export function displayOrderNumber(value: string): string {
  return value.replace(/^(\D*)0+(\d+)$/, (_, prefix: string, digits: string) => {
    const withoutLeadingZeros = digits.replace(/^0+/, '');
    return `${prefix}${withoutLeadingZeros || '0'}`;
  });
}

/** Суффикс с названием зала: « · Большой зал». */
export function hallSuffix(table: { hall?: { name?: string } | null } | null | undefined): string {
  const name = table?.hall?.name;
  return name ? ` · ${name}` : '';
}

/** Время HH:MM. */
export function timeHM(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Дата DD.MM. */
export function dateDM(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

/** Прошедшее время mm:ss (таймер кухни). */
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

/** Уникальный idempotency key для создания заказа (ТЗ §20). */
export function makeIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Русское склонение: 1 позиция, 2 позиции, 5 позиций. */
export function pluralPositions(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'позиций';
  if (b > 1 && b < 5) return 'позиции';
  if (b === 1) return 'позиция';
  return 'позиций';
}
