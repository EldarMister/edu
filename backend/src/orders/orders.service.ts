import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderItemStatus,
  OrderStatus,
  PaymentMethod,
  PaymentSource,
  PaymentStatus,
  Prisma,
  PrepStation,
  Role,
  TableStatus,
  KitchenEventType,
  WaiterShiftStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { WaiterShiftsService } from '../waiter-shifts/waiter-shifts.service';
import { PushService } from '../push/push.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { CreateOrderDto, CreateOrderItemDto } from './dto/create-order.dto';
import { orderInclude, unitPricing, round2 } from './order.helpers';
import { buildNewOrderText, buildChangedText, buildCancelText, buildEditVoiceText } from '../tts/kitchen-voice';

/** Статусы «живого» заказа, который занимает стол. */
const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.sent_to_kitchen,
  OrderStatus.accepted_by_kitchen,
  OrderStatus.cooking,
  OrderStatus.ready,
  OrderStatus.picked_up,
  OrderStatus.served,
  OrderStatus.waiting_payment,
  OrderStatus.partially_rejected,
];

const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  [PaymentMethod.qr]: 'QR',
  [PaymentMethod.cash]: 'Наличные',
  [PaymentMethod.card]: 'Карта',
  [PaymentMethod.mixed]: 'Смешанная',
};

const PARTIAL_REJECTION_PENDING_MESSAGE =
  'Ожидается решение официанта по частичному отказу';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private shifts: WaiterShiftsService,
    private push: PushService,
    private settings: SettingsService,
    private audit: AuditService,
  ) {}

  /** Денежный формат для человекочитаемых описаний аудита. */
  private money(value: unknown): string {
    return `${Number(value)} с`;
  }

  // ---------- Чтение ----------

  findById(id: string) {
    return this.prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
  }

  async findByIdForActor(id: string, actor: AuditActor) {
    const order = await this.findById(id);
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    return order;
  }

  /** Активные заказы официанта (не закрытые). */
  findActiveForWaiter(waiterId: string) {
    return this.prisma.order.findMany({
      where: {
        waiterId,
        // rejected/cancelled заказы завершены и не должны числиться активными за столом.
        status: { notIn: [OrderStatus.paid, OrderStatus.cancelled, OrderStatus.rejected] },
      },
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
  }

  /**
   * Сводка для личного кабинета официанта: статистика за 7 дней
   * (завершено / отменено / выручка) и последние заказы.
   */
  async waiterCabinet(waiterId: string, period: 'day' | 'week' | 'month' = 'week') {
    const since = new Date();
    if (period === 'day') {
      since.setDate(since.getDate() - 1);
    } else if (period === 'month') {
      since.setMonth(since.getMonth() - 1);
    } else {
      since.setDate(since.getDate() - 7);
    }

    const [completed, cancelled, revenue, recent] = await Promise.all([
      this.prisma.order.count({
        where: { waiterId, status: OrderStatus.paid, createdAt: { gte: since } },
      }),
      this.prisma.order.count({
        where: { waiterId, status: OrderStatus.cancelled, createdAt: { gte: since } },
      }),
      this.prisma.order.aggregate({
        _sum: { finalAmount: true },
        where: { waiterId, status: OrderStatus.paid, createdAt: { gte: since } },
      }),
      this.prisma.order.findMany({
        where: { waiterId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          orderNumber: true,
          finalAmount: true,
          status: true,
          createdAt: true,
          table: { select: { number: true } },
        },
      }),
    ]);

    return {
      stats: {
        completed,
        cancelled,
        revenue: String(revenue._sum.finalAmount ?? 0),
      },
      recentOrders: recent.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        tableNumber: o.table.number,
        finalAmount: String(o.finalAmount),
        status: o.status,
        createdAt: o.createdAt,
      })),
    };
  }

  // ---------- Создание заказа (официант → кухня) ----------

  async create(actor: AuditActor, dto: CreateOrderDto) {
    const waiterId = actor.id;
    // Идемпотентность: повтор того же запроса вернёт уже созданный заказ.
    if (dto.idempotencyKey) {
      const existing = await this.prisma.order.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        include: orderInclude,
      });
      if (existing) {
        return existing;
      }
    }

    await this.shifts.getRequiredActiveShift(waiterId);

    const table = await this.prisma.table.findUnique({ where: { id: dto.tableId } });
    if (!table || !table.isActive) {
      throw new NotFoundException('Стол не найден');
    }

    const activeOrder = await this.activeOrderForTable(dto.tableId);
    if (activeOrder) {
      throw new BadRequestException('У этого стола уже есть активный заказ');
    }

    const { itemsData, dishDeductions, variantDeductions } = await this.buildItemsData(dto.items);

    // Есть ли позиции, которые реально уходят на станцию (кухня/бар).
    // Заказ только из «Без отправки» сразу готов: на кухню/бар ничего не шлём.
    const hasPrep = itemsData.some((i) => i.prepStation !== PrepStation.none);
    const initialStatus = hasPrep ? OrderStatus.sent_to_kitchen : OrderStatus.ready;
    const initialTableStatus = hasPrep ? TableStatus.sent_to_kitchen : TableStatus.ready;

    let order: Awaited<ReturnType<typeof this.findById>>;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const activeShift = await this.shifts.getRequiredActiveShift(waiterId, tx);
        const serviceChargeAmount = await this.currentServiceChargeAmount(tx);
        const totals = this.calcTotals(itemsData, serviceChargeAmount);
        const businessDate = this.businessDateOf();
        const orderNumber = await this.nextOrderNumber(tx, businessDate);
        await tx.table.update({
          where: { id: dto.tableId },
          data: { status: initialTableStatus },
        });
        await this.deductInventory(tx, dishDeductions, variantDeductions);
        return tx.order.create({
          data: {
            orderNumber,
            businessDate,
            tableId: dto.tableId,
            waiterId,
            waiterShiftId: activeShift.id,
            status: initialStatus,
            comment: dto.comment,
            idempotencyKey: dto.idempotencyKey,
            totalAmount: totals.total,
            discountAmount: totals.discount,
            serviceChargeAmount: totals.serviceCharge,
            finalAmount: totals.final,
            items: { create: itemsData },
          },
          include: orderInclude,
        });
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        if (dto.idempotencyKey) {
          const existing = await this.prisma.order.findUnique({
            where: { idempotencyKey: dto.idempotencyKey },
            include: orderInclude,
          });
          if (existing) return existing;
        }
        if (await this.activeOrderForTable(dto.tableId)) {
          throw new BadRequestException('У этого стола уже есть активный заказ');
        }
      }
      throw err;
    }

    // Real-time: кухня получает новый заказ только если есть что готовить.
    if (hasPrep) {
      this.events.emitToKitchen(SERVER_EVENTS.KITCHEN_NEW_ORDER, {
        ...order,
        voice: { text: buildNewOrderText(order) },
      });
      this.events.emitToKitchen(SERVER_EVENTS.ORDER_NEW, order);
      void this.notifyKitchenNewOrder(order);
    }
    this.events.emitBroadcast(SERVER_EVENTS.TABLE_STATUS_CHANGED, {
      id: table.id,
      number: table.number,
      status: initialTableStatus,
      hallId: table.hallId,
    });
    // Уведомление официанту об отправке показывается локально на фронте (мгновенно).

    await this.audit.log({
      actor,
      actionType: AuditAction.ORDER_CREATED,
      entityType: AuditEntity.ORDER,
      entityId: order.id,
      orderId: order.id,
      tableId: order.tableId,
      description: `${actor.name ?? 'Сотрудник'} создал заказ ${order.orderNumber} на столе ${table.number}, сумма ${this.money(order.finalAmount)}`,
      newValue: { orderNumber: order.orderNumber, finalAmount: Number(order.finalAmount) },
      metadata: { tableNumber: table.number, itemsCount: order.items.length },
    });

    return order;
  }

  /** Отмена заказа официантом/админом/владельцем с причиной (audit обязателен). */
  async cancelOrder(orderId: string, actor: AuditActor, reason?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    if (([OrderStatus.paid, OrderStatus.cancelled] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Заказ уже закрыт и не может быть отменён');
    }
    // Официант может отменить заказ в любом активном статусе (включая принятый кухней).
    // Единственное ограничение — заказ уже оплачен или отменён (проверено выше).
    // Статус waiting_payment и served — только администратор/владелец.
    const adminOnly: OrderStatus[] = [OrderStatus.waiting_payment, OrderStatus.served];
    if (actor.role === Role.WAITER && adminOnly.includes(order.status)) {
      throw new BadRequestException(
        'Отмена заказа на этом этапе доступна только администратору',
      );
    }

    const prevStatus = order.status;
    const updated = await this.prisma.$transaction(async (tx) => {
      const itemsToCancel = order.items.filter(item => 
        ![OrderItemStatus.rejected, OrderItemStatus.cancelled, OrderItemStatus.served].includes(item.status as any)
      );
      await this.restoreInventory(tx, itemsToCancel);
      await tx.orderItem.updateMany({
        where: { orderId, status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled, OrderItemStatus.served] } },
        data: { status: OrderItemStatus.cancelled },
      });
      // Освобождаем стол.
      await tx.table.update({ where: { id: order.tableId }, data: { status: TableStatus.free } });
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.cancelled, requiresWaiterDecision: false, closedAt: new Date() },
        include: orderInclude,
      });
    });

    this.emitStatusChanged(updated);
    this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.free, updated.table.hallId);

    await this.audit.log({
      actor,
      actionType: AuditAction.ORDER_CANCELLED,
      entityType: AuditEntity.ORDER,
      entityId: order.id,
      orderId: order.id,
      tableId: order.tableId,
      description:
        `${actor.name ?? 'Сотрудник'} отменил заказ ${order.orderNumber} на столе ${order.table.number}, сумма ${this.money(order.finalAmount)}` +
        (reason ? ` · причина: ${reason}` : ''),
      oldValue: { status: prevStatus },
      newValue: { status: OrderStatus.cancelled },
      metadata: {
        reason: reason ?? null,
        amount: Number(order.finalAmount),
        tableNumber: order.table.number,
        orderNumber: order.orderNumber,
      },
    });

    return updated;
  }

  /** Подпись позиции для сопоставления старого и нового состава при редактировании. */
  private editItemSig(
    dishId: string | null | undefined,
    variantId: string | null | undefined,
    comment: string | null | undefined,
    comps:
      | {
          action: string;
          originalDishId: string | null;
          finalDishId: string | null;
          originalVariantNameSnapshot: string | null;
          quantity: number;
        }[]
      | undefined,
  ): string {
    const base = `${dishId ?? ''}|${variantId ?? ''}|${(comment ?? '').trim()}`;
    if (!comps || comps.length === 0) return base;
    const sig = comps
      .map(
        (c) =>
          `${c.action}:${c.originalDishId ?? ''}:${c.finalDishId ?? ''}:${c.originalVariantNameSnapshot ?? ''}:${c.quantity}`,
      )
      .sort()
      .join(',');
    return `${base}|set[${sig}]`;
  }

  /**
   * Переносит статус кухни (принято/готовится/готово/подано) с неизменных старых позиций
   * на соответствующие новые. Реально новые/заменённые позиции остаются «new». Мутирует
   * статусы внутри itemsData (и блюд состава сета).
   */
  private carryItemProgress(
    oldItems: {
      dishId: string | null;
      dishVariantId: string | null;
      comment: string | null;
      status: OrderItemStatus;
      setComponents: {
        action: string;
        originalDishId: string | null;
        finalDishId: string | null;
        originalVariantNameSnapshot: string | null;
        quantity: number;
      }[];
    }[],
    itemsData: Prisma.OrderItemUncheckedCreateWithoutOrderInput[],
  ) {
    const PROGRESS: OrderItemStatus[] = [
      OrderItemStatus.accepted,
      OrderItemStatus.cooking,
      OrderItemStatus.ready,
      OrderItemStatus.served,
    ];
    // Пул статусов старых позиций по подписи (может быть несколько одинаковых).
    const pool = new Map<string, OrderItemStatus[]>();
    for (const it of oldItems) {
      const sig = this.editItemSig(it.dishId, it.dishVariantId, it.comment, it.setComponents);
      const arr = pool.get(sig) ?? [];
      arr.push(it.status);
      pool.set(sig, arr);
    }
    for (const data of itemsData) {
      if (data.prepStation === PrepStation.none) continue; // «без отправки» всегда готово
      const create = (data.setComponents as { create?: any[] } | undefined)?.create;
      const sig = this.editItemSig(data.dishId, data.dishVariantId, data.comment, create as any);
      const arr = pool.get(sig);
      if (!arr || arr.length === 0) continue;
      const carried = arr.shift()!;
      if (!PROGRESS.includes(carried)) continue;
      data.status = carried;
      // Неизменный сет: переносим статус и на блюда состава (кроме удалённых).
      if (Array.isArray(create)) {
        for (const r of create) {
          if (r.status !== OrderItemStatus.cancelled) r.status = carried;
        }
      }
    }
  }

  /**
   * Полное редактирование состава заказа официантом.
   * Разрешено в статусах: sent_to_kitchen, accepted_by_kitchen, cooking.
   * Неизменные позиции сохраняют статус кухни; заказ в работе не возвращается в «Новые».
   */
  async editOrder(
    orderId: string,
    actor: AuditActor,
    items: CreateOrderItemDto[],
    comment?: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }

    // Редактирование разрешено пока кухня не поставила «Готово» и не перешла к оплате.
    const editableStatuses: OrderStatus[] = [
      OrderStatus.sent_to_kitchen,
      OrderStatus.accepted_by_kitchen,
      OrderStatus.cooking,
    ];
    if (!editableStatuses.includes(order.status)) {
      throw new BadRequestException(
        'Редактирование заказа недоступно на текущем этапе',
      );
    }
    if (!items.length) {
      throw new BadRequestException('Заказ не может быть пустым — используйте отмену');
    }

    const { itemsData, dishDeductions, variantDeductions } = await this.buildItemsData(items);

    // Заказ только из «Без отправки» сразу готов — на кухню/бар не уходит.
    const hasPrep = itemsData.some((i) => i.prepStation !== PrepStation.none);

    // Переносим прогресс кухни на неизменные позиции: блюда, которые остались в составе
    // как были, сохраняют свой статус (принято/готовится/готово), а не сбрасываются в «новое».
    // Так заказ, который уже в работе, не возвращается на вкладку «Новые» — туда попадает
    // (как «новое») только реально добавленное / заменённое блюдо.
    this.carryItemProgress(order.items, itemsData);

    // Статус заказа: если он уже был в работе — оставляем как есть (не возвращаем в «Новые»).
    const wasInWork =
      order.status === OrderStatus.accepted_by_kitchen || order.status === OrderStatus.cooking;
    const nextStatus = !hasPrep
      ? OrderStatus.ready
      : wasInWork
        ? order.status
        : OrderStatus.sent_to_kitchen;
    const nextTableStatus = this.tableStatusForOrderStatus(nextStatus);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.restoreInventory(tx, order.items);
      const serviceChargeAmount = await this.currentServiceChargeAmount(tx);
      const totals = this.calcTotals(itemsData, serviceChargeAmount);
      await tx.order.update({
        where: { id: orderId },
        data: {
          comment,
          totalAmount: totals.total,
          discountAmount: totals.discount,
          serviceChargeAmount: totals.serviceCharge,
          finalAmount: totals.final,
          requiresWaiterDecision: false,
          status: nextStatus,
        },
      });
      if (nextTableStatus) {
        await tx.table.update({ where: { id: order.tableId }, data: { status: nextTableStatus } });
      }
      await tx.orderItem.deleteMany({ where: { orderId } });
      await this.createOrderItems(tx, orderId, itemsData);
      await this.deductInventory(tx, dishDeductions, variantDeductions);
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    });

    // Уведомляем кухню — звук + обновление списка, только если есть что готовить.
    if (hasPrep) {
      // Конкретная озвучка изменения: что заменили / убрали / добавили.
      const voiceText = buildEditVoiceText(updated.orderNumber, order.items, updated.items);
      this.events.emitToKitchen(SERVER_EVENTS.KITCHEN_NEW_ORDER, {
        ...updated,
        voice: { text: voiceText },
      });
      void this.notifyKitchenNewOrder(updated);
    }
    if (nextTableStatus) {
      this.emitTableStatus(updated.table.id, updated.table.number, nextTableStatus, updated.table.hallId);
    }
    // Уведомляем остальных (официант, администратор) об изменении статуса.
    this.emitStatusChanged(updated);

    // Сводка изменений для журнала: что добавилось / убавилось по блюдам.
    const before = this.itemQtyMap(order.items);
    const after = this.itemQtyMap(updated.items);
    const diff = this.describeItemDiff(before, after);
    await this.audit.log({
      actor,
      actionType: AuditAction.ORDER_UPDATED,
      entityType: AuditEntity.ORDER,
      entityId: order.id,
      orderId: order.id,
      tableId: order.tableId,
      description:
        `${actor.name ?? 'Сотрудник'} изменил заказ ${order.orderNumber}` +
        (diff ? `: ${diff}` : ''),
      oldValue: { finalAmount: Number(order.finalAmount), items: [...before.entries()].map(([n, q]) => `${n} ×${q}`) },
      newValue: { finalAmount: Number(updated.finalAmount), items: [...after.entries()].map(([n, q]) => `${n} ×${q}`) },
      metadata: { orderNumber: order.orderNumber, tableNumber: order.table.number },
    });

    return updated;
  }

  /** Карта «название блюда → суммарное количество» по позициям заказа. */
  private itemQtyMap(items: { dishNameSnapshot: string; dishVariantNameSnapshot?: string | null; quantity: number }[]) {
    const m = new Map<string, number>();
    for (const it of items) {
      const name = this.orderItemName(it);
      m.set(name, (m.get(name) ?? 0) + it.quantity);
    }
    return m;
  }

  private orderItemName(item: { dishNameSnapshot: string; dishVariantNameSnapshot?: string | null }) {
    return item.dishVariantNameSnapshot
      ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}`
      : item.dishNameSnapshot;
  }

  /** Человеко-читаемая сводка различий составов: «добавил X ×1, убрал Y ×2». */
  private describeItemDiff(before: Map<string, number>, after: Map<string, number>) {
    const added: string[] = [];
    const removed: string[] = [];
    const names = new Set([...before.keys(), ...after.keys()]);
    for (const name of names) {
      const delta = (after.get(name) ?? 0) - (before.get(name) ?? 0);
      if (delta > 0) added.push(`${name} ×${delta}`);
      else if (delta < 0) removed.push(`${name} ×${-delta}`);
    }
    const parts: string[] = [];
    if (added.length) parts.push(`добавил ${added.join(', ')}`);
    if (removed.length) parts.push(`убрал ${removed.join(', ')}`);
    return parts.join('; ');
  }

  /** Добавить блюда к существующему заказу того же стола. */
  async addItems(orderId: string, actor: AuditActor, items: CreateOrderItemDto[], idempotencyKey?: string) {
    const waiterId = actor.id;
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.waiterId !== waiterId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    if (([OrderStatus.paid, OrderStatus.cancelled] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Заказ уже закрыт');
    }

    const activeShift = await this.shifts.getRequiredActiveShift(waiterId);

    const actionType = 'add_items';
    if (idempotencyKey) {
      const existingAction = await this.prisma.orderAction.findUnique({
        where: { type_idempotencyKey: { type: actionType, idempotencyKey } },
      });
      if (existingAction) {
        if (existingAction.orderId !== orderId) {
          throw new BadRequestException('Ключ повтора уже использован для другого заказа');
        }
        return this.findById(orderId);
      }
    }

    const { itemsData, dishDeductions, variantDeductions } = await this.buildItemsData(items);

    // Добавляемые позиции «Без отправки» не возвращают заказ на кухню/бар.
    const hasPrepAdded = itemsData.some((i) => i.prepStation !== PrepStation.none);

    const applied = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const createdAction = await tx.orderAction.createMany({
          data: { orderId, type: actionType, idempotencyKey, userId: waiterId },
          skipDuplicates: true,
        });
        if (createdAction.count === 0) {
          const existingAction = await tx.orderAction.findUnique({
            where: { type_idempotencyKey: { type: actionType, idempotencyKey } },
          });
          if (existingAction?.orderId !== orderId) {
            throw new BadRequestException('Ключ повтора уже использован для другого заказа');
          }
          return false;
        }
      }
      await this.createOrderItems(tx, orderId, itemsData);
      await this.deductInventory(tx, dishDeductions, variantDeductions);
      await this.recalcOrder(tx, orderId);
      // Новые блюда снова уходят на кухню; если добавили только «Без отправки» —
      // статус заказа пересчитываем по составу, кухню не трогаем.
      const nextStatus = hasPrepAdded
        ? OrderStatus.sent_to_kitchen
        : await this.statusFromActiveItems(tx, orderId);
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: nextStatus,
          requiresWaiterDecision: false,
          waiterShiftId: activeShift.id,
        },
      });
      return true;
    });

    const updated = await this.findById(orderId);
    if (applied) {
      if (hasPrepAdded) {
        this.events.emitToKitchen(SERVER_EVENTS.KITCHEN_NEW_ORDER, {
          ...updated,
          voice: { text: buildChangedText(updated) },
        });
        void this.notifyKitchenNewOrder(updated);
      }
      this.emitStatusChanged(updated);
      const addedCount = items.reduce((sum, i) => sum + i.quantity, 0);
      await this.audit.log({
        actor,
        actionType: AuditAction.ORDER_ITEM_ADDED,
        entityType: AuditEntity.ORDER,
        entityId: orderId,
        orderId,
        tableId: updated.tableId,
        description: `${actor.name ?? 'Сотрудник'} добавил ${addedCount} поз. в заказ ${updated.orderNumber} (стол ${updated.table.number})`,
        newValue: { items: items.map((i) => ({ dishId: i.dishId, variantId: i.variantId, quantity: i.quantity })) },
        metadata: { tableNumber: updated.table.number, finalAmount: Number(updated.finalAmount) },
      });
    }
    return updated;
  }

  // ---------- Действия кухни ----------

  /**
   * Станционный приём заказа в работу: переводит в «готовится» только позиции
   * своей станции (кухня/бар). Глобальный статус заказа пересчитывается по всем
   * активным позициям, поэтому заказ «готов» только когда готовы обе станции.
   */
  async stationAccept(orderId: string, kitchenUserId: string, station: PrepStation) {
    const order = await this.getMutableOrder(orderId);
    this.ensureStationDecision(order, station);

    const targetIds = order.items
      .filter((it) => it.prepStation === station && it.status === OrderItemStatus.new)
      .map((it) => it.id);

    let applied = false;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (targetIds.length === 0) {
        return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
      }
      applied = true;
      await tx.orderItem.updateMany({
        where: { id: { in: targetIds }, orderId },
        data: { status: OrderItemStatus.cooking },
      });
      // Состав сетов этой станции тоже уходит в работу, чтобы кухня могла
      // отмечать каждое блюдо внутри сета по отдельности.
      await tx.orderItemSetComponent.updateMany({
        where: { status: OrderItemStatus.new, orderItem: { orderId, prepStation: station } },
        data: { status: OrderItemStatus.cooking },
      });
      await tx.kitchenEvent.create({
        data: { orderId, type: KitchenEventType.accept, createdById: kitchenUserId },
      });
      await this.recalcSetParents(tx, orderId);
      const nextStatus = await this.statusFromActiveItems(tx, orderId);
      if (nextStatus !== order.status) {
        const nextTableStatus = this.tableStatusForOrderStatus(nextStatus);
        if (nextTableStatus) {
          await tx.table.update({ where: { id: order.tableId }, data: { status: nextTableStatus } });
        }
      }
      return tx.order.update({
        where: { id: orderId },
        data: { status: nextStatus },
        include: orderInclude,
      });
    });

    if (applied) {
      this.emitStatusChanged(updated);
      if (updated.status !== order.status) {
        const tableStatus = this.tableStatusForOrderStatus(updated.status);
        if (tableStatus) {
          this.emitTableStatus(updated.table.id, updated.table.number, tableStatus, updated.table.hallId);
        }
      }
      this.notifyWaiter(
        updated.waiterId,
        `Стол №${updated.table.number}: ${station === PrepStation.bar ? 'бар' : 'кухня'} принял заказ`,
        updated,
        'success',
      );
    }
    return updated;
  }

  async kitchenReady(orderId: string, kitchenUserId: string) {
    const order = await this.getMutableOrder(orderId);
    this.ensureNoPendingWaiterDecision(order);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { orderId, status: { in: [OrderItemStatus.cooking, OrderItemStatus.accepted, OrderItemStatus.new] } },
        data: { status: OrderItemStatus.ready },
      });
      await tx.kitchenEvent.create({
        data: { orderId, type: KitchenEventType.ready_order, createdById: kitchenUserId },
      });
      await tx.table.update({
        where: { id: order.tableId },
        data: { status: TableStatus.ready },
      });
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.ready },
        include: orderInclude,
      });
    });

    this.emitStatusChanged(updated);
    this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.ready, updated.table.hallId);
    this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.WAITER_ORDER_READY, updated);
    this.notifyWaiter(
      updated.waiterId,
      `Стол №${updated.table.number} — заказ готов. Заберите с кухни.`,
      updated,
      'success',
    );
    return updated;
  }

  /** Отказ по всему заказу с причиной. */
  async kitchenRejectOrder(orderId: string, kitchenUserId: string, reason: string, comment?: string) {
    const order = await this.getMutableOrder(orderId);
    this.ensureNoPendingWaiterDecision(order);
    const updated = await this.prisma.$transaction(async (tx) => {
      const itemsToReject = order.items.filter(item => 
        ![OrderItemStatus.rejected, OrderItemStatus.cancelled].includes(item.status as any)
      );
      await this.restoreInventory(tx, itemsToReject);
      await tx.orderItem.updateMany({
        where: { orderId, status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] } },
        data: { status: OrderItemStatus.rejected, rejectReason: reason },
      });
      await tx.kitchenEvent.create({
        data: { orderId, type: KitchenEventType.reject_order, reason, comment, createdById: kitchenUserId },
      });
      // Весь заказ отклонён — стол освобождается.
      await tx.table.update({ where: { id: order.tableId }, data: { status: TableStatus.free } });
      const o = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.rejected, requiresWaiterDecision: false },
        include: orderInclude,
      });
      return o;
    });

    this.emitStatusChanged(updated);
    this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.free, updated.table.hallId);
    this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.WAITER_ORDER_REJECTED, updated);
    this.notifyWaiter(
      updated.waiterId,
      `Стол №${updated.table.number}. Кухня отказала в заказе. Причина: ${reason}`,
      updated,
      'error',
    );
    return updated;
  }

  /** Отказ по одному блюду. Заказ становится «частично отказан». */
  async kitchenRejectItem(
    orderId: string,
    itemId: string,
    kitchenUserId: string,
    reason: string,
    comment?: string,
  ) {
    const order = await this.getMutableOrder(orderId);
    this.ensureNoPendingWaiterDecision(order);
    const item = await this.prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) throw new NotFoundException('Блюдо в заказе не найдено');

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.restoreInventory(tx, [item]);
      await tx.orderItem.update({
        where: { id: itemId },
        data: { status: OrderItemStatus.rejected, rejectReason: reason },
      });
      await tx.kitchenEvent.create({
        data: {
          orderId,
          orderItemId: itemId,
          type: KitchenEventType.reject_item,
          reason,
          comment,
          createdById: kitchenUserId,
        },
      });

      // Если отказаны все блюда — заказ rejected, иначе partially_rejected.
      const remaining = await tx.orderItem.count({
        where: { orderId, status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] } },
      });
      await this.recalcOrder(tx, orderId);
      // Все блюда отклонены — стол освобождается.
      if (remaining === 0) {
        await tx.table.update({ where: { id: order.tableId }, data: { status: TableStatus.free } });
      }
      const o = await tx.order.update({
        where: { id: orderId },
        data: {
          status: remaining === 0 ? OrderStatus.rejected : OrderStatus.partially_rejected,
          requiresWaiterDecision: remaining > 0,
        },
        include: orderInclude,
      });
      return o;
    });

    this.emitStatusChanged(updated);
    if (updated.status === OrderStatus.rejected) {
      this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.free, updated.table.hallId);
    }
    this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.WAITER_ORDER_REJECTED, updated);
    const partialText =
      updated.status === OrderStatus.partially_rejected
        ? ' Уточните у клиента: продолжить заказ, заменить блюдо или отменить заказ?'
        : '';
    const itemName = this.orderItemName(item);
    this.notifyWaiter(
      updated.waiterId,
      `Стол №${updated.table.number}. Кухня отказала блюдо: ${itemName}. Причина: ${reason}.${partialText}`,
      updated,
      'error',
    );
    return updated;
  }

  /** Отметить одно блюдо готовым. Заказ становится ready если все активные готовы. */
  async kitchenReadyItem(orderId: string, itemId: string, kitchenUserId: string) {
    const order = await this.getMutableOrder(orderId);
    this.ensureNoPendingWaiterDecision(order);
    const item = await this.prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) throw new NotFoundException('Блюдо в заказе не найдено');

    if (item.status === OrderItemStatus.ready) {
      return this.findById(orderId);
    }

    if (item.status === OrderItemStatus.rejected || item.status === OrderItemStatus.cancelled) {
      throw new BadRequestException('Нельзя приготовить отмененное или отказанное блюдо');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.update({
        where: { id: itemId },
        data: { status: OrderItemStatus.ready },
      });
      await tx.kitchenEvent.create({
        data: {
          orderId,
          orderItemId: itemId,
          type: KitchenEventType.ready_item,
          createdById: kitchenUserId,
        },
      });

      const nextStatus = await this.statusFromActiveItems(tx, orderId);
      if (nextStatus !== order.status) {
        const nextTableStatus = this.tableStatusForOrderStatus(nextStatus);
        if (nextTableStatus) {
          await tx.table.update({ where: { id: order.tableId }, data: { status: nextTableStatus } });
        }
      }

      return tx.order.update({
        where: { id: orderId },
        data: { status: nextStatus },
        include: orderInclude,
      });
    });

    this.emitStatusChanged(updated);
    if (updated.status !== order.status) {
      const tableStatus = this.tableStatusForOrderStatus(updated.status);
      if (tableStatus) {
        this.emitTableStatus(updated.table.id, updated.table.number, tableStatus, updated.table.hallId);
      }
    }

    if (updated.status === OrderStatus.ready) {
      this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.WAITER_ORDER_READY, updated);
      this.notifyWaiter(
        updated.waiterId,
        `Заказ ${updated.orderNumber} готов полностью`,
        updated,
        'success',
      );
    } else {
      const itemName = this.orderItemName(item);
      this.notifyWaiter(
        updated.waiterId,
        `Заказ ${updated.orderNumber}: ${itemName} готов`,
        updated,
        'success',
      );
    }

    return updated;
  }

  /**
   * Пакетно отметить несколько блюд готовыми (массовое действие кухни «Готово выбранные»).
   * Атомарно: один пересчёт статуса заказа, одно уведомление официанту.
   */
  async kitchenReadyItems(
    orderId: string,
    itemIds: string[],
    kitchenUserId: string,
    station: PrepStation = PrepStation.kitchen,
    setComponentIds: string[] = [],
  ) {
    const order = await this.getMutableOrder(orderId);
    this.ensureStationDecision(order, station);

    const targetIds = order.items
      .filter(
        (it) =>
          itemIds.includes(it.id) &&
          ![OrderItemStatus.rejected, OrderItemStatus.cancelled, OrderItemStatus.ready, OrderItemStatus.served].includes(
            it.status as any,
          ),
      )
      .map((it) => it.id);

    // Блюда внутри сетов — отдельные позиции для кухни.
    const targetComponents = await this.resolveSetComponents(orderId, setComponentIds, [
      OrderItemStatus.rejected,
      OrderItemStatus.cancelled,
      OrderItemStatus.ready,
      OrderItemStatus.served,
    ]);

    const doneCount = targetIds.length + targetComponents.length;
    if (doneCount === 0) {
      throw new BadRequestException('Нет блюд, которые можно отметить готовыми');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (targetIds.length > 0) {
        await tx.orderItem.updateMany({
          where: { id: { in: targetIds }, orderId },
          data: { status: OrderItemStatus.ready },
        });
        // Если среди выбранных есть сет целиком — синхронизируем его состав.
        await tx.orderItemSetComponent.updateMany({
          where: {
            orderItemId: { in: targetIds },
            status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] },
          },
          data: { status: OrderItemStatus.ready },
        });
      }
      if (targetComponents.length > 0) {
        await tx.orderItemSetComponent.updateMany({
          where: { id: { in: targetComponents.map((c) => c.id) } },
          data: { status: OrderItemStatus.ready },
        });
      }
      await tx.kitchenEvent.createMany({
        data: [
          ...targetIds.map((id) => ({ orderId, orderItemId: id })),
          ...targetComponents.map((c) => ({ orderId, orderItemId: c.orderItemId })),
        ].map((e) => ({ ...e, type: KitchenEventType.ready_item, createdById: kitchenUserId })),
      });

      // Статус сета выводим из его состава (готов только когда готовы все блюда).
      await this.recalcSetParents(tx, orderId);
      const nextStatus = await this.statusFromActiveItems(tx, orderId);
      if (nextStatus !== order.status) {
        const nextTableStatus = this.tableStatusForOrderStatus(nextStatus);
        if (nextTableStatus) {
          await tx.table.update({ where: { id: order.tableId }, data: { status: nextTableStatus } });
        }
      }

      return tx.order.update({
        where: { id: orderId },
        data: { status: nextStatus },
        include: orderInclude,
      });
    });

    this.emitStatusChanged(updated);
    if (updated.status !== order.status) {
      const tableStatus = this.tableStatusForOrderStatus(updated.status);
      if (tableStatus) {
        this.emitTableStatus(updated.table.id, updated.table.number, tableStatus, updated.table.hallId);
      }
    }

    if (updated.status === OrderStatus.ready) {
      this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.WAITER_ORDER_READY, updated);
      this.notifyWaiter(updated.waiterId, `Заказ ${updated.orderNumber} готов полностью`, updated, 'success');
    } else {
      this.notifyWaiter(
        updated.waiterId,
        `Заказ ${updated.orderNumber}: готово позиций — ${doneCount}`,
        updated,
        'success',
      );
    }

    return updated;
  }

  /**
   * Возвращает блюда состава сетов заказа по их id, отсекая позиции в финальных
   * статусах (нельзя повторно отметить готовыми/отказанными).
   */
  private async resolveSetComponents(
    orderId: string,
    componentIds: string[],
    excludeStatuses: OrderItemStatus[],
  ) {
    if (!componentIds?.length) return [];
    return this.prisma.orderItemSetComponent.findMany({
      where: {
        id: { in: componentIds },
        status: { notIn: excludeStatuses },
        orderItem: { orderId },
      },
      select: {
        id: true,
        orderItemId: true,
        action: true,
        originalNameSnapshot: true,
        finalNameSnapshot: true,
      },
    });
  }

  /**
   * Пакетный отказ по нескольким блюдам (массовое действие кухни «Отказать выбранные»).
   * Атомарно: один пересчёт сумм, одно уведомление официанту.
   */
  async kitchenRejectItems(
    orderId: string,
    itemIds: string[],
    kitchenUserId: string,
    reason: string,
    comment?: string,
    station: PrepStation = PrepStation.kitchen,
    setComponentIds: string[] = [],
  ) {
    const order = await this.getMutableOrder(orderId);
    this.ensureStationDecision(order, station);

    const items = order.items.filter(
      (it) =>
        itemIds.includes(it.id) &&
        ![OrderItemStatus.rejected, OrderItemStatus.cancelled].includes(it.status as any),
    );
    // Блюда внутри сетов — отдельные позиции для кухни.
    const components = await this.resolveSetComponents(orderId, setComponentIds, [
      OrderItemStatus.rejected,
      OrderItemStatus.cancelled,
    ]);
    if (items.length === 0 && components.length === 0) {
      throw new BadRequestException('Нет блюд, которые можно отказать');
    }
    const targetIds = items.map((it) => it.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.restoreInventory(tx, items);
      if (targetIds.length > 0) {
        await tx.orderItem.updateMany({
          where: { id: { in: targetIds }, orderId },
          data: { status: OrderItemStatus.rejected, rejectReason: reason },
        });
        // Сет целиком — отказываем и его состав.
        await tx.orderItemSetComponent.updateMany({
          where: {
            orderItemId: { in: targetIds },
            status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] },
          },
          data: { status: OrderItemStatus.rejected, rejectReason: reason },
        });
      }
      if (components.length > 0) {
        await tx.orderItemSetComponent.updateMany({
          where: { id: { in: components.map((c) => c.id) } },
          data: { status: OrderItemStatus.rejected, rejectReason: reason },
        });
      }
      await tx.kitchenEvent.createMany({
        data: [
          ...targetIds.map((id) => ({ orderId, orderItemId: id })),
          ...components.map((c) => ({ orderId, orderItemId: c.orderItemId })),
        ].map((e) => ({ ...e, type: KitchenEventType.reject_item, reason, comment, createdById: kitchenUserId })),
      });

      // Статус сета выводим из состава; сет, отказанный целиком, возвращает остатки.
      const setsRejected = await this.recalcSetParents(tx, orderId);
      await this.restoreInventory(tx, setsRejected);

      // Если отказаны все блюда — заказ rejected, иначе partially_rejected.
      const remaining = await tx.orderItem.count({
        where: { orderId, status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] } },
      });
      await this.recalcOrder(tx, orderId);
      if (remaining === 0) {
        await tx.table.update({ where: { id: order.tableId }, data: { status: TableStatus.free } });
      }
      return tx.order.update({
        where: { id: orderId },
        data: {
          status: remaining === 0 ? OrderStatus.rejected : OrderStatus.partially_rejected,
          requiresWaiterDecision: remaining > 0,
        },
        include: orderInclude,
      });
    });

    this.emitStatusChanged(updated);
    if (updated.status === OrderStatus.rejected) {
      this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.free, updated.table.hallId);
    }
    this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.WAITER_ORDER_REJECTED, updated);
    const componentNames = components.map((c) =>
      c.action === 'replaced' && c.finalNameSnapshot ? c.finalNameSnapshot : c.originalNameSnapshot,
    );
    const names = [...items.map((it) => this.orderItemName(it)), ...componentNames].join(', ');
    const stationLabel = station === PrepStation.bar ? 'Бар' : 'Кухня';
    const partialText =
      updated.status === OrderStatus.partially_rejected
        ? ' Уточните у клиента: продолжить заказ, заменить блюдо или отменить заказ?'
        : '';
    this.notifyWaiter(
      updated.waiterId,
      `Стол №${updated.table.number}. ${stationLabel} отказал: ${names}. Причина: ${reason}.${partialText}`,
      updated,
      'error',
    );
    return updated;
  }

  // ---------- Действия официанта после готовности ----------

  async resolvePartialRejection(orderId: string, waiterId: string) {
    const order = await this.assertOwnedOrder(orderId, waiterId);
    if (order.status !== OrderStatus.partially_rejected || !order.requiresWaiterDecision) {
      throw new BadRequestException('По этому заказу нет ожидающего решения по частичному отказу');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextStatus = await this.statusFromActiveItems(tx, orderId);
      const nextTableStatus = this.tableStatusForOrderStatus(nextStatus);
      if (nextTableStatus) {
        await tx.table.update({ where: { id: order.tableId }, data: { status: nextTableStatus } });
      }
      return tx.order.update({
        where: { id: orderId },
        data: { status: nextStatus, requiresWaiterDecision: false },
        include: orderInclude,
      });
    });

    this.emitStatusChanged(updated);
    const tableStatus = this.tableStatusForOrderStatus(updated.status);
    if (tableStatus) {
      this.emitTableStatus(updated.table.id, updated.table.number, tableStatus, updated.table.hallId);
    }
    return updated;
  }

  async pickedUp(orderId: string, waiterId: string) {
    const order = await this.assertOwnedOrder(orderId, waiterId);
    if (order.requiresWaiterDecision) {
      throw new BadRequestException(PARTIAL_REJECTION_PENDING_MESSAGE);
    }
    const readyItems = await this.prisma.orderItem.count({
      where: { orderId, status: OrderItemStatus.ready },
    });
    if (
      readyItems === 0 ||
      ([OrderStatus.paid, OrderStatus.cancelled, OrderStatus.rejected, OrderStatus.waiting_payment] as OrderStatus[]).includes(order.status)
    ) {
      throw new BadRequestException('Заказ ещё не готов');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.picked_up, requiresWaiterDecision: false },
      include: orderInclude,
    });
    this.emitStatusChanged(updated);
    return updated;
  }

  async served(orderId: string, waiterId: string) {
    const order = await this.assertOwnedOrder(orderId, waiterId);
    if (order.requiresWaiterDecision) {
      throw new BadRequestException(PARTIAL_REJECTION_PENDING_MESSAGE);
    }
    if (!([OrderStatus.picked_up, OrderStatus.ready, OrderStatus.partially_rejected] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Сначала заберите заказ с кухни');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { orderId, status: OrderItemStatus.ready },
        data: { status: OrderItemStatus.served },
      });
      await tx.table.update({ where: { id: order.tableId }, data: { status: TableStatus.served } });
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.served, requiresWaiterDecision: false },
        include: orderInclude,
      });
    });
    this.emitStatusChanged(updated);
    this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.served, updated.table.hallId);
    return updated;
  }

  /** Перевод к оплате. */
  async toPayment(orderId: string, waiterId: string) {
    const order = await this.assertOwnedOrder(orderId, waiterId);
    if (order.requiresWaiterDecision) {
      throw new BadRequestException(PARTIAL_REJECTION_PENDING_MESSAGE);
    }
    if (([OrderStatus.paid, OrderStatus.cancelled, OrderStatus.rejected] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Заказ нельзя оплатить');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.table.update({
        where: { id: order.tableId },
        data: { status: TableStatus.waiting_payment },
      });
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.waiting_payment },
        include: orderInclude,
      });
    });
    this.emitStatusChanged(updated);
    this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.waiting_payment, updated.table.hallId);
    return updated;
  }

  /** Приём оплаты: закрывает заказ, освобождает стол. Вызывается из PaymentsService. */
  async markPaid(
    orderId: string,
    actor: AuditActor,
    method: PaymentMethod,
    parts?: { method: PaymentMethod; amount: number }[],
    source: PaymentSource = PaymentSource.normal,
  ) {
    const cashierId = actor.id;
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    if (order.status === OrderStatus.paid) {
      return order;
    }

    // Смешанная/раздельная оплата: суммы частей должны точно совпадать с итогом заказа.
    const final = Number(order.finalAmount);
    let paymentParts: { method: PaymentMethod; amount: number }[];
    if (source === PaymentSource.split || method === PaymentMethod.mixed) {
      paymentParts = (parts ?? []).filter((p) => p.amount > 0);
      if (source === PaymentSource.normal && paymentParts.length < 2) {
        throw new BadRequestException('Для смешанной оплаты укажите суммы наличными и по QR');
      } else if (source === PaymentSource.split && paymentParts.length < 2) {
        throw new BadRequestException('Для раздельной оплаты укажите минимум два платежа');
      }
      const sum = paymentParts.reduce((acc, p) => acc + p.amount, 0);
      if (Math.abs(sum - final) > 0.01) {
        throw new BadRequestException('Сумма частей оплаты должна совпадать с итогом заказа');
      }
    } else {
      paymentParts = [{ method, amount: final }];
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const existingPayment = await tx.payment.findFirst({ where: { orderId, status: PaymentStatus.paid } });
      if (!existingPayment) {
        await tx.payment.createMany({
          data: paymentParts.map((p) => ({
            orderId,
            amount: p.amount,
            method: p.method,
            source,
            status: PaymentStatus.paid,
            cashierId,
          })),
        });
      }
      // Стол освобождается.
      await tx.table.update({ where: { id: order.tableId }, data: { status: TableStatus.free } });
      return tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.paid,
          paymentStatus: PaymentStatus.paid,
          paymentMethod: method,
          closedAt: new Date(),
        },
        include: orderInclude,
      });
    });

    this.emitStatusChanged(updated);
    this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.free, updated.table.hallId);

    const methodLabel = PAYMENT_METHOD_LABEL[method] ?? method;
    await this.audit.log({
      actor,
      actionType: AuditAction.ORDER_PAID,
      entityType: AuditEntity.PAYMENT,
      entityId: updated.id,
      orderId: updated.id,
      tableId: updated.tableId,
      description: `${actor.name ?? 'Сотрудник'} принял оплату по заказу ${updated.orderNumber} (стол ${updated.table.number}): ${this.money(updated.finalAmount)} · ${methodLabel}`,
      newValue: { paymentMethod: method, finalAmount: Number(updated.finalAmount) },
      metadata: { method, amount: Number(updated.finalAmount), tableNumber: updated.table.number },
    });

    return updated;
  }

  // ---------- Внутренние помощники ----------

  private async buildItemsData(items: CreateOrderItemDto[]): Promise<{
    itemsData: Prisma.OrderItemUncheckedCreateWithoutOrderInput[];
    dishDeductions: Map<string, number>;
    variantDeductions: Map<string, number>;
  }> {
    const dishIds = [...new Set(items.map((i) => i.dishId))];
    const variantIds = [...new Set(items.map((i) => i.variantId).filter((id): id is string => !!id))];
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: dishIds }, isActive: true },
      include: {
        variants: { orderBy: { sortOrder: 'asc' } },
        category: { select: { prepStation: true } },
        setComponents: { select: { dishId: true, dishVariantId: true, quantity: true } },
      },
    });
    const byId = new Map(dishes.map((d) => [d.id, d]));
    const variants = variantIds.length
      ? await this.prisma.dishVariant.findMany({ where: { id: { in: variantIds } } })
      : [];
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    // Имена блюд состава сета (оригиналы + замены) — для снимков.
    const componentDishIds = [
      ...new Set(
        items.flatMap((i) =>
          (i.setComponents ?? []).flatMap((c) =>
            [c.originalDishId, c.finalDishId].filter((x): x is string => !!x),
          ),
        ),
      ),
    ];
    const componentDishes = componentDishIds.length
      ? await this.prisma.dish.findMany({
          where: { id: { in: componentDishIds } },
          select: { id: true, name: true, price: true, isSet: true, isActive: true },
        })
      : [];
    const compById = new Map(componentDishes.map((d) => [d.id, d]));

    // Варианты блюд состава сета (например, «1 л») — для снимков названия/цены.
    const componentVariantIds = [
      ...new Set(
        items.flatMap((i) =>
          (i.setComponents ?? []).map((c) => c.originalVariantId).filter((x): x is string => !!x),
        ),
      ),
    ];
    const componentVariants = componentVariantIds.length
      ? await this.prisma.dishVariant.findMany({
          where: { id: { in: componentVariantIds } },
          select: { id: true, dishId: true, name: true, price: true },
        })
      : [];
    const compVariantById = new Map(componentVariants.map((v) => [v.id, v]));

    const dishDeductions = new Map<string, number>();
    const variantDeductions = new Map<string, number>();

    const itemsData = items.map((i): Prisma.OrderItemUncheckedCreateWithoutOrderInput => {
      const dish = byId.get(i.dishId);
      if (!dish) {
        throw new BadRequestException(`Блюдо недоступно`);
      }
      if (!dish.isAvailable) {
        throw new BadRequestException(`Блюдо «${dish.name}» сейчас недоступно`);
      }
      const hasVariants = dish.variants.length > 0;
      const variant = i.variantId ? variantById.get(i.variantId) : null;
      if (hasVariants && !variant) {
        throw new BadRequestException(`Выберите вариант блюда «${dish.name}»`);
      }
      if (!hasVariants && i.variantId) {
        throw new BadRequestException(`У блюда «${dish.name}» нет вариантов`);
      }
      if (variant && variant.dishId !== dish.id) {
        throw new BadRequestException('Вариант не относится к выбранному блюду');
      }

      if (dish.trackInventory) {
        if (hasVariants && variant) {
          if (variant.stock !== null) {
            const current = variantDeductions.get(variant.id) ?? 0;
            if ((variant.stock ?? 0) < current + i.quantity) {
              throw new BadRequestException(`Недостаточно остатка для «${dish.name} - ${variant.name}»`);
            }
            variantDeductions.set(variant.id, current + i.quantity);
          }
        } else {
          if (dish.stock !== null) {
            const current = dishDeductions.get(dish.id) ?? 0;
            if ((dish.stock ?? 0) < current + i.quantity) {
              throw new BadRequestException(`Недостаточно остатка для «${dish.name}»`);
            }
            dishDeductions.set(dish.id, current + i.quantity);
          }
        }
      }

      // Направление позиции: приоритет у блюда, иначе — направление категории.
      const prepStation = dish.prepStation ?? dish.category.prepStation;
      // «Без отправки»: позиция не готовится — сразу «готова», на кухню/бар не уходит.
      const initialStatus =
        prepStation === PrepStation.none ? OrderItemStatus.ready : OrderItemStatus.new;

      // Состав сета с изменениями (только для блюд-сетов).
      // Цена сета меняется: убрали блюдо → минус его цена; заменили → разница цен.
      let setComponents: Prisma.OrderItemSetComponentUncheckedCreateNestedManyWithoutOrderItemInput | undefined;
      let setDelta = 0;
      if (dish.isSet) {
        // Состав ключуем по блюду + варианту: одно блюдо с разными вариантами — разные строки.
        const compKey = (dishId: string, variantId?: string | null) => `${dishId}|${variantId ?? ''}`;
        const qtyByOrig = new Map(
          dish.setComponents.map((sc) => [compKey(sc.dishId, sc.dishVariantId), sc.quantity]),
        );
        const rows = (i.setComponents ?? []).map((c, idx) => {
          const orig = compById.get(c.originalDishId);
          if (!orig) throw new BadRequestException('Блюдо состава сета не найдено');
          const origVariant = c.originalVariantId ? compVariantById.get(c.originalVariantId) : null;
          if (c.originalVariantId && (!origVariant || origVariant.dishId !== c.originalDishId)) {
            throw new BadRequestException('Вариант блюда состава не найден');
          }
          const qty = qtyByOrig.get(compKey(c.originalDishId, c.originalVariantId)) ?? 1;
          // Цена оригинала — вариант, если он задан, иначе базовая цена блюда.
          const origPrice = origVariant ? Number(origVariant.price) : Number(orig.price);
          let finalDishId: string | null = null;
          let finalNameSnapshot: string | null = null;
          let priceDelta = 0;
          if (c.action === 'removed') {
            priceDelta = -origPrice * qty;
          } else if (c.action === 'replaced') {
            if (!c.finalDishId) throw new BadRequestException('Не указано блюдо замены');
            const fin = compById.get(c.finalDishId);
            if (!fin || !fin.isActive) throw new BadRequestException('Блюдо замены недоступно');
            if (fin.isSet) throw new BadRequestException('Нельзя заменить на сет');
            finalDishId = fin.id;
            finalNameSnapshot = fin.name;
            priceDelta = (Number(fin.price) - origPrice) * qty;
          }
          setDelta += priceDelta;
          return {
            originalDishId: c.originalDishId,
            originalNameSnapshot: orig.name,
            originalVariantNameSnapshot: origVariant?.name ?? null,
            finalDishId,
            finalNameSnapshot,
            action: c.action,
            // Удалённое из сета блюдо («без X») кухня не готовит; «без отправки» сразу готово.
            status:
              c.action === 'removed' ? OrderItemStatus.cancelled : initialStatus,
            quantity: qty,
            sortOrder: idx,
            priceDelta: new Prisma.Decimal(round2(priceDelta)),
          };
        });
        if (rows.length > 0) setComponents = { create: rows };
      }

      const basePrice = variant?.price ?? dish.price;
      const pricing = unitPricing(basePrice, dish.discountType, dish.discountValue);
      // Для сета корректируем цену на дельту состава (не уходим в минус).
      const unit = dish.isSet ? Math.max(0, round2(pricing.unit + setDelta)) : pricing.unit;
      const unitDiscount = dish.isSet ? 0 : pricing.unitDiscount;
      const unitFinal = dish.isSet ? Math.max(0, round2(pricing.unitFinal + setDelta)) : pricing.unitFinal;
      return {
        dishId: dish.id,
        dishVariantId: variant?.id,
        dishNameSnapshot: dish.name,
        dishVariantNameSnapshot: variant?.name,
        dishVoiceSnapshot: dish.voiceName ?? null,
        priceSnapshot: new Prisma.Decimal(unit),
        quantity: i.quantity,
        discountAmount: new Prisma.Decimal(round2(unitDiscount * i.quantity)),
        finalPrice: new Prisma.Decimal(round2(unitFinal * i.quantity)),
        status: initialStatus,
        prepStation,
        comment: i.comment,
        takeaway: i.takeaway ?? false,
        setComponents,
      };
    });

    return { itemsData, dishDeductions, variantDeductions };
  }

  /** Создаёт позиции заказа по одной (поддерживает вложенный состав сета). */
  private async createOrderItems(
    tx: Prisma.TransactionClient,
    orderId: string,
    itemsData: Prisma.OrderItemUncheckedCreateWithoutOrderInput[],
  ) {
    for (const item of itemsData) {
      await tx.orderItem.create({ data: { ...item, orderId } });
    }
  }

  private async deductInventory(
    tx: Prisma.TransactionClient,
    dishDeductions: Map<string, number>,
    variantDeductions: Map<string, number>,
  ) {
    for (const [dishId, qty] of dishDeductions.entries()) {
      await tx.dish.update({ where: { id: dishId }, data: { stock: { decrement: qty } } });
    }
    for (const [variantId, qty] of variantDeductions.entries()) {
      await tx.dishVariant.update({ where: { id: variantId }, data: { stock: { decrement: qty } } });
    }
  }

  private async restoreInventory(
    tx: Prisma.TransactionClient,
    items: { dishId: string | null; dishVariantId: string | null; quantity: number }[],
  ) {
    if (!items.length) return;
    // Удалённое из меню блюдо (dishId === null) не имеет остатков для возврата.
    const dishIds = [...new Set(items.map((i) => i.dishId).filter((id): id is string => !!id))];
    const variantIds = items.map((i) => i.dishVariantId).filter((id): id is string => !!id);
    const variants = variantIds.length
      ? await tx.dishVariant.findMany({ where: { id: { in: variantIds } } })
      : [];
    const nonNullVariantIds = new Set(variants.filter((v) => v.stock !== null).map((v) => v.id));

    const dishes = await tx.dish.findMany({
      where: { id: { in: dishIds }, trackInventory: true },
      select: { id: true, stock: true },
    });
    const trackedDishIds = new Set(dishes.map((d) => d.id));
    const dishesWithStock = new Set(dishes.filter((d) => d.stock !== null).map((d) => d.id));

    const dishIncrements = new Map<string, number>();
    const variantIncrements = new Map<string, number>();

    for (const item of items) {
      if (item.dishId && trackedDishIds.has(item.dishId)) {
        if (item.dishVariantId) {
          if (nonNullVariantIds.has(item.dishVariantId)) {
            variantIncrements.set(item.dishVariantId, (variantIncrements.get(item.dishVariantId) ?? 0) + item.quantity);
          }
        } else {
          if (dishesWithStock.has(item.dishId)) {
            dishIncrements.set(item.dishId, (dishIncrements.get(item.dishId) ?? 0) + item.quantity);
          }
        }
      }
    }

    for (const [dishId, qty] of dishIncrements.entries()) {
      await tx.dish.update({ where: { id: dishId }, data: { stock: { increment: qty } } });
    }
    for (const [variantId, qty] of variantIncrements.entries()) {
      await tx.dishVariant.update({ where: { id: variantId }, data: { stock: { increment: qty } } });
    }
  }

  private calcTotals(
    items: {
      priceSnapshot: string | number | Prisma.Decimal | Prisma.DecimalJsLike;
      quantity?: number | null;
      discountAmount?: string | number | Prisma.Decimal | Prisma.DecimalJsLike | null;
      finalPrice: string | number | Prisma.Decimal | Prisma.DecimalJsLike;
    }[],
    serviceChargeAmount = 0,
  ) {
    let total = 0;
    let discount = 0;
    let final = 0;
    for (const i of items) {
      const qty = i.quantity ?? 1;
      total += Number(i.priceSnapshot) * qty;
      discount += Number(i.discountAmount ?? 0);
      final += Number(i.finalPrice);
    }
    const serviceCharge = round2(Math.max(0, serviceChargeAmount));
    return {
      total: new Prisma.Decimal(round2(total)),
      discount: new Prisma.Decimal(round2(discount)),
      serviceCharge: new Prisma.Decimal(serviceCharge),
      final: new Prisma.Decimal(round2(final + serviceCharge)),
    };
  }

  /** Пересчитывает суммы заказа по его актуальным (не отказанным) позициям. */
  private async recalcOrder(tx: Prisma.TransactionClient, orderId: string) {
    const items = await tx.orderItem.findMany({ where: { orderId } });
    let total = 0;
    let discount = 0;
    let final = 0;
    for (const i of items) {
      if (i.status === OrderItemStatus.rejected || i.status === OrderItemStatus.cancelled) continue;
      total += Number(i.priceSnapshot) * i.quantity;
      discount += Number(i.discountAmount);
      final += Number(i.finalPrice);
    }
    const serviceCharge = await this.currentServiceChargeAmount(tx);
    await tx.order.update({
      where: { id: orderId },
      data: {
        totalAmount: new Prisma.Decimal(round2(total)),
        discountAmount: new Prisma.Decimal(round2(discount)),
        serviceChargeAmount: new Prisma.Decimal(serviceCharge),
        finalAmount: new Prisma.Decimal(round2(final + serviceCharge)),
      },
    });
  }

  private async currentServiceChargeAmount(tx?: Prisma.TransactionClient): Promise<number> {
    const settings = tx
      ? await tx.settings.findUnique({ where: { id: 'default' }, select: { serviceChargeAmount: true } })
      : await this.settings.ensure();
    return Math.max(0, round2(Number(settings?.serviceChargeAmount ?? 0)));
  }

  private async statusFromActiveItems(tx: Prisma.TransactionClient, orderId: string): Promise<OrderStatus> {
    const items = await tx.orderItem.findMany({
      where: { orderId, status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] } },
      select: { status: true },
    });
    if (items.length === 0) return OrderStatus.rejected;

    const statuses = new Set(items.map((i) => i.status));
    if (statuses.has(OrderItemStatus.cooking)) return OrderStatus.cooking;
    if (statuses.has(OrderItemStatus.accepted)) return OrderStatus.accepted_by_kitchen;
    if (statuses.has(OrderItemStatus.new)) return OrderStatus.sent_to_kitchen;
    if (statuses.has(OrderItemStatus.ready)) return OrderStatus.ready;
    if (statuses.has(OrderItemStatus.served)) return OrderStatus.served;
    return OrderStatus.partially_rejected;
  }

  /**
   * Статус блюда-сета как агрегат статусов его состава: сет готов только когда
   * готовы все блюда внутри, и отказан только когда отказаны все.
   */
  private aggregateItemStatus(componentStatuses: OrderItemStatus[]): OrderItemStatus {
    const active = componentStatuses.filter(
      (s) => s !== OrderItemStatus.rejected && s !== OrderItemStatus.cancelled,
    );
    if (active.length === 0) {
      return componentStatuses.includes(OrderItemStatus.rejected)
        ? OrderItemStatus.rejected
        : OrderItemStatus.cancelled;
    }
    if (active.includes(OrderItemStatus.cooking)) return OrderItemStatus.cooking;
    if (active.includes(OrderItemStatus.accepted)) return OrderItemStatus.accepted;
    if (active.includes(OrderItemStatus.new)) return OrderItemStatus.new;
    if (active.every((s) => s === OrderItemStatus.served)) return OrderItemStatus.served;
    return OrderItemStatus.ready;
  }

  /**
   * Пересчитывает статус блюд-сетов из статусов их состава. Возвращает позиции,
   * которые при этом стали отказанными (нужно вернуть остатки на склад).
   */
  private async recalcSetParents(tx: Prisma.TransactionClient, orderId: string) {
    const setItems = await tx.orderItem.findMany({
      where: { orderId, setComponents: { some: {} } },
      select: {
        id: true,
        status: true,
        dishId: true,
        dishVariantId: true,
        quantity: true,
        setComponents: { select: { status: true } },
      },
    });
    const becameRejected: { dishId: string | null; dishVariantId: string | null; quantity: number }[] = [];
    for (const item of setItems) {
      const next = this.aggregateItemStatus(item.setComponents.map((c) => c.status));
      if (next === item.status) continue;
      await tx.orderItem.update({ where: { id: item.id }, data: { status: next } });
      if (
        next === OrderItemStatus.rejected &&
        item.status !== OrderItemStatus.rejected &&
        item.status !== OrderItemStatus.cancelled
      ) {
        becameRejected.push({
          dishId: item.dishId,
          dishVariantId: item.dishVariantId,
          quantity: item.quantity,
        });
      }
    }
    return becameRejected;
  }

  private tableStatusForOrderStatus(status: OrderStatus): TableStatus | null {
    switch (status) {
      case OrderStatus.sent_to_kitchen:
        return TableStatus.sent_to_kitchen;
      case OrderStatus.accepted_by_kitchen:
        return TableStatus.accepted;
      case OrderStatus.cooking:
        return TableStatus.cooking;
      case OrderStatus.ready:
        return TableStatus.ready;
      case OrderStatus.picked_up:
      case OrderStatus.served:
        return TableStatus.served;
      case OrderStatus.waiting_payment:
        return TableStatus.waiting_payment;
      case OrderStatus.paid:
      case OrderStatus.rejected:
      case OrderStatus.cancelled:
        return TableStatus.free;
      default:
        return null;
    }
  }

  private ensureNoPendingWaiterDecision(order: { requiresWaiterDecision: boolean }) {
    if (order.requiresWaiterDecision) {
      throw new BadRequestException(PARTIAL_REJECTION_PENDING_MESSAGE);
    }
  }

  /**
   * Станционный аналог: ожидание решения официанта блокирует только ту станцию,
   * где есть отказанная позиция. Другая станция работает независимо.
   */
  private ensureStationDecision(
    order: { requiresWaiterDecision: boolean; items: { prepStation: PrepStation; status: OrderItemStatus }[] },
    station: PrepStation,
  ) {
    if (
      order.requiresWaiterDecision &&
      order.items.some((it) => it.prepStation === station && it.status === OrderItemStatus.rejected)
    ) {
      throw new BadRequestException(PARTIAL_REJECTION_PENDING_MESSAGE);
    }
  }

  /** Локальная полночь — бизнес-день заказа (для дневной нумерации). */
  private businessDateOf(date = new Date()): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Следующий номер заказа в пределах бизнес-дня (каждый день начинается с №1). */
  private async nextOrderNumber(tx: Prisma.TransactionClient, businessDate: Date): Promise<string> {
    const result: any[] = await tx.$queryRaw`
      SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(order_number, '[^0-9]', '', 'g') AS INTEGER)), 0) as max_num
      FROM orders WHERE business_date = ${businessDate}`;
    const max = Number(result[0]?.max_num || 0);
    return `№${max + 1}`;
  }

  private async getMutableOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { items: true, table: true } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (([OrderStatus.paid, OrderStatus.cancelled] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Заказ уже закрыт');
    }
    return order;
  }

  private async assertOwnedOrder(orderId: string, waiterId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.waiterId !== waiterId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    return order;
  }

  // ---------- Действия со столом (закрыть / перенести / передать) ----------

  /** Активный заказ стола (если есть). */
  private activeOrderForTable(tableId: string) {
    return this.prisma.order.findFirst({
      where: { tableId, status: { in: ACTIVE_ORDER_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Закрыть стол — сделать его свободным. Нельзя при незавершённом заказе. */
  async closeTable(tableId: string, actor: AuditActor) {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table) throw new NotFoundException('Стол не найден');

    const active = await this.activeOrderForTable(tableId);
    if (active) {
      throw new BadRequestException(
        'У этого стола есть активный заказ. Завершите или оплатите заказ перед закрытием стола.',
      );
    }

    const prevStatus = table.status;
    const updated = await this.prisma.table.update({
      where: { id: tableId },
      data: { status: TableStatus.free },
    });
    this.emitTableStatus(updated.id, updated.number, TableStatus.free, updated.hallId);

    await this.audit.log({
      actor,
      actionType: AuditAction.TABLE_CLOSED,
      entityType: AuditEntity.TABLE,
      entityId: table.id,
      tableId: table.id,
      description: `${actor.name ?? 'Сотрудник'} закрыл стол ${table.number}`,
      oldValue: { status: prevStatus },
      newValue: { status: TableStatus.free },
      metadata: { tableNumber: table.number },
    });
    return updated;
  }

  /** Перенести активный заказ на другой (свободный) стол. */
  async moveTable(sourceTableId: string, targetTableId: string, actor: AuditActor) {
    if (sourceTableId === targetTableId) {
      throw new BadRequestException('Нельзя перенести заказ на тот же стол');
    }
    const [source, target] = await Promise.all([
      this.prisma.table.findUnique({ where: { id: sourceTableId } }),
      this.prisma.table.findUnique({ where: { id: targetTableId } }),
    ]);
    if (!source) throw new NotFoundException('Исходный стол не найден');
    if (!target) throw new NotFoundException('Целевой стол не найден');
    if (!target.isActive) throw new BadRequestException('Целевой стол отключён');

    const targetBusy = await this.activeOrderForTable(targetTableId);
    if (targetBusy) throw new BadRequestException('Целевой стол занят');

    const order = await this.activeOrderForTable(sourceTableId);
    if (!order) throw new BadRequestException('У стола нет активного заказа для переноса');
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.table.update({ where: { id: targetTableId }, data: { status: source.status } });
      await tx.table.update({ where: { id: sourceTableId }, data: { status: TableStatus.free } });
      return tx.order.update({
        where: { id: order.id },
        data: { tableId: targetTableId },
        include: orderInclude,
      });
    });

    this.emitTableStatus(source.id, source.number, TableStatus.free, source.hallId);
    this.emitTableStatus(target.id, target.number, source.status, target.hallId);
    this.emitStatusChanged(updated);
    // Уведомление о переносе показывается локально на фронте у инициатора.

    await this.audit.log({
      actor,
      actionType: AuditAction.TABLE_MOVED,
      entityType: AuditEntity.ORDER,
      entityId: order.id,
      orderId: order.id,
      tableId: targetTableId,
      description: `${actor.name ?? 'Сотрудник'} перенёс заказ ${updated.orderNumber} со стола ${source.number} на стол ${target.number}`,
      oldValue: { tableId: sourceTableId, tableNumber: source.number },
      newValue: { tableId: targetTableId, tableNumber: target.number },
      metadata: {
        fromTableNumber: source.number,
        toTableNumber: target.number,
        orderNumber: updated.orderNumber,
        amount: Number(updated.finalAmount),
      },
    });
    return updated;
  }

  /** Передать стол (активный заказ) другому официанту. */
  async transferTable(sourceTableId: string, waiterId: string, actor: AuditActor) {
    const byUserId = actor.id;
    const order = await this.activeOrderForTable(sourceTableId);
    if (!order) throw new BadRequestException('У стола нет активного заказа для передачи');
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }

    const waiter = await this.prisma.user.findUnique({ where: { id: waiterId } });
    if (!waiter || waiter.role !== Role.WAITER || !waiter.isActive) {
      throw new BadRequestException('Официант недоступен');
    }
    if (waiter.id === order.waiterId) {
      throw new BadRequestException('Стол уже закреплён за этим официантом');
    }

    const shift = await this.prisma.waiterShift.findFirst({
      where: { waiterId, status: WaiterShiftStatus.active },
    });
    const fromWaiterId = order.waiterId;

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { waiterId, waiterShiftId: shift?.id ?? null },
      include: orderInclude,
    });

    // История передачи (ТЗ §18 — audit log).
    const fromWaiter = await this.prisma.user.findUnique({
      where: { id: fromWaiterId },
      select: { name: true },
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.TABLE_TRANSFERRED,
      entityType: AuditEntity.ORDER,
      entityId: order.id,
      orderId: order.id,
      tableId: sourceTableId,
      description: `${actor.name ?? 'Сотрудник'} передал стол ${updated.table.number} официанту ${waiter.name}`,
      oldValue: { waiterId: fromWaiterId, waiterName: fromWaiter?.name },
      newValue: { waiterId, waiterName: waiter.name },
      metadata: {
        tableNumber: updated.table.number,
        orderNumber: updated.orderNumber,
        fromWaiterName: fromWaiter?.name,
        toWaiterName: waiter.name,
      },
    });

    this.emitStatusChanged(updated);
    this.notifyWaiter(waiterId, `Вам передан стол №${updated.table.number}`, updated, 'info');
    // Бывшему официанту — только если передачу сделал не он сам (напр. админ).
    if (fromWaiterId !== waiterId && fromWaiterId !== byUserId) {
      this.notifyWaiter(
        fromWaiterId,
        `Стол №${updated.table.number} передан официанту ${waiter.name}`,
        updated,
        'info',
      );
    }
    return updated;
  }

  /** Официанты на активной смене — для модалки «Передать стол». */
  async availableWaiters() {
    const shifts = await this.prisma.waiterShift.findMany({
      where: { status: WaiterShiftStatus.active, waiter: { isActive: true, role: Role.WAITER } },
      select: { waiterId: true, waiter: { select: { id: true, name: true } } },
      orderBy: { startedAt: 'asc' },
    });
    const seen = new Set<string>();
    const list: { id: string; name: string }[] = [];
    for (const s of shifts) {
      if (!seen.has(s.waiterId)) {
        seen.add(s.waiterId);
        list.push({ id: s.waiter.id, name: s.waiter.name });
      }
    }
    return list;
  }

  // ---------- Real-time helpers ----------

  private isUniqueConstraintError(err: unknown) {
    return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
  }

  private emitStatusChanged(order: { waiterId: string } & Record<string, unknown>) {
    // Полная отмена/отказ — добавляем озвучку «Заказ номер … отменён» (ТЗ §4).
    const status = order.status as OrderStatus | undefined;
    let payload = order;
    if (status === OrderStatus.cancelled || status === OrderStatus.rejected) {
      payload = { ...order, voice: { text: buildCancelText({ orderNumber: String(order.orderNumber) }) } };
    }
    this.events.emitToWaiter(order.waiterId, SERVER_EVENTS.ORDER_STATUS_CHANGED, payload);
    this.events.emitToKitchen(SERVER_EVENTS.ORDER_STATUS_CHANGED, payload);
    this.events.emitToAdmin(SERVER_EVENTS.ORDER_STATUS_CHANGED, payload);
  }

  private emitTableStatus(id: string, number: number, status: TableStatus, hallId: string) {
    this.events.emitBroadcast(SERVER_EVENTS.TABLE_STATUS_CHANGED, { id, number, status, hallId });
  }

  private notifyWaiter(
    waiterId: string,
    message: string,
    order: { id: string; orderNumber: string },
    type: 'info' | 'success' | 'error' = 'info',
  ) {
    const payload = {
      message,
      type,
      orderId: order.id,
      orderNumber: order.orderNumber,
      at: new Date().toISOString(),
    };
    this.events.emitToWaiter(waiterId, SERVER_EVENTS.NOTIFICATION_NEW, {
      ...payload,
    });
    void this.push.notifyWaiter(waiterId, {
      title: 'EDU POS',
      body: message,
      type,
      orderId: order.id,
      orderNumber: order.orderNumber,
      url: '/waiter',
    });
  }

  private notifyKitchenNewOrder(order: { id: string; orderNumber: string; table: { number: number } }) {
    return this.push.notifyRole(Role.KITCHEN, {
      title: 'EDU POS',
      body: `Новый заказ ${order.orderNumber} · Стол ${order.table.number}`,
      type: 'info',
      orderId: order.id,
      orderNumber: order.orderNumber,
      url: '/kitchen',
    });
  }
}
