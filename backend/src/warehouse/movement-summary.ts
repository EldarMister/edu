import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { warehouseDateRange } from './report-range';
import { WarehouseReportQuery } from './reports.dto';
import { resolveWarehouse, warehouseBalances, warehouseDocumentFilter } from './warehouse-location';
import { normalizeUnit, unitDef, unitLabel } from './units';

const zero = new Prisma.Decimal(0);
type Evidence = { createdAt: Date; change: Prisma.Decimal; costAtMoment: Prisma.Decimal; valuationAdjustment: Prisma.Decimal;
  beforeValuationKnown?: boolean; valuationKnown?: boolean };

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
      if (movement.change.gt(0)) incomingQuantity = incomingQuantity.add(movement.change);
      if (movement.change.lt(0)) outgoingQuantity = outgoingQuantity.sub(movement.change);
      valuationAdjustment = valuationAdjustment.add(movement.valuationAdjustment);
      movementCount += 1;
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

export async function movementSummary(db: Prisma.TransactionClient, query: WarehouseReportQuery) {
  const cafeId = getCafeId();
  if (!cafeId) throw new BadRequestException('Заведение не назначено');
  // A balance cannot be attributed to one employee or one movement type.
  if (query.employeeId || query.type) throw new BadRequestException('Фильтр сотрудника или операции доступен в деталях движения');
  const range = warehouseDateRange(query.from, query.to);
  const warehouse = query.warehouseId ? await resolveWarehouse(db, query.warehouseId) : null;
  const locations = await db.warehouse.findMany({ where: { cafeId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  const ingredients = await db.ingredient.findMany({ where: {
    cafeId,
    ...(query.ingredientId ? { id: query.ingredientId } : {}),
    ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' as const } } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
  }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  const movements = ingredients.length ? await db.stockMovement.findMany({ where: {
    cafeId, ...warehouseDocumentFilter(warehouse), ingredientId: { in: ingredients.map(({ id }) => id) },
    ...(range?.gte ? { createdAt: { gte: range.gte } } : {}),
  }, select: { ingredientId: true, warehouseId: true, createdAt: true, change: true, costAtMoment: true, valuationAdjustment: true, beforeValuationKnown: true, valuationKnown: true } }) : [];
  const defaultId = locations.find((item) => item.isDefault)?.id;
  const byBalance = new Map<string, Evidence[]>();
  for (const movement of movements) {
    const key = `${movement.warehouseId ?? defaultId}:${movement.ingredientId}`;
    const list = byBalance.get(key) ?? [];
    list.push(movement);
    byBalance.set(key, list);
  }
  const rows = [];
  let totalOpening = zero;
  let totalClosing = zero;
  let totalAdjustment = zero;
  let openingComplete = true;
  let closingComplete = true;
  for (const location of warehouse ? [warehouse] : locations) {
    const balances = await warehouseBalances(db, location, ingredients);
    for (const ingredient of ingredients) {
      const id = `${location.id}:${ingredient.id}`;
      const summary = summarizeMovements(balances.get(ingredient.id)!, byBalance.get(id) ?? [], range?.gte, range?.lte);
      if (query.onlyWithMovement === 'true' && summary.movementCount === 0) continue;
      if (ingredient.preparationMode === 'virtual' && summary.movementCount === 0 && summary.openingQuantity.isZero() && summary.closingQuantity.isZero()) continue;
      if (!ingredient.isActive && summary.movementCount === 0 && summary.openingQuantity.isZero() && summary.closingQuantity.isZero()) continue;
      const unit = normalizeUnit(ingredient.displayUnit);
      const factor = unitDef(unit).factor;
      const openingKnown = summary.openingKnown;
      const closingKnown = summary.closingKnown;
      totalOpening = totalOpening.add(summary.openingValue);
      totalClosing = totalClosing.add(summary.closingValue);
      totalAdjustment = totalAdjustment.add(summary.valuationAdjustment);
      openingComplete &&= openingKnown;
      closingComplete &&= closingKnown;
      rows.push({ id, ingredientId: ingredient.id, name: ingredient.name, kind: ingredient.kind, category: ingredient.category,
        warehouseId: location.id, warehouseName: location.name, unit: unitLabel(unit),
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
  }
  return { rows, openingValue: openingComplete ? Number(totalOpening.toDecimalPlaces(2)) : null,
    closingValue: closingComplete ? Number(totalClosing.toDecimalPlaces(2)) : null,
    totalValuationAdjustment: Number(totalAdjustment.toDecimalPlaces(2)) };
}
