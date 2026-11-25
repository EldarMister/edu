import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OrderStatus, Prisma, Role, WaiterShift, WaiterShiftStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { lockFinance } from '../finance/finance-ledger';
import { resolveUserPermissions } from '../common/permissions';
import { recordWorkShiftChange } from './work-shift-history';
import type { AuthUser } from '../common/decorators/current-user.decorator';

export const CLOSED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.paid,
  OrderStatus.cancelled,
  OrderStatus.rejected,
];

type PrismaClientLike = PrismaService | Prisma.TransactionClient;
export const WORK_SHIFT_ROLES: Role[] = [Role.WAITER, Role.ADMIN, Role.KITCHEN, Role.BAR];
export const MAX_WORK_SHIFT_MS = 20 * 60 * 60 * 1000;

export function workShiftView(shift: WaiterShift) {
  return { ...shift, employeeId: shift.waiterId,
    autoCloseAt: shift.endedAt ? null : new Date(shift.startedAt.getTime() + MAX_WORK_SHIFT_MS) };
}

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

  async currentWithStats(waiterId: string) {
    const shift = await this.current(waiterId);
    if (!shift) return null;

    const [ordersCount, activeOrdersCount, totals] = await Promise.all([
      this.prisma.order.count({
        where: {
          waiterShiftId: shift.id,
          status: { notIn: [OrderStatus.cancelled] },
        },
      }),
      this.prisma.order.count({
        where: {
          waiterShiftId: shift.id,
          status: { notIn: CLOSED_ORDER_STATUSES },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          waiterShiftId: shift.id,
          status: { notIn: [OrderStatus.cancelled] },
        },
        _sum: { finalAmount: true, refundedAmount: true },
      }),
    ]);

    return {
      ...workShiftView(shift),
      stats: {
        ordersCount,
        totalAmount: (totals._sum.finalAmount ?? new Prisma.Decimal(0)).sub(totals._sum.refundedAmount ?? 0).toString(),
        activeOrdersCount,
      },
    };
  }

  async shiftForTerminalOrder(waiterId: string, client: PrismaClientLike = this.prisma) {
    const employee = await client.user.findUnique({ where: { id: waiterId }, include: { position: true } });
    if (employee?.cafeId && client !== this.prisma) await lockFinance(client as Prisma.TransactionClient, employee.cafeId);
    const latest = await client.user.findUnique({ where: { id: waiterId }, include: { position: true } });
    if (!latest?.isActive) throw new ForbiddenException('Нет доступа к кассе');
    const permissions = resolveUserPermissions(latest);
    if (!permissions.terminalAccess) throw new ForbiddenException('Нет доступа к кассе');
    if (permissions.workShiftRequired === false) return null;
    const shift = await this.current(waiterId, client);
    if (!shift) {
      throw new BadRequestException('Сначала начните смену.');
    }
    return shift;
  }

  async requestState(employeeId: string) {
    const request = await this.prisma.workShiftRequest.findUnique({ where: { userId: employeeId },
      select: { cafeId: true, requestedAt: true, rejectedAt: true } });
    if (!request || !await this.approvalRequired(this.prisma, request.cafeId)) return null;
    return { requestedAt: request.requestedAt, status: request.rejectedAt ? 'rejected' : 'pending' };
  }

  async manageList(cafeId: string) {
    const staff = await this.prisma.user.findMany({
      where: { cafeId, role: { in: WORK_SHIFT_ROLES }, OR: [
        { isActive: true }, { waiterShifts: { some: { status: WaiterShiftStatus.active } } },
      ] },
      include: { position: true, workShiftRequest: true, waiterShifts: {
        where: { status: WaiterShiftStatus.active }, take: 1, orderBy: { startedAt: 'desc' },
      } },
      orderBy: { name: 'asc' },
    });
    return staff.flatMap((employee) => {
      const active = employee.waiterShifts.at(0);
      if (!active && resolveUserPermissions(employee).workShiftRequired === false) return [];
      const request = !active && employee.isActive && employee.workShiftRequest;
      return [{
        id: employee.id, name: employee.name, role: employee.role, position: employee.position?.name ?? null,
        active: active ? { id: active.id, startedAt: active.startedAt } : null,
        request: request && !request.rejectedAt ? { id: request.requestId, requestedAt: request.requestedAt } : null,
      }];
    });
  }

  startStaff(employeeId: string, allowPending = false) {
    return this.start(employeeId, WORK_SHIFT_ROLES, { allowPending });
  }

  endStaff(employeeId: string) {
    return this.end(employeeId, WORK_SHIFT_ROLES);
  }

  startManaged(actor: AuthUser, employeeId: string, requestId?: string) {
    if (actor.id === employeeId) throw new ForbiddenException('Свою смену начните в личном кабинете');
    return this.start(employeeId, WORK_SHIFT_ROLES, { actor, requestId });
  }

  async rejectRequest(actor: AuthUser, employeeId: string, requestId: string) {
    if (actor.id === employeeId) throw new ForbiddenException('Свой запрос обрабатывает другой ответственный');
    const cafeId = actor.cafeId;
    if (!cafeId) throw new ForbiddenException('Заведение не назначено');
    await this.prisma.$transaction(async (tx) => {
      await lockFinance(tx, cafeId);
      const result = await tx.workShiftRequest.updateMany({
        where: { cafeId, userId: employeeId, requestId, rejectedAt: null }, data: { rejectedAt: new Date() },
      });
      if (!result.count) throw new ConflictException('Запрос уже обработан. Обновите список');
      await this.auditStart(tx, actor, cafeId, requestId, employeeId, 'Запрос на начало смены отклонён');
    });
    this.emitRequestUpdate(employeeId, cafeId);
    return { ok: true };
  }

  async start(waiterId: string, allowedRoles: Role[] = [Role.WAITER],
    options: { allowPending?: boolean; actor?: AuthUser; requestId?: string } = {}) {
    const employee = await this.prisma.user.findUnique({ where: { id: waiterId }, select: { cafeId: true } });
    const { actor, requestId } = options;
    if (!employee || (actor && (!actor.cafeId || actor.cafeId !== employee.cafeId))) {
      throw new ForbiddenException('Сотрудник не найден или отключён');
    }
    const shift = await this.prisma.$transaction(async (tx) => {
      if (employee.cafeId) await lockFinance(tx, employee.cafeId);
      // Recheck after the same lock used by staff reassignment and deactivation.
      const currentEmployee = await tx.user.findUnique({ where: { id: waiterId }, include: { position: true } });
      const terminal = allowedRoles.length === 1 && allowedRoles[0] === Role.WAITER;
      if (!currentEmployee?.isActive || (terminal ? !resolveUserPermissions(currentEmployee).terminalAccess : !allowedRoles.includes(currentEmployee.role))) {
        throw new ForbiddenException('Сотрудник отключён или его рабочее место изменилось');
      }
      if (resolveUserPermissions(currentEmployee).workShiftRequired === false) {
        throw new BadRequestException('Для вашей должности учёт смен отключён.');
      }
      const active = await this.current(waiterId, tx);
      if (active) throw new BadRequestException('Смена уже активна.');
      const cafeId = employee.cafeId;
      if (!actor && cafeId && await this.approvalRequired(tx, cafeId)) {
        const request = await tx.workShiftRequest.findUnique({ where: { userId: waiterId } });
        if (!request || request.rejectedAt) {
          const renewal = { requestId: randomUUID(), requestedAt: new Date(), rejectedAt: null };
          await tx.workShiftRequest.upsert({ where: { userId: waiterId },
            create: { cafeId, userId: waiterId, ...renewal }, update: renewal });
        }
        return null;
      }
      if (requestId && !await tx.workShiftRequest.findFirst({
        where: { cafeId: cafeId!, userId: waiterId, requestId, rejectedAt: null }, select: { userId: true },
      })) throw new ConflictException('Запрос уже обработан. Обновите список');
      if (cafeId) await tx.workShiftRequest.deleteMany({ where: { cafeId, userId: waiterId } });
      const created = await tx.waiterShift.create({ data: { cafeId, waiterId, status: WaiterShiftStatus.active } });
      if (actor && cafeId) await this.auditStart(tx, actor, cafeId, created.id, waiterId,
        requestId ? 'Начало рабочей смены подтверждено' : 'Рабочая смена открыта администратором');
      return created;
    });

    if (!shift) {
      this.emitRequestUpdate(waiterId, employee.cafeId!);
      if (!options.allowPending) throw new ConflictException('Запрос отправлен. Ожидайте подтверждения начала смены.');
      return null;
    }
    this.events.emitToWaiter(waiterId, SERVER_EVENTS.WAITER_SHIFT_STARTED, shift);
    this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_STARTED, shift);
    return workShiftView(shift);
  }

  private async approvalRequired(db: PrismaClientLike, cafeId: string) {
    return (await db.settings.findUnique({ where: { cafeId }, select: { workShiftApprovalRequired: true } }))?.workShiftApprovalRequired === true;
  }

  private emitRequestUpdate(userId: string, cafeId: string) {
    const payload = { cafeId, userId };
    this.events.emitToWaiter(userId, SERVER_EVENTS.WORK_SHIFT_REQUEST_UPDATED, payload);
    this.events.emitToAdmin(SERVER_EVENTS.WORK_SHIFT_REQUEST_UPDATED, payload);
  }

  private auditStart(tx: Prisma.TransactionClient, actor: AuthUser, cafeId: string, id: string, employeeId: string, description: string) {
    return tx.auditLog.create({ data: { cafeId, userId: actor.id, userName: actor.name, userRole: actor.identityRole ?? actor.role,
      actionType: 'STAFF_SHIFT_CHANGED', entityType: 'STAFF_SHIFT', entityId: id, description, metadata: { employeeId } } });
  }

  async end(waiterId: string, allowedRoles: Role[] = [Role.WAITER]) {
    const employee = await this.prisma.user.findUnique({ where: { id: waiterId }, select: { cafeId: true } });
    if (!employee) throw new ForbiddenException('Сотрудник не найден или отключён');
    const shift = await this.prisma.$transaction(async (tx) => {
      if (employee.cafeId) await lockFinance(tx, employee.cafeId);
      const currentEmployee = await tx.user.findUnique({ where: { id: waiterId }, include: { position: true } });
      const terminal = allowedRoles.length === 1 && allowedRoles[0] === Role.WAITER;
      if (!currentEmployee?.isActive || (terminal ? !resolveUserPermissions(currentEmployee).terminalAccess : !allowedRoles.includes(currentEmployee.role))) {
        throw new ForbiddenException('Сотрудник отключён или его рабочее место изменилось');
      }
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

      const closed = await tx.waiterShift.update({
        where: { id: active.id },
        data: {
          status: WaiterShiftStatus.closed,
          endedAt: new Date(),
        },
      });
      await recordWorkShiftChange(tx, active, closed, 'self-close', currentEmployee);
      return closed;
    });

    // Итоги смены: сколько заказов официант закрыл (оплачено) и на какую сумму.
    const [ordersCount, totals] = await Promise.all([
      this.prisma.order.count({
        where: { waiterShiftId: shift.id, status: OrderStatus.paid },
      }),
      this.prisma.order.aggregate({
        where: { waiterShiftId: shift.id, status: OrderStatus.paid },
        _sum: { finalAmount: true, refundedAmount: true },
      }),
    ]);
    const result = {
      ...workShiftView(shift),
      stats: {
        ordersCount,
        totalAmount: (totals._sum.finalAmount ?? new Prisma.Decimal(0)).sub(totals._sum.refundedAmount ?? 0).toString(),
        activeOrdersCount: 0,
      },
    };

    this.events.emitToWaiter(waiterId, SERVER_EVENTS.WAITER_SHIFT_ENDED, shift);
    this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_ENDED, shift);
    return result;
  }
}
