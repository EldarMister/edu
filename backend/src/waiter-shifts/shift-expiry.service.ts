import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { OrderStatus, WaiterShiftStatus } from '@prisma/client';

/** Максимальная длительность смены (20 часов в миллисекундах). */
const MAX_SHIFT_MS = 20 * 60 * 60 * 1000;

/**
 * Каждый час проверяет все активные смены.
 * Если смена длится дольше MAX_SHIFT_MS — принудительно закрывает её.
 * Активные заказы при этом НЕ отменяются: смена просто закрывается,
 * а заказы официант обязан закрыть самостоятельно до/после.
 */
@Injectable()
export class ShiftExpiryService {
  private readonly logger = new Logger(ShiftExpiryService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
  ) {}

  /** Запускается каждый час ровно (0 минут каждого часа). */
  @Cron(CronExpression.EVERY_HOUR)
  async closeExpiredShifts() {
    const cutoff = new Date(Date.now() - MAX_SHIFT_MS);

    const expired = await this.prisma.waiterShift.findMany({
      where: {
        status: WaiterShiftStatus.active,
        startedAt: { lt: cutoff },
      },
      select: { id: true, waiterId: true, startedAt: true },
    });

    if (expired.length === 0) return;

    this.logger.log(`Авто-закрытие ${expired.length} смен(ы), превысивших 20 ч.`);

    for (const shift of expired) {
      try {
        const activeOrders = await this.prisma.order.count({
          where: {
            waiterId: shift.waiterId,
            status: {
              notIn: [OrderStatus.paid, OrderStatus.cancelled, OrderStatus.rejected],
            },
          },
        });
        if (activeOrders > 0) {
          this.logger.warn(
            `Смена ${shift.id} не закрыта автоматически: у официанта ${shift.waiterId} есть ${activeOrders} активных заказ(а/ов).`,
          );
          continue;
        }

        const closed = await this.prisma.waiterShift.update({
          where: { id: shift.id },
          data: { status: WaiterShiftStatus.closed, endedAt: new Date() },
        });

        // Уведомляем официанта и администратора через WebSocket.
        this.events.emitToWaiter(
          shift.waiterId,
          SERVER_EVENTS.WAITER_SHIFT_ENDED,
          closed,
        );
        this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_ENDED, closed);

        this.logger.log(
          `Смена ${shift.id} (официант ${shift.waiterId}) закрыта автоматически.`,
        );
      } catch (err) {
        this.logger.error(`Ошибка авто-закрытия смены ${shift.id}:`, err);
      }
    }
  }
}
