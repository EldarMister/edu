export const SPLIT_OPTIONS = [
  { value: 'items', label: 'По позициям' },
  { value: 'amount', label: 'По сумме' },
  { value: 'equal', label: 'Поровну' },
] as const;
export type SplitMode = typeof SPLIT_OPTIONS[number]['value'];
export type AmountSplitMode = Exclude<SplitMode, 'items'>;

type CheckItem = { id: string; status: string; quantity: number; weightGrams?: number | null };
type Check = {
  status: string;
  finalAmount: string | number;
  requiresWaiterDecision: boolean;
  paymentStatus?: string | null;
  updatedAt?: string;
  source?: string;
  waiter?: unknown;
  items: CheckItem[];
};

export function activeSplitItems<T extends CheckItem>(items: T[]) {
  return items.filter(({ status }) => status !== 'cancelled' && status !== 'rejected');
}

export function indivisibleSplitItem(item: CheckItem) {
  return item.quantity <= 1 || !!item.weightGrams;
}

function canSplit(check: Check) {
  const items = activeSplitItems(check.items);
  return (check.status === 'served' || check.status === 'waiting_payment') &&
    !check.requiresWaiterDecision && (!check.paymentStatus || check.paymentStatus === 'pending') &&
    items.length > 0 && items.every(({ status }) => status === 'served');
}

export function canSplitOrder(check: Check) {
  const items = activeSplitItems(check.items);
  return canSplit(check) && !!check.updatedAt && check.source !== 'delivery' && check.source !== 'pickup' &&
    (check.source !== 'qr' || !!check.waiter) && (items.length > 1 || items.some((item) => !indivisibleSplitItem(item)));
}

export function canSplitAmount(check: Check) {
  return canSplit(check) && Number.isFinite(Number(check.finalAmount)) && maxSplitShares(Number(check.finalAmount)) >= 2;
}

export function splitItemSelection(items: CheckItem[], draft: Record<string, string>) {
  const lines = items.filter(({ id }) => draft[id] !== undefined).map((item) => ({ ...item, selected: Number(draft[item.id]) }));
  if (!lines.length || lines.some((line) => !Number.isSafeInteger(line.selected) ||
    line.selected < 1 || line.selected > line.quantity || (indivisibleSplitItem(line) && line.selected !== line.quantity)) ||
    (lines.length === items.length && lines.every((line) => line.selected === line.quantity))) return null;
  return lines.map(({ id, selected }) => ({ itemId: id, quantity: selected }));
}

export const splitCents = (value: number) => Math.round(value * 100);
export const maxSplitShares = (total: number) => Math.min(10, splitCents(total));

export function splitAmounts(total: number, count: number): string[] {
  const totalCents = splitCents(total);
  const base = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, i) =>
    String((base + Number(i < totalCents % count)) / 100),
  );
}

export function validSplitAmounts(total: number, amounts: number[]) {
  return amounts.length >= 2 && amounts.every((amount) => Number.isFinite(amount) && amount >= 0.01) &&
    amounts.reduce((sum, amount) => sum + splitCents(amount), 0) === splitCents(total);
}

export function adjustSplitAmount(inputs: string[], i: number, value: string, paid: boolean[], total: number) {
  const next = [...inputs];
  next[i] = value;
  const other = next.findIndex((_, index) => index > i && !paid[index]);
  const adjustIndex = other >= 0 ? other : (i > 0 ? paid.lastIndexOf(false, i - 1) : -1);
  if (adjustIndex >= 0) {
    const others = next.reduce((sum, amount, idx) => idx === adjustIndex ? sum : sum + splitCents(Number(amount) || 0), 0);
    next[adjustIndex] = String(Math.max(0, splitCents(total) - others) / 100);
  }
  return next;
}

export function splitPaymentMethod<T extends string>(payments: { method: T }[]): T | 'mixed' | undefined {
  return payments.every(({ method }) => method === payments[0]?.method) ? payments[0]?.method : 'mixed';
}
