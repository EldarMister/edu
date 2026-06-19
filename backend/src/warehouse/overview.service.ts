import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WarehouseOverviewService {
  constructor(private prisma: PrismaService) {}

  async getOverview(params: { dateFrom?: string; dateTo?: string }) {
    const range = this.dateRange(params.dateFrom, params.dateTo);
    const days = this.daysBetween(range.from, range.to);

    const [ingredients, purchases, saleMovements, recentMovements] = await Promise.all([
      this.prisma.ingredient.findMany({
        where: { isActive: true },
        select: { id: true, name: true, unit: true, stock: true, avgCost: true, lowStockThreshold: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.purchase.findMany({
        where: { status: 'completed', date: { gte: range.from, lte: range.to } },
        select: { supplier: true, totalAmount: true },
      }),
      this.prisma.stockMovement.findMany({
        where: { type: StockMovementType.sale, createdAt: { gte: range.from, lte: range.to } },
        include: { ingredient: { select: { name: true, unit: true } } },
      }),
      this.prisma.stockMovement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 7,
        include: { ingredient: { select: { name: true, unit: true } } },
      }),
    ]);

    const stockValue = round2(
      ingredients.reduce((sum, item) => sum + Number(item.stock) * Number(item.avgCost), 0),
    );
    const lowStockItems = ingredients
      .filter((item) => Number(item.stock) <= Number(item.lowStockThreshold))
      .map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        stock: Number(item.stock),
        lowStockThreshold: Number(item.lowStockThreshold),
      }));

    const purchasesTotal = round2(purchases.reduce((sum, p) => sum + Number(p.totalAmount), 0));
    const ingredientWriteOffTotal = round2(
      saleMovements.reduce((sum, movement) => {
        return sum + Math.abs(Number(movement.change)) * Number(movement.costAtMoment);
      }, 0),
    );

    const topConsumedIngredients = this.topConsumed(saleMovements);
    const suppliersTop = this.suppliersTop(purchases);
    const stockValueTrend = await this.stockValueTrend(days, stockValue);

    return {
      stockValue,
      lowStockCount: lowStockItems.length,
      purchasesTotal,
      ingredientWriteOffTotal,
      stockValueTrend,
      lowStockItems: lowStockItems.slice(0, 10),
      topConsumedIngredients,
      recentMovements: recentMovements.map((m) => ({
        id: m.id,
        createdAt: m.createdAt,
        type: m.type,
        ingredientName: m.ingredient.name,
        unit: m.ingredient.unit,
        change: Number(m.change),
        after: Number(m.afterStock),
      })),
      suppliersTop,
    };
  }

  private topConsumed(
    movements: Array<{
      ingredientId: string;
      change: Prisma.Decimal;
      costAtMoment: Prisma.Decimal;
      ingredient: { name: string; unit: string };
    }>,
  ) {
    const byIngredient = new Map<
      string,
      { ingredientId: string; name: string; unit: string; quantity: number; cost: number }
    >();
    for (const movement of movements) {
      const current = byIngredient.get(movement.ingredientId) ?? {
        ingredientId: movement.ingredientId,
        name: movement.ingredient.name,
        unit: movement.ingredient.unit,
        quantity: 0,
        cost: 0,
      };
      const quantity = Math.abs(Number(movement.change));
      current.quantity += quantity;
      current.cost += quantity * Number(movement.costAtMoment);
      byIngredient.set(movement.ingredientId, current);
    }
    return [...byIngredient.values()]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5)
      .map((item) => ({
        ...item,
        quantity: round3(item.quantity),
        cost: round2(item.cost),
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

  private async stockValueTrend(days: Date[], currentValue: number) {
    if (days.length === 0) return [];
    const first = startOfDay(days[0]);
    const movements = await this.prisma.stockMovement.findMany({
      where: { createdAt: { gte: first } },
      select: { createdAt: true, change: true, costAtMoment: true },
    });

    if (currentValue === 0 && movements.length === 0) return [];

    return days.map((day) => {
      const end = endOfDay(day);
      const valueAfterDay = movements.reduce((sum, movement) => {
        if (movement.createdAt <= end) return sum;
        return sum + Number(movement.change) * Number(movement.costAtMoment);
      }, 0);
      return {
        date: isoDate(day),
        value: round2(Math.max(0, currentValue - valueAfterDay)),
      };
    });
  }

  private dateRange(dateFrom?: string, dateTo?: string) {
    const now = new Date();
    const to = dateTo ? endOfDay(new Date(dateTo)) : endOfDay(now);
    const from = dateFrom ? startOfDay(new Date(dateFrom)) : startOfDay(addDays(to, -6));
    if (from > to) return { from: startOfDay(to), to };
    return { from, to };
  }

  private daysBetween(from: Date, to: Date) {
    const days: Date[] = [];
    const cursor = startOfDay(from);
    const last = startOfDay(to);
    while (cursor <= last && days.length < 62) {
      days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
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
