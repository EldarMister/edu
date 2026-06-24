import { Injectable } from '@nestjs/common';
import { OrderItemStatus, OrderStatus, PrepStation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { orderInclude } from '../orders/order.helpers';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { AuditService, AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { StopListItemDto } from './dto/stop-list.dto';

export type KitchenTab = 'new' | 'in_work' | 'ready' | 'rejected';

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

/** Отказанные заказы видны в ленте кухни только последние 24 часа. */
const KITCHEN_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Начало сегодняшнего дня (локальное время сервера) — как в статистике «сегодня». */
function startOfToday() {
  const s = new Date();
  s.setHours(0, 0, 0, 0);
  return s;
}

type StationItem = { status: OrderItemStatus };

type HistoryOrder = {
  status: OrderStatus;
  updatedAt: Date;
  closedAt: Date | null;
};

/**
 * Вкладка станции вычисляется по её собственным позициям — независимо от другой
 * станции. Пусто (нет активных позиций станции) → null (заказ не показываем).
 */
function stationTabOf(items: StationItem[]): Exclude<KitchenTab, 'rejected'> | null {
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
  return order.status === OrderStatus.paid ? (order.closedAt ?? order.updatedAt) : order.updatedAt;
}

function isRecentKitchenHistory(order: HistoryOrder, cutoff: Date) {
  return kitchenHistoryAt(order) >= cutoff;
}

@Injectable()
export class KitchenService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private audit: AuditService,
  ) {}

  async findByTab(tab: KitchenTab, station: PrepStation = PrepStation.kitchen) {
    const historyCutoff = new Date(Date.now() - KITCHEN_HISTORY_WINDOW_MS);

    if (tab === 'rejected') {
      const orders = await this.prisma.order.findMany({
        where: { status: OrderStatus.rejected, items: { some: { prepStation: station } } },
        orderBy: { createdAt: 'asc' },
        include: orderInclude,
      });
      return orders
        .filter((o) => isRecentKitchenHistory(o, historyCutoff))
        .map((o) => ({ ...o, items: o.items.filter((i) => i.prepStation === station) }));
    }

    const statusWhere =
      tab === 'ready'
        ? {
            OR: [
              { status: { in: ACTIVE_TAB_STATUSES } },
              { status: OrderStatus.paid },
            ],
          }
        : { status: { in: ACTIVE_TAB_STATUSES } };

    const orders = await this.prisma.order.findMany({
      where: {
        ...statusWhere,
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

    // Оставляем только позиции станции и раскладываем по вкладке станции.
    // Оплаченные заказы (все позиции готовы/поданы) попадают в «Завершённые».
    // Завершённые показываем только за сегодня и сортируем: недавние сверху, старые снизу.
    const todayStart = startOfToday();
    const list = orders
      .map((o) => ({ ...o, items: o.items.filter((i) => i.prepStation === station) }))
      .filter((o) => o.status === OrderStatus.paid ? tab === 'ready' : stationTabOf(o.items) === tab)
      .filter((o) => tab === 'ready' ? isRecentKitchenHistory(o, todayStart) : true);

    if (tab === 'ready') {
      list.sort((a, b) => kitchenHistoryAt(b).getTime() - kitchenHistoryAt(a).getTime());
    }
    return list;
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
  async updateStopList(actor: AuditActor, items: StopListItemDto[]) {
    const ids = [...new Set(items.map((i) => i.dishId))];
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true, isAvailable: true },
    });
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

    return this.getStopList();
  }
}
