import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { OrderItemStatus, OrderStatus, PaymentMethod, PaymentStatus, Prisma, Role, WaiterShiftStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { allocateOrderItemCents, amountWithoutDelivery, netItemAmount, netItemQuantity, netOrderAmount, netPaymentAmount } from '../orders/order-net';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { lockStationRouting, staffStation } from '../kitchen/preparation-stations';
import { lockFinance } from '../finance/finance-ledger';
import { ACCOUNT_PHONE_ERROR, accountPhoneAliases, normalizeAccountPhone } from '../common/account-phone';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { assertNoActiveWorkShifts, assertStaffWorkspaceChange, canManagePosition, disablesWorkTracking, losesOperationalAccess } from './staff-access';
import { syncEmployeeSalary } from '../finance/employee-salary';
import { payrollWorkTime } from '../finance/payroll';
import { warehouseDateRange, warehouseDay } from '../warehouse/report-range';
import { CLOSED_ORDER_STATUSES, MAX_WORK_SHIFT_MS, WORK_SHIFT_ROLES } from '../waiter-shifts/waiter-shifts.service';
import { recordWorkShiftChange, type WorkShiftChange } from '../waiter-shifts/work-shift-history';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import {
  CreateStaffDto,
  ShiftHistoryQueryDto,
  UpdateShiftHistoryDto,
  UpdateStaffDto,
  WaiterOrdersReportQueryDto,
} from './dto';
import {
  ACTION_KEYS,
  getDefaultPermissionsByRole,
  hasPermission,
  resolvePermissions,
  resolvePositionPermissions,
  resolveUserPermissions,
  SECTION_KEYS,
} from '../common/permissions';

const staffPositionSelect = { id: true, name: true, role: true, isStarter: true, permissions: true } satisfies Prisma.StaffPositionSelect;
type StaffPosition = Prisma.StaffPositionGetPayload<{ select: typeof staffPositionSelect }>;

function isManageableStarter(role: Role, position: StaffPosition | null) {
  if (!position?.isStarter || position.role !== role) return false;
  const baseline = getDefaultPermissionsByRole(role);
  const effective = resolvePositionPermissions(position);
  return SECTION_KEYS.every((key) => !effective.sections[key] || baseline.sections[key])
    && ACTION_KEYS.every((key) => !effective.actions[key] || baseline.actions[key]);
}

const STAFF_SELECT = {
  id: true,
  name: true,
  phone: true,
  login: true,
  lastLoginAt: true,
  role: true,
  positionId: true,
  position: { select: staffPositionSelect },
  prepStation: true,
  isActive: true,
  permissions: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class StaffService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @Optional() private readonly events?: EventsGateway,
  ) {}

  private isOwner(actor: AuditActor) {
    return actor.role === Role.OWNER;
  }

  /** Подставить итоговые (resolved) права вместо «сырого» json из БД. */
  private withPermissions({ position, ...user }: Prisma.UserGetPayload<{ select: typeof STAFF_SELECT }>, actor?: AuthUser) {
    const assigned = position?.role === user.role ? position : null;
    return {
      ...user,
      positionName: assigned?.name ?? null,
      positionIsStarter: isManageableStarter(user.role, assigned),
      canManage: actor ? canManagePosition(actor, assigned ?? { role: user.role, permissions: user.permissions }) : undefined,
      permissions: resolveUserPermissions({ ...user, position: assigned }),
    };
  }

  private assertCanManageRole(actor: AuditActor, role: Role) {
    if (role === Role.OWNER && !this.isOwner(actor)) {
      throw new ForbiddenException('Только владелец может управлять владельцами');
    }
  }

  private assertCanManagePositionAccount(
    actor: AuthUser, user: { role: Role; positionId: string | null; position?: StaffPosition | null; permissions?: unknown },
  ) {
    if (!canManagePosition(actor, { role: user.role, permissions: user.position?.permissions ?? user.permissions })) {
      throw new ForbiddenException('Этим сотрудником управляет владелец заведения');
    }
  }

  private async starterPosition(tx: Prisma.TransactionClient, actor: AuthUser, role: Role) {
    if (!actor.cafeId || role === Role.OWNER) return null;
    const starter = await tx.staffPosition.findFirst({
      where: { cafeId: actor.cafeId, role, isStarter: true },
      select: staffPositionSelect,
    });
    if (!starter) throw new BadRequestException('Выберите должность сотрудника');
    if (!canManagePosition(actor, starter)) throw new ForbiddenException('Нет права назначать эту должность');
    return starter;
  }

  private async checkPosition(tx: Prisma.TransactionClient, actor: AuthUser, positionId: string, role?: Role) {
    if (!actor.cafeId) throw new ForbiddenException('Не выбрано заведение');
    const position = await tx.staffPosition.findFirst({ where: { cafeId: actor.cafeId, id: positionId }, select: staffPositionSelect });
    if (!position) throw new NotFoundException('Должность не найдена');
    if (role !== undefined && position.role !== role) throw new BadRequestException('Рабочее место определяется выбранной должностью');
    if (!canManagePosition(actor, position)) throw new ForbiddenException('Нет права назначать эту должность');
    return position;
  }

  async positions(actor: AuthUser) {
    if (!actor.cafeId) throw new ForbiddenException('Не выбрано заведение');
    const positions = await this.prisma.staffPosition.findMany({
      where: { cafeId: actor.cafeId }, select: staffPositionSelect, orderBy: { name: 'asc' },
    });
    return positions.filter((position) => canManagePosition(actor, position)).map(({ isStarter, ...position }) => ({
      ...position, permissions: resolvePositionPermissions({ ...position, isStarter }),
    }));
  }

  async overview(actor: AuditActor) {
    const visibleRoles = this.isOwner(actor) ? undefined : { not: Role.OWNER };
    const [total, admins, waiters, kitchen, activeShifts] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null, role: visibleRoles } }),
      this.prisma.user.count({ where: { deletedAt: null, role: Role.ADMIN } }),
      this.prisma.user.count({ where: { deletedAt: null, role: Role.WAITER } }),
      this.prisma.user.count({ where: { deletedAt: null, role: Role.KITCHEN } }),
      this.prisma.waiterShift.findMany({
        where: { status: WaiterShiftStatus.active },
        select: { waiterId: true },
      }),
    ]);
    return {
      totalStaff: total,
      adminsCount: admins,
      waitersCount: waiters,
      kitchenCount: kitchen,
      onShiftCount: new Set(activeShifts.map((s) => s.waiterId)).size,
    };
  }

  async list(actor: AuthUser, params: { role?: Role; search?: string }) {
    if (params.role === Role.OWNER && !this.isOwner(actor)) {
      throw new ForbiddenException('Только владелец может просматривать владельцев');
    }
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(!this.isOwner(actor) ? { role: { not: Role.OWNER } } : {}),
      ...(params.role ? { role: params.role } : {}),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: 'insensitive' } },
              { phone: { contains: params.search } },
              { login: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const users = await this.prisma.user.findMany({
      where,
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: STAFF_SELECT,
    });

    // Кто сейчас на смене (активная смена официанта).
    const activeShifts = await this.prisma.waiterShift.findMany({
      where: { status: WaiterShiftStatus.active },
      select: { waiterId: true },
    });
    const onShift = new Set(activeShifts.map((s) => s.waiterId));

    return users.map((u) => ({ ...this.withPermissions(u, actor), onShift: onShift.has(u.id) }));
  }

  async reportEmployees(actor: AuthUser) {
    return this.prisma.user.findMany({
      where: {
        ...(this.isOwner(actor) ? {} : { role: { not: Role.OWNER } }),
      },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  /** Один сотрудник с итоговыми правами доступа. */
  async getOne(id: string, actor: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null }, select: STAFF_SELECT });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    if (user.role === Role.OWNER && !this.isOwner(actor)) {
      throw new ForbiddenException('Только владелец может просматривать владельцев');
    }
    return this.withPermissions(user, actor);
  }

  async create(dto: CreateStaffDto, actor: AuthUser) {
    const phone = normalizeAccountPhone(dto.phone);
    if (!phone) throw new BadRequestException(ACCOUNT_PHONE_ERROR);
    const exists = await this.prisma.user.findFirst({ where: { phone: { in: accountPhoneAliases(phone) } }, select: { id: true } });
    if (exists) {
      throw new BadRequestException('Сотрудник с таким телефоном уже есть');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx);
      if (actor.cafeId) await lockFinance(tx, actor.cafeId);
      if (!dto.positionId && dto.role !== Role.OWNER && (dto.positionId === null || !dto.role)) {
        throw new BadRequestException('Выберите должность сотрудника');
      }
      const position = dto.positionId
        ? await this.checkPosition(tx, actor, dto.positionId, dto.role)
        : await this.starterPosition(tx, actor, dto.role!);
      const role = position?.role ?? dto.role!;
      this.assertCanManageRole(actor, role);
      this.assertCanManagePositionAccount(actor, { role, positionId: position?.id ?? null, position });
      const prepStation = await staffStation(tx, role, dto.prepStation);
      const positionId = position?.id ?? null;
      const created = await tx.user.create({
        data: { name: dto.name, phone, role, prepStation, passwordHash, positionId },
        select: STAFF_SELECT,
      });
      if (actor.cafeId && role !== Role.OWNER) await syncEmployeeSalary(tx, actor.cafeId, [created.id], warehouseDay(new Date()));
      return created;
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_CREATED,
      entityType: AuditEntity.STAFF,
      entityId: created.id,
      description: `${actor.name ?? 'Сотрудник'} добавил сотрудника ${created.name} (${created.role})`,
      newValue: { name: created.name, phone: created.phone, role: created.role, prepStation: created.prepStation, positionId: created.positionId },
    });
    return this.withPermissions(created, actor);
  }

  async update(id: string, dto: UpdateStaffDto, actor: AuthUser) {
    const actorId = actor.id;
    const user = await this.prisma.user.findUnique({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    this.assertCanManageRole(actor, user.role);
    if (dto.role !== undefined) {
      this.assertCanManageRole(actor, dto.role);
    }

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isActive !== undefined) {
      if (id === actorId && dto.isActive === false) {
        throw new ForbiddenException('Нельзя отключить самого себя');
      }
      data.isActive = dto.isActive;
    }
    if (dto.phone !== undefined && dto.phone !== user.phone) {
      const phone = normalizeAccountPhone(dto.phone);
      if (!phone) throw new BadRequestException(ACCOUNT_PHONE_ERROR);
      const other = await this.prisma.user.findFirst({
        where: { phone: { in: accountPhoneAliases(phone) }, id: { not: id } },
        select: { id: true },
      });
      if (other) {
        throw new BadRequestException('Этот телефон занят другим сотрудником');
      }
      data.phone = phone;
    }
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx);
      if (actor.cafeId) await lockFinance(tx, actor.cafeId);
      const current = await tx.user.findUnique({ where: { id, deletedAt: null }, select: STAFF_SELECT });
      if (!current) throw new NotFoundException('Сотрудник не найден');
      this.assertCanManageRole(actor, current.role);
      if (id !== actorId) this.assertCanManagePositionAccount(actor, current);
      if (dto.isActive === false) await assertStaffWorkspaceChange(tx, actor.cafeId, [id], 'отключением сотрудника');
      if (id === actorId && ((dto.role !== undefined && dto.role !== current.role) || (dto.positionId !== undefined && dto.positionId !== current.positionId))) {
        throw new ForbiddenException('Нельзя менять собственную роль или должность');
      }
      let position = current.position;
      let role = dto.role ?? current.role;
      if (dto.positionId) {
        // A position is the source of both workspace and permissions, including role-only legacy clients.
        position = await this.checkPosition(tx, actor, dto.positionId, dto.role);
        role = position.role;
      } else if (dto.positionId === null && role !== Role.OWNER) {
        throw new BadRequestException('Выберите должность сотрудника');
      } else if (role !== current.role) {
        position = await this.starterPosition(tx, actor, role);
      }
      if (role === Role.OWNER) position = null;
      this.assertCanManageRole(actor, role);
      const positionChanged = (position?.id ?? null) !== current.positionId;
      if (role !== current.role || positionChanged) {
        this.assertCanManagePositionAccount(actor, { role, positionId: position?.id ?? null, position });
        const before = { role: current.role, permissions: resolveUserPermissions(current) };
        const next = { role, permissions: position?.permissions };
        const losesAccess = losesOperationalAccess(before, next);
        if (actor.cafeId && (role !== current.role || losesAccess)) await assertStaffWorkspaceChange(tx, actor.cafeId, [id], 'сменой должности');
        else if (disablesWorkTracking(before, next)) await assertNoActiveWorkShifts(tx, [id]);
        data.role = role;
        data.positionId = position?.id ?? null;
        data.permissions = Prisma.DbNull;
      }
      if (dto.prepStation !== undefined || role !== current.role) {
        data.prepStation = await staffStation(tx, role, dto.prepStation);
      }
      const updated = await tx.user.update({ where: { id }, data, select: STAFF_SELECT });
      if (dto.isActive === false || role !== current.role || positionChanged) {
        await tx.workShiftRequest.deleteMany({ where: { userId: id } });
      }
      if (actor.cafeId && (role !== current.role || positionChanged)) await syncEmployeeSalary(tx, actor.cafeId, [id]);
      return updated;
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_UPDATED,
      entityType: AuditEntity.STAFF,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} изменил сотрудника ${updated.name}` +
        (updated.role !== user.role ? ` · рабочее место ${user.role} → ${updated.role}` : '') +
        (dto.isActive !== undefined && dto.isActive !== user.isActive
          ? dto.isActive
            ? ' · доступ включён'
            : ' · доступ выключен'
          : ''),
      oldValue: { name: user.name, role: user.role, phone: user.phone, isActive: user.isActive, prepStation: user.prepStation, positionId: user.positionId },
      newValue: { name: updated.name, role: updated.role, phone: updated.phone, isActive: updated.isActive, prepStation: updated.prepStation, positionId: updated.positionId },
      metadata: { passwordChanged: !!dto.password },
    });
    return this.withPermissions(updated, actor);
  }

  async remove(id: string, actor: AuthUser) {
    if (id === actor.id) {
      throw new ForbiddenException('Нельзя удалить самого себя');
    }
    const { user, historyRetained } = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx);
      if (actor.cafeId) await lockFinance(tx, actor.cafeId);
      const user = await tx.user.findUnique({ where: { id, deletedAt: null }, select: STAFF_SELECT });
      if (!user) throw new NotFoundException('Сотрудник не найден');
      this.assertCanManageRole(actor, user.role);
      this.assertCanManagePositionAccount(actor, user);
      await assertStaffWorkspaceChange(tx, actor.cafeId, [id], 'удалением сотрудника');
      await tx.workShiftRequest.deleteMany({ where: { userId: id } });
      const scope = actor.cafeId ? { cafeId: actor.cafeId } : {};
      const history = await Promise.all([
        tx.user.findFirst({ where: { id, OR: [
          { orders: { some: {} } }, { openedPayrollOrders: { some: {} } }, { waiterShifts: { some: {} } }, { payments: { some: {} } },
          { kitchenEvents: { some: {} } }, { penalties: { some: {} } }, { assignedRewards: { some: {} } },
          { incidentsOwned: { some: {} } }, { incidentsMade: { some: {} } }, { auditLogs: { some: {} } },
          { receiptPrintRequests: { some: {} } }, { cashReports: { some: {} } },
        ] }, select: { id: true } }),
        tx.salaryAccrual.findFirst({ where: { ...scope, OR: [{ userId: id }, { actorId: id }] }, select: { id: true } }),
        tx.cashShift.findFirst({ where: { ...scope, OR: [{ openedById: id }, { closedById: id }] }, select: { id: true } }),
        tx.financeEntry.findFirst({ where: { ...scope, actorId: id }, select: { id: true } }),
        tx.orderAction.findFirst({ where: { ...scope, userId: id }, select: { id: true } }),
      ]);
      if (history.some(Boolean)) {
        await tx.user.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            isActive: false,
            phone: `deleted:${id}`,
            login: null,
            pinHash: null,
            positionId: null,
          },
        });
        await tx.pushSubscription.deleteMany({ where: { userId: id } });
        await tx.userDevice.deleteMany({ where: { userId: id } });
        return { user, historyRetained: true };
      }
      await tx.user.delete({ where: { id } });
      return { user, historyRetained: false };
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_DELETED,
      entityType: AuditEntity.STAFF,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} удалил сотрудника ${user.name}${historyRetained ? ' (история работы и расчётов сохранена)' : ''}`,
      oldValue: { name: user.name, role: user.role, phone: user.phone },
      metadata: { historyRetained },
    });
    return { ok: true };
  }

  async waiterReport(period: 'today' | 'week' | 'month', dateStr?: string) {
    const day = this.dayBounds(dateStr);
    const from = new Date(day.from.getTime() - (period === 'week' ? 6 : period === 'month' ? 29 : 0) * 86400000);
    const to = day.to;
    const waiters = await this.prisma.user.findMany({
      where: { role: { not: Role.OWNER }, OR: [{ role: Role.WAITER }, { orders: { some: {
        status: { in: [OrderStatus.paid, OrderStatus.cancelled] }, closedAt: { gte: from, lt: to },
      } } }] },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.paid, OrderStatus.cancelled] },
        closedAt: { gte: from, lt: to },
      },
      select: { waiterId: true, status: true, finalAmount: true, refundedAmount: true },
    });

    const report = waiters.map(w => ({
      id: w.id,
      name: w.name,
      revenue: 0,
      closedOrders: 0,
      cancelledOrders: 0,
    }));
    const waiterMap = new Map(report.map(r => [r.id, r]));

    for (const o of orders) {
      // QR-заказы без официанта не относятся к статистике сотрудников.
      const w = o.waiterId ? waiterMap.get(o.waiterId) : undefined;
      if (!w) continue;
      if (o.status === OrderStatus.paid) {
        w.revenue += Number(netOrderAmount(o));
        w.closedOrders += 1;
      } else if (o.status === OrderStatus.cancelled) {
        w.cancelledOrders += 1;
      }
    }

    return report;
  }

  // ====== Отчёт по сменам за дату ======

  private dayBounds(dateStr?: string) {
    const day = dateStr ?? warehouseDay(new Date());
    const range = warehouseDateRange(day, day)!;
    return { from: range.gte!, to: new Date(range.lte!.getTime() + 1) };
  }

  /** Дата без времени (для уникального ключа ShiftCashReport). */
  private dateOnly(dateStr?: string) {
    const { from } = this.dayBounds(dateStr);
    return new Date(warehouseDay(from) + 'T00:00:00.000Z');
  }

  private loadPaidOrders(waiterIds: string[], from: Date, to: Date) {
    return this.prisma.order.findMany({
      where: { waiterId: { in: waiterIds }, status: OrderStatus.paid, closedAt: { gte: from, lt: to } },
      select: {
        waiterId: true,
        finalAmount: true,
        deliveryFee: true,
        refundedAmount: true,
        paymentMethod: true,
        payments: { select: { method: true, status: true, amount: true, refundedAmount: true } },
        items: {
          where: { status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            dishNameSnapshot: true,
            dishVariantNameSnapshot: true,
            quantity: true,
            refundedQuantity: true,
            finalPrice: true,
            dish: { select: { categoryId: true, category: { select: { name: true, sortOrder: true } } } },
            // Состав сета — чтобы показать его под строкой сета в разбивке.
            setComponents: {
              where: {
                status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] },
                action: { not: 'removed' },
              },
              select: {
                quantity: true,
                action: true,
                status: true,
                originalNameSnapshot: true,
                finalNameSnapshot: true,
                finalVariantNameSnapshot: true,
              },
            },
          },
        },
      },
    });
  }

  private loadRejectedItems(waiterIds: string[], from: Date, to: Date) {
    return this.prisma.orderItem.findMany({
      where: {
        status: OrderItemStatus.rejected,
        updatedAt: { gte: from, lt: to },
        order: { waiterId: { in: waiterIds } },
      },
      select: {
        dishNameSnapshot: true,
        dishVariantNameSnapshot: true,
        finalPrice: true,
        rejectReason: true,
        updatedAt: true,
        order: { select: { waiterId: true, orderNumber: true } },
      },
    });
  }

  /**
   * Отчёт по сменам сотрудников за выбранную дату: смена, оборот, касса (должен/сдал),
   * разница, товарная разбивка по категориям и список отмен.
   */
  async shiftReport(dateStr: string | undefined, actor?: AuditActor) {
    const { from, to } = this.dayBounds(dateStr);
    const dateKey = this.dateOnly(dateStr);

    // В таблице — все сотрудники. Владельцев видит только владелец (как в списке персонала).
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(actor && actor.role !== Role.OWNER ? { role: { not: Role.OWNER } } : {}),
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    // Work time belongs to every employee. Historical waiter orders remain attached after a role change.
    const waiterIds = users.map((u) => u.id);
    const shifts = await this.prisma.waiterShift.findMany({
      where: { waiterId: { in: waiterIds }, startedAt: { lt: to }, OR: [{ endedAt: null }, { endedAt: { gt: from } }] },
      select: { waiterId: true, startedAt: true, endedAt: true, status: true },
    });

    // A failed query must surface as a report error, never as a fictitious zero balance.
    const [paidOrders, cancelledOrders, rejectedItems, cashReports, custody, cashSettings] = await Promise.all([
      this.loadPaidOrders(waiterIds, from, to),
      this.prisma.order.findMany({
        where: { waiterId: { in: waiterIds }, status: OrderStatus.cancelled, closedAt: { gte: from, lt: to } },
        select: { id: true, waiterId: true, orderNumber: true, finalAmount: true, closedAt: true },
      }),
      this.loadRejectedItems(waiterIds, from, to),
      this.prisma.shiftCashReport.findMany({
        where: { waiterId: { in: waiterIds }, date: dateKey },
        select: { waiterId: true, cashHanded: true, cashReceivedAt: true },
      }),
      this.prisma.financeEntry.groupBy({
        by: ['cashCustodianId'], _sum: { amount: true },
        where: { cashCustodianId: { in: waiterIds }, cashCustodyDay: dateKey },
      }),
      this.prisma.settings.findFirst({ select: { cashHandoverEnabled: true } }),
    ]);

    // Причины отмены заказов — из журнала аудита.
    const cancelledIds = cancelledOrders.map((o) => o.id);
    const reasonByOrder = new Map<string, string>();
    if (cancelledIds.length) {
      const logs = await this.prisma.auditLog.findMany({
        where: { actionType: AuditAction.ORDER_CANCELLED, orderId: { in: cancelledIds } },
        select: { orderId: true, metadata: true },
      });
      for (const l of logs) {
        const reason = (l.metadata as { reason?: string } | null)?.reason;
        if (l.orderId && reason) reasonByOrder.set(l.orderId, reason);
      }
    }

    const cashHandedByWaiter = new Map(cashReports.map((report) => [report.waiterId, report]));
    const custodyByWaiter = new Map(custody.map((row) => [row.cashCustodianId, Number(row._sum.amount ?? 0)]));

    type LineAgg = { name: string; qty: number; amount: number; components: Map<string, number> };
    type CatAgg = { categoryId: string; name: string; sortOrder: number; qty: number; amount: number; items: Map<string, LineAgg> };
    type Cancel = { time: string; name: string; amount: number; reason: string };
    const acc = new Map<string, {
      turnover: number;
      cashDue: number;
      categories: Map<string, CatAgg>;
      cancellations: Cancel[];
    }>();
    const ensure = (id: string) => {
      let a = acc.get(id);
      if (!a) {
        a = { turnover: 0, cashDue: 0, categories: new Map(), cancellations: [] };
        acc.set(id, a);
      }
      return a;
    };

    for (const o of paidOrders) {
      if (!o.waiterId) continue; // QR-заказ без официанта в отчёт сотрудника не идёт
      const a = ensure(o.waiterId);
      a.turnover += Number(netOrderAmount(o));
      if (!o.payments.length && o.paymentMethod === PaymentMethod.cash) {
        a.cashDue += Number(netOrderAmount(o));
      }
      for (const p of o.payments) {
        if (p.status === PaymentStatus.paid && p.method === PaymentMethod.cash) a.cashDue += Number(netPaymentAmount(p));
      }
      const itemPayables = allocateOrderItemCents(amountWithoutDelivery(o), o.items);
      for (const [index, it] of o.items.entries()) {
        const quantity = netItemQuantity(it);
        if (quantity <= 0) continue;
        const amount = Number(netItemAmount(it, itemPayables[index] / 100));
        const catId = it.dish?.categoryId ?? 'other';
        const catName = it.dish?.category?.name ?? 'Прочее';
        const sortOrder = it.dish?.category?.sortOrder ?? 9999;
        let cat = a.categories.get(catId);
        if (!cat) {
          cat = { categoryId: catId, name: catName, sortOrder, qty: 0, amount: 0, items: new Map() };
          a.categories.set(catId, cat);
        }
        const lineName = it.dishVariantNameSnapshot
          ? `${it.dishNameSnapshot} · ${it.dishVariantNameSnapshot}`
          : it.dishNameSnapshot;
        cat.qty += quantity;
        cat.amount += amount;
        let line = cat.items.get(lineName);
        if (!line) {
          line = { name: lineName, qty: 0, amount: 0, components: new Map() };
          cat.items.set(lineName, line);
        }
        line.qty += quantity;
        line.amount += amount;
        // Сет: показываем СОСТАВ под строкой сета (информативно, на счёт категорий
        // не влияет — владельцам так понятнее, чем подмешивать блюда в категории).
        for (const sc of it.setComponents ?? []) {
          if (sc.action === 'removed' || sc.status === OrderItemStatus.rejected || sc.status === OrderItemStatus.cancelled) {
            continue;
          }
          const compName =
            sc.action === 'replaced' && sc.finalNameSnapshot
              ? [sc.finalNameSnapshot, sc.finalVariantNameSnapshot].filter(Boolean).join(' ')
              : sc.originalNameSnapshot;
          line.components.set(compName, (line.components.get(compName) ?? 0) + sc.quantity * quantity);
        }
      }
    }

    for (const o of cancelledOrders) {
      if (!o.waiterId) continue;
      ensure(o.waiterId).cancellations.push({
        time: (o.closedAt ?? from).toISOString(),
        name: `Заказ ${o.orderNumber}`,
        amount: Number(o.finalAmount),
        reason: reasonByOrder.get(o.id) ?? '—',
      });
    }
    for (const it of rejectedItems) {
      const name = it.dishVariantNameSnapshot
        ? `${it.dishNameSnapshot} · ${it.dishVariantNameSnapshot}`
        : it.dishNameSnapshot;
      if (!it.order.waiterId) continue;
      ensure(it.order.waiterId).cancellations.push({
        time: it.updatedAt.toISOString(),
        name,
        amount: Number(it.finalPrice),
        reason: it.rejectReason ?? '—',
      });
    }

    // Смены: самое раннее начало и самое позднее завершение за день.
    const shiftByWaiter = new Map<string, { start: Date; end: Date | null; open: boolean }>();
    for (const s of shifts) {
      const cur = shiftByWaiter.get(s.waiterId);
      const open = s.status === WaiterShiftStatus.active || !s.endedAt;
      if (!cur) {
        shiftByWaiter.set(s.waiterId, { start: s.startedAt, end: s.endedAt, open });
      } else {
        if (s.startedAt < cur.start) cur.start = s.startedAt;
        if (open) cur.open = true;
        if (s.endedAt && (!cur.end || s.endedAt > cur.end)) cur.end = s.endedAt;
      }
    }

    const rows = users.map((u) => {
      const a = acc.get(u.id);
      const custodyDue = custodyByWaiter.get(u.id);
      const isWaiter = u.role === Role.WAITER || !!a || custodyDue !== undefined;
      const sh = shiftByWaiter.get(u.id);
      const receipt = cashHandedByWaiter.get(u.id);
      const cashDue = custodyDue ?? a?.cashDue ?? 0;
      const cashHanded = custodyDue !== undefined && !receipt?.cashReceivedAt ? 0 : Number(receipt?.cashHanded ?? 0);
      const durationMin = sh ? Math.round(payrollWorkTime(
        shifts.filter((shift) => shift.waiterId === u.id).map((shift) => ({
          startedAt: shift.startedAt, endedAt: shift.endedAt ?? new Date(),
        })), { start: from.getTime(), end: to.getTime(), days: 1 },
      ).milliseconds / 60000) : null;
      const categories = a
        ? [...a.categories.values()]
            .sort((x, y) => x.sortOrder - y.sortOrder || y.amount - x.amount)
            .map((c) => ({
              categoryId: c.categoryId,
              name: c.name,
              qty: c.qty,
              amount: c.amount,
              items: [...c.items.values()]
                .sort((x, y) => y.amount - x.amount)
                .map((it) => ({
                  name: it.name,
                  qty: it.qty,
                  amount: it.amount,
                  // Состав сета (если есть) — для показа под строкой сета.
                  components: it.components.size
                    ? [...it.components.entries()].map(([name, qty]) => ({ name, qty }))
                    : undefined,
                })),
            }))
        : [];
      const cancellations = (a?.cancellations ?? []).sort((x, y) => y.time.localeCompare(x.time));
      return {
        waiterId: u.id,
        name: u.name,
        role: u.role,
        // Подробный отчёт по смене — только для официантов.
        isWaiter,
        shiftStart: sh ? sh.start.toISOString() : null,
        shiftEnd: sh?.end && !sh.open ? sh.end.toISOString() : null,
        shiftOpen: sh?.open ?? false,
        durationMin,
        turnover: a?.turnover ?? 0,
        cashDue,
        cashHanded,
        cashHandover: custodyDue !== undefined || !!cashSettings?.cashHandoverEnabled,
        cashReceivedAt: receipt?.cashReceivedAt ?? null,
        difference: cashHanded - cashDue,
        categories,
        cancellations,
      };
    });

    // Официанты — первыми (у них развёрнутый отчёт), затем остальные; внутри — по имени.
    return rows.sort(
      (x, y) => Number(y.isWaiter) - Number(x.isWaiter) || x.name.localeCompare(y.name),
    );
  }

  /** Записать факт сдачи наличных сотрудником за дату. */
  async setCashHanded(waiterId: string, dateStr: string | undefined, amount: number, actor: AuditActor) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new BadRequestException('Некорректная сумма');
    }
    const date = this.dateOnly(dateStr);
    const key = { waiterId, date };
    const { waiter, saved } = await this.prisma.$transaction(async (db) => {
      const waiter = await db.user.findUnique({ where: { id: waiterId }, select: { name: true, cafeId: true } });
      if (!waiter) throw new NotFoundException('Сотрудник не найден');
      if (waiter.cafeId) {
        await lockFinance(db, waiter.cafeId);
        const [settings, custody] = await Promise.all([
          db.settings.findFirst({ where: { cafeId: waiter.cafeId }, select: { cashHandoverEnabled: true } }),
          db.financeEntry.findFirst({
            where: { cafeId: waiter.cafeId, cashCustodianId: waiterId, cashCustodyDay: date }, select: { id: true },
          }),
        ]);
        if (settings?.cashHandoverEnabled || custody) throw new ConflictException('Откройте «Финансы → Сдача наличных»');
      }
      const saved = await db.shiftCashReport.upsert({
        where: { waiterId_date: key }, create: { ...key, cafeId: waiter.cafeId, cashHanded: amount, updatedById: actor.id },
        update: { cashHanded: amount, updatedById: actor.id },
      });
      return { waiter, saved };
    });

    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_UPDATED,
      entityType: AuditEntity.STAFF,
      entityId: waiterId,
      description: `${actor.name ?? 'Администратор'} зафиксировал сдачу наличных сотрудником ${waiter.name}: ${amount} с (${date.toISOString().slice(0, 10)})`,
      metadata: { cashHanded: amount, date: date.toISOString().slice(0, 10) },
    });

    return { waiterId, cashHanded: Number(saved.cashHanded) };
  }

  private rangeForShiftHistory(params: ShiftHistoryQueryDto) {
    const today = this.dayBounds();
    const period = params.period ?? 'today';
    if (period === 'custom') {
      if (!params.from || !params.to) throw new BadRequestException('Укажите начало и конец периода');
      const range = warehouseDateRange(params.from, params.to)!;
      return { from: range.gte!, to: new Date(range.lte!.getTime() + 1) };
    }
    const days = period === 'week' ? 6 : period === 'month' ? 29 : 0;
    return { from: new Date(today.from.getTime() - days * 86400000), to: today.to };
  }

  private shiftStatus(startedAt: Date, endedAt: Date | null, now = new Date()) {
    if (endedAt) return 'closed';
    return now.getTime() - startedAt.getTime() >= MAX_WORK_SHIFT_MS ? 'unclosed' : 'active';
  }

  async shiftHistory(params: ShiftHistoryQueryDto, actor: AuditActor) {
    const { from, to } = this.rangeForShiftHistory(params);
    const userWhere: Prisma.UserWhereInput = {
      ...(!this.isOwner(actor) ? { role: { not: Role.OWNER } } : {}),
      ...(params.employeeId ? { id: params.employeeId } : {}),
      ...(params.role ? { role: params.role } : {}),
    };

    const { shifts, revisions } = await this.prisma.$transaction(async (tx) => {
      const shifts = await tx.waiterShift.findMany({
        where: {
          startedAt: { lt: to },
          OR: [{ endedAt: null }, { endedAt: { gt: from } }],
          waiter: userWhere,
        },
        orderBy: { startedAt: 'desc' },
        include: {
          waiter: { select: { id: true, name: true, role: true } },
          orders: {
            where: { status: OrderStatus.paid },
            select: { id: true, orderNumber: true, finalAmount: true, refundedAmount: true },
          },
        },
      });
      const revisions = shifts.length ? await tx.auditLog.findMany({
        where: { entityType: AuditEntity.STAFF_SHIFT, actionType: AuditAction.STAFF_SHIFT_CHANGED, entityId: { in: shifts.map(({ id }) => id) } },
        select: { id: true, entityId: true, userName: true, metadata: true, oldValue: true, newValue: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }) : [];
      return { shifts, revisions };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const history = new Map<string, typeof revisions>();
    for (const revision of revisions) {
      if (!revision.entityId) continue;
      const entries = history.get(revision.entityId) ?? [];
      entries.push(revision);
      history.set(revision.entityId, entries);
    }
    const now = new Date();
    const rows = shifts.map((s) => {
      const effectiveEnd = s.endedAt ?? now;
      const durationMin = Math.max(0, Math.round((Math.min(effectiveEnd.getTime(), to.getTime()) - Math.max(s.startedAt.getTime(), from.getTime())) / 60000));
      const turnover = s.orders.reduce((sum, o) => sum + Number(netOrderAmount(o)), 0);
      let closedBy: string | null = null;
      const changes = (history.get(s.id) ?? []).map((revision) => {
        const oldTime = revision.oldValue as { startedAt: string; endedAt: string | null };
        const newTime = revision.newValue as { startedAt: string; endedAt: string | null };
        const { kind, reason } = revision.metadata as { kind: WorkShiftChange; reason: string | null };
        if (!newTime.endedAt) closedBy = null;
        else if (!oldTime.endedAt) closedBy = kind === 'auto-close' ? 'Автоматически' : revision.userName;
        return { id: revision.id, at: revision.createdAt.toISOString(), actorName: revision.userName, kind, reason, oldTime, newTime };
      }).reverse();
      return {
        id: s.id,
        employeeId: s.waiterId,
        employeeName: s.waiter.name,
        role: s.waiter.role,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        updatedAt: s.updatedAt.toISOString(),
        durationMin,
        status: this.shiftStatus(s.startedAt, s.endedAt, now),
        closedBy: s.endedAt ? closedBy : null,
        adminComment: changes.find(({ reason }) => !!reason)?.reason ?? null,
        changes,
        ordersCount: s.orders.length,
        turnover,
        orders: s.orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          amount: Number(netOrderAmount(o)),
        })),
      };
    });

    return {
      items: rows,
      summary: {
        shiftsCount: rows.length,
        totalDurationMin: rows.reduce((sum, r) => sum + r.durationMin, 0),
        activeCount: rows.filter((r) => r.status === 'active').length,
        unclosedCount: rows.filter((r) => r.status === 'unclosed').length,
      },
      range: { from: from.toISOString(), to: to.toISOString() },
    };
  }

  /** Позиции оплаченных заказов по назначенным сотрудникам. */
  async waiterOrdersReport(params: WaiterOrdersReportQueryDto) {
    const range = warehouseDateRange(params.from, params.to)!;
    const from = range.gte!;
    const toInclusive = range.lte!;
    const to = new Date(toInclusive.getTime() + 1);

    const all = params.waiterId === 'all';
    const waiter = all ? { id: 'all', name: 'Все сотрудники' } : await this.prisma.user.findFirst({
      where: {
        id: params.waiterId,
        role: { not: Role.OWNER },
      },
      select: { id: true, name: true },
    });
    if (!waiter) throw new NotFoundException('Сотрудник не найден');

    const orders = await this.prisma.order.findMany({
      where: {
        ...(all ? { waiter: { role: { not: Role.OWNER } } } : { waiterId: waiter.id }),
        status: OrderStatus.paid,
        paymentStatus: { not: PaymentStatus.refunded },
        closedAt: { gte: from, lt: to },
      },
      orderBy: [{ closedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        closedAt: true,
        finalAmount: true,
        deliveryFee: true,
        waiter: { select: { name: true } },
        table: { select: { number: true } },
        items: {
          where: { status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            dishNameSnapshot: true,
            dishVariantNameSnapshot: true,
            quantity: true,
            refundedQuantity: true,
            finalPrice: true,
            updatedAt: true,
            dish: { select: { category: { select: { name: true } } } },
          },
        },
      },
    });

    let totalServingSeconds = 0;
    let totalPaymentSeconds = 0;
    const rows = orders.flatMap((order) => {
      const paidAt = order.closedAt ?? order.createdAt;
      const servedAt = order.items.length
        ? new Date(Math.max(...order.items.map((item) => item.updatedAt.getTime())))
        : order.createdAt;
      totalServingSeconds += Math.max(0, Math.round((servedAt.getTime() - order.createdAt.getTime()) / 1000));
      totalPaymentSeconds += Math.max(0, (paidAt.getTime() - order.createdAt.getTime()) / 1000);

      const allocations = allocateOrderItemCents(amountWithoutDelivery(order), order.items);
      return order.items.flatMap((item, index) => {
        const quantity = netItemQuantity(item);
        if (quantity <= 0) return [];
        const amount = Number(netItemAmount(item, allocations[index] / 100));
        return {
          id: item.id,
          orderId: order.id,
          orderedAt: order.createdAt.toISOString(),
          servedAt: servedAt.toISOString(),
          paidAt: paidAt.toISOString(),
          waiterName: order.waiter?.name ?? waiter.name,
          orderNumber: order.orderNumber,
          tableNumber: order.table.number,
          dishName: item.dishVariantNameSnapshot
            ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}`
            : item.dishNameSnapshot,
          categoryName: item.dish?.category.name ?? 'Прочее',
          quantity,
          unitPrice: amount / quantity,
          amount,
        };
      });
    });

    return {
      waiter,
      range: { from: from.toISOString(), to: toInclusive.toISOString() },
      items: rows,
      summary: {
        ordersCount: orders.length,
        dishesCount: rows.reduce((sum, row) => sum + row.quantity, 0),
        amount: Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
        averageServingSeconds: orders.length ? Math.round(totalServingSeconds / orders.length) : 0,
        averagePaymentSeconds: orders.length ? Math.round(totalPaymentSeconds / orders.length) : 0,
      },
    };
  }

  async updateShiftHistory(id: string, dto: UpdateShiftHistoryDto, actor: AuditActor & Partial<Pick<AuthUser, 'permissions'>>) {
    const change = await this.prisma.$transaction(async (tx) => {
      const shift = await this.lockStaffShift(tx, id, actor);
      const parseTime = (value: string) => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw new BadRequestException('Некорректное время смены');
        warehouseDateRange(value.slice(0, 10), value.slice(0, 10));
        return new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : value + '+06:00');
      };
      const startedAt = dto.startedAt !== undefined ? parseTime(dto.startedAt) : shift.startedAt;
      const endedAt = dto.endedAt !== undefined ? dto.endedAt ? parseTime(dto.endedAt) : null : shift.endedAt;
      if (!Number.isFinite(startedAt.getTime()) || (endedAt && !Number.isFinite(endedAt.getTime()))) {
        throw new BadRequestException('Некорректное время смены');
      }
      if (+startedAt === +shift.startedAt && (endedAt?.getTime() ?? null) === (shift.endedAt?.getTime() ?? null)) return null;
      if (dto.expectedUpdatedAt && dto.expectedUpdatedAt !== shift.updatedAt.toISOString()) {
        throw new ConflictException('Рабочая смена уже изменена. Обновите список и повторите действие');
      }
      if (!!endedAt !== !!shift.endedAt && !this.isOwner(actor)
          && !hasPermission(actor.permissions ?? resolvePermissions(actor.role as Role, null), 'actions.closeShift')) {
        throw new ForbiddenException('Нет права закрывать или повторно открывать рабочую смену');
      }
      if (endedAt && endedAt < startedAt) throw new BadRequestException('Время окончания не может быть раньше начала');
      const now = new Date();
      if (startedAt > now || (endedAt && endedAt > now)) throw new BadRequestException('Нельзя указать время смены в будущем');
      if (!endedAt && (!shift.waiter.isActive || !WORK_SHIFT_ROLES.includes(shift.waiter.role))) {
        throw new BadRequestException('Нельзя открыть смену отключённому сотруднику или владельцу');
      }
      const overlap = await tx.waiterShift.findFirst({ where: {
        waiterId: shift.waiterId, id: { not: id }, ...(endedAt ? { startedAt: { lt: endedAt } } : {}),
        OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }],
      }, select: { id: true } });
      if (overlap) throw new ConflictException('Время пересекается с другой сменой сотрудника');
      if (endedAt && shift.status === WaiterShiftStatus.active) await this.assertCanCloseStaffShift(tx, shift.waiterId);
      const updated = await tx.waiterShift.update({ where: { id }, data: {
        startedAt, endedAt, status: endedAt ? WaiterShiftStatus.closed : WaiterShiftStatus.active,
      } });
      await recordWorkShiftChange(tx, shift, updated, 'correction', actor, dto.reason);
      return { shift, updated };
    });
    if (change) {
      const { shift, updated } = change;
      this.events?.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_UPDATED, updated);
      if (!updated.endedAt || !shift.endedAt) this.events?.emitToWaiter(updated.waiterId,
        updated.endedAt ? SERVER_EVENTS.WAITER_SHIFT_ENDED : SERVER_EVENTS.WAITER_SHIFT_STARTED, updated);
    }
    return { ok: true };
  }

  async closeShiftHistory(id: string, actor: AuditActor) {
    const change = await this.prisma.$transaction(async (tx) => {
      const shift = await this.lockStaffShift(tx, id, actor);
      if (shift.endedAt || shift.status === WaiterShiftStatus.closed) return null;
      const endedAt = new Date();
      if (endedAt < shift.startedAt) throw new BadRequestException('Нельзя закрыть смену раньше начала');
      await this.assertCanCloseStaffShift(tx, shift.waiterId);
      const updated = await tx.waiterShift.update({ where: { id }, data: { endedAt, status: WaiterShiftStatus.closed } });
      await recordWorkShiftChange(tx, shift, updated, 'manual-close', actor);
      return updated;
    });
    if (!change) return { ok: true };
    this.events?.emitToWaiter(change.waiterId, SERVER_EVENTS.WAITER_SHIFT_ENDED, change);
    this.events?.emitToAdmin(SERVER_EVENTS.WAITER_SHIFT_ENDED, change);
    return { ok: true };
  }

  private async lockStaffShift(tx: Prisma.TransactionClient, id: string, actor: AuditActor) {
    const before = await tx.waiterShift.findUnique({ where: { id }, select: { cafeId: true } });
    if (!before) throw new NotFoundException('Смена не найдена');
    if (before.cafeId) await lockFinance(tx, before.cafeId);
    const shift = await tx.waiterShift.findUnique({ where: { id }, include: {
      waiter: { select: { name: true, role: true, isActive: true } },
    } });
    if (!shift) throw new NotFoundException('Смена не найдена');
    this.assertCanManageRole(actor, shift.waiter.role);
    return shift;
  }

  private async assertCanCloseStaffShift(tx: Prisma.TransactionClient, employeeId: string) {
    if (await tx.order.count({ where: { waiterId: employeeId, status: { notIn: CLOSED_ORDER_STATUSES } } })) {
      throw new ConflictException('Нельзя завершить смену, пока есть активные заказы');
    }
  }
}
