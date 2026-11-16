import type { FinanceEntry } from '@prisma/client';

export type AccountShift = { id: string; accountId: string; openedAt: Date; closedAt: Date | null };

/** A reconciled drawer cannot be silently changed by reversing a historical movement. */
export function canReverseEntry(entry: Pick<FinanceEntry, 'cashShiftId' | 'occurredAt'>, latest?: AccountShift) {
  if (!latest) return entry.cashShiftId == null;
  if (entry.cashShiftId) return latest.id === entry.cashShiftId && latest.closedAt == null;
  return latest.closedAt != null && entry.occurredAt >= latest.closedAt;
}
