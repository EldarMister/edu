import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';
import type { AuditActor } from '../audit/audit.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
    private settings: SettingsService,
  ) {}

  /** Приём оплаты официантом/кассиром. Способ должен быть включён в настройках. */
  async pay(actor: AuditActor, orderId: string, method: PaymentMethod) {
    await this.settings.assertMethodEnabled(method);
    return this.orders.markPaid(orderId, actor, method);
  }

  /** Данные для печати чека (ТЗ §4.8) — реквизиты берём из настроек заведения. */
  async receipt(orderId: string) {
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
              quantity: true,
              priceSnapshot: true,
              finalPrice: true,
            },
          },
        },
      }),
      this.settings.ensure(),
    ]);

    return {
      cafeName: settings.cafeName,
      address: settings.address,
      phone: settings.phone,
      phone2: settings.phone2,
      orderNumber: order.orderNumber,
      tableNumber: order.table.number,
      waiter: order.waiter.name,
      date: (order.closedAt ?? order.createdAt).toISOString(),
      items: order.items,
      totalAmount: order.totalAmount,
      discountAmount: order.discountAmount,
      finalAmount: order.finalAmount,
      paymentMethod: order.paymentMethod,
      thanks: settings.receiptText,
    };
  }
}
