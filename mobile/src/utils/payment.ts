import type { PaymentMethod } from '@/types';

export type Tender = Exclude<PaymentMethod, 'mixed'>;

export const tenderLabels: Record<Tender, string> = { cash: 'Наличные', card: 'Карта', qr: 'QR-код' };

export function moneyCents(input: string) {
  const parts = /^(\d{1,10})(?:[,.](\d{0,2}))?$/.exec(input.trim());
  if (!parts) return null;
  return Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
}

export function mixedTender(total: number, drafts: Record<Tender, string>, available: Tender[]) {
  const amounts = { cash: 0, card: 0, qr: 0 };
  for (const method of available) {
    if (!drafts[method]) continue;
    const amount = moneyCents(drafts[method]);
    if (amount == null) return null;
    amounts[method] = amount;
  }
  if (amounts.card + amounts.qr > total) return null;
  const cash = Math.min(amounts.cash, total - amounts.card - amounts.qr);
  if (cash + amounts.card + amounts.qr !== total || [cash, amounts.card, amounts.qr].filter(Boolean).length < 2) return null;
  return { cashAmount: cash / 100, qrAmount: amounts.qr / 100, cardAmount: amounts.card / 100,
    change: (amounts.cash - cash) / 100 };
}
