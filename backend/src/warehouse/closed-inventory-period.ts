import { Prisma } from '@prisma/client';

/** A later physical count supersedes earlier stock corrections, including zero-variance counts. */
export async function inventoryReversalBlockedReason(
  db: Prisma.TransactionClient,
  cafeId: string,
  operationAt: Date,
  scopes: { warehouseId: string; ingredientId: string }[],
  excludeDocumentId?: string,
) {
  if (!scopes.length) return null;
  const warehouses = new Map<string, Set<string>>();
  for (const { warehouseId, ingredientId } of scopes) {
    const ingredients = warehouses.get(warehouseId) ?? new Set<string>();
    ingredients.add(ingredientId);
    warehouses.set(warehouseId, ingredients);
  }
  const count = await db.warehouseDocumentItem.findFirst({
    where: {
      cafeId, quantity: { not: null },
      document: {
        kind: 'inventory', id: excludeDocumentId ? { not: excludeDocumentId } : undefined,
        AND: [{ OR: [{ status: 'posted' }, { reopenedAt: { not: null } }] },
          { OR: [{ countedAt: { gte: operationAt } }, { countedAt: null, postedAt: { gte: operationAt } }] }],
      },
      OR: [...warehouses].map(([warehouseId, ids]) => ({
        ingredientId: { in: [...ids] }, document: { warehouseId },
      })),
    },
    select: { ingredientId: true },
  });
  return count ? 'После этой операции по её продуктам проведена инвентаризация. Отмена изменит подтверждённые остатки. Сначала отмените более позднюю инвентаризацию или внесите новый складской документ.' : null;
}

/** Each affected position must be inside its own closest following count. */
export async function nextInventoryPeriods(
  tx: Prisma.TransactionClient, cafeId: string | null, operationAt: Date, warehouseIds: string[], ingredientIds: string[],
) {
  if (!warehouseIds.length || !ingredientIds.length) return [];
  const rows = await tx.warehouseDocumentItem.findMany({
    where: { cafeId: cafeId ?? undefined, ingredientId: { in: ingredientIds }, quantity: { not: null },
      document: { kind: 'inventory', warehouseId: { in: warehouseIds },
        AND: [{ OR: [{ status: { in: ['posted', 'reversed'] } }, { reopenedAt: { not: null } }] },
          { OR: [{ countedAt: { gte: operationAt } }, { countedAt: null, postedAt: { gte: operationAt } }] }] } },
    select: { ingredientId: true, document: { select: { warehouseId: true, countedAt: true, postedAt: true, reopenedAt: true } } },
  });
  const cutoff = (item: (typeof rows)[number]) => (item.document.countedAt ?? item.document.postedAt!).getTime();
  const nearest = new Map<string, (typeof rows)[number]>();
  for (const row of rows.sort((a, b) => cutoff(a) - cutoff(b))) {
    const key = JSON.stringify([row.document.warehouseId, row.ingredientId]);
    if (!nearest.has(key)) nearest.set(key, row);
  }
  return [...nearest.values()];
}
