import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HallsService {
  constructor(private prisma: PrismaService) {}

  /** Активные залы со столами — для экрана выбора стола официантом. */
  async findAllWithTables() {
    const halls = await this.prisma.hall.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        tables: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, number: true, seats: true, status: true, hallId: true },
        },
      },
    });

    // Кто из официантов сейчас занимает стол (по активному заказу) — чтобы запретить
    // другому официанту заходить в чужой занятый стол.
    const activeOrders = await this.prisma.order.findMany({
      where: {
        status: { notIn: [OrderStatus.paid, OrderStatus.cancelled, OrderStatus.rejected] },
      },
      orderBy: { createdAt: 'desc' },
      select: { tableId: true, waiterId: true, waiter: { select: { name: true } } },
    });
    const ownerByTable = new Map<string, { id: string; name: string }>();
    for (const o of activeOrders) {
      if (!ownerByTable.has(o.tableId)) {
        // QR-заказ занимает стол без официанта — помечаем как «QR-меню».
        ownerByTable.set(o.tableId, { id: o.waiterId ?? 'qr', name: o.waiter?.name ?? 'QR-меню' });
      }
    }

    return halls.map((h) => ({
      ...h,
      tables: h.tables.map((t) => ({ ...t, occupiedBy: ownerByTable.get(t.id) ?? null })),
    }));
  }
}
