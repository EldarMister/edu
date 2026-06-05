import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

function startOfDay(d = new Date()) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

/** Статистика владельца (ТЗ §7). */
@Injectable()
export class StatisticsService {
  constructor(private prisma: PrismaService) {}

  async dashboard(period: 'week' | 'month' | 'year' = 'month') {
    const today = startOfDay();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const days = period === 'week' ? 7 : period === 'year' ? 365 : 30;
    const since = new Date(today);
    since.setDate(since.getDate() - (days - 1));

    const paidWhere = { status: OrderStatus.paid as OrderStatus };

    const [todayAgg, periodPaidOrders, allPaidAgg] = await Promise.all([
      // Сегодня: выручка + кол-во
      this.prisma.order.aggregate({
        where: { ...paidWhere, closedAt: { gte: today, lt: tomorrow } },
        _sum: { finalAmount: true },
        _count: true,
      }),
      // Оплаченные заказы за период (для графика, способов оплаты, топов)
      this.prisma.order.findMany({
        where: { ...paidWhere, closedAt: { gte: since } },
        select: {
          finalAmount: true,
          paymentMethod: true,
          closedAt: true,
          waiterId: true,
          waiter: { select: { name: true } },
        },
      }),
      // Средний чек по всем оплаченным
      this.prisma.order.aggregate({ where: paidWhere, _avg: { finalAmount: true } }),
    ]);

    // --- Карточки ---
    const revenueToday = Number(todayAgg._sum.finalAmount ?? 0);
    const ordersToday = todayAgg._count;
    const avgCheck = allPaidAgg._avg.finalAmount ? Number(allPaidAgg._avg.finalAmount) : 0;
    const revenuePeriod = periodPaidOrders.reduce((s, o) => s + Number(o.finalAmount), 0);

    // --- График выручки по дням ---
    const seriesMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      seriesMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const o of periodPaidOrders) {
      if (!o.closedAt) continue;
      const key = new Date(o.closedAt).toISOString().slice(0, 10);
      seriesMap.set(key, (seriesMap.get(key) ?? 0) + Number(o.finalAmount));
    }
    const revenueSeries = [...seriesMap.entries()].map(([date, amount]) => ({ date, amount }));

    // --- Способы оплаты ---
    const methodTotals: Record<PaymentMethod, number> = { qr: 0, cash: 0, card: 0 };
    for (const o of periodPaidOrders) {
      if (o.paymentMethod) methodTotals[o.paymentMethod] += Number(o.finalAmount);
    }
    const methodsSum = methodTotals.qr + methodTotals.cash + methodTotals.card || 1;
    const paymentMethods = (['qr', 'cash', 'card'] as PaymentMethod[]).map((m) => ({
      method: m,
      amount: methodTotals[m],
      percent: Math.round((methodTotals[m] / methodsSum) * 100),
    }));

    // --- Лучшие официанты ---
    const waiterMap = new Map<string, { name: string; amount: number; orders: number }>();
    for (const o of periodPaidOrders) {
      const cur = waiterMap.get(o.waiterId) ?? { name: o.waiter.name, amount: 0, orders: 0 };
      cur.amount += Number(o.finalAmount);
      cur.orders += 1;
      waiterMap.set(o.waiterId, cur);
    }
    const topWaiters = [...waiterMap.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // --- Топ блюд (по выручке) за период ---
    const items = await this.prisma.orderItem.findMany({
      where: {
        order: { ...paidWhere, closedAt: { gte: since } },
        status: { notIn: ['rejected', 'cancelled'] },
      },
      select: { dishNameSnapshot: true, finalPrice: true, quantity: true },
    });
    const dishMap = new Map<string, { name: string; amount: number; count: number }>();
    for (const it of items) {
      const cur = dishMap.get(it.dishNameSnapshot) ?? {
        name: it.dishNameSnapshot,
        amount: 0,
        count: 0,
      };
      cur.amount += Number(it.finalPrice);
      cur.count += it.quantity;
      dishMap.set(it.dishNameSnapshot, cur);
    }
    const topDishes = [...dishMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);

    return {
      cards: { revenueToday, ordersToday, avgCheck, revenuePeriod },
      revenueSeries,
      paymentMethods,
      topDishes,
      topWaiters,
      period,
    };
  }
}
