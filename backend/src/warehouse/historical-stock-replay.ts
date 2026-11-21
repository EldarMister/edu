import { ConflictException } from '@nestjs/common';
import { Prisma, type StockMovement } from '@prisma/client';
import { calculateStockValuation } from './stock-posting';
import { calculatePurchaseCorrection, historicalPurchaseCorrection, historicalPurchaseValue } from './purchase-correction';
import { getWarehouseBalance, setWarehouseBalance, type WarehouseLocation } from './warehouse-location';

type Movement = StockMovement;
type Balance = { stock: Prisma.Decimal; avgCost: Prisma.Decimal | null; valuationKnown: boolean };
type Price = { costAtMoment: Prisma.Decimal; costKnown: boolean };
type Replayed = Price & { beforeStock: Prisma.Decimal; afterStock: Prisma.Decimal;
  valuationAdjustment: Prisma.Decimal; beforeValuationKnown: boolean; valuationKnown: boolean };
type ReceiptLine = { ingredientId: string; quantityBase: Prisma.Decimal; total: Prisma.Decimal };

const zero = new Prisma.Decimal(0);
const rounding = new Prisma.Decimal('0.000000005');
const movementLimit = 20_000;
const scopeKey = (row: Movement) => JSON.stringify([row.ingredientId, row.warehouseKey]);
const documentKey = (row: Movement) => JSON.stringify([row.sourceType, row.sourceId, row.ingredientId]);
const warehouseDocumentKey = (row: Movement) => JSON.stringify([row.sourceType, row.sourceId, scopeKey(row)]);
const saleKey = (row: Movement, sale: boolean) => JSON.stringify([
  row.sourceId, sale ? row.orderItemId : row.saleLineId ?? row.orderItemId, scopeKey(row), row.saleCycle,
]);
const actualTime = (row: Movement) => (row.recordedAt ?? row.createdAt).getTime();

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
    (row.sourceType === 'supplier_return' && row.type === 'supplier_return')
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
    const carriedCost = usesBookCost(movement) ? costAtMoment : change.isZero() ? after.avgCost : null;
    return { stock: beforeStock, avgCost: carriedCost, valuationKnown: beforeValuationKnown };
  }
  // The journal stores eight decimal places. Recover an exact representable
  // average, or rely on a movement that explicitly records that prior price.
  const hint = usesBookCost(movement) ? costAtMoment : null;
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

function chartLanes(inserted: Movement[], rows: Movement[], pairs: Map<string, Movement[]>) {
  const starts = new Map<string, number>(inserted.map((row) => [scopeKey(row), row.createdAt.getTime()]));
  // A new source cost changes the corresponding destination and any further
  // transfers. An unrelated warehouse holding the same SKU is independent.
  const outbound = rows.filter((row) => row.sourceType === 'transfer' && row.type === 'transfer' && row.change.lt(0));
  outbound.sort(compareChronology);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const row of outbound) {
      if ((starts.get(scopeKey(row)) ?? Infinity) > row.createdAt.getTime()) continue;
      const { credit } = transferPair(pairs, row);
      if ((starts.get(scopeKey(credit)) ?? Infinity) <= credit.createdAt.getTime()) continue;
      starts.set(scopeKey(credit), credit.createdAt.getTime());
      expanded = true;
    }
  }
  return starts;
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

type ReplayInput = { cafeId: string; effectiveAt: Date; insertedMovementIds: string[] };

/** Caller holds the same sorted ingredient locks as normal postings. All
 * provisional writes and this replay must be part of the same transaction. */
export async function replayHistoricalStock(tx: Prisma.TransactionClient, input: ReplayInput) {
  const { cafeId, effectiveAt, insertedMovementIds } = input;
  if (!insertedMovementIds.length) return new Map<string, Replayed>();
  const insertedRecords: Movement[] = await tx.stockMovement.findMany({ where: { cafeId, id: { in: insertedMovementIds } } });
  const insertedById = new Map(insertedRecords.map((row) => [row.id, row]));
  if (insertedById.size !== insertedMovementIds.length || insertedRecords.some((row) => row.createdAt.getTime() !== effectiveAt.getTime())) {
    throw cannotReplay('новые проводки не соответствуют дате документа');
  }
  const inserted = insertedMovementIds.map((id) => insertedById.get(id)!);
  const ingredientIds = [...new Set(inserted.map((row) => row.ingredientId))];
  const [suffix, ingredients, locations, settings] = await Promise.all([
    tx.stockMovement.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, createdAt: { gte: effectiveAt } }, take: movementLimit + 1 }),
    tx.ingredient.findMany({ where: { cafeId, id: { in: ingredientIds } } }),
    tx.warehouse.findMany({ where: { cafeId }, select: { id: true, cafeId: true, name: true, isDefault: true } }),
    tx.settings.findFirst({ where: { cafeId }, select: { allowNegativeIngredientStock: true } }),
  ]);
  if (suffix.length > movementLimit) throw cannotReplay('слишком много движений; выберите более позднюю дату');

  const suffixIds = [...new Set(suffix.flatMap((row) => row.sourceId ? [row.sourceId] : []))];
  const [transferOrigins, saleOrigins, reversedOrigins, receipts, inventories] = await Promise.all([
    tx.stockMovement.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, sourceId: { in: suffixIds },
      sourceType: 'transfer', type: 'transfer' } }),
    tx.stockMovement.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, sourceId: { in: suffixIds },
      sourceType: 'order', type: 'sale' } }),
    tx.stockMovement.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, sourceId: { in: suffixIds },
      OR: [{ sourceType: 'writeoff', type: 'writeoff' }, { sourceType: 'supplier_return', type: 'supplier_return' }] } }),
    tx.purchase.findMany({ where: { cafeId, id: { in: suffix.filter((row) => row.type === 'purchase' && row.receiptValue == null).flatMap((row) => row.sourceId ? [row.sourceId] : []) } },
      select: { id: true, items: { select: { ingredientId: true, quantityBase: true, total: true } } } }),
    tx.warehouseDocumentItem.findMany({ where: { cafeId, ingredientId: { in: ingredientIds }, quantity: { not: null },
      document: { kind: 'inventory', status: { in: ['posted', 'reversed'] }, postedAt: { gte: effectiveAt } } },
      select: { ingredientId: true, document: { select: { warehouseId: true, postedAt: true } } } }),
  ]);
  const pairs = transferPairs(transferOrigins);
  const starts = chartLanes(inserted, suffix, pairs);
  const byLocation = new Map(locations.map((location) => [location.id, location]));
  const startFor = (row: Movement) => starts.get(scopeKey(row)) ?? Infinity;
  const replayRows: Movement[] = suffix.filter((row) => row.createdAt.getTime() >= startFor(row));
  const replayById = new Map(replayRows.map((row) => [row.id, row]));
  for (const item of inventories) {
    const warehouse = byLocation.get(item.document.warehouseId);
    const key = JSON.stringify([item.ingredientId, warehouse?.isDefault ? 'default' : item.document.warehouseId]);
    if ((item.document.postedAt?.getTime() ?? -Infinity) >= (starts.get(key) ?? Infinity)) {
      throw cannotReplay('после выбранной даты проведена инвентаризация на затронутом складе');
    }
  }
  for (const row of replayRows) {
    if (row.sourceType === 'inventory') throw cannotReplay('после выбранной даты проведена инвентаризация');
    if (row.sourceType === 'production' || row.sourceType === 'processing') {
      throw cannotReplay('после выбранной даты были производство или переработка; их распределение стоимости требует отдельной проверки');
    }
  }

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
    const previous = unwindLane(balances.get(key)!, rows.filter((row) => !stagedOrder.has(row.id)));
    balances.set(key, previous.balance);
    const oldOrder = new Map(previous.rows.map((row, index) => [row.id, index]));
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      || Number(stagedOrder.has(a.id)) - Number(stagedOrder.has(b.id))
      || (stagedOrder.get(a.id) ?? oldOrder.get(a.id)!) - (stagedOrder.get(b.id) ?? oldOrder.get(b.id)!));
  }
  await verifyOpening(tx, cafeId, laneRows, starts, balances);

  const prices = new Map(receipts.map(({ id, items }) => [id, items]));
  const sales = new Map(saleOrigins.map((row) => [saleKey(row, true), row]));
  const origins = new Map([...transferOrigins, ...reversedOrigins].map((row) => [warehouseDocumentKey(row), row]));
  const replayed = new Map<string, Replayed>();
  const dependency = (row: Movement) => {
    if (row.sourceType === 'transfer' && row.type === 'transfer' && row.change.gt(0)) return transferPair(pairs, row).debit;
    if (row.sourceType === 'order' && (row.type === 'return' || row.type === 'writeoff')) return sales.get(saleKey(row, false));
    if (row.type === 'cancel') return origins.get(warehouseDocumentKey(row));
    return undefined;
  };
  const derivePricing = (row: Movement, before: Balance, original?: Movement): Pricing => {
    const sourcePrice = original && (replayed.get(original.id) ?? original);
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
      const source = dependency(row);
      return !source || !replayById.has(source.id) || replayed.has(source.id);
    });
    if (!next) throw cannotReplay('связанные складские операции не образуют корректный порядок');
    const { key, row } = next;
    const before = balances.get(key)!;
    const afterStock = before.stock.add(row.change);
    const recordedShortage = !stagedOrder.has(row.id) && row.afterStock.lt(0) && afterStock.gte(row.afterStock);
    const canStayNegative = settings?.allowNegativeIngredientStock === true || recordedShortage
      || (row.sourceType === 'transfer' && row.type === 'transfer') || (row.sourceType === 'order' && row.type !== 'sale');
    if (!canStayNegative && row.change.lt(0) && afterStock.lt(0)) {
      throw cannotReplay('в историческом периоде недостаточно запаса для списания или перемещения');
    }
    const original = dependency(row);
    if (original && original.createdAt > row.createdAt) throw cannotReplay('возврат или перемещение стоит раньше исходного движения');
    const result = historicalPurchaseCorrection(row) ? replayPurchaseCorrection(before, row)
      : replayStep(before, row, derivePricing(row, before, original));
    replayed.set(row.id, result.movement);
    balances.set(key, result.balance);
    const index = cursors.get(key)! + 1;
    cursors.set(key, index);
    if (index === laneRows.get(key)!.length) pending.delete(key);
  }

  for (const [id, movement] of replayed) {
    const row = replayById.get(id)!;
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
    if (!balance.stock.eq(expectedCurrent.get(key)!.stock)) throw cannotReplay('не совпадает итоговое количество');
    await setWarehouseBalance(tx, laneLocations.get(key) ?? null, ingredientId, { ...balance, avgCost: balance.avgCost });
  }
  return replayed;
}
