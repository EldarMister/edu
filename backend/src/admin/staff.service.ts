import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, WaiterShiftStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { CreateStaffDto, UpdateStaffDto } from './dto';

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
}
