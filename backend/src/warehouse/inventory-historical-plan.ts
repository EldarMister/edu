import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type Ingredient, type WarehouseDocumentKind } from '@prisma/client';
import { isISO8601 } from 'class-validator';
import { warehouseDocumentFilter, type WarehouseLocation } from './warehouse-location';

type Position = Pick<Ingredient, 'id' | 'name' | 'createdAt'>;
type DocumentItem = { ingredientId: string; quantity: Prisma.Decimal | null };
type PhysicalMovement = { ingredientId: string; beforeStock: Prisma.Decimal; afterStock: Prisma.Decimal; change: Prisma.Decimal };
const zero = new Prisma.Decimal(0);
const maximum = new Prisma.Decimal('99999999999.999');

/** A timestamp can contain several postings, and UUIDs do not encode their order.
 * Their balances must form one directed trail ending at the known closing stock.
 * Degree and connectivity checks prove that trail without guessing a UUID order,
 * including a receipt and withdrawal that revisit the same balance. */
function rewindPhysicalGroup(closing: Prisma.Decimal, rows: PhysicalMovement[]) {
  const opening = rows.reduce((stock, row) => stock.sub(row.change), closing);
  const degrees = new Map<string, number>();
  const neighbours = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.beforeStock.add(row.change).eq(row.afterStock)) return null;
    const from = row.afterStock.toString(), to = row.beforeStock.toString();
    degrees.set(from, (degrees.get(from) ?? 0) + 1);
    degrees.set(to, (degrees.get(to) ?? 0) - 1);
    if (!neighbours.has(from)) neighbours.set(from, new Set());
    if (!neighbours.has(to)) neighbours.set(to, new Set());
    neighbours.get(from)!.add(to);
    neighbours.get(to)!.add(from);
  }
  const end = closing.toString(), start = opening.toString();
  if (!neighbours.has(end)) return null;
  for (const [balance, degree] of degrees) {
    if (degree !== Number(balance === end) - Number(balance === start)) return null;
  }
  const visited = new Set<string>();
  const pending = [end];
  while (pending.length) {
    const balance = pending.pop()!;
    if (visited.has(balance)) continue;
    visited.add(balance);
    for (const neighbour of neighbours.get(balance)!) if (!visited.has(neighbour)) pending.push(neighbour);
  }
  return visited.size === neighbours.size ? opening : null;
}

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
        warehouseId: warehouse.id, kind: 'inventory',
        AND: [{ OR: [{ status: { in: ['posted', 'reversed'] } }, { reopenedAt: { not: null } }] },
          { OR: [{ postedAt: { gte: countedAt } }, { reversedAt: { gte: countedAt } }] }],
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
      select: { ingredientId: true, beforeStock: true, afterStock: true, change: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
    tx.$queryRaw<PhysicalMovement[]>`
      WITH latest AS (
        SELECT ingredient_id, MAX(created_at) AS created_at
        FROM stock_movements
        WHERE cafe_id = ${cafeId} AND ingredient_id IN (${idsSql})
          AND (warehouse_id = ${warehouseId} ${isDefault ? Prisma.sql`OR warehouse_id IS NULL` : Prisma.empty})
          AND created_at < ${cutoffUtc} AND change <> 0
        GROUP BY ingredient_id
      )
      SELECT m.ingredient_id AS "ingredientId", m.before_stock AS "beforeStock",
        m.after_stock AS "afterStock", m.change
      FROM stock_movements m JOIN latest l ON m.ingredient_id = l.ingredient_id AND m.created_at = l.created_at
      WHERE m.cafe_id = ${cafeId} AND m.ingredient_id IN (${idsSql})
        AND (m.warehouse_id = ${warehouseId} ${isDefault ? Prisma.sql`OR m.warehouse_id IS NULL` : Prisma.empty})
        AND m.change <> 0
    `,
    tx.$queryRaw<DocumentItem[]>`
      SELECT DISTINCT ON (i.ingredient_id) i.ingredient_id AS "ingredientId", i.quantity
      FROM warehouse_document_items i
      JOIN warehouse_documents d ON d.cafe_id = i.cafe_id AND d.id = i.document_id
      WHERE i.cafe_id = ${cafeId} AND d.warehouse_id = ${warehouseId} AND i.ingredient_id IN (${idsSql})
        AND d.kind = 'inventory' AND d.posted_at < ${cutoffUtc}
        AND (d.status = 'posted' OR d.reopened_at IS NOT NULL OR (d.status = 'reversed' AND d.reversed_at >= ${cutoffUtc}))
        AND i.quantity IS NOT NULL
      ORDER BY i.ingredient_id, d.posted_at DESC, d.id DESC
    `,
  ]);
  const historical = new Map(positions.map(({ id }) => [id, current.get(id)!.stock]));
  const names = new Map(positions.map(({ id, name }) => [id, name]));
  const incomplete = (id: string) => new ConflictException(`Журнал по позиции «${names.get(id)}» не подтверждает остаток на эту дату. Выберите более позднее время или пересчёт на момент проведения`);
  // Rewind complete timestamp groups; the cutoff never splits one timestamp.
  const groups = new Map<string, typeof later>();
  for (const movement of later) {
    const key = JSON.stringify([movement.ingredientId, movement.createdAt.getTime()]);
    const group = groups.get(key) ?? [];
    group.push(movement);
    groups.set(key, group);
  }
  for (const rows of groups.values()) {
    const id = rows[0].ingredientId;
    const opening = rewindPhysicalGroup(historical.get(id)!, rows);
    if (opening === null) throw incomplete(id);
    historical.set(id, opening);
  }
  const anchorGroups = new Map<string, PhysicalMovement[]>();
  for (const row of anchors) {
    const group = anchorGroups.get(row.ingredientId) ?? [];
    group.push(row);
    anchorGroups.set(row.ingredientId, group);
  }
  const countedStock = new Map(priorCounts.map(({ ingredientId, quantity }) => [ingredientId, quantity]));
  for (const [id, expected] of historical) {
    const anchor = anchorGroups.get(id);
    const confirmed = anchor ? rewindPhysicalGroup(expected, anchor) !== null : expected.eq(countedStock.get(id) ?? zero);
    if (!confirmed || expected.abs().gt(maximum)) throw incomplete(id);
  }
  return historical;
}
