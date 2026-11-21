import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderRefundStatus, PaymentStatus, Prisma, Role, type OrderRefund } from '@prisma/client';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { assertAdminSectionAccess } from '../common/admin-section-access';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { recordRefundReceipts } from '../finance/refund-order-receipts';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { IngredientStockService } from '../warehouse/ingredient-stock.service';
import type { CreateOrderRefundDto, OrderRefundApprovalDto, OrderRefundSelectionDto } from './dto/order-refund.dto';
import { lockOrder } from './order-lock';
import { buildRefundPlan, refundOrderInclude, requiresFiscalRefund, type RefundOrder, type RefundPlan } from './order-refund-plan';

const refundOrderDetails = {
  select: { id: true, orderNumber: true, source: true, fiscalReceiptNumber: true, fiscalizedAt: true, table: { select: { number: true } } },
} satisfies Prisma.OrderDefaultArgs;
type RefundOrderDetails = Prisma.OrderGetPayload<typeof refundOrderDetails>;
type RefundWithOrder = OrderRefund & { order: RefundOrderDetails };

function serialize(refund: RefundWithOrder) {
  const { order, cafeId: _cafeId, taxReversals: _taxes, quoteVersion: _version, ...details } = refund;
  return {
    ...details, amount: details.amount.toFixed(2), orderNumber: order.orderNumber, source: order.source,
    tableNumber: order.table.number, requireFiscalReference: requiresFiscalRefund(order),
  };
}

@Injectable()
export class OrderRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventsGateway,
    private readonly ingredientStock: IngredientStockService,
  ) {}

  private assertReviewer(actor: AuthUser) {
    if (actor.role !== Role.OWNER && actor.role !== Role.ADMIN) throw new ForbiddenException('Возврат подтверждает администратор');
    assertAdminSectionAccess(actor, 'orders', true);
    assertAdminSectionAccess(actor, 'checks', true, 'refundChecks');
  }

  private async loadOrder(db: Prisma.TransactionClient, actor: AuthUser, orderId: string) {
    if (actor.role !== Role.WAITER) this.assertReviewer(actor);
    const order = await db.order.findUnique({ where: { id: orderId, cafeId: actor.cafeId }, include: refundOrderInclude });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) throw new ForbiddenException('Это не ваш заказ');
    return order;
  }

  private async findPending(db: Prisma.TransactionClient, orderId: string) {
    return db.orderRefund.findFirst({ where: { orderId, status: OrderRefundStatus.pending }, select: { id: true } });
  }

  async quote(actor: AuthUser, orderId: string, selection: OrderRefundSelectionDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrder(tx, actor, orderId);
      if (await this.findPending(tx, orderId)) throw new ConflictException('По заказу уже есть заявка на возврат');
      const plan = buildRefundPlan(order, selection);
      return {
        amount: plan.amount, items: plan.items, paymentParts: plan.paymentParts, version: plan.version,
        requireFiscalReference: plan.requireFiscalReference,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async history(actor: AuthUser, orderId: string) {
    await this.loadOrder(this.prisma, actor, orderId);
    const refunds = await this.prisma.orderRefund.findMany({
      where: { cafeId: actor.cafeId, orderId }, include: { order: refundOrderDetails },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
    });
    return refunds.map(serialize);
  }

  async pending(actor: AuthUser) {
    this.assertReviewer(actor);
    const requests = await this.prisma.orderRefund.findMany({
      where: { cafeId: actor.cafeId, status: OrderRefundStatus.pending }, include: { order: refundOrderDetails },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return requests.map(serialize);
  }

  async create(actor: AuthUser, orderId: string, dto: CreateOrderRefundDto, direct: boolean) {
    if (direct) this.assertReviewer(actor);
    else if (actor.role !== Role.WAITER) throw new ForbiddenException('Отправьте заявку из кассы');
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Укажите причину возврата');

    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const order = await this.loadOrder(tx, actor, orderId);
      const existing = await tx.orderRefund.findUnique({
        where: { id: dto.requestId, cafeId: actor.cafeId }, include: { order: refundOrderDetails },
      });
      if (existing) {
        if (existing.orderId !== orderId || existing.requestedById !== actor.id || (direct && existing.status !== 'approved')) {
          throw new ConflictException('Ключ операции уже использован');
        }
        return { refund: existing, waiterId: order.waiterId, changed: false };
      }
      if (await this.findPending(tx, orderId)) throw new ConflictException('По заказу уже есть заявка на возврат');

      const plan = buildRefundPlan(order, dto);
      if (plan.version !== dto.quoteVersion) throw new ConflictException('Сумма или состав возврата изменились. Рассчитайте возврат заново.');
      let refund = await tx.orderRefund.create({
        data: {
          id: dto.requestId, cafeId: order.cafeId, orderId: order.id, itemId: dto.itemId ?? null,
          quantity: dto.itemId ? plan.items[0].quantity : null, reason, amount: plan.amount, items: plan.items,
          paymentParts: plan.paymentParts, taxReversals: plan.taxReversals, quoteVersion: plan.version,
          requestedById: actor.id, requestedByName: actor.name,
        },
        include: { order: refundOrderDetails },
      });
      if (direct) refund = await this.apply(tx, actor, order, refund, plan, dto.approval ?? {});
      return { refund, waiterId: order.waiterId, changed: true };
    });
    if (result.changed) await this.notify(actor, result.refund, result.waiterId);
    return serialize(result.refund);
  }

  async decide(actor: AuthUser, id: string, status: 'approved' | 'rejected', approval: OrderRefundApprovalDto = {}) {
    this.assertReviewer(actor);
    const existing = await this.prisma.orderRefund.findUnique({ where: { id, cafeId: actor.cafeId }, select: { orderId: true } });
    if (!existing) throw new NotFoundException('Заявка на возврат не найдена');
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, existing.orderId);
      const order = await this.loadOrder(tx, actor, existing.orderId);
      const refund = await tx.orderRefund.findUniqueOrThrow({ where: { id, cafeId: actor.cafeId }, include: { order: refundOrderDetails } });
      if (refund.status === status) return { refund, waiterId: order.waiterId, changed: false };
      if (refund.status !== 'pending') throw new ConflictException('Заявку уже рассмотрели');

      if (status === 'rejected') {
        const rejected = await tx.orderRefund.update({
          where: { id }, data: { status, decidedAt: new Date(), decidedById: actor.id, decidedByName: actor.name },
          include: { order: refundOrderDetails },
        });
        return { refund: rejected, waiterId: order.waiterId, changed: true };
      }
      const plan = buildRefundPlan(order, { itemId: refund.itemId ?? undefined, quantity: refund.quantity ?? undefined });
      if (plan.version !== refund.quoteVersion) throw new ConflictException('Заказ изменился. Отклоните заявку и создайте новую.');
      const approved = await this.apply(tx, actor, order, refund, plan, approval);
      return { refund: approved, waiterId: order.waiterId, changed: true };
    });
    if (result.changed) await this.notify(actor, result.refund, result.waiterId);
    return serialize(result.refund);
  }

  private async apply(
    tx: Prisma.TransactionClient, actor: AuthUser, order: RefundOrder, refund: OrderRefund, plan: RefundPlan, approval: OrderRefundApprovalDto,
  ) {
    if (plan.paymentParts.length && !approval.fundsReturned) {
      throw new BadRequestException('Подтвердите, что деньги возвращены гостю указанными способами');
    }
    const reference = approval.fiscalRefundReference?.trim() || null;
    if (plan.requireFiscalReference && !reference) throw new BadRequestException('Укажите номер чека возврата ККМ');
    if (reference && await tx.orderRefund.findFirst({ where: { orderId: order.id, fiscalRefundReference: reference } })) {
      throw new ConflictException('Этот чек возврата ККМ уже привязан к операции');
    }

    const now = new Date();
    // Stock cancellation and payment both lock the order first. Use the same order of locks.
    const restockedGoods = approval.restockGoods === true && plan.items.length > 0
      ? await this.ingredientStock.restockPaidGoods(tx, order.id, refund.id, plan.items.map(({ itemId, quantity }) => ({
        item: order.items.find((item) => item.id === itemId)!, quantity,
      })), refund.reason)
      : false;
    if (order.cafeId) await recordRefundReceipts(tx, order.cafeId, actor.id, refund.id, order.orderNumber, plan.paymentParts, now);

    for (const { paymentId, amount } of plan.paymentParts) {
      if (paymentId) await tx.payment.update({ where: { id: paymentId }, data: { refundedAmount: { increment: amount } } });
    }
    for (const { itemId, quantity } of plan.items) {
      const item = order.items.find(({ id }) => id === itemId)!;
      await tx.orderItem.update({
        where: { id: itemId }, data: { refundedQuantity: { increment: quantity }, updatedAt: item.updatedAt },
      });
    }
    await tx.order.update({
      where: { id: order.id },
      data: { refundedAmount: { increment: plan.amount }, paymentStatus: plan.fullyRefunded ? PaymentStatus.refunded : PaymentStatus.paid },
    });
    return tx.orderRefund.update({
      where: { id: refund.id },
      data: {
        status: 'approved', decidedAt: now, decidedById: actor.id, decidedByName: actor.name,
        fiscalRefundReference: reference, restockedGoods,
      },
      include: { order: refundOrderDetails },
    });
  }

  private async notify(actor: AuthUser, refund: RefundWithOrder, waiterId: string | null) {
    const event = {
      cafeId: refund.cafeId, orderId: refund.orderId, orderNumber: refund.order.orderNumber, status: refund.status, refundId: refund.id,
    };
    this.events.emitToAdmin(SERVER_EVENTS.ORDER_REFUND_UPDATED, event);
    for (const userId of new Set([waiterId, refund.requestedById])) {
      this.events.emitToWaiter(userId, SERVER_EVENTS.ORDER_REFUND_UPDATED, event);
    }
    if (refund.restockedGoods) this.events.emitToAdmin(SERVER_EVENTS.WAREHOUSE_UPDATED, { cafeId: refund.cafeId });
    const action = refund.status === 'pending' ? 'Запрошен возврат' : refund.status === 'approved' ? 'Проведён возврат' : 'Отклонён возврат';
    await this.audit.log({
      actor, actionType: AuditAction.ORDER_REFUND, entityType: AuditEntity.PAYMENT, entityId: refund.id, orderId: refund.orderId,
      description: action + ' по заказу ' + refund.order.orderNumber,
      metadata: {
        status: refund.status, itemId: refund.itemId, quantity: refund.quantity, reason: refund.reason,
        amount: refund.amount.toString(), fiscalRefundReference: refund.fiscalRefundReference, restockedGoods: refund.restockedGoods,
      },
    });
  }
}
