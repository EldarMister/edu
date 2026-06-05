import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, WaiterShiftStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';

const CLOSED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.paid,
  OrderStatus.cancelled,
  OrderStatus.rejected,
];

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class WaiterShiftsService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
  ) {}

  current(waiterId: string, client: PrismaClientLike = this.prisma) {
    return client.waiterShift.findFirst({
      where: { waiterId, status: WaiterShiftStatus.active },
      orderBy: { startedAt: 'desc' },
    });
  }

  async getRequiredActiveShift(waiterId: string, client: PrismaClientLike = this.prisma) {
    const shift = await this.current(waiterId, client);
    if (!shift) {
      throw new BadRequestException('Сначала начните смену в профиле.');
    }
    return shift;
  }

  async start(waiterId: string) {
    const active = await this.current(waiterId);
    if (active) {
      throw new BadRequestException('Смена уже активна.');
    }

    const shift = await this.prisma.waiterShift.create({
      data: {
        waiterId,
        status: WaiterShiftStatus.active,
      },
    });

    this.events.emitToWaiter(waiterId, SERVER_EVENTS.WAITER_SHIFT_STARTED, shift);
    this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_STARTED, shift);
    return shift;
  }

  async end(waiterId: string) {
    const shift = await this.prisma.$transaction(async (tx) => {
      const active = await this.current(waiterId, tx);
      if (!active) {
        throw new BadRequestException('Смена не начата.');
      }

      const activeOrders = await tx.order.count({
        where: {
          waiterId,
          status: { notIn: CLOSED_ORDER_STATUSES },
        },
      });
      if (activeOrders > 0) {
        throw new BadRequestException('Нельзя завершить смену, пока есть активные заказы.');
      }

      return tx.waiterShift.update({
        where: { id: active.id },
        data: {
          status: WaiterShiftStatus.closed,
          endedAt: new Date(),
        },
      });
    });

    this.events.emitToWaiter(waiterId, SERVER_EVENTS.WAITER_SHIFT_ENDED, shift);
    this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_ENDED, shift);
    return shift;
  }
}
