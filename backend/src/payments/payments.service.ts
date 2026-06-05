import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';

const CAFE_NAME = 'Кафе «Вкусно»';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
  ) {}

  /** Приём оплаты официантом/кассиром. */
  pay(cashierId: string, orderId: string, method: PaymentMethod) {
    return this.orders.markPaid(orderId, cashierId, method);
  }

  /** Данные для печати чека (ТЗ §4.8). */
  async receipt(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
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
    });

    return {
      cafeName: CAFE_NAME,
      orderNumber: order.orderNumber,
      tableNumber: order.table.number,
      waiter: order.waiter.name,
      date: (order.closedAt ?? order.createdAt).toISOString(),
      items: order.items,
      totalAmount: order.totalAmount,
      discountAmount: order.discountAmount,
      finalAmount: order.finalAmount,
      paymentMethod: order.paymentMethod,
      thanks: 'Спасибо за визит! Ждём вас снова.',
    };
  }
}
