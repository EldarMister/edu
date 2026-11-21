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
import { FiscalService } from '../fiscal/fiscal.service';
import type { AuditActor } from '../audit/audit.service';
import { PushService } from '../push/push.service';
import { lockOrder } from '../orders/order-lock';
import { RECEIPT_REQUEST_TTL_MS } from './receipt-print-access';

const withWaiter = {
  waiter: { select: { id: true, name: true } },
  order: { select: { source: true } },
} satisfies Prisma.ReceiptPrintRequestInclude;

type RequestWithWaiter = Prisma.ReceiptPrintRequestGetPayload<{ include: typeof withWaiter }>;
type PrintableOrder = Prisma.OrderGetPayload<{
  include: {
    table: { select: { number: true } };
    waiter: { select: { id: true; name: true } };
  };
}>;
const PRINTABLE_ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const PRELIMINARY_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.sent_to_kitchen,
  OrderStatus.accepted_by_kitchen,
  OrderStatus.cooking,
  OrderStatus.ready,
  OrderStatus.picked_up,
  OrderStatus.served,
  OrderStatus.waiting_payment,
  OrderStatus.partially_rejected,
];

const UNITS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function numberToWordsRu(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1000) return String(n);
  if (n === 0) return UNITS[0];
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) parts.push(TENS[t]);
    if (u) parts.push(UNITS[u]);
  }
  return parts.join(' ');
}

function tableNumberVoice(value: number): string {
  return Number.isInteger(value) ? numberToWordsRu(value) : String(value);
}

@Injectable()
export class ReceiptPrintsService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private fiscal: FiscalService,
    private push: PushService,
  ) {}

  private serialize(r: RequestWithWaiter) {
    return {
      id: r.id,
      source: 'request',
      priority: true,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      orderSource: r.order.source,
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
    const delivery = dto.orderSource === 'delivery';
    const place = delivery ? 'Доставка' : `Стол номер ${tableNumberVoice(dto.tableNumber)}`;
    return {
      ...dto,
      voice: {
        text: `${delivery ? '' : 'Официант '}${dto.waiterName} отправил заявку на печать ${documentName}. ${place}.`,
      },
    };
  }

  private serializeOrder(order: PrintableOrder) {
    const type =
      order.status === OrderStatus.paid ? ReceiptPrintType.receipt : ReceiptPrintType.preliminary;
    return {
      id: `order:${type}:${order.id}`,
      source: 'order',
      priority: false,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderSource: order.source,
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
    const cutoff = new Date(Date.now() - RECEIPT_REQUEST_TTL_MS);
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

    const { request, created, cafeId } = await this.prisma.$transaction(async (tx) => {
      await lockOrder(tx, orderId);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { table: { select: { number: true } } },
      });
      if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
        throw new ForbiddenException('Это не ваш заказ');
      }
      if (!order.waiterId) {
        throw new BadRequestException('У заказа нет официанта — печать через раздел администратора');
      }
      if (type === ReceiptPrintType.receipt && order.status !== OrderStatus.paid) {
        throw new BadRequestException('Чек можно запросить после оплаты');
      }
      if (type === ReceiptPrintType.preliminary && !PRELIMINARY_ORDER_STATUSES.includes(order.status) && order.status !== OrderStatus.draft) {
        throw new BadRequestException('Счёт доступен для открытого заказа');
      }
      const existing = await tx.receiptPrintRequest.findFirst({
        where: { orderId, type, status: { in: [ReceiptPrintStatus.pending, ReceiptPrintStatus.approved] } },
        orderBy: { createdAt: 'asc' },
        include: withWaiter,
      });
      if (existing) return { request: existing, created: false, cafeId: order.cafeId };

      const request = await tx.receiptPrintRequest.create({
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
      return { request, created: true, cafeId: order.cafeId };
    });
    if (!created) return this.serialize(request);
    const dto = this.withRequestVoice(this.serialize(request));
    // Заявка сразу появляется только у администраторов.
    this.events.emitToReceiptPrinters(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_CREATED, dto);
    const place = dto.orderSource === 'delivery' ? 'Доставка' : `Стол ${dto.tableNumber}`;
    void this.push.notifyRole(Role.ADMIN, {
      title: 'Печать чека', body: `Заявка от ${dto.waiterName} · ${place}`,
      orderId: dto.orderId, orderNumber: dto.orderNumber, channel: 'payments',
      notificationId: `receipt:${dto.id}:created`, url: '/admin/receipts',
    }, cafeId);
    return dto;
  }

  /** Заявки всегда в приоритете. Остальные документы зависят от режима заведения. */
  async listPending(terminalId?: string) {
    await this.purgeExpired();

    const printableCutoff = new Date(Date.now() - PRINTABLE_ORDER_TTL_MS);

    const [requests, settings] = await Promise.all([
      this.prisma.receiptPrintRequest.findMany({
        where: { OR: [
          { status: ReceiptPrintStatus.pending },
          { status: ReceiptPrintStatus.approved, decidedById: terminalId },
        ] },
        orderBy: { createdAt: 'asc' },
        include: withWaiter,
      }),
      this.prisma.settings.findFirst({ select: { receiptPrintRequestsOnly: true } }),
    ]);
    if (settings?.receiptPrintRequestsOnly) return requests.map((request) => this.serialize(request));

    const orders = await this.prisma.order.findMany({
      where: {
        waiterId: terminalId,
        OR: [
          { status: { in: PRELIMINARY_ORDER_STATUSES }, updatedAt: { gte: printableCutoff } },
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
    });

    const activeRequestKeys = new Set(requests.map((r) => `${r.orderId}:${r.type}`));
    const printableOrders = orders.filter((order) => {
      const type =
        order.status === OrderStatus.paid ? ReceiptPrintType.receipt : ReceiptPrintType.preliminary;
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
    const updated = await this.decidePending(actor.id, id, ReceiptPrintStatus.approved);
    const dto = this.serialize(updated);

    this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, dto);
    this.events.emitToReceiptPrinters(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_APPROVED, dto);
    return dto;
  }

  /** Администраторское устройство подтвердило фактическую печать. */
  async markPrinted(actor: AuditActor, id: string) {
    await this.purgeExpired();
    const request = await this.prisma.receiptPrintRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Заявка не найдена');
    if (actor.role === Role.WAITER && request.decidedById !== actor.id) {
      throw new ForbiddenException('Заявку обрабатывает другой сотрудник');
    }
    if (request.status === ReceiptPrintStatus.printed) {
      const printed = await this.prisma.receiptPrintRequest.findUniqueOrThrow({ where: { id }, include: withWaiter });
      return this.serialize(printed);
    }
    if (request.status !== ReceiptPrintStatus.approved) {
      throw new BadRequestException('Заявка ещё не подтверждена');
    }

    const result = await this.prisma.receiptPrintRequest.updateMany({
      where: { id, status: ReceiptPrintStatus.approved },
      data: {
        status: ReceiptPrintStatus.printed,
        decidedById: request.decidedById ?? actor.id,
        decidedAt: request.decidedAt ?? new Date(),
      },
    });
    const updated = await this.prisma.receiptPrintRequest.findUniqueOrThrow({ where: { id }, include: withWaiter });
    const dto = this.serialize(updated);
    if (!result.count) return dto;

    // ККМ: финальный (товарный) чек пробивается фискально, если подключён провайдер.
    // Предчек (preliminary) не фискализируется. Ошибка ККМ не блокирует flow печати —
    // FiscalService сам пишет результат/ошибку в заказ и при выключенной ККМ ничего не делает.
    if (request.type === ReceiptPrintType.receipt) {
      this.fiscal.fiscalizeOrder(request.orderId).catch(() => undefined);
    }

    this.events.emitToWaiter(request.waiterId, SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, dto);
    this.events.emitToReceiptPrinters(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_PRINTED, dto);
    const label = dto.type === ReceiptPrintType.preliminary ? 'Счёт' : 'Чек';
    void this.push.notifyWaiter(request.waiterId, {
      title: 'Печать завершена', body: `${label} ${dto.orderNumber} распечатан. Заберите ${label.toLowerCase()}.`,
      orderId: dto.orderId, orderNumber: dto.orderNumber, type: 'success', channel: 'payments',
      notificationId: `receipt:${dto.id}:printed`, url: '/waiter',
    });
    return dto;
  }

  /** Администратор отклоняет заявку: чек не печатается → статус rejected. */
  async reject(actor: AuditActor, id: string) {
    await this.purgeExpired();
    const updated = await this.decidePending(actor.id, id, ReceiptPrintStatus.rejected);
    const dto = this.serialize(updated);

    this.events.emitToWaiter(updated.waiterId, SERVER_EVENTS.RECEIPT_PRINT_REQUEST_REJECTED, dto);
    this.events.emitToReceiptPrinters(SERVER_EVENTS.RECEIPT_PRINT_REQUEST_REJECTED, dto);
    void this.push.notifyWaiter(updated.waiterId, {
      title: 'Печать отклонена', body: 'Печать чека отклонена администратором',
      orderId: dto.orderId, orderNumber: dto.orderNumber, type: 'error', channel: 'payments',
      notificationId: `receipt:${dto.id}:rejected`, url: '/waiter',
    });
    return dto;
  }

  private async decidePending(actorId: string, id: string, status: ReceiptPrintStatus) {
    try {
      return await this.prisma.receiptPrintRequest.update({
        where: { id, status: ReceiptPrintStatus.pending },
        data: { status, decidedById: actorId, decidedAt: new Date() },
        include: withWaiter,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new BadRequestException('Заявка уже обработана или недоступна');
      }
      throw error;
    }
  }
}
