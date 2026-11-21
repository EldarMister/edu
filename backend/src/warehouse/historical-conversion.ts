import { ConflictException } from '@nestjs/common';
import { Prisma, type PreparationBatch, type ProcessingLine, type StockMovement } from '@prisma/client';

type ConversionType = 'production' | 'processing';
type Price = { costAtMoment: Prisma.Decimal; costKnown: boolean };
type PriceFor = (row: StockMovement) => Price;
type PricedLine = Price & { value: Prisma.Decimal };
type ConversionValuation = { total: Prisma.Decimal; known: boolean; lines: Map<string, PricedLine> };
type ProcessingDocument = Prisma.ProcessingDocumentGetPayload<{ include: { lines: true } }>;
type GroupBase = {
  id: string;
  inputs: StockMovement[];
  outputs: StockMovement[];
  reversals: Map<string, StockMovement>;
  restoreAfter: StockMovement[];
  valuation?: ConversionValuation;
};
type ProductionGroup = GroupBase & {
  sourceType: 'production';
  batch: PreparationBatch;
  items: Prisma.JsonObject;
  actual: Prisma.JsonObject[];
  legacy: boolean;
};
type ProcessingGroup = GroupBase & {
  sourceType: 'processing';
  document: ProcessingDocument;
  lines: Map<string, ProcessingLine>;
};
export type HistoricalConversion = ProductionGroup | ProcessingGroup;

const zero = new Prisma.Decimal(0);
const key = (kind: ConversionType, id: string) => kind + ':' + id;
const operationTime = (row: StockMovement) => (row.recordedAt ?? row.createdAt).getTime();

function incomplete() {
  return new ConflictException('В журнале не найден полный состав производства, переработки или их сторно');
}

function jsonObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function matchesDecimal(value: Prisma.JsonValue | undefined, decimal: Prisma.Decimal) {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  try { return decimal.eq(value); } catch { return false; }
}

export function isConversionMovement(row: StockMovement): row is StockMovement & { sourceType: ConversionType } {
  return row.sourceType === 'production' || row.sourceType === 'processing';
}

/** Production never consumes missing raw material, and undo cannot remove missing output. */
export function conversionStrictStock(row: StockMovement) {
  return isConversionMovement(row) && row.change.lt(0) && (row.sourceType === 'production' || row.type === 'cancel');
}

function buildGroup(
  group: Omit<GroupBase, 'reversals' | 'restoreAfter'>,
  cancelRows: StockMovement[],
  sourceType: ConversionType,
  reversedAt: Date | null,
): GroupBase {
  const { inputs, outputs } = group;
  if (!inputs.length || !outputs.length || cancelRows.length !== (reversedAt ? inputs.length + outputs.length : 0)) throw incomplete();
  const originals = new Map([...inputs, ...outputs].map((row) => [row.id, row]));
  const reversals = new Map<string, StockMovement>();
  const matched = new Set<string>();
  const restoreAfter: StockMovement[] = [];
  for (const row of cancelRows) {
    const snapshot = jsonObject(row.recipeSnapshot);
    const originalId = sourceType === 'production' ? snapshot?.originalMovementId : snapshot?.reversedMovementId;
    const original = typeof originalId === 'string' ? originals.get(originalId) : undefined;
    if (!original || matched.has(original.id) || row.ingredientId !== original.ingredientId
      || row.warehouseKey !== original.warehouseKey || !row.change.eq(original.change.negated())
      || operationTime(row) < operationTime(original)) throw incomplete();
    matched.add(original.id);
    reversals.set(row.id, original);
    if (row.change.lt(0)) restoreAfter.push(row);
  }
  return { ...group, reversals, restoreAfter };
}

function buildProduction(batch: PreparationBatch, rows: StockMovement[], defaultWarehouseId?: string): ProductionGroup {
  const items = jsonObject(batch.items);
  if (!items || !Array.isArray(items.actual)) throw incomplete();
  const actual = items.actual.map(jsonObject);
  const legacy = items.legacy === true;
  const originals = rows.filter((row) => row.type !== 'cancel');
  const inputs = originals.filter((row) => row.change.lt(0));
  const outputs = originals.filter((row) => row.change.gt(0));
  if (outputs.length !== 1 || outputs[0].ingredientId !== batch.ingredientId || !outputs[0].change.eq(batch.actualQuantity)
    || inputs.length + 1 !== originals.length || actual.length !== inputs.length
    || inputs.some((row) => row.ingredientId === batch.ingredientId)
    || originals.some((row) => row.type !== (legacy ? 'correction' : 'production')
      || (row.warehouseId ?? defaultWarehouseId) !== batch.warehouseId
      || (legacy && jsonObject(row.recipeSnapshot)?.legacyProduction !== true))) throw incomplete();
  const byIngredient = new Map(inputs.map((row) => [row.ingredientId, row]));
  const recordedIngredients = new Set<string>();
  const recorded = actual.map((entry) => {
    const ingredientId = entry?.ingredientId;
    const row = typeof ingredientId === 'string' ? byIngredient.get(ingredientId) : undefined;
    if (!entry || !row || recordedIngredients.has(row.ingredientId) || !matchesDecimal(entry.amount, row.change.abs())) throw incomplete();
    recordedIngredients.add(row.ingredientId);
    return entry;
  });
  const group = buildGroup({ id: batch.id, inputs, outputs }, rows.filter((row) => row.type === 'cancel'), 'production', batch.reversedAt);
  return { ...group, sourceType: 'production', batch, items, actual: recorded, legacy };
}

function buildProcessing(document: ProcessingDocument, rows: StockMovement[]): ProcessingGroup {
  const { lines } = document;
  const originals = rows.filter((row) => row.type !== 'cancel');
  if (!['posted', 'reversed'].includes(document.status) || (document.status === 'reversed') !== !!document.reversedAt
    || originals.length !== lines.length || new Set(lines.map((line) => line.sortOrder)).size !== lines.length) throw incomplete();
  const rowsForLine = new Map<string, StockMovement>();
  for (const row of originals) {
    const lineId = jsonObject(row.recipeSnapshot)?.processingLineId;
    if (typeof lineId !== 'string' || rowsForLine.has(lineId)) throw incomplete();
    rowsForLine.set(lineId, row);
  }
  const inputs: StockMovement[] = [], outputs: StockMovement[] = [];
  const movementLines = new Map<string, ProcessingLine>();
  for (const line of lines) {
    const row = rowsForLine.get(line.id);
    const snapshot = row && jsonObject(row.recipeSnapshot);
    const input = line.direction === 'input';
    if (!row || row.type !== 'processing' || row.ingredientId !== line.ingredientId || row.warehouseId !== line.warehouseId
      || (!input && line.direction !== 'output') || snapshot?.direction !== line.direction || !line.quantity.gt(0)
      || !row.change.eq(input ? line.quantity.negated() : line.quantity)
      || (!input && (!matchesDecimal(snapshot.costSharePercent, line.costSharePercent)
        || line.costSharePercent.lt(0) || line.costSharePercent.gt(100)))) throw incomplete();
    (input ? inputs : outputs).push(row);
    movementLines.set(row.id, line);
  }
  const share = outputs.reduce((sum, row) => sum.add(movementLines.get(row.id)!.costSharePercent), zero);
  if (!share.eq(100)) throw incomplete();
  const group = buildGroup({ id: document.id, inputs, outputs }, rows.filter((row) => row.type === 'cancel'), 'processing', document.reversedAt);
  return { ...group, sourceType: 'processing', document, lines: movementLines };
}

export async function loadHistoricalConversions(tx: Prisma.TransactionClient, cafeId: string, replayRows: StockMovement[]) {
  const ids = { production: new Set<string>(), processing: new Set<string>() };
  for (const row of replayRows) {
    if (!isConversionMovement(row)) continue;
    if (!row.sourceId) throw incomplete();
    ids[row.sourceType].add(row.sourceId);
  }
  const groups: HistoricalConversion[] = [];
  const byMovement = new Map<string, HistoricalConversion>();
  if (!ids.production.size && !ids.processing.size) return { groups, byMovement };
  const production = [...ids.production], processing = [...ids.processing];
  const [batches, documents, rows] = await Promise.all([
    production.length ? tx.preparationBatch.findMany({ where: { cafeId, id: { in: production } } }) : [],
    processing.length ? tx.processingDocument.findMany({ where: { cafeId, id: { in: processing } },
      include: { lines: { orderBy: { sortOrder: 'asc' } } } }) : [],
    tx.stockMovement.findMany({ where: { cafeId, OR: [
      { sourceType: 'production', sourceId: { in: production } },
      { sourceType: 'processing', sourceId: { in: processing } },
    ] } }),
  ]);
  if (batches.length !== production.length || documents.length !== processing.length) throw incomplete();
  const byGroup = new Map<string, StockMovement[]>();
  for (const row of rows) {
    if (!isConversionMovement(row) || !row.sourceId) throw incomplete();
    const groupKey = key(row.sourceType, row.sourceId);
    const members = byGroup.get(groupKey) ?? [];
    members.push(row);
    byGroup.set(groupKey, members);
  }
  const defaultWarehouse = rows.some((row) => row.sourceType === 'production' && row.warehouseId === null)
    ? await tx.warehouse.findFirst({ where: { cafeId, isDefault: true }, select: { id: true } }) : null;
  for (const batch of batches) {
    groups.push(buildProduction(batch, byGroup.get(key('production', batch.id)) ?? [], defaultWarehouse?.id));
  }
  for (const document of documents) groups.push(buildProcessing(document, byGroup.get(key('processing', document.id)) ?? []));
  for (const group of groups) {
    for (const row of [...group.inputs, ...group.outputs]) byMovement.set(row.id, group);
    for (const id of group.reversals.keys()) byMovement.set(id, group);
  }
  if (replayRows.some((row) => isConversionMovement(row) && !byMovement.has(row.id))) throw incomplete();
  return { groups, byMovement };
}

/** Conversion outputs depend on all inputs, and reversals remove every output before restoring input. */
export function conversionDependencies(group: HistoricalConversion, row: StockMovement): StockMovement[] {
  if (row.type === 'cancel') {
    const original = group.reversals.get(row.id);
    if (!original) throw incomplete();
    return row.change.gt(0) ? [original, ...group.restoreAfter] : [original];
  }
  return row.change.gt(0) ? group.inputs : [];
}

function calculateConversion(group: HistoricalConversion, priceFor: PriceFor): ConversionValuation {
  const lines = new Map<string, PricedLine>();
  let total = zero;
  let known = true;
  for (const row of group.inputs) {
    const price = priceFor(row);
    const quantityValue = row.change.abs().mul(price.costAtMoment);
    const value = group.sourceType === 'processing' ? quantityValue.toDecimalPlaces(8) : quantityValue;
    total = total.add(value);
    known = known && price.costKnown;
    lines.set(row.id, { ...price, value });
  }
  if (group.sourceType === 'production') {
    const [row] = group.outputs;
    lines.set(row.id, { costAtMoment: total.div(row.change).toDecimalPlaces(8), costKnown: known, value: total });
  } else {
    // Round the cumulative allocation, as at the original posting, so the
    // output values still add up exactly to the cost of the input.
    let share = zero, allocated = zero;
    for (const row of group.outputs) {
      share = share.add(group.lines.get(row.id)!.costSharePercent);
      const cumulative = total.mul(share).div(100).toDecimalPlaces(8);
      const value = cumulative.sub(allocated);
      allocated = cumulative;
      lines.set(row.id, { costAtMoment: value.div(row.change).toDecimalPlaces(8), costKnown: known, value });
    }
  }
  return { total, known, lines };
}

export function conversionPricing(group: HistoricalConversion, row: StockMovement, priceFor: PriceFor): {
  mode: 'average' | 'value';
  price: Price;
  value?: Prisma.Decimal;
} {
  if (row.type === 'cancel') {
    const original = group.reversals.get(row.id);
    if (!original) throw incomplete();
    const price = priceFor(original);
    return { mode: group.sourceType === 'processing' && row.change.gt(0) ? 'average' : 'value', price };
  }
  // The replay scheduler has resolved every input before valuing the first output.
  const valuation = group.valuation ??= calculateConversion(group, priceFor);
  const price = valuation.lines.get(row.id);
  if (!price || !row.change.gt(0)) throw incomplete();
  return { mode: 'average', price, value: group.sourceType === 'processing' || group.legacy ? price.value : undefined };
}

async function lockProcessingForValuation(tx: Prisma.TransactionClient, cafeId: string, id: string) {
  // Processing reversal locks its document before locking ingredients. Replay
  // already holds ingredient locks, so wait for a retry instead of deadlocking.
  try {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM processing_documents
      WHERE id = ${id} AND cafe_id = ${cafeId} FOR UPDATE NOWAIT`;
    if (!locked.length) throw incomplete();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010' && error.meta?.code === '55P03') {
      throw new ConflictException('Переработку сейчас изменяет другой сотрудник. Повторите проведение инвентаризации');
    }
    throw error;
  }
}

export async function persistHistoricalConversions(
  tx: Prisma.TransactionClient, cafeId: string, groups: HistoricalConversion[], replayed: Map<string, Price>,
) {
  for (const group of groups) {
    const originals = [...group.inputs, ...group.outputs];
    if (!originals.some((row) => replayed.has(row.id))) continue;
    const { total, known, lines } = group.valuation ?? calculateConversion(group, (row) => replayed.get(row.id) ?? row);
    if (group.sourceType === 'production') {
      const byIngredient = new Map(group.inputs.map((row) => [row.ingredientId, lines.get(row.id)!]));
      const actual = group.actual.map((entry) => {
        const value = byIngredient.get(String(entry.ingredientId))!;
        return { ...entry, cost: value.value.toString(), costAtMoment: value.costAtMoment.toString(), costKnown: value.costKnown };
      });
      await tx.preparationBatch.update({ where: { id: group.id, cafeId }, data: {
        totalCost: total.toDecimalPlaces(2), costKnown: known, items: { ...group.items, actual },
      } });
      continue;
    }
    const updates = [...group.lines].flatMap(([id, line]) => {
      const { costAtMoment, costKnown, value } = lines.get(id)!;
      const costSharePercent = line.direction === 'input'
        ? total.gt(0) ? value.mul(100).div(total).toDecimalPlaces(4) : zero
        : line.costSharePercent;
      if (line.unitCost.eq(costAtMoment) && line.lineCost.eq(value) && line.costKnown === costKnown
        && line.costSharePercent.eq(costSharePercent)) return [];
      return [{ line, costAtMoment, costKnown, value, costSharePercent }];
    });
    if (!updates.length && group.document.totalCost.eq(total) && group.document.hasUnknownCost === !known) continue;
    await lockProcessingForValuation(tx, cafeId, group.id);
    for (const { line, costAtMoment, costKnown, value, costSharePercent } of updates) {
      await tx.processingLine.update({ where: { id: line.id, cafeId }, data: {
        unitCost: costAtMoment, lineCost: value, costKnown, costSharePercent,
      } });
    }
    await tx.processingDocument.update({ where: { id: group.id, cafeId }, data: {
      totalCost: total, hasUnknownCost: !known, revision: { increment: 1 },
    } });
  }
}
