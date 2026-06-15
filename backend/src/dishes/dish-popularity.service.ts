import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderItemStatus, OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';

@Injectable()
export class DishPopularityService {
  private readonly logger = new Logger(DishPopularityService.name);
  private readonly DECAY = 0.1;
  private readonly WINDOW_DAYS = 90;
  private readonly BATCH_SIZE = 100;

  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
  ) {}

  @Cron('0 */2 * * *')
  async scheduledRecalculate() {
    await this.recalculateAll();
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { source: 'dish-popularity-cron' });
  }

  async recalculateAll(): Promise<void> {
    let cursor: string | undefined;

    while (true) {
      const dishes = await this.prisma.dish.findMany({
        select: { id: true },
        orderBy: { id: 'asc' },
        take: this.BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (dishes.length === 0) return;

      for (const dish of dishes) {
        try {
          await this.recalculateDish(dish.id);
        } catch (err) {
          this.logger.error(`Failed to recalculate popularity for dish ${dish.id}`, err instanceof Error ? err.stack : String(err));
        }
      }

      cursor = dishes[dishes.length - 1].id;
    }
  }

  async recalculateDish(dishId: string): Promise<void> {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - this.WINDOW_DAYS);

    // Сеты считаются как отдельные блюда; компоненты сета не получают дополнительный score.
    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        dishId,
        status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] },
        order: {
          createdAt: { gte: windowStart },
          status: OrderStatus.paid,
        },
      },
      select: {
        quantity: true,
        order: { select: { createdAt: true } },
      },
    });

    const now = Date.now();
    const msPerDay = 1000 * 60 * 60 * 24;
    const popularityScore = orderItems.reduce((score, item) => {
      const daysSince = Math.max(0, (now - item.order.createdAt.getTime()) / msPerDay);
      return score + item.quantity * (1 / (1 + daysSince * this.DECAY));
    }, 0);

    await this.prisma.dish.update({
      where: { id: dishId },
      data: { popularityScore, scoreUpdatedAt: new Date() },
    });
  }

  async recalculateDishes(dishIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(dishIds)];
    await Promise.all(uniqueIds.map((dishId) => this.recalculateDish(dishId)));
    if (uniqueIds.length > 0) {
      this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, {
        source: 'dish-popularity-order',
        dishIds: uniqueIds,
      });
    }
  }
}
