import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type Ingredient, type WarehouseDocumentKind } from '@prisma/client';
import { isISO8601 } from 'class-validator';
import { warehouseDocumentFilter, type WarehouseLocation } from './warehouse-location';

type Position = Pick<Ingredient, 'id' | 'name' | 'createdAt'>;
type DocumentItem = { ingredientId: string; quantity: Prisma.Decimal | null };
const zero = new Prisma.Decimal(0);
const maximum = new Prisma.Decimal('99999999999.999');

export function parseInventoryCountedAt(kind: WarehouseDocumentKind, value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (kind !== 'inventory') throw new BadRequestException('Дата пересчёта доступна только для инвентаризации');
  if (value === null) return null;
  if (typeof value !== 'string' || !isISO8601(value, { strict: true, strictSeparator: true })
      || !/T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new BadRequestException('Укажите дату и время пересчёта с часовым поясом');
  }
  const countedAt = new Date(value);
  if (Number.isNaN(countedAt.getTime()) || countedAt > new Date()) throw new BadRequestException('Дата пересчёта не может быть в будущем');
  return countedAt;
}

export async function assertInventoryCutoff(
  tx: Prisma.TransactionClient, warehouse: WarehouseLocation, documentId: string, ingredientIds: string[], countedAt: Date,
) {
  if (!ingredientIds.length) return;
  const conflicting = await tx.warehouseDocumentItem.findFirst({
    where: {
      cafeId: warehouse.cafeId, documentId: { not: documentId }, ingredientId: { in: ingredientIds }, quantity: { not: null },
      document: {
        warehouseId: warehouse.id, kind: 'inventory', status: { in: ['posted', 'reversed'] },
        OR: [{ postedAt: { gte: countedAt } }, { reversedAt: { gte: countedAt } }],
      },
    },
    select: { name: true },
  });
  if (conflicting) throw new ConflictException(`Дата пересчёта «${conflicting.name}» должна быть позже проведения или сторно предыдущей инвентаризации на этом складе`);
}

export async function inventoryHistoricalPlan(
  tx: Prisma.TransactionClient, warehouse: WarehouseLocation, positions: Position[],
  current: Map<string, { stock: Prisma.Decimal }>, countedAt: Date,
) {
  if (!positions.length) return new Map<string, Prisma.Decimal>();
  const ids = positions.map(({ id }) => id);
  for (const position of positions) {
    if (position.createdAt > countedAt) throw new BadRequestException(`Позиция «${position.name}» создана после даты пересчёта`);
  }
  const { cafeId, id: warehouseId, isDefault } = warehouse;
  const idsSql = Prisma.join(ids);
  // Prisma binds Date as timestamptz; stored timestamps are UTC without a zone.
  const cutoffUtc = Prisma.sql`(${countedAt} AT TIME ZONE 'UTC')`;
  const [later, anchors, priorCounts] = await Promise.all([
    tx.stockMovement.findMany({
      where: { cafeId, ...warehouseDocumentFilter(warehouse), ingredientId: { in: ids },
        createdAt: { gte: countedAt }, change: { not: 0 } },
      select: { ingredientId: true, beforeStock: true, afterStock: true, change: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    tx.$queryRaw<{ ingredientId: string; afterStock: Prisma.Decimal }[]>`
      SELECT DISTINCT ON (m.ingredient_id) m.ingredient_id AS "ingredientId", m.after_stock AS "afterStock"
      FROM stock_movements m
      WHERE m.cafe_id = ${cafeId} AND m.ingredient_id IN (${idsSql})
        AND (m.warehouse_id = ${warehouseId} ${isDefault ? Prisma.sql`OR m.warehouse_id IS NULL` : Prisma.empty})
        AND m.created_at < ${cutoffUtc} AND m.change <> 0
      ORDER BY m.ingredient_id, m.created_at DESC, m.id DESC
    `,
    tx.$queryRaw<DocumentItem[]>`
      SELECT DISTINCT ON (i.ingredient_id) i.ingredient_id AS "ingredientId", i.quantity
      FROM warehouse_document_items i
      JOIN warehouse_documents d ON d.cafe_id = i.cafe_id AND d.id = i.document_id
      WHERE i.cafe_id = ${cafeId} AND d.warehouse_id = ${warehouseId} AND i.ingredient_id IN (${idsSql})
        AND d.kind = 'inventory' AND d.posted_at < ${cutoffUtc}
        AND (d.status = 'posted' OR (d.status = 'reversed' AND d.reversed_at >= ${cutoffUtc}))
        AND i.quantity IS NOT NULL
      ORDER BY i.ingredient_id, d.posted_at DESC, d.id DESC
    `,
  ]);
  const historical = new Map(positions.map(({ id }) => [id, current.get(id)!.stock]));
  const names = new Map(positions.map(({ id, name }) => [id, name]));
  const incomplete = (id: string) => new ConflictException(`Журнал по позиции «${names.get(id)}» не подтверждает остаток на эту дату. Выберите более позднее время или пересчёт на момент проведения`);
  // Rewind only physical deltas and check that each journal entry connects to
  // the balance after it. This bounds historical counts to reconstructable periods.
  for (const movement of later) {
    const { ingredientId, beforeStock, afterStock, change } = movement;
    const stock = historical.get(ingredientId)!;
    if (!stock.eq(afterStock) || !stock.sub(change).eq(beforeStock)) throw incomplete(ingredientId);
    historical.set(ingredientId, beforeStock);
  }
  const confirmedStock = new Map(anchors.map(({ ingredientId, afterStock }) => [ingredientId, afterStock]));
  const countedStock = new Map(priorCounts.map(({ ingredientId, quantity }) => [ingredientId, quantity]));
  for (const [id, expected] of historical) {
    const anchor = confirmedStock.get(id) ?? countedStock.get(id) ?? zero;
    if (!expected.eq(anchor) || expected.abs().gt(maximum)) throw incomplete(id);
  }
  return historical;
}
