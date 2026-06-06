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
  PaymentStatus,
  Prisma,
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
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { CreateOrderDto, CreateOrderItemDto } from './dto/create-order.dto';
import { orderInclude, unitPricing, round2 } from './order.helpers';

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

    const itemsData = await this.buildItemsData(dto.items);
    const totals = this.calcTotals(itemsData);

    let order: Awaited<ReturnType<typeof this.findById>>;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const activeShift = await this.shifts.getRequiredActiveShift(waiterId, tx);
        const orderNumber = await this.nextOrderNumber(tx);
        await tx.table.update({
          where: { id: dto.tableId },
          data: { status: TableStatus.sent_to_kitchen },
        });
        return tx.order.create({
          data: {
            orderNumber,
            tableId: dto.tableId,
            waiterId,
            waiterShiftId: activeShift.id,
            status: OrderStatus.sent_to_kitchen,
            comment: dto.comment,
            idempotencyKey: dto.idempotencyKey,
            totalAmount: totals.total,
            discountAmount: totals.discount,
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

    // Real-time: кухня получает новый заказ, все видят смену статуса стола.
    this.events.emitToKitchen(SERVER_EVENTS.KITCHEN_NEW_ORDER, order);
    this.events.emitToKitchen(SERVER_EVENTS.ORDER_NEW, order);
    void this.notifyKitchenNewOrder(order);
    this.events.emitBroadcast(SERVER_EVENTS.TABLE_STATUS_CHANGED, {
      id: table.id,
      number: table.number,
      status: TableStatus.sent_to_kitchen,
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
    if (([OrderStatus.paid, OrderStatus.cancelled] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Заказ уже закрыт и не может быть отменён');
    }

    const prevStatus = order.status;
    const updated = await this.prisma.$transaction(async (tx) => {
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

    const itemsData = await this.buildItemsData(items);

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
      await tx.orderItem.createMany({
        data: itemsData.map((i) => ({ ...i, orderId })),
      });
      await this.recalcOrder(tx, orderId);
      // Новые блюда снова уходят на кухню.
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.sent_to_kitchen,
          requiresWaiterDecision: false,
          waiterShiftId: activeShift.id,
        },
      });
      return true;
    });

    const updated = await this.findById(orderId);
    if (applied) {
      this.events.emitToKitchen(SERVER_EVENTS.KITCHEN_NEW_ORDER, updated);
      void this.notifyKitchenNewOrder(updated);
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
        newValue: { items: items.map((i) => ({ dishId: i.dishId, quantity: i.quantity })) },
        metadata: { tableNumber: updated.table.number, finalAmount: Number(updated.finalAmount) },
      });
    }
    return updated;
  }

  // ---------- Действия кухни ----------

  async kitchenAccept(orderId: string, kitchenUserId: string) {
    const order = await this.getMutableOrder(orderId);
    this.ensureNoPendingWaiterDecision(order);
    let applied = false;
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.sent_to_kitchen },
        data: { status: OrderStatus.accepted_by_kitchen },
      });
      if (changed.count === 0) {
        return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
      }
      applied = true;
      await tx.orderItem.updateMany({
        where: { orderId, status: OrderItemStatus.new },
        data: { status: OrderItemStatus.cooking },
      });
      await tx.kitchenEvent.create({
        data: { orderId, type: KitchenEventType.accept, createdById: kitchenUserId },
      });
      await tx.table.update({
        where: { id: order.tableId },
        data: { status: TableStatus.accepted },
      });
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    });

    if (applied) {
      this.emitStatusChanged(updated);
      this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.accepted, updated.table.hallId);
      this.notifyWaiter(
        updated.waiterId,
        `Стол №${updated.table.number}: кухня приняла заказ`,
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
    this.notifyWaiter(
      updated.waiterId,
      `Стол №${updated.table.number}. Кухня отказала блюдо: ${item.dishNameSnapshot}. Причина: ${reason}.${partialText}`,
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
  async markPaid(orderId: string, actor: AuditActor, method: PaymentMethod) {
    const cashierId = actor.id;
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.status === OrderStatus.paid) {
      return order;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const existingPayment = await tx.payment.findFirst({ where: { orderId, status: PaymentStatus.paid } });
      if (!existingPayment) {
        await tx.payment.create({
          data: {
            orderId,
            amount: order.finalAmount,
            method,
            status: PaymentStatus.paid,
            cashierId,
          },
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

  private async buildItemsData(items: CreateOrderItemDto[]): Promise<Prisma.OrderItemCreateManyOrderInput[]> {
    const dishIds = [...new Set(items.map((i) => i.dishId))];
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: dishIds }, isActive: true },
    });
    const byId = new Map(dishes.map((d) => [d.id, d]));

    return items.map((i) => {
      const dish = byId.get(i.dishId);
      if (!dish) {
        throw new BadRequestException(`Блюдо недоступно`);
      }
      if (!dish.isAvailable) {
        throw new BadRequestException(`Блюдо «${dish.name}» временно недоступно`);
      }
      const { unit, unitDiscount, unitFinal } = unitPricing(
        dish.price,
        dish.discountType,
        dish.discountValue,
      );
      return {
        dishId: dish.id,
        dishNameSnapshot: dish.name,
        priceSnapshot: new Prisma.Decimal(unit),
        quantity: i.quantity,
        discountAmount: new Prisma.Decimal(round2(unitDiscount * i.quantity)),
        finalPrice: new Prisma.Decimal(round2(unitFinal * i.quantity)),
        status: OrderItemStatus.new,
        comment: i.comment,
      };
    });
  }

  private calcTotals(items: Prisma.OrderItemCreateManyOrderInput[]) {
    let total = 0;
    let discount = 0;
    let final = 0;
    for (const i of items) {
      const qty = i.quantity ?? 1;
      total += Number(i.priceSnapshot) * qty;
      discount += Number(i.discountAmount ?? 0);
      final += Number(i.finalPrice);
    }
    return {
      total: new Prisma.Decimal(round2(total)),
      discount: new Prisma.Decimal(round2(discount)),
      final: new Prisma.Decimal(round2(final)),
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
    await tx.order.update({
      where: { id: orderId },
      data: {
        totalAmount: new Prisma.Decimal(round2(total)),
        discountAmount: new Prisma.Decimal(round2(discount)),
        finalAmount: new Prisma.Decimal(round2(final)),
      },
    });
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

  private async nextOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
    const count = await tx.order.count();
    const next = count + 1;
    return `№${next}`;
  }

  private async getMutableOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
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
    this.events.emitToWaiter(order.waiterId, SERVER_EVENTS.ORDER_STATUS_CHANGED, order);
    this.events.emitToKitchen(SERVER_EVENTS.ORDER_STATUS_CHANGED, order);
    this.events.emitToAdmin(SERVER_EVENTS.ORDER_STATUS_CHANGED, order);
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
