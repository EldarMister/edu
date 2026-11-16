import type { EntryKind, FinanceEntry } from './api';

export const entryLabels: Record<EntryKind, string> = {
  income: 'Доход', expense: 'Расход', transfer: 'Перевод', sale: 'Продажа', refund: 'Возврат',
  salary: 'Выплата зарплаты', adjustment: 'Корректировка',
};

export function entryLabel(entry: FinanceEntry) {
  return entry.reversalOf ? 'Сторно' : entryLabels[entry.kind] ?? entry.kind;
}

const formatter = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', dateStyle: 'short', timeStyle: 'short' });
const bishkekDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit' });
const bishkekTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const financeMoney = (value: number | null | undefined) => value == null ? '—' : formatter.format(value) + ' с';
export const financeDateTime = (value: string | null | undefined) => value ? dateFormatter.format(new Date(value)) : '—';
export const financeDay = (date: Date = new Date()) => bishkekDate.format(date);
export function financeLocalTime() {
  const now = new Date();
  return bishkekDate.format(now) + 'T' + bishkekTime.format(now);
}

export function parseMoney(value: string): number | null {
  const text = value.trim().replace(',', '.');
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
  return Number(text);
}
