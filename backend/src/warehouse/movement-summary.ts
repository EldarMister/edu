import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { warehouseDateRange } from './report-range';
import { reportIngredientFilters } from './report-ingredient-filters';
import { WarehouseReportQuery } from './reports.dto';
import { warehouseBalances } from './warehouse-location';
import { reportWarehouses } from './report-warehouses';
import { internalTransferLegs } from './report-transfer-flow';
import { adjustsPurchaseReceipt } from './purchase-correction';
import { normalizeUnit, unitDef, unitLabel } from './units';

const zero = new Prisma.Decimal(0);
type Evidence = { createdAt: Date; change: Prisma.Decimal; costAtMoment: Prisma.Decimal; valuationAdjustment: Prisma.Decimal;
  beforeValuationKnown?: boolean; excludeFromFlow?: boolean; adjustsReceipt?: boolean };

/** Rewind the current book balance using immutable value deltas. The carry-in
 * survives imports with no opening movement; later purchases cannot reprice it. */
export function summarizeMovements(current: { stock: Prisma.Decimal; stockValue: Prisma.Decimal; valuationKnown?: boolean }, movements: Evidence[], from?: Date, to?: Date) {
  let openingQuantity = current.stock;
  let openingValue = current.stockValue;
  let closingQuantity = current.stock;
  let closingValue = current.stockValue;
  let incomingQuantity = zero;
  let outgoingQuantity = zero;
  let valuationAdjustment = zero;
  let movementCount = 0;
  for (const movement of movements) {
    const value = movement.change.mul(movement.costAtMoment).add(movement.valuationAdjustment);
    if (!from || movement.createdAt >= from) {
      openingQuantity = openingQuantity.sub(movement.change);
      openingValue = openingValue.sub(value);
    }
    if (to && movement.createdAt > to) {
      closingQuantity = closingQuantity.sub(movement.change);
      closingValue = closingValue.sub(value);
    }
    if ((!from || movement.createdAt >= from) && (!to || movement.createdAt <= to)) {
      valuationAdjustment = valuationAdjustment.add(movement.valuationAdjustment);
      if (!movement.excludeFromFlow && !movement.change.isZero()) {
        if (movement.adjustsReceipt || movement.change.gt(0)) incomingQuantity = incomingQuantity.add(movement.change);
        else outgoingQuantity = outgoingQuantity.sub(movement.change);
        movementCount += 1;
      }
    }
  }
  const knowledgeBefore = (boundary?: Date) => {
    const future = movements.filter((movement) => !boundary || movement.createdAt >= boundary);
    if (!future.length) return current.valuationKnown === true;
    const firstTime = future.reduce((earliest, movement) => Math.min(earliest, movement.createdAt.getTime()), Infinity);
    // Multiple writes can share the same database timestamp. Never claim known
    // valuation when any of the tied boundary snapshots was unconfirmed.
    return future.filter((movement) => movement.createdAt.getTime() === firstTime).every((movement) => movement.beforeValuationKnown === true);
  };
  return { openingQuantity, openingValue, closingQuantity, closingValue, incomingQuantity, outgoingQuantity, valuationAdjustment, movementCount,
    openingKnown: openingQuantity.isZero() || knowledgeBefore(from),
    closingKnown: closingQuantity.isZero() || (to ? knowledgeBefore(new Date(to.getTime() + 1)) : current.valuationKnown === true) };
}

function emptySummary() {
  return {
    openingQuantity: zero, openingValue: zero, closingQuantity: zero, closingValue: zero,
    incomingQuantity: zero, outgoingQuantity: zero, valuationAdjustment: zero,
    movementCount: 0, openingKnown: true, closingKnown: true,
  };
}

function hasNoBalance(summary: ReturnType<typeof emptySummary>) {
  return summary.openingQuantity.isZero() && summary.closingQuantity.isZero()
    && summary.openingValue.isZero() && summary.closingValue.isZero()
    && summary.openingKnown && summary.closingKnown;
}

function reportNameFilter({ search, nameCondition, nameValue }: WarehouseReportQuery) {
  const searchText = search?.trim().toLowerCase();
  const value = nameValue?.trim().toLowerCase();
  // Apply the same Unicode case folding regardless of the database collation.
  return (ingredient: { name: string }) => {
    const name = ingredient.name.trim().toLowerCase();
    if (searchText && !name.includes(searchText)) return false;
    switch (nameCondition) {
      case 'empty': return name === '';
      case 'notEmpty': return name !== '';
      case 'equals': return !value || name === value;
      case 'notEquals': return !value || name !== value;
      case 'contains': return !value || name.includes(value);
      default: return true;
    }
  };
}

export async function movementSummary(db: Prisma.TransactionClient, query: WarehouseReportQuery) {
  // Historical stock balances apply to a warehouse, not an employee or transaction category.
  if (query.employeeId || query.type) throw new BadRequestException('Фильтр сотрудника или операции доступен в деталях движения');
  const range = warehouseDateRange(query.from, query.to);
  const scope = await reportWarehouses(db, query);
  const { cafeId } = scope;
  const ingredients = (await db.ingredient.findMany({ where: {
    cafeId,
    ...(query.ingredientId ? { id: query.ingredientId } : {}),
    ...reportIngredientFilters(query),
  }, select: {
    id: true, name: true, kind: true, category: true, displayUnit: true,
    stock: true, avgCost: true, valuationKnown: true, preparationMode: true, isActive: true,
  } })).filter(reportNameFilter(query));
  const movements = ingredients.length ? await db.stockMovement.findMany({ where: {
    cafeId, ...scope.filter, ingredientId: { in: ingredients.map(({ id }) => id) },
    ...(range?.gte ? { createdAt: { gte: range.gte } } : {}),
  }, select: {
    id: true, ingredientId: true, warehouseId: true, createdAt: true, change: true, costAtMoment: true,
    valuationAdjustment: true, beforeValuationKnown: true, sourceId: true, sourceType: true, type: true,
    reason: true,
  } }) : [];
  const preparations = new Set(ingredients.filter(({ kind }) => kind === 'preparation' || kind === 'prepared_dish').map(({ id }) => id));
  const stockedPreparations = new Set<string>();
  const internalLegs = internalTransferLegs(movements
    .filter((movement) => movement.sourceType === 'transfer' && (!range?.lte || movement.createdAt <= range.lte))
    .map((movement) => ({ ...movement, warehouseId: movement.warehouseId ?? scope.defaultWarehouse?.id ?? null, quantity: movement.change })));
  const byBalance = new Map<string, Evidence[]>();
  const balanceKey = (warehouseId: string | null, ingredientId: string) => JSON.stringify([warehouseId, ingredientId]);
  for (const movement of movements) {
    if (preparations.has(movement.ingredientId) && !movement.change.isZero() && (!range?.lte || movement.createdAt <= range.lte)) {
      stockedPreparations.add(movement.ingredientId);
    }
    const key = balanceKey(movement.warehouseId ?? scope.defaultWarehouse?.id ?? null, movement.ingredientId);
    const list = byBalance.get(key) ?? [];
    list.push({ ...movement, excludeFromFlow: internalLegs.has(movement.id), adjustsReceipt: adjustsPurchaseReceipt(movement) });
    byBalance.set(key, list);
  }

  // Rewind each location separately: an unknown opening price in one location
  // must not be hidden by a known price in another.
  const summaries = new Map(ingredients.map(({ id }) => [id, emptySummary()]));
  const locations = scope.includesDefault && !scope.defaultWarehouse ? [null, ...scope.selected] : scope.selected;
  for (const location of locations) {
    const balances = location ? await warehouseBalances(db, location, ingredients) : null;
    for (const ingredient of ingredients) {
      const current = balances?.get(ingredient.id) ?? {
        stock: ingredient.stock,
        stockValue: ingredient.stock.mul(ingredient.avgCost),
        valuationKnown: ingredient.valuationKnown,
      };
      const local = summarizeMovements(current, byBalance.get(balanceKey(location?.id ?? null, ingredient.id)) ?? [], range?.gte, range?.lte);
      const total = summaries.get(ingredient.id)!;
      total.openingQuantity = total.openingQuantity.add(local.openingQuantity);
      total.openingValue = total.openingValue.add(local.openingValue);
      total.closingQuantity = total.closingQuantity.add(local.closingQuantity);
      total.closingValue = total.closingValue.add(local.closingValue);
      total.incomingQuantity = total.incomingQuantity.add(local.incomingQuantity);
      total.outgoingQuantity = total.outgoingQuantity.add(local.outgoingQuantity);
      total.valuationAdjustment = total.valuationAdjustment.add(local.valuationAdjustment);
      total.movementCount += local.movementCount;
      total.openingKnown &&= local.openingKnown;
      total.closingKnown &&= local.closingKnown;
    }
  }

  // With a start date the ledger above excludes earlier production. Check old
  // stock evidence only for quiet preparations that would otherwise disappear.
  if (range?.gte && query.onlyWithMovement !== 'true') {
    const candidates = ingredients.filter(({ id, isActive, preparationMode }) => {
      const summary = summaries.get(id)!;
      return isActive && preparationMode !== 'virtual' && preparations.has(id) && !stockedPreparations.has(id)
        && summary.movementCount === 0 && hasNoBalance(summary);
    }).map(({ id }) => id);
    if (candidates.length) {
      const stockedBefore = await db.stockMovement.groupBy({
        by: ['ingredientId'],
        where: { cafeId, ...scope.filter, ingredientId: { in: candidates }, change: { not: zero }, createdAt: { lt: range.gte } },
      });
      for (const { ingredientId } of stockedBefore) stockedPreparations.add(ingredientId);
    }
  }

  const rows = [];
  let totalOpening = zero;
  let totalClosing = zero;
  let totalAdjustment = zero;
  let openingComplete = true;
  let closingComplete = true;
  for (const ingredient of ingredients) {
    const summary = summaries.get(ingredient.id)!;
    if (query.onlyWithMovement === 'true' && summary.movementCount === 0) continue;
    const neverStockedPreparation = preparations.has(ingredient.id) && !stockedPreparations.has(ingredient.id);
    if ((!ingredient.isActive || ingredient.preparationMode === 'virtual' || neverStockedPreparation)
      && summary.movementCount === 0 && hasNoBalance(summary)) continue;
    const unit = normalizeUnit(ingredient.displayUnit);
    const factor = unitDef(unit).factor;
    const { openingKnown, closingKnown } = summary;
    totalOpening = totalOpening.add(summary.openingValue);
    totalClosing = totalClosing.add(summary.closingValue);
    totalAdjustment = totalAdjustment.add(summary.valuationAdjustment);
    openingComplete &&= openingKnown;
    closingComplete &&= closingKnown;
    rows.push({
      id: scope.single ? `${scope.single.id}:${ingredient.id}` : ingredient.id,
      ingredientId: ingredient.id, name: ingredient.name, kind: ingredient.kind, category: ingredient.category,
      warehouseId: scope.single?.id ?? null, warehouseName: scope.warehouseName, unit: unitLabel(unit),
      openingQuantity: Number(summary.openingQuantity.div(factor)),
      openingAvgCost: openingKnown && !summary.openingQuantity.isZero() ? Number(summary.openingValue.div(summary.openingQuantity).mul(factor).toDecimalPlaces(8)) : null,
      openingValue: openingKnown ? Number(summary.openingValue.toDecimalPlaces(2)) : null,
      incomingQuantity: Number(summary.incomingQuantity.div(factor)), outgoingQuantity: Number(summary.outgoingQuantity.div(factor)),
      closingQuantity: Number(summary.closingQuantity.div(factor)),
      closingAvgCost: closingKnown && !summary.closingQuantity.isZero() ? Number(summary.closingValue.div(summary.closingQuantity).mul(factor).toDecimalPlaces(8)) : null,
      closingValue: closingKnown ? Number(summary.closingValue.toDecimalPlaces(2)) : null,
      openingValuationKnown: openingKnown, valuationKnown: closingKnown,
      valuationAdjustment: Number(summary.valuationAdjustment.toDecimalPlaces(2)), movementCount: summary.movementCount,
    });
  }
  const collator = new Intl.Collator('ru', { numeric: true });
  const nameDirection = query.nameSort === 'desc' ? -1 : 1;
  rows.sort((a, b) => nameDirection * collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
  return { rows, openingValue: openingComplete ? Number(totalOpening.toDecimalPlaces(2)) : null,
    closingValue: closingComplete ? Number(totalClosing.toDecimalPlaces(2)) : null,
    totalValuationAdjustment: Number(totalAdjustment.toDecimalPlaces(2)) };
}
