import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementSource, StockMovementType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MovementsQueryDto } from './dto';

@Injectable()
export class MovementsService {
  constructor(private prisma: PrismaService) {}

  private buildWhere(query: MovementsQueryDto): Prisma.StockMovementWhereInput {
    const where: Prisma.StockMovementWhereInput = {};
    if (query.type && this.isType(query.type)) where.type = query.type;
    if (query.sourceType && this.isSource(query.sourceType)) where.sourceType = query.sourceType;
    if (query.ingredientId) where.ingredientId = query.ingredientId;
    if (query.search) {
      where.ingredient = { name: { contains: query.search, mode: 'insensitive' } };
    }
    const gte = query.from ? new Date(query.from) : undefined;
    const lte = query.to ? new Date(`${query.to}T23:59:59.999`) : undefined;
    if (gte || lte) {
      where.createdAt = { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    }
    return where;
  }

  async findAll(query: MovementsQueryDto) {
    const movements = await this.prisma.stockMovement.findMany({
      where: this.buildWhere(query),
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { ingredient: { select: { name: true, unit: true } } },
    });

    // Подтягиваем номера документов: закупки (по sourceId) и заказы (по sourceId).
    const purchaseIds = [
      ...new Set(movements.filter((m) => m.sourceType === 'purchase' && m.sourceId).map((m) => m.sourceId as string)),
    ];
    const orderIds = [
      ...new Set(movements.filter((m) => m.sourceType === 'order' && m.sourceId).map((m) => m.sourceId as string)),
    ];
    const [purchases, orders] = await Promise.all([
      purchaseIds.length
        ? this.prisma.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, number: true } })
        : Promise.resolve([]),
      orderIds.length
        ? this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } })
        : Promise.resolve([]),
    ]);
    const purchaseMap = new Map(purchases.map((p) => [p.id, p.number]));
    const orderMap = new Map(orders.map((o) => [o.id, o.orderNumber]));

    return movements.map((m) => {
      let documentLabel: string | null = null;
      if (m.sourceType === 'purchase' && m.sourceId) {
        const num = purchaseMap.get(m.sourceId);
        documentLabel = num != null ? `Закупка №${num}` : 'Закупка';
      } else if (m.sourceType === 'order' && m.sourceId) {
        const num = orderMap.get(m.sourceId);
        documentLabel = num != null ? `Заказ №${num}` : 'Заказ';
      }
      return {
        id: m.id,
        ingredientId: m.ingredientId,
        ingredientName: m.ingredient.name,
        unit: m.ingredient.unit,
        type: m.type,
        sourceType: m.sourceType,
        sourceId: m.sourceId,
        documentLabel,
        beforeStock: Number(m.beforeStock),
        change: Number(m.change),
        afterStock: Number(m.afterStock),
        costAtMoment: Number(m.costAtMoment),
        comment: m.comment,
        createdAt: m.createdAt,
      };
    });
  }

  /** Сводка по периоду: приход / списание / возвраты (суммы по модулю изменения). */
  async summary(query: MovementsQueryDto) {
    const where = this.buildWhere(query);
    const movements = await this.prisma.stockMovement.findMany({
      where,
      select: { type: true, change: true },
    });
    let income = 0;
    let writeoff = 0;
    let returns = 0;
    for (const m of movements) {
      const change = Number(m.change);
      if (m.type === 'purchase') income += change;
      else if (m.type === 'sale') writeoff += Math.abs(change);
      else if (m.type === 'return') returns += change;
    }
    return { income, writeoff, returns };
  }

  private isType(v: string): v is StockMovementType {
    return ['purchase', 'sale', 'return', 'correction', 'cancel'].includes(v);
  }
  private isSource(v: string): v is StockMovementSource {
    return ['purchase', 'order', 'manual'].includes(v);
  }
}
