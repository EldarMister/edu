import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveWarehouse, warehouseBalances, warehouseDocumentFilter } from './warehouse-location';
import { fromBase, unitLabel, type UnitCode } from './units';
import { warehouseDateRange, warehouseDay } from './report-range';
import { preparedLossQuantity } from './movement-cost';

@Injectable()
export class WarehouseOverviewService {
  constructor(private prisma: PrismaService) {}

  async getOverview(params: { dateFrom?: string; dateTo?: string; warehouseId?: string }) {
    return this.prisma.$transaction((tx) => this.readOverview(tx, params), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async readOverview(db: Prisma.TransactionClient, params: { dateFrom?: string; dateTo?: string; warehouseId?: string }) {
    const warehouse = params.warehouseId === undefined ? null : await resolveWarehouse(db, params.warehouseId);
    const location = warehouseDocumentFilter(warehouse);
    const range = this.dateRange(params.dateFrom, params.dateTo);
    const days = this.daysBetween(range.from, range.to);

    const [ingredients, purchases, consumptionMovements, recentMovements, missingRecipeDishes] = await Promise.all([
      db.ingredient.findMany({
        where: { isActive: true, preparationMode: { not: 'virtual' } },
        select: { id: true, name: true, displayUnit: true, stock: true, avgCost: true, valuationKnown: true, lowStockThreshold: true },
        orderBy: { name: 'asc' },
      }),
      db.purchase.findMany({
        where: { ...location, status: 'completed', date: { gte: range.from, lte: range.to } },
        select: { supplier: true, totalAmount: true },
      }),
      db.stockMovement.findMany({
        where: { ...location, type: { in: [StockMovementType.sale, StockMovementType.return, StockMovementType.writeoff, StockMovementType.inventory, StockMovementType.cancel] }, createdAt: { gte: range.from, lte: range.to } },
        include: { ingredient: { select: { name: true, displayUnit: true } } },
      }),
      db.stockMovement.findMany({
        where: location,
        orderBy: { createdAt: 'desc' },
        take: 7,
        include: { ingredient: { select: { name: true, displayUnit: true } } },
      }),
      db.dish.findMany({ where: { isActive: true, isSet: false, stockIngredientId: null, recipeItems: { none: {} } },
        select: { id: true, name: true, variants: { select: { id: true, name: true, stockIngredientId: true } } } }),
    ]);

    const missingRecipeConfigurations = missingRecipeDishes.flatMap<{ dishId: string; variantId: string | null; name: string }>((dish) => dish.variants.length
      ? dish.variants.filter((variant) => !variant.stockIngredientId).map((variant) => ({ dishId: dish.id, variantId: variant.id, name: `${dish.name} · ${variant.name}` }))
      : [{ dishId: dish.id, variantId: null, name: dish.name }]);
    const missingRecipeCount = missingRecipeConfigurations.length;

    const balances = await warehouseBalances(db, warehouse, ingredients);
    const stockKnown = ingredients.every((item) => { const balance = balances.get(item.id)!; return balance.stock.isZero() || balance.valuationKnown; });
    const bookValue = Number(ingredients.reduce((sum, item) => sum.add(balances.get(item.id)!.stockValue), new Prisma.Decimal(0)).toDecimalPlaces(2));
    const stockValue = stockKnown ? bookValue : null;
    const lowStockItems = ingredients
      .map((item) => ({ ...item, stock: balances.get(item.id)!.stock }))
      .filter((item) => item.stock.lte(item.lowStockThreshold))
      .map((item) => {
        const display = item.displayUnit as UnitCode;
        return {
          id: item.id,
          name: item.name,
          unit: unitLabel(display),
          stock: round3(fromBase(Number(item.stock), display)),
          lowStockThreshold: round3(fromBase(Number(item.lowStockThreshold), display)),
        };
      });

    const purchasesTotal = Number(purchases.reduce((sum, p) => sum.add(p.totalAmount), new Prisma.Decimal(0)).toDecimalPlaces(2));
    const consumption = consumptionMovements.filter((movement) => ['sale', 'return', 'writeoff'].includes(movement.type));
    // Keep this legacy field for older clients, but never label recipe consumption as losses.
    const ingredientWriteOffTotal = consumption.every((movement) => movement.costKnown) ? Number(consumption.reduce((sum, movement) => sum.sub(movement.change.mul(movement.costAtMoment)), new Prisma.Decimal(0)).toDecimalPlaces(2)) : null;
    const losses = consumptionMovements.filter((movement) => movement.sourceType === 'writeoff'
      || (movement.sourceType === 'inventory' && ((movement.type === 'inventory' && movement.change.lt(0)) || (movement.type === 'cancel' && movement.change.gt(0))))
      || preparedLossQuantity(movement).gt(0));
    const lossesTotal = losses.every((movement) => movement.costKnown) ? Number(losses.reduce((sum, movement) => sum.sub(movement.change.mul(movement.costAtMoment))
        .add(preparedLossQuantity(movement).mul(movement.costAtMoment)), new Prisma.Decimal(0)).toDecimalPlaces(2)) : null;
    const outOfStockCount = ingredients.filter((item) => balances.get(item.id)!.stock.lte(0)).length;
    const unknownCostCount = ingredients.filter((item) => !balances.get(item.id)!.valuationKnown).length;

    const topConsumedIngredients = this.topConsumed(consumption);
    const suppliersTop = this.suppliersTop(purchases);
    const stockValueTrend = await this.stockValueTrend(db, days, bookValue, location, stockKnown);

    return {
      stockValue,
      valuationKnown: stockKnown,
      itemCount: ingredients.length,
      totalItemsCount: ingredients.length,
      outOfStockCount,
      missingRecipeCount,
      missingRecipeConfigurations: missingRecipeConfigurations.slice(0, 30),
      unknownCostCount,
      lossesTotal,
      messages: [
        ...(missingRecipeCount ? [{ code: 'missing_recipe', text: `Не настроен складской учёт: ${missingRecipeCount} блюд и вариантов`, count: missingRecipeCount, section: 'recipes' }] : []),
        ...(unknownCostCount ? [{ code: 'unknown_cost', text: `Не подтверждена себестоимость ${unknownCostCount} позиций`, count: unknownCostCount, section: 'items' }] : []),
        ...(outOfStockCount ? [{ code: 'out_of_stock', text: `Закончились ${outOfStockCount} позиций`, count: outOfStockCount, section: 'items' }] : []),
      ],
      lowStockCount: lowStockItems.filter((item) => item.stock > 0).length,
      purchasesTotal,
      ingredientWriteOffTotal,
      stockValueTrend,
      lowStockItems: lowStockItems.slice(0, 10),
      topConsumedIngredients,
      recentMovements: recentMovements.map((m) => {
        const display = m.ingredient.displayUnit as UnitCode;
        return {
          id: m.id,
          warehouseId: m.warehouseId,
          createdAt: m.createdAt,
          type: m.type,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          ingredientId: m.ingredientId,
          ingredientName: m.ingredient.name,
          unit: unitLabel(display),
          change: round3(fromBase(Number(m.change), display)),
          after: round3(fromBase(Number(m.afterStock), display)),
        };
      }),
      suppliersTop,
    };
  }

  private topConsumed(
    movements: Array<{
      ingredientId: string;
      change: Prisma.Decimal;
      costAtMoment: Prisma.Decimal;
      costKnown: boolean;
      ingredient: { name: string; displayUnit: string };
    }>,
  ) {
    // quantity накапливаем в базе, cost = база × себестоимость-за-базу (валюта).
    const byIngredient = new Map<
      string,
      { ingredientId: string; name: string; displayUnit: UnitCode; quantityBase: number; cost: number; costKnown: boolean }
    >();
    for (const movement of movements) {
      const current = byIngredient.get(movement.ingredientId) ?? {
        ingredientId: movement.ingredientId,
        name: movement.ingredient.name,
        displayUnit: movement.ingredient.displayUnit as UnitCode,
        quantityBase: 0,
        cost: 0,
        costKnown: true,
      };
      const quantityBase = -Number(movement.change);
      current.quantityBase += quantityBase;
      current.cost += quantityBase * Number(movement.costAtMoment);
      current.costKnown &&= movement.costKnown;
      byIngredient.set(movement.ingredientId, current);
    }
    return [...byIngredient.values()]
      .filter((item) => item.quantityBase > 0)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5)
      .map((item) => ({
        ingredientId: item.ingredientId,
        name: item.name,
        unit: unitLabel(item.displayUnit),
        quantity: round3(fromBase(item.quantityBase, item.displayUnit)),
        cost: item.costKnown ? round2(item.cost) : null,
      }));
  }

  private suppliersTop(purchases: Array<{ supplier: string; totalAmount: Prisma.Decimal }>) {
    const bySupplier = new Map<string, number>();
    for (const purchase of purchases) {
      const supplier = purchase.supplier.trim() || 'Без поставщика';
      bySupplier.set(supplier, (bySupplier.get(supplier) ?? 0) + Number(purchase.totalAmount));
    }
    return [...bySupplier.entries()]
      .map(([supplier, total]) => ({ supplier, total: round2(total) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }

  private async stockValueTrend(db: Prisma.TransactionClient, days: Date[], currentValue: number, location: Prisma.StockMovementWhereInput, valuationKnown: boolean) {
    if (days.length === 0) return [];
    const first = days[0];
    const movements = await db.stockMovement.findMany({
      where: { ...location, createdAt: { gte: first } },
      select: { createdAt: true, change: true, costAtMoment: true, valuationAdjustment: true, costKnown: true },
    });

    if (currentValue === 0 && movements.length === 0) return [];

    return days.map((day) => {
      const end = new Date(day.getTime() + 86400000 - 1);
      const valueAfterDay = movements.reduce((sum, movement) => {
        if (movement.createdAt <= end) return sum;
        return sum + Number(movement.change.mul(movement.costAtMoment).add(movement.valuationAdjustment));
      }, 0);
      return {
        date: warehouseDay(day),
        value: valuationKnown && movements.every((movement) => movement.costKnown) ? round2(currentValue - valueAfterDay) : null,
      };
    });
  }

  private dateRange(dateFrom?: string, dateTo?: string) {
    const now = new Date();
    const range = warehouseDateRange(dateFrom || warehouseDay(addDays(now, -6)), dateTo || warehouseDay(now))!;
    return { from: range.gte!, to: range.lte! };
  }

  private daysBetween(from: Date, to: Date) {
    const days: Date[] = [];
    const cursor = new Date(from);
    const last = to;
    while (cursor <= last && days.length < 62) {
      days.push(new Date(cursor));
      cursor.setTime(cursor.getTime() + 86400000);
    }
    return days;
  }
}

function startOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date) {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function addDays(d: Date, days: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
