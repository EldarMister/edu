import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type StockMovement } from '@prisma/client';
import { calculateStockValuation } from './stock-posting';
import { calculatePurchaseCorrection, historicalPurchaseCorrection, historicalPurchaseValue } from './purchase-correction';
import { getWarehouseBalance, setWarehouseBalance, type WarehouseLocation } from './warehouse-location';
import { conversionDependencies, conversionPricing, conversionStrictStock, isConversionMovement,
  loadHistoricalConversions, persistHistoricalConversions } from './historical-conversion';

type Movement = StockMovement;
type Balance = { stock: Prisma.Decimal; avgCost: Prisma.Decimal | null; valuationKnown: boolean };
type Price = { costAtMoment: Prisma.Decimal; costKnown: boolean };
type Replayed = Price & { beforeStock: Prisma.Decimal; afterStock: Prisma.Decimal;
  valuationAdjustment: Prisma.Decimal; beforeValuationKnown: boolean; valuationKnown: boolean };
type ReceiptLine = { ingredientId: string; quantityBase: Prisma.Decimal; total: Prisma.Decimal };

const zero = new Prisma.Decimal(0);
const rounding = new Prisma.Decimal('0.000000005');
const maxQuantity = new Prisma.Decimal('99999999999.999');
const movementLimit = 20_000;
const scopeKey = (row: Movement) => JSON.stringify([row.ingredientId, row.warehouseKey]);
const documentKey = (row: Movement) => JSON.stringify([row.sourceType, row.sourceId, row.ingredientId]);
const warehouseDocumentKey = (row: Movement) => JSON.stringify([row.sourceType, row.sourceId, scopeKey(row)]);
const saleKey = (row: Movement, sale: boolean) => JSON.stringify([
  row.sourceId, sale ? row.orderItemId : row.saleLineId ?? row.orderItemId, scopeKey(row), row.saleCycle,
]);
const actualTime = (row: Movement) => (row.recordedAt ?? row.createdAt).getTime();
const conversionKey = (row: Movement) => JSON.stringify([row.sourceType, row.sourceId]);
const isConversionInput = (row: Pick<Movement, 'change' | 'sourceType' | 'type'>) => row.change.lt(0)
  && (row.sourceType === 'production' || row.sourceType === 'processing') && row.type !== 'cancel';

function cannotReplay(reason: string) {
  return new ConflictException(`Пересчёт задним числом невозможен: ${reason}`);
}

function bookValue({ stock, avgCost }: Balance) {
  if (!avgCost && !stock.isZero()) throw cannotReplay('в журнале нет подтверждённой исходной оценки остатка');
  return stock.mul(avgCost ?? zero);
}

function usesBookCost(row: Pick<Movement, 'change' | 'sourceType' | 'type'>) {
  return row.change.lt(0) && (
    (row.sourceType === 'order' && row.type === 'sale') ||
    (row.sourceType === 'writeoff' && row.type === 'writeoff') ||
    (row.sourceType === 'transfer' && row.type === 'transfer') ||
    (row.sourceType === 'supplier_return' && row.type === 'supplier_return') || isConversionInput(row)
  );
}

function unpost(after: Balance, movement: Movement): Balance {
  const { beforeStock, afterStock, change, costAtMoment, valuationAdjustment, beforeValuationKnown } = movement;
  if (!after.stock.eq(afterStock) || after.valuationKnown !== movement.valuationKnown || !beforeStock.add(change).eq(afterStock)) {
    throw cannotReplay('остатки не образуют непрерывную цепочку');
  }
  const value = bookValue(after).sub(change.mul(costAtMoment)).sub(valuationAdjustment);
  if (beforeStock.isZero()) {
    if (value.abs().gt(rounding)) throw cannotReplay('нулевой остаток имеет неподтверждённую оценку');
    const carriedCost = usesBookCost(movement) || movement.type === 'inventory' ? costAtMoment : change.isZero() ? after.avgCost : null;
    return { stock: beforeStock, avgCost: carriedCost, valuationKnown: beforeValuationKnown };
  }
  // The journal stores eight decimal places. Recover an exact representable
  // average, or rely on a movement that explicitly records that prior price.
  const hint = usesBookCost(movement) || movement.type === 'inventory' ? costAtMoment : null;
  const [first, last] = [value.sub(rounding).div(beforeStock), value.add(rounding).div(beforeStock)]
    .sort((a, b) => a.comparedTo(b));
  const low = first.toDecimalPlaces(8, Prisma.Decimal.ROUND_CEIL);
  const high = last.toDecimalPlaces(8, Prisma.Decimal.ROUND_FLOOR);
  const avgCost = hint && hint.gte(low) && hint.lte(high) ? hint : low.eq(high) ? low : null;
  if (!avgCost || avgCost.lt(0)) throw cannotReplay('исходная себестоимость не восстанавливается однозначно');
  return { stock: beforeStock, avgCost, valuationKnown: beforeValuationKnown };
}

function compareChronology(a: Movement, b: Movement) {
  return a.createdAt.getTime() - b.createdAt.getTime() || actualTime(a) - actualTime(b);
}

/** An arbitrary UUID order cannot reconstruct old operations in one millisecond.
 * Follow each warehouse's before/after chain, refusing ambiguous financial ties. */
function unwindLane(current: Balance, rows: Movement[]) {
  const ordered = rows.sort((a, b) => compareChronology(b, a));
  let balance = current;
  const reversed: Movement[] = [];
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && !compareChronology(ordered[start], ordered[end])) end++;
    const tied = ordered.slice(start, end);
    while (tied.length) {
      const candidates = tied.filter((row) => row.afterStock.eq(balance.stock) && row.valuationKnown === balance.valuationKnown);
      const harmless = candidates.filter((row) => row.change.isZero() && row.valuationAdjustment.isZero()
        && row.beforeValuationKnown === row.valuationKnown);
      const chosen = harmless[0] ?? (candidates.length === 1 ? candidates[0] : null);
      if (!chosen) throw cannotReplay('нельзя установить порядок операций с одинаковым временем');
      balance = unpost(balance, chosen);
      reversed.push(chosen);
      tied.splice(tied.indexOf(chosen), 1);
    }
    start = end;
  }
  return { balance, rows: reversed.reverse() };
}

function transferPairs(rows: Movement[]) {
  const pairs = new Map<string, Movement[]>();
  for (const row of rows) {
    if (row.type !== 'transfer' || row.sourceType !== 'transfer') continue;
    const key = documentKey(row);
    const entries = pairs.get(key) ?? [];
    entries.push(row);
    pairs.set(key, entries);
  }
  return pairs;
}

function transferPair(pairs: Map<string, Movement[]>, movement: Movement) {
  const rows = pairs.get(documentKey(movement));
  const debit = rows?.find((row) => row.change.lt(0));
  const credit = rows?.find((row) => row.change.gt(0));
  if (!debit || !credit || rows?.length !== 2 || !movement.sourceId || scopeKey(debit) === scopeKey(credit)
      || !debit.change.add(credit.change).isZero() || compareChronology(debit, credit) > 0) {
    throw cannotReplay('в журнале нет двух согласованных сторон перемещения');
  }
  return { debit, credit };
}

async function lockReplayIngredients(tx: Prisma.TransactionClient, cafeId: string, ids: string[]) {
  try {
    // The caller already holds the original ingredients. Fail and roll back
    // instead of waiting on a later ingredient while another writer holds it.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM ingredients WHERE cafe_id = ${cafeId} AND id IN (${Prisma.join(ids)})
      ORDER BY id FOR UPDATE NOWAIT
    `;
    if (locked.length !== ids.length) throw cannotReplay('исходная складская позиция больше недоступна');
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '55P03') {
      throw cannotReplay('связанные остатки изменяются другой операцией; повторите проведение');
    }
    throw error;
  }
}

async function chartLanes(tx: Prisma.TransactionClient, cafeId: string, scanAt: Date, starts: Map<string, number>, seeds: string[]) {
  const suffix: Movement[] = [];
  const ingredients = new Set(seeds);
  const loaded = new Set<string>();
  const expanded = new Set<string>();
  const expandedPeriods = new Set<string>();
  const periodStarts = new Map(starts);
  const follow = (row: Movement, dates = starts) => {
    const key = scopeKey(row), time = row.createdAt.getTime();
    if ((dates.get(key) ?? Infinity) <= time) return;
    dates.set(key, time);
    ingredients.add(row.ingredientId);
  };

  // Only the output lanes reachable from a changed cost need replay. Their
  // output costs can in turn feed transfers and other conversion inputs.
  while (true) {
    const nextIngredients = [...ingredients].filter((id) => !loaded.has(id));
    if (nextIngredients.length) {
      await lockReplayIngredients(tx, cafeId, nextIngredients);
      const rows = await tx.stockMovement.findMany({
        where: { cafeId, ingredientId: { in: nextIngredients }, createdAt: { gte: scanAt } },
        take: movementLimit - suffix.length + 1,
      });
      suffix.push(...rows);
      if (suffix.length > movementLimit) throw cannotReplay('слишком много движений; выберите более позднюю дату');
      nextIngredients.forEach((id) => loaded.add(id));
    }
    const sources = suffix.filter((row) => {
      const transfer = row.sourceType === 'transfer' && row.type === 'transfer' && row.change.lt(0);
      if (!transfer && !isConversionInput(row)) return false;
      const key = scopeKey(row), time = row.createdAt.getTime();
      return (!expanded.has(row.id) && time >= (starts.get(key) ?? Infinity))
        || (transfer && !expandedPeriods.has(row.id) && time >= (periodStarts.get(key) ?? Infinity));
    });
    if (!sources.length) return { suffix, ingredientIds: [...ingredients], periodStarts };
    const transferIds = sources.flatMap((row) => row.sourceType === 'transfer' && row.sourceId ? [row.sourceId] : []);
    const conversionIds = sources.flatMap((row) => isConversionInput(row) && row.sourceId ? [row.sourceId] : []);
    const [transferLegs, conversionOutputs] = await Promise.all([
      transferIds.length ? tx.stockMovement.findMany({ where: { cafeId, sourceId: { in: transferIds },
        sourceType: 'transfer', type: 'transfer', ingredientId: { in: [...ingredients] } } }) : [],
      conversionIds.length ? tx.stockMovement.findMany({ where: { cafeId, sourceId: { in: conversionIds },
        sourceType: { in: ['production', 'processing'] }, type: { not: 'cancel' }, change: { gt: 0 } } }) : [],
    ]);
    const pairs = transferPairs(transferLegs);
    const outputs = new Map<string, Movement[]>();
    for (const row of conversionOutputs) {
      const key = conversionKey(row);
      const entries = outputs.get(key) ?? [];
      entries.push(row);
      outputs.set(key, entries);
    }
    for (const row of sources) {
      if (row.sourceType === 'transfer') {
        const { credit } = transferPair(pairs, row);
        follow(credit);
        if (row.createdAt.getTime() >= (periodStarts.get(scopeKey(row)) ?? Infinity)) {
          follow(credit, periodStarts);
          expandedPeriods.add(row.id);
        }
      } else {
        const results = outputs.get(conversionKey(row));
        if (!results?.length) throw cannotReplay('в журнале нет выпуска по производству или переработке');
        for (const output of results) {
          if (compareChronology(row, output) > 0) throw cannotReplay('выпуск проведён до расхода сырья');
          follow(output);
        }
      }
      expanded.add(row.id);
    }
  }
}

export function receiptMovementValue(movement: Movement, items: ReceiptLine[] | undefined) {
  if (movement.receiptValue != null) {
    if (!movement.receiptValue.div(movement.change).toDecimalPlaces(8).eq(movement.costAtMoment)) {
      throw cannotReplay('сумма поставки расходится с исходной ценой');
    }
    return movement.receiptValue;
  }
  const amount = items?.filter((line) =>
    line.ingredientId === movement.ingredientId && line.quantityBase.eq(movement.change)
    && line.quantityBase.gt(0) && line.total.div(line.quantityBase).toDecimalPlaces(8).eq(movement.costAtMoment));
  if (!amount?.length || amount.some((line) => !line.total.eq(amount[0].total))) {
    throw cannotReplay('нельзя подтвердить исходную сумму поставки');
  }
  return amount[0].total;
}

type Pricing = { mode: 'preserve' | 'average' | 'value'; price: Price; value?: Prisma.Decimal };

function replayStep(before: Balance, row: Movement, pricing: Pricing) {
  const { mode, price, value } = pricing;
  const { stock, avgCost, valuationKnown, cost, costKnown, valuationAdjustment } = calculateStockValuation(
    { ...before, avgCost: before.avgCost ?? zero },
    { change: row.change, cost: price.costAtMoment, costKnown: price.costKnown, value, valuation: mode },
  );
  const balance = { stock, avgCost: before.avgCost === null && row.change.isZero() ? null : avgCost, valuationKnown };
  const movement = {
    costAtMoment: cost, costKnown, beforeStock: before.stock, afterStock: stock, valuationAdjustment,
    beforeValuationKnown: before.valuationKnown, valuationKnown,
  };
  return { balance, movement };
}

function replayPurchaseCorrection(before: Balance, row: Movement) {
  if (before.avgCost === null) throw cannotReplay('не подтверждена себестоимость перед исправлением поставки');
  const { stock, avgCost, valuationKnown, costKnown, valuationAdjustment } = calculatePurchaseCorrection(
    { ...before, avgCost: before.avgCost }, row.change, historicalPurchaseValue(row),
  );
  return {
    balance: { stock, avgCost, valuationKnown },
    movement: { costAtMoment: before.avgCost, costKnown, beforeStock: before.stock, afterStock: stock, valuationAdjustment,
      beforeValuationKnown: before.valuationKnown, valuationKnown },
  };
}

type OpeningWitness = Pick<Movement, 'change' | 'sourceType' | 'type' | 'afterStock' | 'valuationKnown' | 'costAtMoment'> & { key: string };

async function verifyOpening(
  tx: Prisma.TransactionClient, cafeId: string, lanes: Map<string, Movement[]>, starts: Map<string, number>, balances: Map<string, Balance>,
) {
  const scope = [...lanes].map(([key, [first]]) => ({
    key, ingredient: first.ingredientId, warehouse: first.warehouseKey, cutoff: new Date(starts.get(key)!).toISOString(),
  }));
  const anchors = await tx.$queryRaw<OpeningWitness[]>`
    SELECT s.key, m.change, m.source_type AS "sourceType", m.type, m.after_stock AS "afterStock",
      m.valuation_known AS "valuationKnown", m.cost_at_moment AS "costAtMoment"
    FROM jsonb_to_recordset(${JSON.stringify(scope)}::jsonb)
      AS s(key text, ingredient text, warehouse text, cutoff timestamptz)
    JOIN LATERAL (
      SELECT p.created_at, COALESCE(p.recorded_at, p.created_at) AS actual_at
      FROM stock_movements p
      WHERE p.cafe_id = ${cafeId} AND p.ingredient_id = s.ingredient AND p.warehouse_key = s.warehouse
        AND p.created_at < (s.cutoff AT TIME ZONE 'UTC')
      ORDER BY p.created_at DESC, COALESCE(p.recorded_at, p.created_at) DESC
      LIMIT 1
    ) prior ON true
    JOIN stock_movements m ON m.cafe_id = ${cafeId} AND m.ingredient_id = s.ingredient AND m.warehouse_key = s.warehouse
      AND m.created_at = prior.created_at AND COALESCE(m.recorded_at, m.created_at) = prior.actual_at
  `;
  const byKey = new Map<string, OpeningWitness[]>();
  for (const row of anchors) {
    const group = byKey.get(row.key) ?? [];
    group.push(row);
    byKey.set(row.key, group);
  }
  for (const [key, balance] of balances) {
    const prior = byKey.get(key) ?? [];
    const matching = prior.filter((row) => row.afterStock.eq(balance.stock) && row.valuationKnown === balance.valuationKnown);
    if (!matching.length && (prior.length || !balance.stock.isZero())) {
      throw cannotReplay('журнал не подтверждает начальный остаток на выбранную дату');
    }
    if (balance.avgCost === null && balance.stock.isZero()) {
      const carryingPrices = matching.filter(usesBookCost).map((row) => row.costAtMoment);
      if (!prior.length) balances.set(key, { ...balance, avgCost: zero });
      else if (carryingPrices.length && carryingPrices.every((price) => price.eq(carryingPrices[0]))) {
        balances.set(key, { ...balance, avgCost: carryingPrices[0] });
      }
    }
  }
}

type InventoryRepost = { id: string; ingredientIds: string[]; recordedAt: Date; actorId: string; actorName: string; note: string | null };
type ReplayInput = { cafeId: string; effectiveAt: Date; insertedMovementIds: string[]; inventoryRepost?: InventoryRepost };
type AppliedCount = {
  ingredientId: string;
  quantity: Prisma.Decimal | null;
  reopenedQuantity: Prisma.Decimal | null;
  expected: Prisma.Decimal | null;
  document: { id: string; warehouseId: string; postedAt: Date | null; countedAt: Date | null; reopenedAt: Date | null;
    status: string; postedById: string | null; postedByName: string | null; note: string | null };
};
const inventoryReset = 'inventory_zero_cost';
const inventoryResetSnapshot = { kind: inventoryReset };
const isInventoryReset = (row: Movement) => (row.recipeSnapshot as Prisma.JsonObject | null)?.kind === inventoryReset;

function inventoryLane(item: AppliedCount, locations: Map<string, WarehouseLocation>) {
  const warehouse = locations.get(item.document.warehouseId);
  return JSON.stringify([item.ingredientId, warehouse?.isDefault ? 'default' : item.document.warehouseId]);
}

function inventoryPlaceholder(cafeId: string, item: AppliedCount, locations: Map<string, WarehouseLocation>): Movement {
  const { ingredientId, document } = item;
  return {
    id: randomUUID(), cafeId, ingredientId, orderItemId: null, type: 'inventory', sourceType: 'inventory', sourceId: document.id,
    beforeStock: zero, change: zero, afterStock: zero, costAtMoment: zero, comment: document.note, createdAt: document.postedAt!,
    recordedAt: null, receiptValue: null, warehouseId: document.warehouseId,
    valuationAdjustment: zero, actorId: document.postedById, actorName: document.postedByName, reason: null,
    recipeSnapshot: null, saleQuantity: null, warehouseKey: locations.get(document.warehouseId)?.isDefault ? 'default' : document.warehouseId,
    saleCycle: 0, saleLineId: null, costKnown: false, beforeValuationKnown: false, valuationKnown: false,
  };
}

/** Caller holds the same sorted ingredient locks as normal postings. All
 * provisional writes and this replay must be part of the same transaction. */
export async function replayHistoricalStock(tx: Prisma.TransactionClient, input: ReplayInput) {
  const { cafeId, effectiveAt, insertedMovementIds, inventoryRepost } = input;
  if (!insertedMovementIds.length && !inventoryRepost) return new Map<string, Replayed>();
  const reposted = inventoryRepost && await tx.warehouseDocument.findFirst({
    where: { id: inventoryRepost.id, cafeId, kind: 'inventory', reopenedAt: { not: null } },
    select: { warehouseId: true, items: { where: { ingredientId: { in: inventoryRepost.ingredientIds } },
      select: { ingredientId: true } } },
  });
  if (inventoryRepost && !reposted?.items.length) throw cannotReplay('инвентаризация уже закрыта');
  const insertedRecords: Movement[] = await tx.stockMovement.findMany({ where: { cafeId, id: { in: insertedMovementIds } } });
  const insertedById = new Map(insertedRecords.map((row) => [row.id, row]));
  if (insertedById.size !== insertedMovementIds.length || insertedRecords.some((row) => row.createdAt.getTime() !== effectiveAt.getTime())) {
    throw cannotReplay('новые проводки не соответствуют дате документа');
  }
  const inserted = insertedMovementIds.map((id) => insertedById.get(id)!);
  const repostedMovements = inventoryRepost ? await tx.stockMovement.findMany({
    where: { cafeId, type: 'inventory', sourceType: 'inventory', sourceId: inventoryRepost.id,
      ingredientId: { in: inventoryRepost.ingredientIds } },
    select: { ingredientId: true, createdAt: true },
  }) : [];
  const scanAt = new Date(Math.min(effectiveAt.getTime(), ...repostedMovements.map(({ createdAt }) => createdAt.getTime())));
  const seedIngredients = [...new Set([...inserted.map((row) => row.ingredientId), ...(reposted?.items ?? []).map(({ ingredientId }) => ingredientId)])];
  const [locations, settings] = await Promise.all([
    tx.warehouse.findMany({ where: { cafeId }, select: { id: true, cafeId: true, name: true, isDefault: true } }),
    tx.settings.findFirst({ where: { cafeId }, select: { allowNegativeIngredientStock: true } }),
  ]);
  const byLocation = new Map(locations.map((location) => [location.id, location]));
  const starts = new Map(inserted.map((row) => [scopeKey(row), row.createdAt.getTime()]));
  if (reposted) {
    const warehouse = byLocation.get(reposted.warehouseId);
    if (!warehouse) throw cannotReplay('не удалось подтвердить склад инвентаризации');
    const openingByIngredient = new Map(repostedMovements.map(({ ingredientId, createdAt }) => [ingredientId, createdAt]));
    for (const { ingredientId } of reposted.items) {
      const opening = openingByIngredient.get(ingredientId) ?? effectiveAt;
      starts.set(JSON.stringify([ingredientId, warehouse.isDefault ? 'default' : warehouse.id]),
        Math.min(effectiveAt.getTime(), opening.getTime()));
    }
  }
  const { suffix, ingredientIds, periodStarts } = await chartLanes(tx, cafeId, scanAt, starts, seedIngredients);
  const startFor = (row: Movement) => starts.get(scopeKey(row)) ?? Infinity;
  const replayRows = suffix.filter((row) => row.createdAt.getTime() >= startFor(row));

  const suffixIds = [...new Set(suffix.flatMap((row) => row.sourceId ? [row.sourceId] : []))];
  const [ingredients, transferOrigins, saleOrigins, reversedOrigins, receipts, inventories, conversions] = await Promise.all([
    tx.ingredient.findMany({ where: { cafeId, id: { in: ingredientIds } } }),
    tx.stockMovement.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, sourceId: { in: suffixIds },
      sourceType: 'transfer', type: 'transfer' } }),
    tx.stockMovement.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, sourceId: { in: suffixIds },
      sourceType: 'order', type: 'sale' } }),
    tx.stockMovement.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, sourceId: { in: suffixIds },
      OR: [{ sourceType: 'writeoff', type: 'writeoff' }, { sourceType: 'supplier_return', type: 'supplier_return' }] } }),
    tx.purchase.findMany({ where: { cafeId, id: { in: suffix.filter((row) => row.type === 'purchase' && row.receiptValue == null).flatMap((row) => row.sourceId ? [row.sourceId] : []) } },
      select: { id: true, items: { select: { ingredientId: true, quantityBase: true, total: true } } } }),
    tx.warehouseDocumentItem.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, quantity: { not: null },
      document: { kind: 'inventory', postedAt: { gte: scanAt },
        OR: [{ status: { in: ['posted', 'reversed'] } }, { reopenedAt: { not: null } }] } },
      select: { ingredientId: true, quantity: true, reopenedQuantity: true, expected: true,
        document: { select: { id: true, warehouseId: true, postedAt: true, countedAt: true, reopenedAt: true, status: true,
          postedById: true, postedByName: true, note: true } } } }),
    loadHistoricalConversions(tx, cafeId, replayRows),
  ]);
  const pairs = transferPairs(transferOrigins);
  // Legacy immediate counts could post a movement milliseconds before
  // stamping the document. A movement already before this replay range
  // stays in the opening balance and needs no replacement anchor.
  const earlierCountRows = inventories.length ? await tx.stockMovement.findMany({
    where: { cafeId, type: 'inventory', sourceType: 'inventory', ingredientId: { in: ingredientIds },
      sourceId: { in: [...new Set(inventories.map(({ document }) => document.id))] }, createdAt: { lt: scanAt } },
  }) : [];
  const anchorsBeforeLane = new Set([...earlierCountRows, ...suffix.filter((row) => row.type === 'inventory' && row.sourceType === 'inventory'
    && row.createdAt.getTime() < startFor(row))].map(warehouseDocumentKey));
  const inventoryRows = new Map<string, Movement>();
  for (const row of replayRows) {
    if (row.sourceType === 'inventory') {
      const key = warehouseDocumentKey(row);
      if (row.type !== 'inventory' || inventoryRows.has(key)) throw cannotReplay('в периоде есть сторно или неоднозначная проводка инвентаризации');
      inventoryRows.set(key, row);
    }
  }
  const earliestCounts = new Map<string, AppliedCount>();
  const countByMovement = new Map<string, AppliedCount>();
  const placeholders = new Set<string>();
  for (const item of inventories) {
    const { document } = item;
    const lane = inventoryLane(item, byLocation);
    const cutoff = (document.countedAt ?? document.postedAt!).getTime();
    const start = starts.get(lane) ?? Infinity;
    if (document.postedAt!.getTime() < start) continue;
    const anchorKey = JSON.stringify(['inventory', document.id, lane]);
    if (anchorsBeforeLane.has(anchorKey)) continue;
    if (document.status === 'reversed') throw cannotReplay('в периоде есть сторно инвентаризации');
    if (!item.expected) throw cannotReplay('журнал не подтверждает остатки на момент инвентаризации');
    // Recording a correction in the source period can revalue already
    // counted manufactured outputs. Their posted physical quantities stay fixed.
    if (cutoff >= (periodStarts.get(lane) ?? Infinity)) {
      const earliest = earliestCounts.get(lane)?.document;
      if (!earliest || cutoff < (earliest.countedAt ?? earliest.postedAt!).getTime()) earliestCounts.set(lane, item);
    }
    const row = inventoryRows.get(anchorKey) ?? inventoryPlaceholder(cafeId, item, byLocation);
    if (!inventoryRows.has(anchorKey)) {
      if (!item.quantity!.eq(item.expected)) throw cannotReplay('в журнале не найдено расхождение исходной инвентаризации');
      placeholders.add(row.id);
      replayRows.push(row);
    }
    countByMovement.set(row.id, item);
  }
  for (const row of inventoryRows.values()) {
    if (!countByMovement.has(row.id)) throw cannotReplay('в журнале не найден исходный документ инвентаризации');
  }
  if (!inventoryRepost && [...earliestCounts.values()].some(({ document }) => !document.reopenedAt)) {
    throw cannotReplay('после выбранной даты проведена инвентаризация на затронутом складе; откройте ближайшую инвентаризацию на редактирование');
  }
  const replayById = new Map(replayRows.map((row) => [row.id, row]));

  const balances = new Map<string, Balance>();
  const laneRows = new Map<string, Movement[]>();
  const laneLocations = new Map<string, WarehouseLocation | null>();
  const byIngredient = new Map(ingredients.map((item) => [item.id, item]));
  const stagedOrder = new Map(inserted.map((row, index) => [row.id, index]));
  for (const row of replayRows) {
    const key = scopeKey(row);
    const location = row.warehouseId ? byLocation.get(row.warehouseId) : null;
    const ingredient = byIngredient.get(row.ingredientId);
    if (!ingredient || (row.warehouseId && !location) || (location?.isDefault ? 'default' : location?.id ?? 'default') !== row.warehouseKey) {
      throw cannotReplay('не удалось подтвердить склад проводки');
    }
    laneLocations.set(key, location ?? null);
    const movements = laneRows.get(key) ?? [];
    movements.push(row);
    laneRows.set(key, movements);
    if (!balances.has(key)) balances.set(key, await getWarehouseBalance(tx, location ?? null, ingredient));
  }
  const expectedCurrent = new Map(balances);
  for (const row of [...inserted].reverse()) balances.set(scopeKey(row), unpost(balances.get(scopeKey(row))!, row));
  for (const [key, rows] of laneRows) {
    const previous = unwindLane(balances.get(key)!, rows.filter((row) => !stagedOrder.has(row.id) && !placeholders.has(row.id)));
    balances.set(key, previous.balance);
    const oldOrder = new Map(previous.rows.map((row, index) => [row.id, index]));
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      || Number(placeholders.has(a.id)) - Number(placeholders.has(b.id))
      || Number(stagedOrder.has(a.id)) - Number(stagedOrder.has(b.id))
      || (stagedOrder.get(a.id) ?? oldOrder.get(a.id) ?? 0) - (stagedOrder.get(b.id) ?? oldOrder.get(b.id) ?? 0));
  }
  await verifyOpening(tx, cafeId, laneRows, starts, balances);

  const prices = new Map(receipts.map(({ id, items }) => [id, items]));
  const sales = new Map(saleOrigins.map((row) => [saleKey(row, true), row]));
  const origins = new Map([...transferOrigins, ...reversedOrigins].map((row) => [warehouseDocumentKey(row), row]));
  const replayed = new Map<string, Replayed>();
  const revisedCounts = new Map<string, { change: Prisma.Decimal; quantity: Prisma.Decimal; expected: Prisma.Decimal; reset: boolean }>();
  const quantityDifferences = new Map<string, { at: number; change: Prisma.Decimal }[]>();
  const linkedMovement = (row: Movement) => {
    if (row.sourceType === 'transfer' && row.type === 'transfer' && row.change.gt(0)) return transferPair(pairs, row).debit;
    if (row.sourceType === 'order' && (row.type === 'return' || row.type === 'writeoff')) return sales.get(saleKey(row, false));
    if (row.type === 'cancel') return origins.get(warehouseDocumentKey(row));
    return undefined;
  };
  const priceForMovement = (row: Movement) => replayed.get(row.id) ?? row;
  const dependencies = new Map<string, Movement[]>();
  for (const row of replayRows) {
    const conversion = conversions.byMovement.get(row.id);
    if (conversion) {
      dependencies.set(row.id, conversionDependencies(conversion, row));
    } else {
      const original = linkedMovement(row);
      if (original) dependencies.set(row.id, [original]);
      if (isConversionMovement(row)) throw cannotReplay('не удалось подтвердить исходный документ выпуска');
    }
  }
  const derivePricing = (row: Movement, before: Balance, original?: Movement): Pricing => {
    const conversion = conversions.byMovement.get(row.id);
    if (conversion && !isConversionInput(row)) return conversionPricing(conversion, row, priceForMovement);
    const sourcePrice = original && priceForMovement(original);
    if (sourcePrice) {
      const cost = { costAtMoment: sourcePrice.costAtMoment, costKnown: sourcePrice.costKnown };
      return { mode: row.change.isZero() ? 'preserve' : row.change.gt(0) ? 'average' : 'value', price: cost };
    }
    if (usesBookCost(row)) {
      if (!before.avgCost) throw cannotReplay('себестоимость первого расхода не подтверждена');
      return { mode: 'preserve', price: { costAtMoment: before.avgCost,
        costKnown: before.valuationKnown && before.stock.gte(row.change.abs()) } };
    }
    if (row.sourceType === 'purchase' && row.type === 'purchase' && row.change.gt(0)) {
      return { mode: 'average', price: { costAtMoment: row.costAtMoment, costKnown: row.costKnown },
        value: receiptMovementValue(row, prices.get(row.sourceId ?? '')) };
    }
    if (row.sourceType === 'purchase' && row.type === 'correction' && row.change.isZero() && row.valuationAdjustment.isZero()) {
      return { mode: 'preserve', price: { costAtMoment: before.avgCost ?? row.costAtMoment, costKnown: true } };
    }
    if (row.sourceType === 'manual' && row.type === 'correction' && row.sourceId === row.ingredientId
      && row.comment === 'Начальный остаток' && row.change.gte(0)) {
      return { mode: 'average', price: { costAtMoment: row.costAtMoment, costKnown: row.costKnown } };
    }
    throw cannotReplay('в журнале есть корректировка или возврат без подтверждаемого источника расчёта');
  };

  // Each warehouse has its own ordered chain; cross-warehouse transfers and
  // order returns consume the recalculated price of their source movement.
  const cursors = new Map([...laneRows.keys()].map((key) => [key, 0]));
  const pending = new Set(laneRows.keys());
  while (pending.size) {
    const heads = [...pending].map((key) => ({ key, row: laneRows.get(key)![cursors.get(key)!] }));
    const time = Math.min(...heads.map(({ row }) => row.createdAt.getTime()));
    const next = heads.find(({ row }) => {
      if (row.createdAt.getTime() !== time) return false;
      return (dependencies.get(row.id) ?? []).every((source) => !replayById.has(source.id) || replayed.has(source.id));
    });
    if (!next) throw cannotReplay('связанные складские операции не образуют корректный порядок');
    const { key, row } = next;
    const before = balances.get(key)!;
    const count = countByMovement.get(row.id);
    const chronicle = quantityDifferences.get(key) ?? [];
    let result: { balance: Balance; movement: Replayed };
    if (count) {
      if (before.avgCost == null) throw cannotReplay('себестоимость на момент инвентаризации не подтверждена');
      const cutoff = count.document.countedAt?.getTime();
      const expected = cutoff == null ? before.stock : chronicle.reduce((value, entry) =>
        entry.at < cutoff ? value.add(entry.change) : value, count.expected!);
      const quantity = count.document.id === inventoryRepost?.id ? count.reopenedQuantity ?? count.quantity! : count.quantity!;
      const change = quantity.sub(expected);
      if (expected.abs().gt(maxQuantity) || change.abs().gt(maxQuantity)) {
        throw cannotReplay('расхождение инвентаризации вне допустимого диапазона');
      }
      const afterStock = before.stock.add(change);
      const countedWithMovements = cutoff != null && laneRows.get(key)!.some((movement) => movement.id !== row.id
        && movement.createdAt.getTime() >= cutoff && movement.createdAt <= row.createdAt);
      const reset = quantity.isZero() && afterStock.isZero() && (cutoff == null
        || isInventoryReset(row) || ((starts.get(key) ?? Infinity) <= cutoff && !countedWithMovements));
      if (afterStock.lt(0) && settings?.allowNegativeIngredientStock !== true && afterStock.lt(row.afterStock)) {
        throw cannotReplay('результат инвентаризации создаёт отрицательный остаток после последующих операций');
      }
      const { stock, avgCost, valuationKnown, cost, costKnown, valuationAdjustment } = calculateStockValuation(
        { ...before, avgCost: before.avgCost },
        { change, costKnown: before.valuationKnown && (change.gte(0) || before.stock.gte(change.abs())),
          carriedAverage: reset ? zero : undefined },
      );
      result = { balance: { stock, avgCost, valuationKnown },
        movement: { beforeStock: before.stock, afterStock: stock, costAtMoment: cost, costKnown,
          valuationAdjustment, beforeValuationKnown: before.valuationKnown, valuationKnown } };
      revisedCounts.set(row.id, { change, quantity, expected, reset });
      const delta = change.sub(row.change);
      if (!delta.isZero()) {
        chronicle.push({ at: row.createdAt.getTime(), change: delta });
        quantityDifferences.set(key, chronicle);
      }
    } else {
      const afterStock = before.stock.add(row.change);
      const recordedShortage = !stagedOrder.has(row.id) && row.afterStock.lt(0) && afterStock.gte(row.afterStock);
      const canStayNegative = settings?.allowNegativeIngredientStock === true || recordedShortage
        || (row.sourceType === 'transfer' && row.type === 'transfer') || (row.sourceType === 'order' && row.type !== 'sale');
      if (row.change.lt(0) && afterStock.lt(0) && (!canStayNegative || conversionStrictStock(row))) {
        throw cannotReplay(isConversionMovement(row) ? 'в историческом периоде недостаточно товара для производства, переработки или их сторно'
          : 'в историческом периоде недостаточно запаса для списания или перемещения');
      }
      const sources = dependencies.get(row.id) ?? [];
      if (sources.some((source) => source.createdAt > row.createdAt)) throw cannotReplay('связанная операция стоит раньше исходного движения');
      result = historicalPurchaseCorrection(row) ? replayPurchaseCorrection(before, row)
        : replayStep(before, row, derivePricing(row, before, sources[0]));
      if (stagedOrder.has(row.id) && !row.change.isZero()) {
        chronicle.push({ at: row.createdAt.getTime(), change: row.change });
        quantityDifferences.set(key, chronicle);
      }
    }
    replayed.set(row.id, result.movement);
    balances.set(key, result.balance);
    const index = cursors.get(key)! + 1;
    cursors.set(key, index);
    if (index === laneRows.get(key)!.length) pending.delete(key);
  }

  await persistHistoricalConversions(tx, cafeId, conversions.groups, replayed);

  for (const [id, movement] of replayed) {
    const row = replayById.get(id)!;
    const count = revisedCounts.get(id);
    if (count) {
      const repost = inventoryRepost?.id === row.sourceId;
      const data = { ...movement, change: count.change,
        ...(repost ? { actorId: inventoryRepost.actorId, actorName: inventoryRepost.actorName, comment: inventoryRepost.note } : {}),
        recipeSnapshot: count.reset ? inventoryResetSnapshot : Prisma.DbNull };
      if (placeholders.has(id)) {
        // Zero-variance counts still anchor the replay. Persist their movement only if it changes the ledger.
        if (!count.change.isZero() || count.reset) {
          const { recipeSnapshot: _snapshot, ...base } = row;
          await tx.stockMovement.create({ data: { ...base, ...data, recordedAt: inventoryRepost?.recordedAt ?? new Date() } });
        }
      } else {
        await tx.stockMovement.update({ where: { id, cafeId }, data });
      }
      await tx.warehouseDocumentItem.update({
        where: { cafeId, documentId_ingredientId: { documentId: row.sourceId!, ingredientId: row.ingredientId } },
        data: { quantity: count.quantity, ...(repost ? { reopenedQuantity: null } : {}), expected: count.expected,
          difference: count.change, unitCost: movement.costAtMoment, costKnown: movement.costKnown },
      });
      continue;
    }
    await tx.stockMovement.update({ where: { id, cafeId }, data: movement });
    if (row.sourceId && row.change.lt(0) && (row.type === 'writeoff' || row.type === 'transfer' || row.type === 'supplier_return') && row.sourceType === row.type) {
      const updated = await tx.warehouseDocumentItem.updateMany({
        where: { cafeId, documentId: row.sourceId, ingredientId: row.ingredientId },
        data: { expected: movement.beforeStock, unitCost: movement.costAtMoment, costKnown: movement.costKnown },
      });
      if (updated.count !== 1) throw cannotReplay('не удалось подтвердить исходный складской документ');
    }
  }
  for (const [key, balance] of balances) {
    const ingredientId = laneRows.get(key)![0].ingredientId;
    if (!balance.avgCost) throw cannotReplay('итоговая оценка остатка не подтверждена');
    const difference = (quantityDifferences.get(key) ?? []).reduce((total, entry) => total.add(entry.change), zero);
    const pendingQuantity = inserted.filter((row) => scopeKey(row) === key).reduce((total, row) => total.add(row.change), zero);
    if (!balance.stock.eq(expectedCurrent.get(key)!.stock.add(difference).sub(pendingQuantity))) {
      throw cannotReplay('не совпадает итоговое количество');
    }
    await setWarehouseBalance(tx, laneLocations.get(key) ?? null, ingredientId, { ...balance, avgCost: balance.avgCost });
  }
  return replayed;
}
