import type { FinanceCategory, TransactionKind } from './api';
import { financeDay } from './format';

export const choice = ({ id, name }: { id: string; name: string }) => ({ value: id, label: name, translate: false });

export function acceptsTransaction(category: FinanceCategory, kind: TransactionKind) {
  return kind !== 'transfer' && (category.kind === 'both' || category.kind === kind);
}

export function categoryChoices(categories: FinanceCategory[], accepts: (category: FinanceCategory) => boolean = () => true) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return categories.filter(accepts).map((category) => {
    const labels = [category.name];
    const seen = new Set([category.id]);
    for (let parent = category.parentId; parent && !seen.has(parent);) {
      seen.add(parent);
      const item = byId.get(parent);
      if (!item) break;
      labels.unshift(item.name);
      parent = item.parentId;
    }
    return { ...choice(category), label: labels.join(' / ') };
  });
}

export function compatibleParent(categories: FinanceCategory[], parent: FinanceCategory, childId?: string): boolean {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  for (let ancestor: string | null = parent.id; ancestor; ancestor = byId.get(ancestor)?.parentId ?? null) {
    if (ancestor === childId || seen.has(ancestor)) return false;
    seen.add(ancestor);
  }
  return true;
}

export function transactionDate(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const value = new Date(date + 'T' + time + ':00+06:00');
  return !Number.isNaN(value.getTime()) && financeDay(value) === date ? value : null;
}
