import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { getWarehouseBalance, setWarehouseBalance, WarehouseLocation } from './warehouse-location';

type MovementData = Omit<Prisma.StockMovementUncheckedCreateInput,
  'id' | 'ingredientId' | 'cafeId' | 'warehouseId' | 'warehouseKey' | 'beforeStock' | 'afterStock' | 'change' | 'costAtMoment' | 'valuationAdjustment' | 'costKnown' | 'beforeValuationKnown' | 'valuationKnown'>;

/** The caller locks all affected ingredient rows in sorted order in its transaction.
 * Every posting writes the balance and immutable evidence together. Costs and
 * quantities remain Decimal until serialization at the API boundary. */
export async function postStockMovement(tx: Prisma.TransactionClient, input: {
  ingredientId: string;
  warehouse: WarehouseLocation | null;
  change: Prisma.Decimal;
  cost?: Prisma.Decimal;
  costKnown?: boolean;
  value?: Prisma.Decimal;
  valuation?: 'preserve' | 'average' | 'value';
  allowNegative?: boolean;
  movement: MovementData;
}) {
  const cafeId = getCafeId();
  const ingredient = await tx.ingredient.findFirst({ where: { id: input.ingredientId, ...(cafeId ? { cafeId } : {}) } });
  if (!ingredient || (input.warehouse && ingredient.cafeId !== input.warehouse.cafeId)) {
    throw new NotFoundException('Товар не найден');
  }
  const before = await getWarehouseBalance(tx, input.warehouse, ingredient);
  const change = input.change.toDecimalPlaces(3);
  if (ingredient.preparationMode === 'virtual' && !change.isZero()) throw new ConflictException('Заготовка без отдельного остатка раскрывается по рецептуре и не участвует в складских движениях');
  const stock = before.stock.add(change);
  if (!stock.isFinite() || stock.abs().gte('100000000000')) throw new ConflictException('Остаток вне допустимого диапазона');
  if (stock.lt(0)) {
    const allowNegative = input.allowNegative ?? (await tx.settings.findFirst({ where: cafeId ? { cafeId } : {}, select: { allowNegativeIngredientStock: true } }))?.allowNegativeIngredientStock ?? false;
    if (!allowNegative) throw new ConflictException(`На выбранном складе недостаточно товара «${ingredient.name}»`);
  }
  const cost = (input.cost ?? before.avgCost).toDecimalPlaces(8);
  const costKnown = input.costKnown ?? (change.lte(0) && before.valuationKnown && before.stock.gte(change.abs()));
  if (!cost.isFinite() || cost.lt(0)) throw new ConflictException('Себестоимость должна быть неотрицательной');
  let avgCost = before.avgCost;
  if (input.valuation === 'average' && change.gt(0)) {
    const positive = Prisma.Decimal.max(before.stock, 0);
    avgCost = positive.mul(before.avgCost).add(input.value ?? change.mul(cost)).div(positive.add(change));
  } else if (input.valuation === 'value' && stock.gt(0)) {
    avgCost = before.stock.mul(before.avgCost).add(change.mul(cost)).div(stock);
    if (avgCost.lt(0)) throw new ConflictException('Корректировка создаёт отрицательную стоимость. Проверьте последующие операции');
  }
  avgCost = avgCost.toDecimalPlaces(8);
  // Unknown opening stock must not become a complete valuation merely because
  // one known receipt makes its numerical weighted average positive.
  let valuationKnown = before.valuationKnown;
  if (change.gt(0)) valuationKnown = (before.stock.lte(0) || before.valuationKnown) && costKnown;
  else if (input.valuation === 'value') valuationKnown = before.valuationKnown && costKnown;
  if (stock.lte(0)) valuationKnown = false;
  const valuationAdjustment = stock.mul(avgCost).sub(before.stock.mul(before.avgCost)).sub(change.mul(cost)).toDecimalPlaces(8);
  await setWarehouseBalance(tx, input.warehouse, ingredient.id, { stock, avgCost, valuationKnown });
  const movement = await tx.stockMovement.create({ data: {
    ...input.movement, cafeId: ingredient.cafeId, ingredientId: ingredient.id,
    warehouseId: input.warehouse?.id ?? null,
    warehouseKey: input.warehouse?.isDefault ? 'default' : input.warehouse?.id ?? 'default',
    beforeStock: before.stock, change, afterStock: stock, costAtMoment: cost, valuationAdjustment,
    costKnown, beforeValuationKnown: before.valuationKnown, valuationKnown,
  } });
  return { stock, avgCost, valuationKnown, before, cost, movement };
}
