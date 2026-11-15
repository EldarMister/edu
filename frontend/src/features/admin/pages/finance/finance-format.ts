import type { CashFlow } from './api';

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
export const cashFlowHeaders = ['Дата', 'Поступления', 'Расходы', 'Чистый поток', 'Остаток на конец дня'];

export function cashFlowSummary(flow: CashFlow): [string, number][] {
  return [
    ['Остаток на начало', flow.opening],
    ['Поступления', flow.income],
    ['Расходы', flow.expense],
    ['Чистый поток', flow.closing - flow.opening],
    ['Остаток на конец', flow.closing],
  ];
}

export function exportCashFlow(flow: CashFlow, from: string, to: string, account: string) {
  const rows: (string | number)[][] = [
    ['Движение денег', account, from, to],
    ...cashFlowSummary(flow),
    [],
    cashFlowHeaders,
    ...flow.days.map(({ date, income, expense, net, balance }) => [date, income, expense, net, balance]),
  ];
  const csv = rows.map((row) => row.map((value) => {
    if (typeof value === 'number') return value.toFixed(2).replace('.', ',');
    const text = /^[=+@-]/.test(value.trimStart()) ? "'" + value : value;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Движение денег ${from} — ${to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
