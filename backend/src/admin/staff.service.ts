import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderItemStatus, OrderStatus, PaymentMethod, PaymentStatus, Prisma, Role, WaiterShiftStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { CreateStaffDto, ShiftHistoryQueryDto, UpdateShiftHistoryDto, UpdateStaffDto } from './dto';

const STAFF_SELECT = {
  id: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class StaffService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private isOwner(actor: AuditActor) {
    return actor.role === Role.OWNER;
  }

  private assertCanManageRole(actor: AuditActor, role: Role) {
    if (role === Role.OWNER && !this.isOwner(actor)) {
      throw new ForbiddenException('Только владелец может управлять владельцами');
    }
  }

  async overview(actor: AuditActor) {
    const visibleRoles = this.isOwner(actor) ? undefined : { not: Role.OWNER };
    const [total, admins, waiters, kitchen, activeShifts] = await Promise.all([
      this.prisma.user.count({ where: visibleRoles ? { role: visibleRoles } : {} }),
      this.prisma.user.count({ where: { role: Role.ADMIN } }),
      this.prisma.user.count({ where: { role: Role.WAITER } }),
      this.prisma.user.count({ where: { role: Role.KITCHEN } }),
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

  async list(actor: AuditActor, params: { role?: Role; search?: string }) {
    if (params.role === Role.OWNER && !this.isOwner(actor)) {
      throw new ForbiddenException('Только владелец может просматривать владельцев');
    }
    const where: Prisma.UserWhereInput = {
      ...(!this.isOwner(actor) ? { role: { not: Role.OWNER } } : {}),
      ...(params.role ? { role: params.role } : {}),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: 'insensitive' } },
              { phone: { contains: params.search } },
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

    return users.map((u) => ({ ...u, onShift: onShift.has(u.id) }));
  }

  private normalizePhone(phone: string) {
    return phone.trim().replace(/[^\d+]/g, '');
  }

  async create(dto: CreateStaffDto, actor: AuditActor) {
    this.assertCanManageRole(actor, dto.role);
    const phone = this.normalizePhone(dto.phone);
    const exists = await this.prisma.user.findUnique({ where: { phone } });
    if (exists) {
      throw new BadRequestException('Сотрудник с таким телефоном уже есть');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const created = await this.prisma.user.create({
      data: { name: dto.name, phone, role: dto.role, passwordHash },
      select: STAFF_SELECT,
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_CREATED,
      entityType: AuditEntity.STAFF,
      entityId: created.id,
      description: `${actor.name ?? 'Сотрудник'} добавил сотрудника ${created.name} (${created.role})`,
      newValue: { name: created.name, phone: created.phone, role: created.role },
    });
    return created;
  }

  async update(id: string, dto: UpdateStaffDto, actor: AuditActor) {
    const actorId = actor.id;
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    this.assertCanManageRole(actor, user.role);
    if (dto.role !== undefined) {
      this.assertCanManageRole(actor, dto.role);
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) {
      if (id === actorId && dto.isActive === false) {
        throw new ForbiddenException('Нельзя отключить самого себя');
      }
      data.isActive = dto.isActive;
    }
    if (dto.phone !== undefined) {
      const phone = this.normalizePhone(dto.phone);
      const other = await this.prisma.user.findUnique({ where: { phone } });
      if (other && other.id !== id) {
        throw new BadRequestException('Этот телефон занят другим сотрудником');
      }
      data.phone = phone;
    }
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const updated = await this.prisma.user.update({ where: { id }, data, select: STAFF_SELECT });
    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_UPDATED,
      entityType: AuditEntity.STAFF,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} изменил сотрудника ${updated.name}` +
        (dto.role !== undefined && dto.role !== user.role ? ` · роль ${user.role} → ${dto.role}` : '') +
        (dto.isActive !== undefined && dto.isActive !== user.isActive
          ? dto.isActive
            ? ' · доступ включён'
            : ' · доступ выключен'
          : ''),
      oldValue: { name: user.name, role: user.role, phone: user.phone, isActive: user.isActive },
      newValue: { name: updated.name, role: updated.role, phone: updated.phone, isActive: updated.isActive },
      metadata: { passwordChanged: !!dto.password },
    });
    return updated;
  }

  async remove(id: string, actor: AuditActor) {
    const actorId = actor.id;
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    this.assertCanManageRole(actor, user.role);
    if (id === actorId) {
      throw new ForbiddenException('Нельзя удалить самого себя');
    }
    const hasOrders = await this.prisma.order.count({ where: { waiterId: id } });
    let result: unknown;
    if (hasOrders > 0) {
      // Есть история — мягко отключаем.
      result = await this.prisma.user.update({
        where: { id },
        data: { isActive: false },
        select: STAFF_SELECT,
      });
    } else {
      await this.prisma.user.delete({ where: { id } });
      result = { ok: true };
    }
    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_DELETED,
      entityType: AuditEntity.STAFF,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} удалил сотрудника ${user.name}${hasOrders > 0 ? ' (отключён, есть история заказов)' : ''}`,
      oldValue: { name: user.name, role: user.role, phone: user.phone },
      metadata: { softDeleted: hasOrders > 0 },
    });
    return result;
  }

  async waiterReport(period: 'today' | 'week' | 'month', dateStr?: string) {
    const startOfDay = (d = new Date()) => {
      const s = new Date(d);
      s.setHours(0, 0, 0, 0);
      return s;
    };
    const endExclusive = (d: Date) => {
      const next = startOfDay(d);
      next.setDate(next.getDate() + 1);
      return next;
    };
    const addDays = (d: Date, days: number) => {
      const next = new Date(d);
      next.setDate(next.getDate() + days);
      return next;
    };

    const today = startOfDay();
    const baseDate = dateStr && !Number.isNaN(new Date(dateStr).getTime()) ? startOfDay(new Date(dateStr)) : today;

    let from: Date;
    let to: Date;
    if (period === 'today') {
      from = baseDate;
      to = endExclusive(baseDate);
    } else if (period === 'week') {
      from = addDays(baseDate, -6);
      to = endExclusive(baseDate);
    } else { // month
      from = addDays(baseDate, -29);
      to = endExclusive(baseDate);
    }

    const waiters = await this.prisma.user.findMany({
      where: { role: Role.WAITER },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.paid, OrderStatus.cancelled] },
        closedAt: { gte: from, lt: to },
      },
      select: { waiterId: true, status: true, finalAmount: true },
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
      const w = waiterMap.get(o.waiterId);
      if (!w) continue;
      if (o.status === OrderStatus.paid) {
        w.revenue += Number(o.finalAmount);
        w.closedOrders += 1;
      } else if (o.status === OrderStatus.cancelled) {
        w.cancelledOrders += 1;
      }
    }

    return report;
  }

  // ====== Отчёт по сменам за дату ======

  private dayBounds(dateStr?: string) {
    const base =
      dateStr && !Number.isNaN(new Date(dateStr).getTime()) ? new Date(dateStr) : new Date();
    const from = new Date(base);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from, to };
  }

  /** Дата без времени (для уникального ключа ShiftCashReport). */
  private dateOnly(dateStr?: string) {
    const { from } = this.dayBounds(dateStr);
    return from;
  }

  private loadPaidOrders(waiterIds: string[], from: Date, to: Date) {
    return this.prisma.order.findMany({
      where: { waiterId: { in: waiterIds }, status: OrderStatus.paid, closedAt: { gte: from, lt: to } },
      select: {
        waiterId: true,
        finalAmount: true,
        payments: { where: { status: PaymentStatus.paid }, select: { method: true, amount: true } },
        items: {
          where: { status: { notIn: [OrderItemStatus.rejected, OrderItemStatus.cancelled] } },
          select: {
            dishNameSnapshot: true,
            dishVariantNameSnapshot: true,
            quantity: true,
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
    const where = actor && actor.role !== Role.OWNER ? { role: { not: Role.OWNER } } : {};
    const users = await this.prisma.user.findMany({
      where,
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    });
    // Финансовый отчёт по смене считаем только для официантов.
    const waiterIds = users.filter((u) => u.role === Role.WAITER).map((u) => u.id);

    // Финансовая агрегация. Если что-то из неё упадёт (напр. отсутствует таблица/колонка
    // на ещё не мигрированной БД) — НЕ роняем весь отчёт: показываем список сотрудников
    // с нулевыми финансами, а не пустую страницу «нет данных».
    let shifts: { waiterId: string; startedAt: Date; endedAt: Date | null; status: WaiterShiftStatus }[] = [];
    let paidOrders: Awaited<ReturnType<typeof this.loadPaidOrders>> = [];
    let cancelledOrders: { id: string; waiterId: string; orderNumber: string; finalAmount: Prisma.Decimal; closedAt: Date | null }[] = [];
    let rejectedItems: Awaited<ReturnType<typeof this.loadRejectedItems>> = [];
    let cashReports: { waiterId: string; cashHanded: Prisma.Decimal }[] = [];
    if (waiterIds.length > 0) {
      try {
        [shifts, paidOrders, cancelledOrders, rejectedItems, cashReports] = await Promise.all([
          this.prisma.waiterShift.findMany({
            where: {
              waiterId: { in: waiterIds },
              startedAt: { lt: to },
              OR: [{ endedAt: null }, { endedAt: { gte: from } }],
            },
            select: { waiterId: true, startedAt: true, endedAt: true, status: true },
          }),
          this.loadPaidOrders(waiterIds, from, to),
          this.prisma.order.findMany({
            where: { waiterId: { in: waiterIds }, status: OrderStatus.cancelled, closedAt: { gte: from, lt: to } },
            select: { id: true, waiterId: true, orderNumber: true, finalAmount: true, closedAt: true },
          }),
          this.loadRejectedItems(waiterIds, from, to),
          this.prisma.shiftCashReport.findMany({
            where: { waiterId: { in: waiterIds }, date: dateKey },
            select: { waiterId: true, cashHanded: true },
          }),
        ]);
      } catch (err) {
        console.error('[shiftReport] финансовая агрегация не удалась:', err);
      }
    }

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

    const cashHandedByWaiter = new Map(cashReports.map((c) => [c.waiterId, Number(c.cashHanded)]));

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
      const a = ensure(o.waiterId);
      a.turnover += Number(o.finalAmount);
      for (const p of o.payments) {
        if (p.method === PaymentMethod.cash) a.cashDue += Number(p.amount);
      }
      for (const it of o.items) {
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
        cat.qty += it.quantity;
        cat.amount += Number(it.finalPrice);
        let line = cat.items.get(lineName);
        if (!line) {
          line = { name: lineName, qty: 0, amount: 0, components: new Map() };
          cat.items.set(lineName, line);
        }
        line.qty += it.quantity;
        line.amount += Number(it.finalPrice);
        // Сет: показываем СОСТАВ под строкой сета (информативно, на счёт категорий
        // не влияет — владельцам так понятнее, чем подмешивать блюда в категории).
        for (const sc of it.setComponents ?? []) {
          if (sc.action === 'removed' || sc.status === OrderItemStatus.rejected || sc.status === OrderItemStatus.cancelled) {
            continue;
          }
          const compName = (sc.action === 'replaced' ? sc.finalNameSnapshot : sc.originalNameSnapshot) ?? sc.originalNameSnapshot;
          line.components.set(compName, (line.components.get(compName) ?? 0) + sc.quantity * it.quantity);
        }
      }
    }

    for (const o of cancelledOrders) {
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
      const isWaiter = u.role === Role.WAITER;
      const a = isWaiter ? acc.get(u.id) : undefined;
      const sh = isWaiter ? shiftByWaiter.get(u.id) : undefined;
      const cashDue = a?.cashDue ?? 0;
      const cashHanded = isWaiter ? cashHandedByWaiter.get(u.id) ?? 0 : 0;
      const durationMin =
        sh && sh.end ? Math.max(0, Math.round((sh.end.getTime() - sh.start.getTime()) / 60000)) : null;
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
        shiftEnd: sh?.end ? sh.end.toISOString() : null,
        shiftOpen: sh?.open ?? false,
        durationMin,
        turnover: a?.turnover ?? 0,
        cashDue,
        cashHanded,
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
    const waiter = await this.prisma.user.findUnique({ where: { id: waiterId }, select: { id: true, name: true } });
    if (!waiter) throw new NotFoundException('Сотрудник не найден');
    const date = this.dateOnly(dateStr);

    const saved = await this.prisma.shiftCashReport.upsert({
      where: { waiterId_date: { waiterId, date } },
      create: { waiterId, date, cashHanded: amount, updatedById: actor.id },
      update: { cashHanded: amount, updatedById: actor.id },
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
    const startOfDay = (d = new Date()) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    const addDays = (d: Date, days: number) => {
      const x = new Date(d);
      x.setDate(x.getDate() + days);
      return x;
    };
    const endExclusive = (d: Date) => addDays(startOfDay(d), 1);
    const today = startOfDay();
    const period = params.period ?? 'today';

    if (period === 'custom' && params.from && params.to) {
      const from = startOfDay(new Date(params.from));
      const to = endExclusive(new Date(params.to));
      return { from, to };
    }
    if (period === 'week') return { from: addDays(today, -6), to: endExclusive(today) };
    if (period === 'month') return { from: addDays(today, -29), to: endExclusive(today) };
    return { from: today, to: endExclusive(today) };
  }

  private shiftStatus(startedAt: Date, endedAt: Date | null, now = new Date()) {
    if (endedAt) return 'closed';
    const startDay = new Date(startedAt);
    startDay.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return startDay < today ? 'unclosed' : 'active';
  }

  async shiftHistory(params: ShiftHistoryQueryDto, actor: AuditActor) {
    const { from, to } = this.rangeForShiftHistory(params);
    const userWhere: Prisma.UserWhereInput = {
      ...(!this.isOwner(actor) ? { role: { not: Role.OWNER } } : {}),
      ...(params.employeeId ? { id: params.employeeId } : {}),
      ...(params.role ? { role: params.role } : {}),
    };

    const shifts = await this.prisma.waiterShift.findMany({
      where: {
        startedAt: { lt: to },
        OR: [{ endedAt: null }, { endedAt: { gte: from } }],
        waiter: userWhere,
      },
      orderBy: { startedAt: 'desc' },
      include: {
        waiter: { select: { id: true, name: true, role: true } },
        orders: {
          where: { status: OrderStatus.paid },
          select: { id: true, orderNumber: true, finalAmount: true },
        },
      },
    });

    const now = new Date();
    const rows = shifts.map((s) => {
      const effectiveEnd = s.endedAt ?? now;
      const durationMin = Math.max(0, Math.round((effectiveEnd.getTime() - s.startedAt.getTime()) / 60000));
      const turnover = s.orders.reduce((sum, o) => sum + Number(o.finalAmount), 0);
      return {
        id: s.id,
        employeeId: s.waiterId,
        employeeName: s.waiter.name,
        role: s.waiter.role,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        durationMin,
        status: this.shiftStatus(s.startedAt, s.endedAt, now),
        closedBy: null,
        adminComment: null,
        ordersCount: s.orders.length,
        turnover,
        orders: s.orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          amount: Number(o.finalAmount),
        })),
      };
    });

    return {
      items: rows,
      summary: {
        shiftsCount: rows.length,
        totalDurationMin: rows.reduce((sum, r) => sum + r.durationMin, 0),
        activeCount: rows.filter((r) => r.status === 'active').length,
      },
      range: { from: from.toISOString(), to: to.toISOString() },
    };
  }

  async updateShiftHistory(id: string, dto: UpdateShiftHistoryDto, actor: AuditActor) {
    const shift = await this.prisma.waiterShift.findUnique({
      where: { id },
      include: { waiter: { select: { name: true } } },
    });
    if (!shift) throw new NotFoundException('Смена не найдена');

    const data: Prisma.WaiterShiftUpdateInput = {};
    const startedAt = dto.startedAt !== undefined ? new Date(dto.startedAt) : shift.startedAt;
    const endedAt =
      dto.endedAt !== undefined
        ? dto.endedAt
          ? new Date(dto.endedAt)
          : null
        : shift.endedAt;
    if (Number.isNaN(startedAt.getTime()) || (endedAt && Number.isNaN(endedAt.getTime()))) {
      throw new BadRequestException('Некорректное время смены');
    }
    if (endedAt && endedAt < startedAt) {
      throw new BadRequestException('Время окончания не может быть раньше начала');
    }
    if (dto.startedAt !== undefined) data.startedAt = startedAt;
    if (dto.endedAt !== undefined) {
      data.endedAt = endedAt;
      data.status = endedAt ? WaiterShiftStatus.closed : WaiterShiftStatus.active;
    }

    const updated = await this.prisma.waiterShift.update({ where: { id }, data });
    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_UPDATED,
      entityType: AuditEntity.STAFF,
      entityId: shift.waiterId,
      description: `${actor.name ?? 'Администратор'} изменил время смены сотрудника ${shift.waiter.name}`,
      oldValue: {
        startedAt: shift.startedAt.toISOString(),
        endedAt: shift.endedAt ? shift.endedAt.toISOString() : null,
      },
      newValue: {
        startedAt: updated.startedAt.toISOString(),
        endedAt: updated.endedAt ? updated.endedAt.toISOString() : null,
      },
    });
    return { ok: true };
  }

  async closeShiftHistory(id: string, actor: AuditActor) {
    const shift = await this.prisma.waiterShift.findUnique({
      where: { id },
      include: { waiter: { select: { name: true } } },
    });
    if (!shift) throw new NotFoundException('Смена не найдена');
    if (shift.endedAt || shift.status === WaiterShiftStatus.closed) {
      return { ok: true };
    }
    const endedAt = new Date();
    if (endedAt < shift.startedAt) {
      throw new BadRequestException('Нельзя закрыть смену раньше начала');
    }
    await this.prisma.waiterShift.update({
      where: { id },
      data: { endedAt, status: WaiterShiftStatus.closed },
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.STAFF_UPDATED,
      entityType: AuditEntity.STAFF,
      entityId: shift.waiterId,
      description: `${actor.name ?? 'Администратор'} вручную закрыл смену сотрудника ${shift.waiter.name}`,
      oldValue: { endedAt: null, status: shift.status },
      newValue: { endedAt: endedAt.toISOString(), status: WaiterShiftStatus.closed },
    });
    return { ok: true };
  }
}
