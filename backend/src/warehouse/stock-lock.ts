import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';

/** Full inventory and catalog insertions share this lock so a new ingredient cannot slip into a count at posting. */
export async function lockWarehouseCatalog(tx: Prisma.TransactionClient, cafeId = getCafeId()) {
  if (!cafeId) return;
  const key = `warehouse-catalog:${cafeId}`;
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS catalog_lock`;
}

export async function lockIngredients(tx: Prisma.TransactionClient, ingredientIds: string[]) {
  if (!ingredientIds.length) return;
  const cafeId = getCafeId();
  const tenant = cafeId ? Prisma.sql`AND cafe_id = ${cafeId}` : Prisma.empty;
  await tx.$queryRaw`
    SELECT id FROM ingredients
    WHERE id IN (${Prisma.join([...new Set(ingredientIds)])}) ${tenant}
    ORDER BY id FOR UPDATE
  `;
}
