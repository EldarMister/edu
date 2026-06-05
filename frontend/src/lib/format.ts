/** Форматирование суммы: 1063 → «1 063 с» (сом). */
export function money(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  const rounded = Math.round(n * 100) / 100;
  const intPart = Math.trunc(rounded);
  const formatted = intPart.toLocaleString('ru-RU');
  const frac = Math.round((rounded - intPart) * 100);
  return frac > 0 ? `${formatted},${String(frac).padStart(2, '0')} с` : `${formatted} с`;
}

/** Время HH:MM из ISO. */
export function timeHM(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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
