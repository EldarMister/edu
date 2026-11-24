import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { WaiterShiftStatus } from '@prisma/client';
import { lockFinance } from '../finance/finance-ledger';
import { CLOSED_ORDER_STATUSES, MAX_WORK_SHIFT_MS } from './waiter-shifts.service';
import { recordWorkShiftChange } from './work-shift-history';

/**
 * Каждый час проверяет все активные смены.
 * Забытую смену закрываем на отметке 20 часов, чтобы простой сервера не
 * увеличивал зарплату. Смены сотрудников с активными заказами сохраняем.
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
    const cutoff = new Date(Date.now() - MAX_WORK_SHIFT_MS);

    const expired = await this.prisma.waiterShift.findMany({
      where: {
        status: WaiterShiftStatus.active,
        startedAt: { lt: cutoff },
      },
      select: { id: true, cafeId: true, waiterId: true, startedAt: true },
    });

    if (expired.length === 0) return;

    this.logger.log(`Авто-закрытие ${expired.length} смен(ы), превысивших 20 ч.`);

    for (const shift of expired) {
      try {
        const closed = await this.prisma.$transaction(async (tx) => {
          if (shift.cafeId) await lockFinance(tx, shift.cafeId);
          const current = await tx.waiterShift.findFirst({
            where: { id: shift.id, status: WaiterShiftStatus.active, startedAt: { lt: cutoff } },
          });
          if (!current) return null;
          const activeOrders = await tx.order.count({ where: {
            waiterId: current.waiterId, status: { notIn: CLOSED_ORDER_STATUSES },
          } });
          if (activeOrders) return null;
          const updated = await tx.waiterShift.update({
            where: { id: current.id },
            data: { status: WaiterShiftStatus.closed, endedAt: new Date(current.startedAt.getTime() + MAX_WORK_SHIFT_MS) },
          });
          await recordWorkShiftChange(tx, current, updated, 'auto-close');
          return updated;
        });
        if (!closed) continue;

        // Уведомляем официанта и администратора через WebSocket.
        this.events.emitToWaiter(
          shift.waiterId,
          SERVER_EVENTS.WAITER_SHIFT_ENDED,
          closed,
        );
        this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_ENDED, closed);

        this.logger.log(
          `Смена ${shift.id} (сотрудник ${shift.waiterId}) закрыта автоматически.`,
        );
      } catch (err) {
        this.logger.error(`Ошибка авто-закрытия смены ${shift.id}:`, err);
      }
    }
  }
}
