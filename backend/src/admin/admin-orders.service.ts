import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderItemStatus, OrderStatus, PaymentMethod, PaymentStatus, Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { hasPermission, resolvePermissions } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { orderInclude } from '../orders/order.helpers';
import { netOrderAmount, netPaymentAmount } from '../orders/order-net';
import { preparedLossQuantity } from '../warehouse/movement-cost';
import { warehouseDateRange } from '../warehouse/report-range';
import { baseUnitForType, fromBase, unitLabel, unitType, type UnitCode } from '../warehouse/units';
import { OrderExportQueryDto, OrderQueryDto } from './dto';
import { receiptExportSelect, receiptExportItems, writeReceiptWorkbook } from './receipt-export-xlsx';

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
const STOCK_UNITS: readonly UnitCode[] = ['g', 'kg', 'ml', 'l', 'pcs'];
const TENDERS = [PaymentMethod.cash, PaymentMethod.card, PaymentMethod.qr];

function getTender(method?: string): PaymentMethod | undefined {
  return TENDERS.find((tender) => tender === method);
}

function legacyTender(method: PaymentMethod): Prisma.OrderWhereInput {
  return { paymentMethod: method, payments: { none: {} } };
}

const receiptInclude = {
  ...orderInclude,
  payments: {
    ...orderInclude.payments,
    where: { status: { in: [PaymentStatus.paid, PaymentStatus.refunded] } },
  },
} satisfies Prisma.OrderInclude;

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function receiptOrderBy(query: OrderQueryDto): Prisma.OrderOrderByWithRelationInput[] {
  const sort = query.sort;
  if (sort === 'amount_asc' || sort === 'amount_desc' || sort === 'amount') {
    const ascending = sort === 'amount_asc' || (sort === 'amount' && query.sortDirection === 'asc');
    return [{ finalAmount: ascending ? 'asc' : 'desc' }, { id: 'asc' }];
  }
  const direction = sort === 'date_asc' || (sort === 'date' && query.sortDirection === 'asc') ? 'asc' : 'desc';
  const byDate: Prisma.OrderOrderByWithRelationInput = query.dateField === 'closed'
    ? { closedAt: { sort: direction, nulls: 'last' } }
    : { createdAt: direction };
  return [byDate, { id: 'asc' }];
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

  private buildWhere(query: OrderQueryDto): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};

    if (query.tab === 'active') where.status = { in: ACTIVE_STATUSES };
    else if (query.tab === 'paid') where.status = OrderStatus.paid;
    else if (query.tab === 'cancelled') where.status = { in: CANCELLED_STATUSES };

    const tender = getTender(query.paymentMethod);
    if (tender) {
      where.AND = [{ OR: [
        { payments: { some: { method: tender, status: { in: [PaymentStatus.paid, PaymentStatus.refunded] } } } },
        legacyTender(tender),
      ] }];
    } else if (query.paymentMethod === PaymentMethod.mixed) {
      where.paymentMethod = PaymentMethod.mixed;
    }
    if (query.waiterId) where.waiterId = query.waiterId;

    const search = query.search?.trim();
    if (search) {
      const contains = { contains: search, mode: Prisma.QueryMode.insensitive };
      where.OR = [
        { orderNumber: contains },
        { waiter: { name: contains } },
        { externalOrderId: contains },
        { deliveryCustomerName: contains },
        { deliveryCustomerPhone: contains },
        { items: { some: {
          status: { notIn: [OrderItemStatus.cancelled, OrderItemStatus.rejected] },
          OR: [{ dishNameSnapshot: contains }, { dishVariantNameSnapshot: contains }],
        } } },
      ];
    }

    if (query.dateField === 'closed') {
      const range = warehouseDateRange(query.dateFrom, query.dateTo);
      if (range) where.closedAt = range;
    } else if (query.dateFrom || query.dateTo) {
      const calendarDate = /^\d{4}-\d{2}-\d{2}$/;
      if ((!query.dateFrom || calendarDate.test(query.dateFrom)) && (!query.dateTo || calendarDate.test(query.dateTo))) {
        where.createdAt = warehouseDateRange(query.dateFrom, query.dateTo);
        return where;
      }
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
        orderBy: receiptOrderBy(query),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: receiptInclude,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async waiters() {
    return this.prisma.user.findMany({
      where: { orders: { some: {} } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
  }

  async exportOrders(query: OrderExportQueryDto) {
    const includeDetails = query.includeDetails === 'true';
    const orders = await this.prisma.order.findMany({
      where: this.buildWhere(query),
      orderBy: receiptOrderBy(query),
      select: { ...receiptExportSelect, items: includeDetails ? receiptExportItems : false },
    });
    return writeReceiptWorkbook(orders, includeDetails);
  }

  async summary(query: OrderQueryDto) {
    const base = this.buildWhere(query);
    const withStatus = (status: Prisma.OrderWhereInput['status']): Prisma.OrderWhereInput => ({ AND: [base, { status }] });
    const closed = withStatus(OrderStatus.paid);
    const tender = getTender(query.paymentMethod);
    const [total, paid, cancelled, unpaid, revenueAgg, tenderRevenue] = await Promise.all([
      this.prisma.order.count({ where: base }),
      this.prisma.order.count({ where: closed }),
      this.prisma.order.count({ where: withStatus({ in: CANCELLED_STATUSES }) }),
      this.prisma.order.count({ where: withStatus({ in: ACTIVE_STATUSES }) }),
      this.prisma.order.aggregate({
        where: closed,
        _sum: { finalAmount: true, refundedAmount: true },
      }),
      tender ? this.tenderRevenue(closed, tender) : null,
    ]);
    return {
      total,
      paid,
      unpaid,
      cancelled,
      revenue: netOrderAmount({ finalAmount: revenueAgg._sum.finalAmount ?? 0, refundedAmount: revenueAgg._sum.refundedAmount }).toNumber(),
      tenderRevenue,
    };
  }

  private async tenderRevenue(closed: Prisma.OrderWhereInput, method: PaymentMethod) {
    const [payments, legacy] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { order: closed, method, status: PaymentStatus.paid },
        _sum: { amount: true, refundedAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { ...closed, ...legacyTender(method) },
        _sum: { finalAmount: true, refundedAmount: true },
      }),
    ]);
    return netPaymentAmount({ amount: payments._sum.amount ?? 0, refundedAmount: payments._sum.refundedAmount })
      .add(netOrderAmount({ finalAmount: legacy._sum.finalAmount ?? 0, refundedAmount: legacy._sum.refundedAmount })).toNumber();
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: receiptInclude });
    if (!order) throw new NotFoundException('Заказ не найден');
    return order;
  }

  async stockMovements(id: string, user: AuthUser) {
    const cafeId = user.cafeId;
    const canViewCosts = user.role === Role.OWNER
      || hasPermission(user.permissions ?? resolvePermissions(user.role as Role, null), 'actions.warehouseCosts');
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, cafeId }, select: { id: true } });
      if (!order) throw new NotFoundException('Заказ не найден');
      const [movements, defaultWarehouse] = await Promise.all([
        tx.stockMovement.findMany({
          where: { cafeId, sourceType: 'order', sourceId: order.id, type: { in: ['sale', 'return', 'writeoff'] }, ingredient: { cafeId },
            ...(cafeId ? { OR: [{ warehouseId: null }, { warehouse: { cafeId } }] } : { warehouseId: null }) },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, type: true, sourceType: true, change: true, createdAt: true,
            costAtMoment: canViewCosts, costKnown: canViewCosts, recipeSnapshot: true,
            warehouse: { select: { name: true } }, ingredient: { select: { name: true, unitType: true, displayUnit: true } } },
        }),
        cafeId ? tx.warehouse.findFirst({ where: { cafeId, isDefault: true }, select: { name: true } }) : null,
      ]);
      let total = new Prisma.Decimal(0);
      let complete = true;
      const rows = movements.map((movement) => {
        const loss = preparedLossQuantity(movement);
        const preparedLoss = loss.gt(0) && movement.change.isZero();
        const { ingredient } = movement;
        const display = STOCK_UNITS.find((unit) => unit === ingredient.displayUnit);
        const unit = display && unitType(display) === ingredient.unitType ? display : baseUnitForType(ingredient.unitType);
        let lineCost: number | null = null;
        if (canViewCosts && !preparedLoss) {
          if (movement.costKnown && movement.costAtMoment != null) {
            const cost = movement.change.negated().mul(movement.costAtMoment);
            total = total.add(cost);
            lineCost = cost.toDecimalPlaces(2).toNumber();
          } else if (!movement.change.isZero()) complete = false;
        }
        return { id: movement.id, type: preparedLoss ? 'prepared-loss' as const : movement.type,
          occurredAt: movement.createdAt, name: ingredient.name,
          warehouseName: movement.warehouse?.name ?? defaultWarehouse?.name ?? 'Основной склад',
          unit: unitLabel(unit), quantity: fromBase((preparedLoss ? loss : movement.change).toNumber(), unit), lineCost };
      });
      return { rows, canViewCosts, totalCost: canViewCosts && complete && rows.length ? total.toDecimalPlaces(2).toNumber() : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
