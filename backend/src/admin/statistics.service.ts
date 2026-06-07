import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StatsQueryDto } from './dto';

type StatsPeriod = 'today' | 'week' | 'month' | 'all' | 'custom';

function startOfDay(d = new Date()) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function endExclusive(d: Date) {
  const next = startOfDay(d);
  next.setDate(next.getDate() + 1);
  return next;
}

function parseDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(d: Date, months: number) {
  const next = new Date(d);
  next.setMonth(next.getMonth() + months);
  return next;
}

/** Статистика владельца. */
@Injectable()
export class StatisticsService {
  constructor(private prisma: PrismaService) {}

  async dashboard(query: StatsQueryDto = {}) {
    const period = query.period ?? 'today';
    const range = await this.resolveRange(period, query);
    const previousRange = this.previousRange(range.from, range.to);
    const paidWhere = { status: OrderStatus.paid as OrderStatus };

    const [currentOrders, previousOrders, todayAgg] = await Promise.all([
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
    ]);

    const revenuePeriod = currentOrders.reduce((s, o) => s + Number(o.finalAmount), 0);
    const previousRevenue = previousOrders.reduce((s, o) => s + Number(o.finalAmount), 0);
    const ordersPeriod = currentOrders.length;
    const avgCheck = ordersPeriod > 0 ? revenuePeriod / ordersPeriod : 0;
    const previousAvg =
      previousOrders.length > 0 ? previousRevenue / previousOrders.length : 0;

    const methodTotals: Record<PaymentMethod, number> = { qr: 0, cash: 0, card: 0 };
    for (const o of currentOrders) {
      if (o.paymentMethod) methodTotals[o.paymentMethod] += Number(o.finalAmount);
    }
    const methodsSum = methodTotals.qr + methodTotals.cash + methodTotals.card || 1;
    const paymentMethods = (['qr', 'cash', 'card'] as PaymentMethod[]).map((m) => ({
      method: m,
      amount: methodTotals[m],
      percent: Math.round((methodTotals[m] / methodsSum) * 100),
    }));

    const waiterMap = new Map<string, { name: string; amount: number; orders: number }>();
    for (const o of currentOrders) {
      const cur = waiterMap.get(o.waiterId) ?? { name: o.waiter.name, amount: 0, orders: 0 };
      cur.amount += Number(o.finalAmount);
      cur.orders += 1;
      waiterMap.set(o.waiterId, cur);
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
      select: { dishNameSnapshot: true, dishVariantNameSnapshot: true, finalPrice: true, quantity: true },
    });
    const dishMap = new Map<string, { name: string; amount: number; count: number }>();
    for (const it of items) {
      const name = it.dishVariantNameSnapshot
        ? `${it.dishNameSnapshot} · ${it.dishVariantNameSnapshot}`
        : it.dishNameSnapshot;
      const cur = dishMap.get(name) ?? { name, amount: 0, count: 0 };
      cur.amount += Number(it.finalPrice);
      cur.count += it.quantity;
      dishMap.set(name, cur);
    }
    const topDishes = [...dishMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);

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
      paymentMethods,
      topDishes,
      topWaiters,
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
        points[o.closedAt.getHours()].amount += Number(o.finalAmount);
      }
      return points;
    }

    const monthMode = period === 'all' && to.getTime() - from.getTime() > 120 * 86_400_000;
    const series = new Map<string, number>();
    if (monthMode) {
      for (let d = startOfMonth(from); d < to; d = addMonths(d, 1)) {
        series.set(d.toISOString().slice(0, 7), 0);
      }
      for (const o of orders) {
        if (!o.closedAt) continue;
        const key = o.closedAt.toISOString().slice(0, 7);
        series.set(key, (series.get(key) ?? 0) + Number(o.finalAmount));
      }
    } else {
      for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
        series.set(d.toISOString().slice(0, 10), 0);
      }
      for (const o of orders) {
        if (!o.closedAt) continue;
        const key = o.closedAt.toISOString().slice(0, 10);
        series.set(key, (series.get(key) ?? 0) + Number(o.finalAmount));
      }
    }
    return [...series.entries()].map(([label, amount]) => ({ label, amount }));
  }
}

function startOfMonth(d: Date) {
  const next = new Date(d);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}
