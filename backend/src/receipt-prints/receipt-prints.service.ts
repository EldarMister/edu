import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, ReceiptPrintStatus, ReceiptPrintType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import type { AuditActor } from '../audit/audit.service';

const withWaiter = {
  waiter: { select: { id: true, name: true } },
} satisfies Prisma.ReceiptPrintRequestInclude;

type RequestWithWaiter = Prisma.ReceiptPrintRequestGetPayload<{ include: typeof withWaiter }>;
type PrintableOrder = Prisma.OrderGetPayload<{
  include: {
    table: { select: { number: true } };
    waiter: { select: { id: true; name: true } };
  };
}>;
const REQUEST_TTL_MS = 2 * 60 * 60 * 1000;
const PRINTABLE_ORDER_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReceiptPrintsService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
  ) {}

  private serialize(r: RequestWithWaiter) {
    return {
      id: r.id,
      source: 'request',
      priority: true,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      tableNumber: r.tableNumber,
      type: r.type,
      waiterId: r.waiterId,
      waiterName: r.waiter?.name ?? '',
      amount: String(r.amount),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    };
  }

  private withRequestVoice(dto: ReturnType<ReceiptPrintsService['serialize']>) {
    const documentName = dto.type === ReceiptPrintType.preliminary ? 'счёта' : 'чека';
    return {
      ...dto,
      voice: {
        text: `Официант ${dto.waiterName} отправил заявку на печать ${documentName}. Стол ${dto.tableNumber}.`,
      },
    };
  }

  private serializeOrder(order: PrintableOrder) {
    const type =
      order.status === OrderStatus.waiting_payment ? ReceiptPrintType.preliminary : ReceiptPrintType.receipt;
    return {
      id: `order:${type}:${order.id}`,
      source: 'order',
      priority: false,
      orderId: order.id,
      orderNumber: order.orderNumber,
      tableNumber: order.table.number,
      type,
      waiterId: order.waiterId,
      waiterName: order.waiter?.name ?? '',
      amount: String(order.finalAmount),
      status: null,
      createdAt: order.createdAt.toISOString(),
      decidedAt: null,
    };
  }

  private async purgeExpired() {
    const cutoff = new Date(Date.now() - REQUEST_TTL_MS);
    await this.prisma.receiptPrintRequest.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    });
  }

  /** Официант создаёт запрос на печать чека. Запрос уходит администратору. */
  async create(
    actor: AuditActor,
    orderId: string,
    type: ReceiptPrintType = ReceiptPrintType.receipt,
  ) {
    await this.purgeExpired();

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { table: { select: { number: true } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }

    // Уже есть активный (ожидающий) запрос того же типа по заказу — вернём его, не дублируем.
    const existing = await this.prisma.receiptPrintRequest.findFirst({
      where: { orderId, type, status: ReceiptPrintStatus.pending },
      include: withWaiter,
    });
    if (existing) return this.serialize(existing);

    const request = await this.prisma.receiptPrintRequest.create({
      data: {
        orderId,
        waiterId: order.waiterId,
        tableNumber: order.table.number,
        orderNumber: order.orderNumber,
        amount: order.finalAmount,
        type,
        status: ReceiptPrintStatus.pending,
      },
      include: withWaiter,
    });

    const dto = this.withRequestVoice(this.serialize(request));
    // Заявка сразу появляется только у администраторов.
    this.events.emitToAdminOnly(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_CREATED, dto);
    return dto;
  }

  /** Список для администратора: приоритетные заявки официантов + заказы, доступные к печати 24 часа. */
  async listPending() {
    await this.purgeExpired();

    const printableCutoff = new Date(Date.now() - PRINTABLE_ORDER_TTL_MS);

    const [requests, orders] = await Promise.all([
      this.prisma.receiptPrintRequest.findMany({
        where: { status: { in: [ReceiptPrintStatus.pending, ReceiptPrintStatus.approved] } },
        orderBy: { createdAt: 'asc' },
        include: withWaiter,
      }),
      this.prisma.order.findMany({
        where: {
          OR: [
            { status: OrderStatus.waiting_payment, updatedAt: { gte: printableCutoff } },
            { status: OrderStatus.paid, closedAt: { gte: printableCutoff } },
            { status: OrderStatus.paid, closedAt: null, updatedAt: { gte: printableCutoff } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          table: { select: { number: true } },
          waiter: { select: { id: true, name: true } },
        },
      }),
    ]);

    const activeRequestKeys = new Set(requests.map((r) => `${r.orderId}:${r.type}`));
    const printableOrders = orders.filter((order) => {
      const type =
        order.status === OrderStatus.waiting_payment ? ReceiptPrintType.preliminary : ReceiptPrintType.receipt;
      return !activeRequestKeys.has(`${order.id}:${type}`);
    });

    return [
      ...requests.map((r) => this.serialize(r)),
      ...printableOrders.map((order) => this.serializeOrder(order)),
    ];
  }

  /** Администратор принимает заявку: дальше админское устройство печатает документ. */
  async approve(actor: AuditActor, id: string) {
    await this.purgeExpired();
    const request = await this.getPending(id);

    const updated = await this.prisma.receiptPrintRequest.update({
      where: { id },
      data: {
        status: ReceiptPrintStatus.approved,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
      include: withWaiter,
    });
    const dto = this.serialize(updated);

    this.events.emitToWaiter(request.waiterId, SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, dto);
    this.events.emitToAdminOnly(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, dto);
    return dto;
  }

  /** Администраторское устройство подтвердило фактическую печать. */
  async markPrinted(actor: AuditActor, id: string) {
    await this.purgeExpired();
    const request = await this.prisma.receiptPrintRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Заявка не найдена');
    if (request.status === ReceiptPrintStatus.printed) {
      const printed = await this.prisma.receiptPrintRequest.findUniqueOrThrow({ where: { id }, include: withWaiter });
      return this.serialize(printed);
    }
    if (request.status !== ReceiptPrintStatus.approved) {
      throw new BadRequestException('Заявка ещё не подтверждена');
    }

    const updated = await this.prisma.receiptPrintRequest.update({
      where: { id },
      data: {
        status: ReceiptPrintStatus.printed,
        decidedById: request.decidedById ?? actor.id,
        decidedAt: request.decidedAt ?? new Date(),
      },
      include: withWaiter,
    });
    const dto = this.serialize(updated);

    this.events.emitToWaiter(request.waiterId, SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, dto);
    this.events.emitToAdminOnly(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, dto);
    return dto;
  }

  /** Администратор отклоняет заявку: чек не печатается → статус rejected. */
  async reject(actor: AuditActor, id: string) {
    await this.purgeExpired();
    const request = await this.getPending(id);

    const updated = await this.prisma.receiptPrintRequest.update({
      where: { id },
      data: {
        status: ReceiptPrintStatus.rejected,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
      include: withWaiter,
    });
    const dto = this.serialize(updated);

    this.events.emitToWaiter(request.waiterId, SERVER_EVENTS.RECEIPT_PRINT_REQUEST_REJECTED, dto);
    this.events.emitToAdminOnly(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_REJECTED, dto);
    return dto;
  }

  private async getPending(id: string) {
    const request = await this.prisma.receiptPrintRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Заявка не найдена');
    if (request.status !== ReceiptPrintStatus.pending) {
      throw new BadRequestException('Заявка уже обработана');
    }
    return request;
  }
}
