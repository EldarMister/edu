import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StatsQueryDto } from './dto';
import { SettingsService } from '../settings/settings.service';
import { warehouseDay } from '../warehouse/report-range';
import { buildStatisticsReports, statisticsMovementSelect, statisticsOrderSelect } from './statistics-reports';

type StatsPeriod = 'today' | 'week' | 'month' | 'all' | 'custom';

const HOUR = 3_600_000;
const BISHKEK_OFFSET = 6 * HOUR;

function startOfDay(d = new Date()) {
  return new Date(`${warehouseDay(d)}T00:00:00+06:00`);
}

function parseDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+06:00` : value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * HOUR);
}

function addMonths(d: Date, months: number) {
  const local = new Date(d.getTime() + BISHKEK_OFFSET);
  local.setUTCMonth(local.getUTCMonth() + months);
  return new Date(local.getTime() - BISHKEK_OFFSET);
}

function businessHour(date: Date) {
  return new Date(date.getTime() + BISHKEK_OFFSET).getUTCHours();
}

function endExclusive(d: Date) {
  return addDays(startOfDay(d), 1);
}

/** Статистика владельца. */
@Injectable()
export class StatisticsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async reports(query: StatsQueryDto, showCosts: boolean) {
    const range = await this.resolveRange(query.period ?? 'today', query);
    return this.prisma.$transaction(async (db) => {
      const orders = await db.order.findMany({
        where: { status: OrderStatus.paid, closedAt: { gte: range.from, lt: range.to } },
        select: statisticsOrderSelect,
      });
      const movements: Prisma.StockMovementGetPayload<{ select: typeof statisticsMovementSelect }>[] = [];
      if (showCosts) {
        for (let offset = 0; offset < orders.length; offset += 5000) {
          const batch = await db.stockMovement.findMany({
            where: { sourceType: 'order', sourceId: { in: orders.slice(offset, offset + 5000).map(({ id }) => id) },
              type: { in: ['sale', 'return', 'writeoff'] } },
            select: statisticsMovementSelect,
          });
          for (const movement of batch) movements.push(movement);
        }
      }
      return { range: { from: range.from.toISOString(), to: range.to.toISOString() },
        ...buildStatisticsReports(orders, movements, showCosts) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async dashboard(query: StatsQueryDto = {}) {
    const period = query.period ?? 'today';
    const range = await this.resolveRange(period, query);
    const previousRange = this.previousRange(range.from, range.to);
    const paidWhere = { status: OrderStatus.paid as OrderStatus };

    const [currentOrders, previousOrders, todayAgg, enabledMethods] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          ...paidWhere,
          closedAt: range.from || range.to ? { gte: range.from, lt: range.to } : undefined,
        },
        select: {
          finalAmount: true,
          paymentMethod: true,
          closedAt: true,
          waiterId: true,
          waiter: { select: { name: true } },
          payments: { where: { status: PaymentStatus.paid }, select: { method: true, amount: true } },
        },
      }),
      this.prisma.order.findMany({
        where: {
          ...paidWhere,
          closedAt: { gte: previousRange.from, lt: previousRange.to },
        },
        select: { finalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { ...paidWhere, closedAt: { gte: startOfDay(), lt: endExclusive(new Date()) } },
        _sum: { finalAmount: true },
        _count: true,
      }),
      this.settings.enabledMethods(),
    ]);

    const revenuePeriod = currentOrders.reduce((s, o) => s + Number(o.finalAmount), 0);
    const previousRevenue = previousOrders.reduce((s, o) => s + Number(o.finalAmount), 0);
    const ordersPeriod = currentOrders.length;
    const avgCheck = ordersPeriod > 0 ? revenuePeriod / ordersPeriod : 0;
    const previousAvg =
      previousOrders.length > 0 ? previousRevenue / previousOrders.length : 0;

    // Считаем по строкам оплат, чтобы смешанная оплата корректно разложилась на наличные/QR.
    const methodTotals: Record<PaymentMethod, number> = { qr: 0, cash: 0, card: 0, mixed: 0 };
    for (const o of currentOrders) {
      for (const p of o.payments) methodTotals[p.method] += Number(p.amount);
    }
    const visibleMethods = enabledMethods.filter(
      (method): method is Extract<PaymentMethod, 'qr' | 'cash' | 'card'> =>
        method === PaymentMethod.qr || method === PaymentMethod.cash || method === PaymentMethod.card,
    );
    const methodsSum = visibleMethods.reduce((sum, method) => sum + methodTotals[method], 0) || 1;
    const paymentMethods = visibleMethods.map((m) => ({
      method: m,
      amount: methodTotals[m],
      percent: Math.round((methodTotals[m] / methodsSum) * 100),
    }));

    const waiterMap = new Map<string, { name: string; amount: number; orders: number; avgCheck: number }>();
    for (const o of currentOrders) {
      // QR-заказы без официанта группируем под «QR-меню».
      const key = o.waiterId ?? 'qr';
      const cur = waiterMap.get(key) ?? { name: o.waiter?.name ?? 'QR-меню', amount: 0, orders: 0, avgCheck: 0 };
      cur.amount += Number(o.finalAmount);
      cur.orders += 1;
      waiterMap.set(key, cur);
    }
    for (const item of waiterMap.values()) {
      item.avgCheck = item.orders > 0 ? item.amount / item.orders : 0;
    }
    const topWaiters = [...waiterMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);

    const items = await this.prisma.orderItem.findMany({
      where: {
        order: {
          ...paidWhere,
          closedAt: range.from || range.to ? { gte: range.from, lt: range.to } : undefined,
        },
        status: { notIn: ['rejected', 'cancelled'] },
      },
      select: {
        dishNameSnapshot: true,
        dishVariantNameSnapshot: true,
        finalPrice: true,
        quantity: true,
        order: { select: { closedAt: true } },
        dish: { select: { category: { select: { name: true } } } },
      },
    });
    const dishMap = new Map<string, { name: string; amount: number; count: number }>();
    // Приготовленные блюда: количество по дням — для «в среднем» и «максимум за день».
    const preparedPerDay = new Map<string, number>();
    let preparedTotal = 0;
    // Проданные напитки: позиции из категории «Напитки» (по названию категории блюда).
    const drinksMap = new Map<string, number>();
    for (const it of items) {
      const name = it.dishVariantNameSnapshot
        ? `${it.dishNameSnapshot} · ${it.dishVariantNameSnapshot}`
        : it.dishNameSnapshot;
      const cur = dishMap.get(name) ?? { name, amount: 0, count: 0 };
      cur.amount += Number(it.finalPrice);
      cur.count += it.quantity;
      dishMap.set(name, cur);

      preparedTotal += it.quantity;
      if (it.order?.closedAt) {
        const day = warehouseDay(it.order.closedAt);
        preparedPerDay.set(day, (preparedPerDay.get(day) ?? 0) + it.quantity);
      }

      if ((it.dish?.category?.name ?? '').toLowerCase().includes('напит')) {
        drinksMap.set(name, (drinksMap.get(name) ?? 0) + it.quantity);
      }
    }
    const topDishes = [...dishMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);

    // Сводка по приготовленным блюдам и список блюд за период (по количеству).
    const preparedDishes = [...dishMap.values()]
      .map((d) => ({ name: d.name, count: d.count }))
      .sort((a, b) => b.count - a.count);
    const activeDays = preparedPerDay.size;
    const prepared = {
      total: preparedTotal,
      avgPerDay: activeDays > 0 ? Math.round(preparedTotal / activeDays) : 0,
      uniqueDishes: dishMap.size,
      maxPerDay: preparedPerDay.size > 0 ? Math.max(...preparedPerDay.values()) : 0,
      dishes: preparedDishes,
    };

    const drinks = {
      total: [...drinksMap.values()].reduce((s, n) => s + n, 0),
      dishes: [...drinksMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    };

    return {
      cards: {
        revenueToday: Number(todayAgg._sum.finalAmount ?? 0),
        ordersToday: todayAgg._count,
        avgCheck,
        revenuePeriod,
        ordersPeriod,
      },
      trends: {
        revenue: percentChange(revenuePeriod, previousRevenue),
        orders: percentChange(ordersPeriod, previousOrders.length),
        avgCheck: percentChange(avgCheck, previousAvg),
      },
      revenueSeries: this.revenueSeries(currentOrders, range.from ?? startOfDay(), range.to, period),
      peakHours: this.peakHours(currentOrders),
      paymentMethods,
      topDishes,
      topWaiters,
      prepared,
      drinks,
      period,
      range: {
        from: range.from?.toISOString() ?? null,
        to: range.to?.toISOString() ?? null,
      },
    };
  }

  private async resolveRange(period: StatsPeriod, query: StatsQueryDto) {
    const today = startOfDay();
    if (period === 'today') return { from: today, to: endExclusive(today) };
    if (period === 'week') return { from: addDays(today, -6), to: endExclusive(today) };
    if (period === 'month') return { from: addDays(today, -29), to: endExclusive(today) };
    if (period === 'custom') {
      const from = startOfDay(parseDate(query.from, addDays(today, -6)));
      const to = endExclusive(parseDate(query.to, today));
      return { from, to };
    }

    const firstPaid = await this.prisma.order.findFirst({
      where: { status: OrderStatus.paid, closedAt: { not: null } },
      orderBy: { closedAt: 'asc' },
      select: { closedAt: true },
    });
    return {
      from: firstPaid?.closedAt ? startOfDay(firstPaid.closedAt) : today,
      to: endExclusive(today),
    };
  }

  private previousRange(from: Date, to: Date) {
    const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
    return { from: addDays(from, -days), to: from };
  }

  private revenueSeries(
    orders: { closedAt: Date | null; finalAmount: unknown }[],
    from: Date,
    to: Date,
    period: StatsPeriod,
  ) {
    if (period === 'today') {
      const points = Array.from({ length: 24 }, (_, hour) => ({
        label: `${String(hour).padStart(2, '0')}:00`,
        amount: 0,
      }));
      for (const o of orders) {
        if (!o.closedAt) continue;
        points[businessHour(o.closedAt)].amount += Number(o.finalAmount);
      }
      return points;
    }

    const monthMode = period === 'all' && to.getTime() - from.getTime() > 120 * 86_400_000;
    const series = new Map<string, number>();
    if (monthMode) {
      for (let d = startOfMonth(from); d < to; d = addMonths(d, 1)) {
        series.set(warehouseDay(d).slice(0, 7), 0);
      }
      for (const o of orders) {
        if (!o.closedAt) continue;
        const key = warehouseDay(o.closedAt).slice(0, 7);
        series.set(key, (series.get(key) ?? 0) + Number(o.finalAmount));
      }
    } else {
      for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
        series.set(warehouseDay(d), 0);
      }
      for (const o of orders) {
        if (!o.closedAt) continue;
        const key = warehouseDay(o.closedAt);
        series.set(key, (series.get(key) ?? 0) + Number(o.finalAmount));
      }
    }
    return [...series.entries()].map(([label, amount]) => ({ label, amount }));
  }

  private peakHours(orders: { closedAt: Date | null; finalAmount: unknown }[]) {
    const hours = new Map<string, { hour: string; amount: number; orders: number }>();
    for (let hour = 0; hour < 24; hour += 1) {
      const label = `${String(hour).padStart(2, '0')}:00`;
      hours.set(label, { hour: label, amount: 0, orders: 0 });
    }

    for (const order of orders) {
      if (!order.closedAt) continue;
      const label = `${String(businessHour(order.closedAt)).padStart(2, '0')}:00`;
      const current = hours.get(label);
      if (!current) continue;
      current.amount += Number(order.finalAmount);
      current.orders += 1;
    }

    return [...hours.values()]
      .filter((hour) => hour.orders > 0)
      .sort((a, b) => b.orders - a.orders || b.amount - a.amount)
      .slice(0, 3);
  }
}

function startOfMonth(d: Date) {
  return new Date(`${warehouseDay(d).slice(0, 7)}-01T00:00:00+06:00`);
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}
