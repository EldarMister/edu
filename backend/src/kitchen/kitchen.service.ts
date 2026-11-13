import { BadRequestException, Injectable } from '@nestjs/common';
import { KitchenEventType, OrderItemStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrepStation } from './preparation-stations';
import { PrismaService } from '../prisma/prisma.service';
import { orderInclude } from '../orders/order.helpers';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { AuditService, AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { StopListItemDto } from './dto/stop-list.dto';

export type KitchenTab = 'new' | 'in_work' | 'ready' | 'rejected' | 'cancelled';

/** Waiter/payment stages must never remove completed work from kitchen history. */
const COMPLETED_ORDER_STATUSES: OrderStatus[] = [OrderStatus.served, OrderStatus.waiting_payment, OrderStatus.paid];

/** Статусы заказа, в которых станция может иметь активные позиции. */
const ACTIVE_TAB_STATUSES: OrderStatus[] = [
  OrderStatus.sent_to_kitchen,
  OrderStatus.accepted_by_kitchen,
  OrderStatus.cooking,
  OrderStatus.partially_rejected,
  OrderStatus.ready,
  OrderStatus.picked_up,
  OrderStatus.served,
];

/** Начало сегодняшнего дня (локальное время сервера) — как в статистике «сегодня». */
function startOfToday() {
  const s = new Date();
  s.setHours(0, 0, 0, 0);
  return s;
}

function startOfDay(d: Date) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export type KitchenStatsPeriod = 'today' | 'week' | 'month' | 'all' | 'custom';

/** Имя позиции с вариантом: «Капучино · 0.4 л». */
function itemName(it: { dishNameSnapshot: string; dishVariantNameSnapshot: string | null }) {
  return it.dishVariantNameSnapshot
    ? `${it.dishNameSnapshot} · ${it.dishVariantNameSnapshot}`
    : it.dishNameSnapshot;
}

type StationItem = { status: OrderItemStatus };

type HistoryOrder = {
  status: OrderStatus;
  updatedAt: Date;
  closedAt: Date | null;
};

const HISTORY_ITEM_STATUS: Record<'ready' | 'rejected' | 'cancelled', OrderItemStatus[]> = {
  ready: [OrderItemStatus.ready, OrderItemStatus.served],
  rejected: [OrderItemStatus.rejected],
  cancelled: [OrderItemStatus.cancelled],
};

const HISTORY_EVENT_TYPES = [
  KitchenEventType.ready_item, KitchenEventType.ready_order,
  KitchenEventType.reject_item, KitchenEventType.reject_order, KitchenEventType.cancel,
];

function historyRange(from?: string, to?: string) {
  // The service is used in Kyrgyzstan, where the business day is UTC+06:00.
  const today = new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
  const start = parseHistoryDate(from ?? to ?? today);
  const end = new Date(parseHistoryDate(to ?? from ?? today).getTime() + 86_400_000);
  if (end <= start || end.getTime() - start.getTime() > 31 * 86_400_000) {
    throw new BadRequestException('Выберите период истории не больше 31 дня');
  }
  return { gte: start, lt: end };
}

function parseHistoryDate(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Укажите дату в формате ГГГГ-ММ-ДД');
  }
  const utc = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Укажите действительную дату');
  }
  return new Date(utc.getTime() - 6 * 3_600_000);
}

/**
 * Вкладка станции вычисляется по её собственным позициям — независимо от другой
 * станции. Пусто (нет активных позиций станции) → null (заказ не показываем).
 */
function stationTabOf(items: StationItem[]): Exclude<KitchenTab, 'rejected' | 'cancelled'> | null {
  const active = items.filter(
    (i) => i.status !== OrderItemStatus.rejected && i.status !== OrderItemStatus.cancelled,
  );
  if (active.length === 0) return null;
  // Все позиции «новые» → «Новые». Все готовы → «Завершённые».
  // Иначе заказ уже в работе (в т.ч. если при редактировании добавили новое блюдо
  // к уже принятым) → остаётся в «В работе», а не возвращается в «Новые».
  const allNew = active.every((i) => i.status === OrderItemStatus.new);
  if (allNew) return 'new';
  const allReady = active.every(
    (i) => i.status === OrderItemStatus.ready || i.status === OrderItemStatus.served,
  );
  if (allReady) return 'ready';
  return 'in_work';
}

/** Момент завершения для ленты кухни: для оплаченных — закрытие, иначе — обновление. */
function kitchenHistoryAt(order: HistoryOrder): Date {
  return order.status === OrderStatus.paid || order.status === OrderStatus.cancelled
    ? (order.closedAt ?? order.updatedAt)
    : order.updatedAt;
}

@Injectable()
export class KitchenService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private audit: AuditService,
  ) {}

  async findByTab(tab: KitchenTab, station: PrepStation = PrepStation.kitchen, from?: string, to?: string) {
    if (tab === 'ready' || tab === 'rejected' || tab === 'cancelled') {
      return this.stationHistory(tab, station, from, to);
    }
    if (tab !== 'new' && tab !== 'in_work') throw new BadRequestException('Неизвестная вкладка станции');
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ACTIVE_TAB_STATUSES },
        items: {
          some: {
            prepStation: station,
            status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      include: orderInclude,
    });

    return orders
      .map((o) => ({ ...o, items: o.items.filter((i) => i.prepStation === station) }))
      .filter((o) => stationTabOf(o.items) === tab);
  }

  private async stationHistory(tab: keyof typeof HISTORY_ITEM_STATUS, station: PrepStation, from?: string, to?: string) {
    const range = historyRange(from, to);
    const itemStatuses = HISTORY_ITEM_STATUS[tab];
    const itemWhere: Prisma.OrderItemWhereInput = { prepStation: station, status: { in: itemStatuses } };
    const legacyTerminalStatus = tab === 'ready' ? undefined : tab;
    const orders = await this.prisma.order.findMany({
      where: {
        OR: [
          { items: { some: { ...itemWhere, updatedAt: range } } },
          { items: { some: itemWhere }, kitchenEvents: { some: { type: { in: HISTORY_EVENT_TYPES }, createdAt: range } } },
          { items: { some: itemWhere }, updatedAt: range },
          ...(legacyTerminalStatus ? [{ status: legacyTerminalStatus, items: { some: { prepStation: station } }, OR: [{ closedAt: range }, { closedAt: null, updatedAt: range }] }] : []),
        ],
      },
      include: {
        ...orderInclude,
        items: { ...orderInclude.items, where: { prepStation: station }, select: { ...orderInclude.items.select, updatedAt: true } },
        kitchenEvents: {
          where: { type: { in: HISTORY_EVENT_TYPES } },
          select: { type: true, orderItemId: true, prepStation: true, createdAt: true, reason: true },
        },
      },
    });

    return orders.flatMap(({ kitchenEvents, ...order }) => {
      const stationItems = order.items.filter((item) => item.prepStation === station);
      const matching = stationItems.filter((item) => itemStatuses.includes(item.status));
      const legacy = !matching.length && order.status === legacyTerminalStatus;
      if (!matching.length && !legacy) return [];
      if (tab === 'ready' && !COMPLETED_ORDER_STATUSES.includes(order.status) && stationTabOf(stationItems) !== 'ready') return [];

      const eventsByItem = new Map<string, typeof kitchenEvents[number]>();
      const eventType = tab === 'ready' ? KitchenEventType.ready_item : tab === 'rejected' ? KitchenEventType.reject_item : KitchenEventType.cancel;
      const orderEventType = tab === 'ready' ? KitchenEventType.ready_order : tab === 'rejected' ? KitchenEventType.reject_order : null;
      let orderEvent: typeof kitchenEvents[number] | undefined;
      for (const event of kitchenEvents) {
        if (event.prepStation && event.prepStation !== station) continue;
        if (event.type === orderEventType && (!orderEvent || event.createdAt > orderEvent.createdAt)) orderEvent = event;
        if (event.type !== eventType || !event.orderItemId) continue;
        const previous = eventsByItem.get(event.orderItemId);
        if (!previous || event.createdAt > previous.createdAt) eventsByItem.set(event.orderItemId, event);
      }

      const items = legacy ? stationItems : matching;
      const at = (item: typeof items[number]) => (eventsByItem.get(item.id) ?? orderEvent)?.createdAt
        ?? (legacy || order.status === legacyTerminalStatus ? kitchenHistoryAt(order) : item.updatedAt ?? kitchenHistoryAt(order));
      const visible = tab === 'ready' ? items : items.filter((item) => at(item) >= range.gte && at(item) < range.lt);
      if (!visible.length) return [];
      const stationHistoryAt = new Date(Math.max(...visible.map((item) => at(item).getTime())));
      if (stationHistoryAt < range.gte || stationHistoryAt >= range.lt) return [];
      return [{
        ...order,
        items: visible.map((item) => ({
          ...item,
          rejectReason: (eventsByItem.get(item.id) ?? orderEvent)?.reason ?? item.rejectReason ?? null,
        })),
        stationHistoryAt,
      }];
    }).sort((a, b) => b.stationHistoryAt.getTime() - a.stationHistoryAt.getTime() || a.id.localeCompare(b.id));
  }

  /**
   * Стоп-лист станции: активные блюда по категориям с текущей доступностью,
   * только те, что относятся к станции (направление блюда, иначе — категории).
   */
  async getStopList(station: PrepStation = PrepStation.kitchen) {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        prepStation: true,
        dishes: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, isAvailable: true, prepStation: true },
        },
      },
    });
    return categories
      .map((c) => ({
        id: c.id,
        name: c.name,
        dishes: c.dishes
          .filter((d) => (d.prepStation ?? c.prepStation) === station)
          .map((d) => ({ id: d.id, name: d.name, isAvailable: d.isAvailable })),
      }))
      .filter((c) => c.dishes.length > 0);
  }

  /** Сохраняет доступность блюд. Меняет только изменившиеся, пишет аудит, шлёт realtime. */
  async updateStopList(actor: AuditActor, items: StopListItemDto[], station: PrepStation = PrepStation.kitchen) {
    const ids = [...new Set(items.map((i) => i.dishId))];
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: ids }, isActive: true, OR: [{ prepStation: station }, { prepStation: null, category: { prepStation: station } }] },
      select: { id: true, name: true, isAvailable: true },
    });
    if (dishes.length !== ids.length) throw new BadRequestException('Одно из блюд не относится к этой станции');
    const byId = new Map(dishes.map((d) => [d.id, d]));

    // Применяем только реальные изменения, чтобы не плодить лишний аудит.
    const changes = items.filter((i) => {
      const dish = byId.get(i.dishId);
      return dish && dish.isAvailable !== i.isAvailable;
    });

    if (changes.length > 0) {
      await this.prisma.$transaction(
        changes.map((c) =>
          this.prisma.dish.update({
            where: { id: c.dishId },
            data: { isAvailable: c.isAvailable },
          }),
        ),
      );

      // Меню изменилось — официанты обновят доступность блюд без перезагрузки.
      this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { source: 'stop-list' });

      for (const c of changes) {
        const dish = byId.get(c.dishId)!;
        await this.audit.log({
          actor,
          actionType: AuditAction.MENU_ITEM_AVAILABILITY_CHANGED,
          entityType: AuditEntity.MENU_ITEM,
          entityId: c.dishId,
          description: `${actor.name ?? 'Сотрудник'} сделал блюдо «${dish.name}» ${
            c.isAvailable ? 'доступным' : 'недоступным'
          }`,
          oldValue: { isAvailable: dish.isAvailable },
          newValue: { isAvailable: c.isAvailable },
        });
      }
    }

    return this.getStopList(station);
  }

  /** Диапазон периода статистики кухни. Для «всё время» нижней границы нет. */
  private resolveStatsRange(
    period: KitchenStatsPeriod,
    from?: string,
    to?: string,
  ): { from: Date | null; to: Date | null } {
    const today = startOfToday();
    const endOfToday = addDays(today, 1);
    if (period === 'today') return { from: today, to: endOfToday };
    if (period === 'week') return { from: addDays(today, -6), to: endOfToday };
    if (period === 'month') return { from: addDays(today, -29), to: endOfToday };
    if (period === 'custom') {
      return {
        from: startOfDay(parseDate(from, addDays(today, -6))),
        to: addDays(startOfDay(parseDate(to, today)), 1),
      };
    }
    return { from: null, to: null };
  }

  /**
   * Статистика станции (кухня/бар): приготовленные блюда, время приготовления,
   * отказы и распределение по часам — за выбранный период.
   *
   * Время приготовления позиции = момент готовности (событие ready_item) минус
   * момент принятия заказа станцией (первое событие accept по заказу).
   */
  async statistics(
    period: KitchenStatsPeriod = 'today',
    from: string | undefined,
    to: string | undefined,
    station: PrepStation = PrepStation.kitchen,
  ) {
    const range = this.resolveStatsRange(period, from, to);
    const createdAtWhere =
      range.from || range.to ? { gte: range.from ?? undefined, lt: range.to ?? undefined } : undefined;

    // Готовые позиции за период (по событиям). Дедупликация по позиции — берём
    // последний момент готовности (актуально для сетов, где состав отмечают по частям).
    const readyEvents = await this.prisma.kitchenEvent.findMany({
      where: { type: KitchenEventType.ready_item, orderItemId: { not: null }, createdAt: createdAtWhere },
      select: { orderItemId: true, orderId: true, createdAt: true },
    });
    const readyByItem = new Map<string, Date>();
    const orderIds = new Set<string>();
    for (const e of readyEvents) {
      const id = e.orderItemId!;
      const cur = readyByItem.get(id);
      if (!cur || e.createdAt > cur) readyByItem.set(id, e.createdAt);
      orderIds.add(e.orderId);
    }

    // Момент принятия заказа станцией — первое событие accept по заказу.
    const acceptEvents = orderIds.size
      ? await this.prisma.kitchenEvent.findMany({
          where: { type: KitchenEventType.accept, orderId: { in: [...orderIds] }, OR: [{ prepStation: station }, { prepStation: null }] },
          select: { orderId: true, createdAt: true },
        })
      : [];
    const acceptByOrder = new Map<string, Date>();
    for (const e of acceptEvents) {
      const cur = acceptByOrder.get(e.orderId);
      if (!cur || e.createdAt < cur) acceptByOrder.set(e.orderId, e.createdAt);
    }

    // Позиции станции (исключаем отказанные/отменённые).
    const items = readyByItem.size
      ? await this.prisma.orderItem.findMany({
          where: {
            id: { in: [...readyByItem.keys()] },
            prepStation: station,
            status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] },
          },
          select: {
            id: true,
            orderId: true,
            dishNameSnapshot: true,
            dishVariantNameSnapshot: true,
            finalPrice: true,
            quantity: true,
          },
        })
      : [];

    type DishAgg = {
      name: string;
      count: number;
      revenue: number;
      timedSum: number;
      timedCount: number;
      minMs: number;
      maxMs: number;
    };
    const dishMap = new Map<string, DishAgg>();
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, revenue: 0 }));
    // Количество приготовленных по дням — для «в среднем в день» и «максимум за день».
    const preparedPerDay = new Map<string, number>();
    let preparedTotal = 0;
    let revenueTotal = 0;
    let prepSum = 0;
    let prepCount = 0;

    for (const it of items) {
      const name = itemName(it);
      const revenue = Number(it.finalPrice);
      const readyAt = readyByItem.get(it.id)!;
      const acceptAt = acceptByOrder.get(it.orderId);
      const ms = acceptAt ? readyAt.getTime() - acceptAt.getTime() : -1;
      const timed = ms >= 0;

      const cur =
        dishMap.get(name) ??
        { name, count: 0, revenue: 0, timedSum: 0, timedCount: 0, minMs: Infinity, maxMs: 0 };
      cur.count += it.quantity;
      cur.revenue += revenue;
      if (timed) {
        cur.timedSum += ms;
        cur.timedCount += 1;
        cur.minMs = Math.min(cur.minMs, ms);
        cur.maxMs = Math.max(cur.maxMs, ms);
      }
      dishMap.set(name, cur);

      preparedTotal += it.quantity;
      revenueTotal += revenue;
      const day = `${readyAt.getFullYear()}-${readyAt.getMonth()}-${readyAt.getDate()}`;
      preparedPerDay.set(day, (preparedPerDay.get(day) ?? 0) + it.quantity);
      if (timed) {
        prepSum += ms;
        prepCount += 1;
      }

      const h = readyAt.getHours();
      hourly[h].count += it.quantity;
      hourly[h].revenue += revenue;
    }

    const toMin = (ms: number) => Math.round(ms / 60000);
    const dishes = [...dishMap.values()].map((d) => ({
      name: d.name,
      count: d.count,
      revenue: d.revenue,
      avgMin: d.timedCount > 0 ? toMin(d.timedSum / d.timedCount) : 0,
      minMin: d.timedCount > 0 ? toMin(d.minMs) : 0,
      maxMin: d.timedCount > 0 ? toMin(d.maxMs) : 0,
      timed: d.timedCount > 0,
    }));

    // Отказы по блюдам станции — события reject_item за период.
    const rejectEvents = await this.prisma.kitchenEvent.findMany({
      where: { type: KitchenEventType.reject_item, orderItemId: { not: null }, createdAt: createdAtWhere },
      select: { orderItemId: true },
    });
    const rejectIds = [...new Set(rejectEvents.map((e) => e.orderItemId!))];
    const rejectItemsList = rejectIds.length
      ? await this.prisma.orderItem.findMany({
          where: { id: { in: rejectIds }, prepStation: station },
          select: { id: true, dishNameSnapshot: true, dishVariantNameSnapshot: true },
        })
      : [];
    const rejectNameById = new Map(rejectItemsList.map((it) => [it.id, itemName(it)]));
    const rejectMap = new Map<string, number>();
    let rejectionsTotal = 0;
    for (const e of rejectEvents) {
      const name = rejectNameById.get(e.orderItemId!);
      if (!name) continue; // позиция не этой станции
      rejectMap.set(name, (rejectMap.get(name) ?? 0) + 1);
      rejectionsTotal += 1;
    }
    const rejections = [...rejectMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const activeDays = preparedPerDay.size;
    const prepared = {
      total: preparedTotal,
      avgPerDay: activeDays > 0 ? Math.round(preparedTotal / activeDays) : 0,
      uniqueDishes: dishMap.size,
      maxPerDay: activeDays > 0 ? Math.max(...preparedPerDay.values()) : 0,
    };

    return {
      cards: {
        revenue: revenueTotal,
        prepared: preparedTotal,
        rejections: rejectionsTotal,
        avgPrepMin: prepCount > 0 ? toMin(prepSum / prepCount) : 0,
      },
      prepared,
      dishes,
      rejections,
      hourly,
      period,
      range: {
        from: range.from?.toISOString() ?? null,
        to: range.to?.toISOString() ?? null,
      },
    };
  }
}
