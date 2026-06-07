import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReceiptPrintStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import type { AuditActor } from '../audit/audit.service';

const withWaiter = {
  waiter: { select: { id: true, name: true } },
} satisfies Prisma.ReceiptPrintRequestInclude;

type RequestWithWaiter = Prisma.ReceiptPrintRequestGetPayload<{ include: typeof withWaiter }>;

@Injectable()
export class ReceiptPrintsService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
  ) {}

  private serialize(r: RequestWithWaiter) {
    return {
      id: r.id,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      tableNumber: r.tableNumber,
      waiterId: r.waiterId,
      waiterName: r.waiter?.name ?? '',
      amount: String(r.amount),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    };
  }

  /** Официант создаёт запрос на печать чека. Запрос уходит администратору. */
  async create(actor: AuditActor, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { table: { select: { number: true } } },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }

    // Уже есть активный (ожидающий) запрос по этому заказу — вернём его, не дублируем.
    const existing = await this.prisma.receiptPrintRequest.findFirst({
      where: { orderId, status: ReceiptPrintStatus.pending },
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
        status: ReceiptPrintStatus.pending,
      },
      include: withWaiter,
    });

    const dto = this.serialize(request);
    // Заявка сразу появляется у администратора.
    this.events.emitToAdmin(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_CREATED, dto);
    return dto;
  }

  /** Список ожидающих заявок для администратора. */
  async listPending() {
    const items = await this.prisma.receiptPrintRequest.findMany({
      where: { status: ReceiptPrintStatus.pending },
      orderBy: { createdAt: 'asc' },
      include: withWaiter,
    });
    return items.map((r) => this.serialize(r));
  }

  /** Администратор принимает заявку: чек печатается → статус printed. */
  async approve(actor: AuditActor, id: string) {
    const request = await this.getPending(id);

    // Печать выполняется на устройстве официанта (window.print). Считаем,
    // что отправка на печать успешна → статус printed.
    const updated = await this.prisma.receiptPrintRequest.update({
      where: { id },
      data: {
        status: ReceiptPrintStatus.printed,
        decidedById: actor.id,
        decidedAt: new Date(),
      },
      include: withWaiter,
    });
    const dto = this.serialize(updated);

    // Официанту: сначала «подтверждено», затем «распечатано».
    this.events.emitToWaiter(request.waiterId, SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, dto);
    this.events.emitToWaiter(request.waiterId, SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, dto);
    // Другим админам — убрать заявку из списка.
    this.events.emitToAdmin(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, dto);
    return dto;
  }

  /** Администратор отклоняет заявку: чек не печатается → статус rejected. */
  async reject(actor: AuditActor, id: string) {
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
    this.events.emitToAdmin(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_REJECTED, dto);
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
