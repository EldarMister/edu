import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, Role, WaiterShift, WaiterShiftStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { lockFinance } from '../finance/finance-ledger';
import { resolveUserPermissions } from '../common/permissions';

export const CLOSED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.paid,
  OrderStatus.cancelled,
  OrderStatus.rejected,
];

type PrismaClientLike = PrismaService | Prisma.TransactionClient;
export const WORK_SHIFT_ROLES: Role[] = [Role.WAITER, Role.ADMIN, Role.KITCHEN, Role.BAR, Role.OWNER];
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
        _sum: { finalAmount: true },
      }),
    ]);

    return {
      ...workShiftView(shift),
      stats: {
        ordersCount,
        totalAmount: String(totals._sum.finalAmount ?? 0),
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

  startStaff(employeeId: string) {
    return this.start(employeeId, WORK_SHIFT_ROLES);
  }

  endStaff(employeeId: string) {
    return this.end(employeeId, WORK_SHIFT_ROLES);
  }

  async start(waiterId: string, allowedRoles: Role[] = [Role.WAITER]) {
    const employee = await this.prisma.user.findUnique({ where: { id: waiterId }, select: { cafeId: true } });
    if (!employee) throw new ForbiddenException('Сотрудник не найден или отключён');
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
      return tx.waiterShift.create({ data: { cafeId: employee.cafeId, waiterId, status: WaiterShiftStatus.active } });
    });

    this.events.emitToWaiter(waiterId, SERVER_EVENTS.WAITER_SHIFT_STARTED, shift);
    this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_STARTED, shift);
    return workShiftView(shift);
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

      return tx.waiterShift.update({
        where: { id: active.id },
        data: {
          status: WaiterShiftStatus.closed,
          endedAt: new Date(),
        },
      });
    });

    // Итоги смены: сколько заказов официант закрыл (оплачено) и на какую сумму.
    const [ordersCount, totals] = await Promise.all([
      this.prisma.order.count({
        where: { waiterShiftId: shift.id, status: OrderStatus.paid },
      }),
      this.prisma.order.aggregate({
        where: { waiterShiftId: shift.id, status: OrderStatus.paid },
        _sum: { finalAmount: true },
      }),
    ]);
    const result = {
      ...workShiftView(shift),
      stats: {
        ordersCount,
        totalAmount: String(totals._sum.finalAmount ?? 0),
        activeOrdersCount: 0,
      },
    };

    this.events.emitToWaiter(waiterId, SERVER_EVENTS.WAITER_SHIFT_ENDED, shift);
    this.events.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_ENDED, shift);
    return result;
  }
}
