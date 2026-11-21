import type { PaymentMethod } from '@/types';

export type TenderMethod = Exclude<PaymentMethod, 'mixed'>;
export type TenderAmounts = Record<TenderMethod, number>;

export function normalizeAmount(value: string) {
  const normalized = value.replace(',', '.');
  const amount = normalized.startsWith('.') ? `0${normalized}` : normalized;
  if (!/^\d*(?:\.\d{0,2})?$/.test(amount) || !Number.isSafeInteger(Math.round(Number(amount) * 100))) return null;
  return amount;
}

export function tenderTotals(total: number, entered: TenderAmounts) {
  const due = Math.round(total * 100);
  const card = Math.round(entered.card * 100);
  const qr = Math.round(entered.qr * 100);
  const cashReceived = Math.round(entered.cash * 100);
  const nonCash = card + qr;
  const cash = Math.min(cashReceived, Math.max(0, due - nonCash));
  return {
    amounts: { cash: cash / 100, card: card / 100, qr: qr / 100 },
    remaining: Math.max(0, due - nonCash - cash) / 100,
    change: (cashReceived - cash) / 100,
    over: nonCash > due,
  };
}
