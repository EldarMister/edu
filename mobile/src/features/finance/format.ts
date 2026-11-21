import type { EntryKind, FinanceEntry } from './api';

export const entryLabels: Record<EntryKind, string> = {
  income: 'Доход', expense: 'Расход', transfer: 'Перевод', sale: 'Продажа', refund: 'Возврат',
  salary: 'Выплата зарплаты', adjustment: 'Корректировка',
};

export function entryLabel(entry: FinanceEntry) {
  return entry.reversalOf ? 'Сторно' : entryLabels[entry.kind] ?? entry.kind;
}

export function entryCategoryLabel(entry: FinanceEntry, categoryName?: string) {
  if (entry.reversalOf) return entryLabel(entry);
  if (categoryName) return categoryName;
  if (entry.kind !== 'transfer' && (entry.sourceKey?.startsWith('cash-pos:')
    || entry.sourceKey?.startsWith('cash-open:') || (entry.cashShiftId && ['sale', 'refund', 'adjustment'].includes(entry.kind)))) {
    return 'Кассовые смены';
  }
  return entryLabel(entry);
}

const formatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', dateStyle: 'short', timeStyle: 'short' });
const bishkekDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' });
const bishkekTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const financeMoney = (value: number | null | undefined) => value == null ? '—' : formatter.format(value) + ' с';
export const financeDateTime = (value: string | null | undefined) => value ? dateFormatter.format(new Date(value)) : '—';
export const financeDay = (date: Date = new Date()) => bishkekDate.format(date);
export function financeLocalTime(date = new Date()) {
  return bishkekDate.format(date) + 'T' + bishkekTime.format(date);
}

export function parseMoney(value: string): number | null {
  const text = value.trim().replace(',', '.');
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
  return Number(text);
}
