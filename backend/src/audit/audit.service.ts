import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, AuditEntity } from './audit.constants';

/** Кто совершил действие. name/role можно не передавать — подтянутся по userId. */
export interface AuditActor {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface AuditLogInput {
  actor?: AuditActor | null;
  actionType: AuditAction;
  entityType: AuditEntity;
  entityId?: string | null;
  tableId?: string | null;
  orderId?: string | null;
  description?: string;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
  metadata?: Prisma.InputJsonValue | null;
}

export interface AuditQuery {
  from?: string;
  to?: string;
  userId?: string;
  actionType?: string;
  entityType?: string;
  orderId?: string;
  tableId?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  constructor(private prisma: PrismaService) {}

  /**
   * Записывает событие в журнал. Вызывать ТОЛЬКО после успешной бизнес-операции.
   * Ошибка записи лога не должна ронять основную операцию — поэтому ловим её здесь.
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      let userName = input.actor?.name ?? null;
      let userRole = input.actor?.role ?? null;

      // Если имя/роль не переданы — подтянем актуальные (это и есть «на момент действия»).
      if (input.actor?.id && (!userName || !userRole)) {
        const user = await this.prisma.user.findUnique({
          where: { id: input.actor.id },
          select: { name: true, role: true },
        });
        userName = userName ?? user?.name ?? null;
        userRole = userRole ?? user?.role ?? null;
      }

      await this.prisma.auditLog.create({
        data: {
          userId: input.actor?.id ?? null,
          userName,
          userRole,
          actionType: input.actionType,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          tableId: input.tableId ?? null,
          orderId: input.orderId ?? null,
          description: input.description,
          oldValue: input.oldValue ?? Prisma.JsonNull,
          newValue: input.newValue ?? Prisma.JsonNull,
          metadata: input.metadata ?? Prisma.JsonNull,
        },
      });
    } catch (err) {
      this.logger.error(`Не удалось записать audit log (${input.actionType})`, err as Error);
    }
  }

  /** Журнал для владельца: фильтры + пагинация. По умолчанию последние 50. */
  async findMany(query: AuditQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));

    const where: Prisma.AuditLogWhereInput = {};
    if (query.userId) where.userId = query.userId;
    if (query.actionType) where.actionType = query.actionType;
    if (query.entityType) where.entityType = query.entityType;
    if (query.orderId) where.orderId = query.orderId;
    if (query.tableId) where.tableId = query.tableId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) {
        const to = new Date(query.to);
        to.setHours(23, 59, 59, 999);
        (where.createdAt as Prisma.DateTimeFilter).lte = to;
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /** Список значений фильтров для UI (сотрудники, типы действий, встречающиеся в логах). */
  async filters() {
    const [users, actions] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { userId: { not: null } },
        distinct: ['userId'],
        select: { userId: true, userName: true },
        orderBy: { userName: 'asc' },
      }),
      this.prisma.auditLog.findMany({
        distinct: ['actionType'],
        select: { actionType: true },
        orderBy: { actionType: 'asc' },
      }),
    ]);
    return {
      users: users
        .filter((u) => u.userId)
        .map((u) => ({ id: u.userId as string, name: u.userName ?? '—' })),
      actionTypes: actions.map((a) => a.actionType),
    };
  }
}
