import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { orderInclude } from '../orders/order.helpers';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { AuditService, AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { StopListItemDto } from './dto/stop-list.dto';

export type KitchenTab = 'new' | 'in_work' | 'ready' | 'rejected';

const TAB_STATUS: Record<KitchenTab, OrderStatus[]> = {
  new: [OrderStatus.sent_to_kitchen],
  in_work: [OrderStatus.accepted_by_kitchen, OrderStatus.cooking, OrderStatus.partially_rejected],
  ready: [OrderStatus.ready, OrderStatus.picked_up, OrderStatus.served],
  rejected: [OrderStatus.rejected],
};

@Injectable()
export class KitchenService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private audit: AuditService,
  ) {}

  findByTab(tab: KitchenTab) {
    const statuses = TAB_STATUS[tab] ?? TAB_STATUS.new;
    return this.prisma.order.findMany({
      where: { status: { in: statuses } },
      orderBy: { createdAt: 'asc' },
      include: orderInclude,
    });
  }

  /** Стоп-лист: активные блюда по категориям с текущей доступностью. */
  async getStopList() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        dishes: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, isAvailable: true },
        },
      },
    });
    return categories.filter((c) => c.dishes.length > 0);
  }

  /** Сохраняет доступность блюд. Меняет только изменившиеся, пишет аудит, шлёт realtime. */
  async updateStopList(actor: AuditActor, items: StopListItemDto[]) {
    const ids = [...new Set(items.map((i) => i.dishId))];
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true, isAvailable: true },
    });
    const byId = new Map(dishes.map((d) => [d.id, d]));

    // Применяем только реальные изменения, чтобы не плодить лишний аудит.
    const changes = items.filter((i) => {
      const dish = byId.get(i.dishId);
      return dish && dish.isAvailable !== i.isAvailable;
    });

    if (changes.length > 0) {
      await this.prisma.$transaction(
        changes.map((c) =>
          this.prisma.dish.update({
            where: { id: c.dishId },
            data: { isAvailable: c.isAvailable },
          }),
        ),
      );

      // Меню изменилось — официанты обновят доступность блюд без перезагрузки.
      this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { source: 'stop-list' });

      for (const c of changes) {
        const dish = byId.get(c.dishId)!;
        await this.audit.log({
          actor,
          actionType: AuditAction.MENU_ITEM_AVAILABILITY_CHANGED,
          entityType: AuditEntity.MENU_ITEM,
          entityId: c.dishId,
          description: `${actor.name ?? 'Сотрудник'} сделал блюдо «${dish.name}» ${
            c.isAvailable ? 'доступным' : 'недоступным'
          }`,
          oldValue: { isAvailable: dish.isAvailable },
          newValue: { isAvailable: c.isAvailable },
        });
      }
    }

    return this.getStopList();
  }
}
