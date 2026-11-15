import { Prisma, type WarehouseDocumentItem } from '@prisma/client';
import { fromBase, normalizeUnit } from './units';
import type { WarehouseLocation } from './warehouse-location';

type PeriodRow = {
  ingredientId: string;
  lastCountAt: Date | null;
  priorQuantity: Prisma.Decimal | null;
  incomingQuantity: Prisma.Decimal;
  consumptionQuantity: Prisma.Decimal;
  writeoffQuantity: Prisma.Decimal;
  otherQuantity: Prisma.Decimal;
};

export async function inventoryPeriodContext(
  tx: Prisma.TransactionClient,
  warehouse: WarehouseLocation,
  documentId: string,
  items: WarehouseDocumentItem[],
  cutoffAt: Date,
) {
  const { cafeId, id: warehouseId, isDefault } = warehouse;
  const countedItems = items.filter(({ expected }) => expected !== null);
  if (!countedItems.length) return { cutoffAt, rows: [] };
  const ingredientIds = Prisma.join(countedItems.map(({ ingredientId }) => ingredientId));
  // Prisma binds a Date as timestamptz. Warehouse timestamps store UTC with
  // no time-zone type, so strip the zone in UTC before comparing any cutoff.
  const cutoffUtc = Prisma.sql`(${cutoffAt} AT TIME ZONE 'UTC')`;
  const periods = await tx.$queryRaw<PeriodRow[]>`
    WITH previous AS (
      SELECT DISTINCT ON (i.ingredient_id)
        i.ingredient_id, i.quantity, COALESCE(d.counted_at, d.posted_at) AS count_at, d.id
      FROM warehouse_document_items i
      JOIN warehouse_documents d ON d.cafe_id = i.cafe_id AND d.id = i.document_id
      WHERE i.cafe_id = ${cafeId} AND d.warehouse_id = ${warehouseId}
        AND i.ingredient_id IN (${ingredientIds}) AND i.quantity IS NOT NULL
        AND d.kind = 'inventory' AND d.id <> ${documentId} AND d.posted_at < ${cutoffUtc}
        AND (d.status = 'posted' OR (d.status = 'reversed' AND d.reversed_at > ${cutoffUtc}))
      ORDER BY i.ingredient_id, d.posted_at DESC, d.id DESC
    ), flows AS (
      SELECT m.ingredient_id, m.change,
        CASE
          WHEN m.source_type = 'purchase' THEN 'incoming'
          WHEN m.source_type = 'order' THEN 'consumption'
          WHEN m.source_type = 'writeoff' THEN 'writeoff'
          WHEN m.source_type IN ('transfer', 'production', 'processing') AND m.change > 0 THEN 'incoming'
          ELSE 'other'
        END AS bucket
      FROM stock_movements m
      LEFT JOIN previous p ON p.ingredient_id = m.ingredient_id
      WHERE m.cafe_id = ${cafeId} AND m.ingredient_id IN (${ingredientIds}) AND m.change <> 0
        AND (m.warehouse_id = ${warehouseId} ${isDefault ? Prisma.sql`OR m.warehouse_id IS NULL` : Prisma.empty})
        AND m.created_at < ${cutoffUtc}
        AND (p.count_at IS NULL OR m.created_at >= p.count_at)
        AND NOT (p.id IS NULL AND m.source_type IS NOT DISTINCT FROM 'manual' AND m.type = 'correction'
          AND m.source_id IS NOT DISTINCT FROM m.ingredient_id
          AND m.comment IS NOT DISTINCT FROM 'Начальный остаток')
        AND (m.source_type IS DISTINCT FROM 'inventory' OR (
          m.source_id IS DISTINCT FROM ${documentId}
          AND (p.id IS NULL OR m.source_id IS DISTINCT FROM p.id)
        ))
    ), totals AS (
      SELECT ingredient_id,
        SUM(change) FILTER (WHERE bucket = 'incoming') AS incoming,
        SUM(change) FILTER (WHERE bucket = 'consumption') AS consumption,
        SUM(change) FILTER (WHERE bucket = 'writeoff') AS writeoff,
        SUM(change) FILTER (WHERE bucket = 'other') AS other
      FROM flows GROUP BY ingredient_id
    )
    SELECT COALESCE(p.ingredient_id, t.ingredient_id) AS "ingredientId",
      p.count_at AS "lastCountAt", p.quantity AS "priorQuantity",
      COALESCE(t.incoming, 0) AS "incomingQuantity",
      COALESCE(t.consumption, 0) AS "consumptionQuantity",
      COALESCE(t.writeoff, 0) AS "writeoffQuantity",
      COALESCE(t.other, 0) AS "otherQuantity"
    FROM previous p FULL OUTER JOIN totals t USING (ingredient_id)
  `;
  const byIngredient = new Map(periods.map((period) => [period.ingredientId, period]));
  const zero = new Prisma.Decimal(0);
  const rows = countedItems.map((item) => {
    const period = byIngredient.get(item.ingredientId);
    const incoming = period?.incomingQuantity ?? zero;
    const consumption = period?.consumptionQuantity ?? zero;
    const writeoff = period?.writeoffQuantity ?? zero;
    const other = period?.otherQuantity ?? zero;
    // A balance imported before warehouse tracking has no opening journal row.
    // Preserve it as opening stock. With a real count, retain that actual
    // quantity and use Other to reconcile unlogged historical differences.
    const opening = period?.priorQuantity ?? item.expected!.sub(incoming).sub(consumption).sub(writeoff).sub(other);
    const balancedOther = item.expected!.sub(opening).sub(incoming).sub(consumption).sub(writeoff);
    const unit = normalizeUnit(item.unit);
    const display = (quantity: Prisma.Decimal) => fromBase(Number(quantity), unit);
    return {
      ingredientId: item.ingredientId, lastCountAt: period?.lastCountAt ?? null,
      openingQuantity: display(opening), incomingQuantity: display(incoming),
      consumptionQuantity: display(consumption), writeoffQuantity: display(writeoff),
      otherQuantity: display(balancedOther),
    };
  });
  return { cutoffAt, rows };
}
