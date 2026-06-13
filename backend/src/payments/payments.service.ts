import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentMethod, PaymentSource, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';
import type { AuditActor } from '../audit/audit.service';
import type { PaymentPartDto } from './dto/pay.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
    private settings: SettingsService,
  ) {}

  /** Приём оплаты официантом/кассиром. Способ должен быть включён в настройках. */
  async pay(
    actor: AuditActor,
    orderId: string,
    method: PaymentMethod,
    cashAmount?: number,
    qrAmount?: number,
    splitPayments?: PaymentPartDto[],
  ) {
    if (splitPayments?.length) {
      const parts = splitPayments.filter((p) => p.amount > 0);
      if (parts.length < 2) {
        throw new BadRequestException('Для раздельной оплаты укажите минимум два платежа');
      }
      for (const part of parts) {
        if (part.method === PaymentMethod.mixed) {
          throw new BadRequestException('В строке раздельной оплаты укажите конкретный способ оплаты');
        }
        await this.settings.assertMethodEnabled(part.method);
      }
      const unique = [...new Set(parts.map((p) => p.method))];
      const orderMethod = unique.length === 1 ? unique[0] : PaymentMethod.mixed;
      return this.orders.markPaid(orderId, actor, orderMethod, parts, PaymentSource.split);
    }

    if (method === PaymentMethod.mixed) {
      // Смешанная складывается из наличных и QR — оба способа должны быть включены.
      await this.settings.assertMethodEnabled(PaymentMethod.cash);
      await this.settings.assertMethodEnabled(PaymentMethod.qr);
      const parts = [
        { method: PaymentMethod.cash, amount: cashAmount ?? 0 },
        { method: PaymentMethod.qr, amount: qrAmount ?? 0 },
      ];
      return this.orders.markPaid(orderId, actor, method, parts);
    }
    await this.settings.assertMethodEnabled(method);
    return this.orders.markPaid(orderId, actor, method);
  }

  /** Данные для печати чека (ТЗ §4.8) — реквизиты берём из настроек заведения. */
  async receipt(actor: AuditActor, orderId: string) {
    const [order, settings] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          table: { select: { number: true } },
          waiter: { select: { name: true } },
          items: {
            where: { status: { notIn: ['rejected', 'cancelled'] } },
            select: {
              dishNameSnapshot: true,
              dishVariantNameSnapshot: true,
              quantity: true,
              priceSnapshot: true,
              finalPrice: true,
            },
          },
          payments: {
            where: { status: 'paid' },
            select: { method: true, amount: true, source: true },
            orderBy: { paidAt: 'asc' },
          },
        },
      }),
      this.settings.ensure(),
    ]);
    if (actor.role === Role.WAITER && order.waiterId !== actor.id) {
      throw new ForbiddenException('Это не ваш заказ');
    }

    return {
      cafeName: settings.cafeName,
      address: settings.address,
      phone: settings.phone,
      phone2: settings.phone2,
      instagram: settings.instagram,
      website: settings.website,
      orderNumber: order.orderNumber,
      tableNumber: order.table.number,
      waiter: order.waiter.name,
      date: (order.closedAt ?? order.createdAt).toISOString(),
      items: order.items,
      totalAmount: order.totalAmount,
      discountAmount: order.discountAmount,
      serviceChargeAmount: order.serviceChargeAmount,
      finalAmount: order.finalAmount,
      paymentMethod: order.paymentMethod,
      // Разбивка по способам (для смешанной оплаты — наличные + QR).
      payments: order.payments.map((p) => ({ method: p.method, amount: String(p.amount), source: p.source })),
      thanks: settings.receiptText,
    };
  }
}
