import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { orderInclude } from '../orders/order.helpers';

export type KitchenTab = 'new' | 'in_work' | 'ready' | 'rejected';

const TAB_STATUS: Record<KitchenTab, OrderStatus[]> = {
  new: [OrderStatus.sent_to_kitchen],
  in_work: [OrderStatus.accepted_by_kitchen, OrderStatus.cooking],
  ready: [OrderStatus.ready, OrderStatus.picked_up, OrderStatus.served],
  rejected: [OrderStatus.rejected, OrderStatus.partially_rejected],
};

@Injectable()
export class KitchenService {
  constructor(private prisma: PrismaService) {}

  findByTab(tab: KitchenTab) {
    const statuses = TAB_STATUS[tab] ?? TAB_STATUS.new;
    return this.prisma.order.findMany({
      where: { status: { in: statuses } },
      orderBy: { createdAt: 'asc' },
      include: orderInclude,
    });
  }
}
