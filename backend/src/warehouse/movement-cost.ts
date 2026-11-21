import { Prisma } from '@prisma/client';

export function preparedLossQuantity(movement: { type: string; sourceType: string; recipeSnapshot: unknown }) {
  const snapshot = movement.recipeSnapshot as { kind?: string; lossQuantity?: unknown } | null;
  if (movement.type !== 'writeoff' || movement.sourceType !== 'order' || snapshot?.kind !== 'prepared_loss') return new Prisma.Decimal(0);
  if (typeof snapshot.lossQuantity !== 'string' && typeof snapshot.lossQuantity !== 'number') return new Prisma.Decimal(0);
  try {
    const quantity = new Prisma.Decimal(snapshot.lossQuantity);
    return quantity.isFinite() && quantity.gt(0) ? quantity : new Prisma.Decimal(0);
  } catch { return new Prisma.Decimal(0); }
}

export const warehouseLossFilter: Prisma.StockMovementWhereInput = {
  OR: [
    { sourceType: 'writeoff' },
    { sourceType: 'inventory', OR: [
      { type: 'inventory', change: { lt: 0 } },
      { type: 'cancel', change: { gt: 0 } },
    ] },
    { sourceType: 'order', type: 'writeoff', recipeSnapshot: { path: ['kind'], equals: 'prepared_loss' } },
  ],
};
