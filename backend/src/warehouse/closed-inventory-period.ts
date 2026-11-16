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
        kind: 'inventory', status: 'posted', id: excludeDocumentId ? { not: excludeDocumentId } : undefined,
        OR: [{ countedAt: { gte: operationAt } }, { countedAt: null, postedAt: { gte: operationAt } }],
      },
      OR: [...warehouses].map(([warehouseId, ids]) => ({
        ingredientId: { in: [...ids] }, document: { warehouseId },
      })),
    },
    select: { ingredientId: true },
  });
  return count ? 'После этой операции по её продуктам проведена инвентаризация. Отмена изменит подтверждённые остатки. Сначала отмените более позднюю инвентаризацию или внесите новый складской документ.' : null;
}
