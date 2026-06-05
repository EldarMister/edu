import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, WaiterShiftStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private prisma: PrismaService) {}

  async overview() {
    const [total, admins, waiters, kitchen, activeShifts] = await Promise.all([
      this.prisma.user.count(),
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

  async list(params: { role?: Role; search?: string }) {
    const where: Prisma.UserWhereInput = {
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

  async create(dto: CreateStaffDto) {
    const phone = this.normalizePhone(dto.phone);
    const exists = await this.prisma.user.findUnique({ where: { phone } });
    if (exists) {
      throw new BadRequestException('Сотрудник с таким телефоном уже есть');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: { name: dto.name, phone, role: dto.role, passwordHash },
      select: STAFF_SELECT,
    });
  }

  async update(id: string, dto: UpdateStaffDto, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Сотрудник не найден');

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

    return this.prisma.user.update({ where: { id }, data, select: STAFF_SELECT });
  }

  async remove(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    if (id === actorId) {
      throw new ForbiddenException('Нельзя удалить самого себя');
    }
    const hasOrders = await this.prisma.order.count({ where: { waiterId: id } });
    if (hasOrders > 0) {
      // Есть история — мягко отключаем.
      return this.prisma.user.update({
        where: { id },
        data: { isActive: false },
        select: STAFF_SELECT,
      });
    }
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
