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
  TableStatus,
  KitchenEventType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { WaiterShiftsService } from '../waiter-shifts/waiter-shifts.service';
import { CreateOrderDto, CreateOrderItemDto } from './dto/create-order.dto';
import { orderInclude, unitPricing, round2 } from './order.helpers';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private shifts: WaiterShiftsService,
  ) {}

  // ---------- Чтение ----------

  findById(id: string) {
    return this.prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
  }

  /** Активные заказы официанта (не закрытые). */
  findActiveForWaiter(waiterId: string) {
    return this.prisma.order.findMany({
      where: {
        waiterId,
        status: { notIn: [OrderStatus.paid, OrderStatus.cancelled] },
      },
      orderBy: { createdAt: 'desc' },
      include: orderInclude,
    });
  }

  // ---------- Создание заказа (официант → кухня) ----------

  async create(waiterId: string, dto: CreateOrderDto) {
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

    const itemsData = await this.buildItemsData(dto.items);
    const totals = this.calcTotals(itemsData);

    const order = await this.prisma.$transaction(async (tx) => {
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

    // Real-time: кухня получает новый заказ, все видят смену статуса стола.
    this.events.emitToKitchen(SERVER_EVENTS.KITCHEN_NEW_ORDER, order);
    this.events.emitToKitchen(SERVER_EVENTS.ORDER_NEW, order);
    this.events.emitBroadcast(SERVER_EVENTS.TABLE_STATUS_CHANGED, {
      id: table.id,
      number: table.number,
      status: TableStatus.sent_to_kitchen,
      hallId: table.hallId,
    });
    this.notifyWaiter(waiterId, `Заказ ${order.orderNumber} отправлен на кухню`, order);

    return order;
  }

  /** Добавить блюда к существующему заказу того же стола. */
  async addItems(orderId: string, waiterId: string, items: CreateOrderItemDto[]) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (order.waiterId !== waiterId) {
      throw new ForbiddenException('Это не ваш заказ');
    }
    if (([OrderStatus.paid, OrderStatus.cancelled] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Заказ уже закрыт');
    }

    const activeShift = await this.shifts.getRequiredActiveShift(waiterId);
    if (order.waiterShiftId && order.waiterShiftId !== activeShift.id) {
      throw new BadRequestException('Этот заказ относится к другой смене.');
    }

    const itemsData = await this.buildItemsData(items);

    await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.createMany({
        data: itemsData.map((i) => ({ ...i, orderId })),
      });
      await this.recalcOrder(tx, orderId);
      // Новые блюда снова уходят на кухню.
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.sent_to_kitchen, waiterShiftId: order.waiterShiftId ?? activeShift.id },
      });
    });

    const updated = await this.findById(orderId);
    this.events.emitToKitchen(SERVER_EVENTS.KITCHEN_NEW_ORDER, updated);
    this.emitStatusChanged(updated);
    return updated;
  }

  // ---------- Действия кухни ----------

  async kitchenAccept(orderId: string, kitchenUserId: string) {
    const order = await this.getMutableOrder(orderId);
    const updated = await this.prisma.$transaction(async (tx) => {
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
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.accepted_by_kitchen },
        include: orderInclude,
      });
    });

    this.emitStatusChanged(updated);
    this.emitTableStatus(updated.table.id, updated.table.number, TableStatus.accepted, updated.table.hallId);
    this.notifyWaiter(
      updated.waiterId,
      `Стол №${updated.table.number}: кухня приняла заказ`,
      updated,
    );
    return updated;
  }

  async kitchenReady(orderId: string, kitchenUserId: string) {
    const order = await this.getMutableOrder(orderId);
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
    );
    return updated;
  }

  /** Отказ по всему заказу с причиной. */
  async kitchenRejectOrder(orderId: string, kitchenUserId: string, reason: string, comment?: string) {
    const order = await this.getMutableOrder(orderId);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.orderItem.updateMany({
        where: { orderId, status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] } },
        data: { status: OrderItemStatus.rejected, rejectReason: reason },
      });
      await tx.kitchenEvent.create({
        data: { orderId, type: KitchenEventType.reject_order, reason, comment, createdById: kitchenUserId },
      });
      const o = await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.rejected },
        include: orderInclude,
      });
      return o;
    });

    this.emitStatusChanged(updated);
    this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.WAITER_ORDER_REJECTED, updated);
    this.notifyWaiter(
      updated.waiterId,
      `Стол №${updated.table.number}. Кухня отказала в заказе. Причина: ${reason}`,
      updated,
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
    await this.getMutableOrder(orderId);
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
      const o = await tx.order.update({
        where: { id: orderId },
        data: {
          status: remaining === 0 ? OrderStatus.rejected : OrderStatus.partially_rejected,
        },
        include: orderInclude,
      });
      return o;
    });

    this.emitStatusChanged(updated);
    this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.WAITER_ORDER_REJECTED, updated);
    this.notifyWaiter(
      updated.waiterId,
      `Стол №${updated.table.number}. Отказано: ${item.dishNameSnapshot}. Причина: ${reason}`,
      updated,
    );
    return updated;
  }

  // ---------- Действия официанта после готовности ----------

  async pickedUp(orderId: string, waiterId: string) {
    const order = await this.assertOwnedOrder(orderId, waiterId);
    if (!([OrderStatus.ready, OrderStatus.partially_rejected] as OrderStatus[]).includes(order.status)) {
      throw new BadRequestException('Заказ ещё не готов');
    }
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.picked_up },
      include: orderInclude,
    });
    this.emitStatusChanged(updated);
    return updated;
  }

  async served(orderId: string, waiterId: string) {
    const order = await this.assertOwnedOrder(orderId, waiterId);
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
        data: { status: OrderStatus.served },
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
  async markPaid(orderId: string, cashierId: string, method: PaymentMethod) {
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

  // ---------- Real-time helpers ----------

  private emitStatusChanged(order: { waiterId: string } & Record<string, unknown>) {
    this.events.emitToWaiter(order.waiterId, SERVER_EVENTS.ORDER_STATUS_CHANGED, order);
    this.events.emitToKitchen(SERVER_EVENTS.ORDER_STATUS_CHANGED, order);
    this.events.emitToAdmin(SERVER_EVENTS.ORDER_STATUS_CHANGED, order);
  }

  private emitTableStatus(id: string, number: number, status: TableStatus, hallId: string) {
    this.events.emitBroadcast(SERVER_EVENTS.TABLE_STATUS_CHANGED, { id, number, status, hallId });
  }

  private notifyWaiter(waiterId: string, message: string, order: { id: string; orderNumber: string }) {
    this.events.emitToWaiter(waiterId, SERVER_EVENTS.NOTIFICATION_NEW, {
      message,
      orderId: order.id,
      orderNumber: order.orderNumber,
      at: new Date().toISOString(),
    });
  }
}
