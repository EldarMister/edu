import { Prisma } from '@prisma/client';

type MovementLeg = {
  id: string;
  ingredientId: string;
  warehouseId: string | null;
  sourceId: string | null;
  sourceType: string | null;
  type: string;
  quantity: Prisma.Decimal;
};

/** A transfer posts two physical legs. Inside the selected scope a fully
 * matched pair changes its distribution, but not its receipt or expense. */
export function internalTransferLegs(movements: MovementLeg[]) {
  const transfers = new Map<string, MovementLeg[]>();
  for (const row of movements) {
    if (row.sourceType !== 'transfer' || !row.sourceId || row.quantity.isZero()) continue;
    const key = JSON.stringify([row.ingredientId, row.sourceId, row.type]);
    const legs = transfers.get(key) ?? [];
    legs.push(row);
    transfers.set(key, legs);
  }
  const excluded = new Set<string>();
  for (const legs of transfers.values()) {
    if (legs.length !== 2 || legs[0].warehouseId === legs[1].warehouseId) continue;
    if (!legs[0].quantity.add(legs[1].quantity).isZero()) continue;
    for (const leg of legs) excluded.add(leg.id);
  }
  return excluded;
}
