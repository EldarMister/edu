import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { orderInclude } from '../orders/order.helpers';
import { OrderQueryDto } from './dto';

const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.sent_to_kitchen,
  OrderStatus.accepted_by_kitchen,
  OrderStatus.cooking,
  OrderStatus.ready,
  OrderStatus.picked_up,
  OrderStatus.served,
  OrderStatus.waiting_payment,
  OrderStatus.partially_rejected,
];

const CANCELLED_STATUSES: OrderStatus[] = [OrderStatus.cancelled, OrderStatus.rejected];

// Список заказов отдаёт ещё и разбивку оплат — чтобы показать «Смешанная (нал / QR)».
const listInclude = {
  ...orderInclude,
  payments: { select: { method: true, amount: true } },
} satisfies Prisma.OrderInclude;

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

@Injectable()
export class AdminOrdersService {
  constructor(private prisma: PrismaService) {}

  async overview() {
    const { start, end } = dayBounds();
    const [ordersToday, active, paid, cancelled] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.order.count({ where: { status: { in: ACTIVE_STATUSES } } }),
      this.prisma.order.count({
        where: { status: OrderStatus.paid, createdAt: { gte: start, lt: end } },
      }),
      this.prisma.order.count({
        where: {
          status: { in: [OrderStatus.cancelled, OrderStatus.rejected] },
          createdAt: { gte: start, lt: end },
        },
      }),
    ]);
    return { ordersToday, activeCount: active, paidCount: paid, cancelledCount: cancelled };
  }

  /**
   * Собирает условие выборки заказов из фильтров.
   * @param withStatus учитывать ли фильтр по статусу (tab) — для сводки он не нужен.
   */
  private buildWhere(query: OrderQueryDto, withStatus = true): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};

    if (withStatus) {
      if (query.tab === 'active') where.status = { in: ACTIVE_STATUSES };
      else if (query.tab === 'paid') where.status = OrderStatus.paid;
      else if (query.tab === 'cancelled') where.status = { in: CANCELLED_STATUSES };
    }

    if (query.paymentMethod && query.paymentMethod in PaymentMethod) {
      where.paymentMethod = query.paymentMethod as PaymentMethod;
    }
    if (query.waiterId) where.waiterId = query.waiterId;

    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { waiter: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(query.dateFrom);
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        (where.createdAt as Prisma.DateTimeFilter).lte = to;
      }
    }

    return where;
  }

  async list(query: OrderQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 10, 50);
    const where = this.buildWhere(query);

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: listInclude,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  /**
   * Сводка по выбранному периоду/фильтрам (для строки итогов под заголовком и внизу таблицы).
   * Статус-фильтр (tab) здесь не применяется — нужна полная разбивка по статусам.
   */
  async summary(query: OrderQueryDto) {
    const base = this.buildWhere(query, false);
    const [total, paid, cancelled, unpaid, revenueAgg] = await Promise.all([
      this.prisma.order.count({ where: base }),
      this.prisma.order.count({ where: { ...base, status: OrderStatus.paid } }),
      this.prisma.order.count({ where: { ...base, status: { in: CANCELLED_STATUSES } } }),
      this.prisma.order.count({ where: { ...base, status: { in: ACTIVE_STATUSES } } }),
      this.prisma.order.aggregate({
        where: { ...base, status: OrderStatus.paid },
        _sum: { finalAmount: true },
      }),
    ]);
    return {
      total,
      paid,
      unpaid,
      cancelled,
      revenue: Number(revenueAgg._sum.finalAmount ?? 0),
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }
}
