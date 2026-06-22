import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CafeStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCafeDto } from './dto';

@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService) {}

  /** Список всех кафе со сводными счётчиками (персонал, заказы). */
  async listCafes() {
    const [cafes, staffGroups, orderGroups] = await Promise.all([
      this.prisma.cafe.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.user.groupBy({ by: ['cafeId'], _count: { _all: true } }),
      this.prisma.order.groupBy({ by: ['cafeId'], _count: { _all: true } }),
    ]);
    const staffByCafe = new Map(staffGroups.map((g) => [g.cafeId, g._count._all]));
    const ordersByCafe = new Map(orderGroups.map((g) => [g.cafeId, g._count._all]));
    return cafes.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      paidUntil: c.paidUntil,
      suspendedAt: c.suspendedAt,
      suspendedReason: c.suspendedReason,
      createdAt: c.createdAt,
      staffCount: staffByCafe.get(c.id) ?? 0,
      ordersCount: ordersByCafe.get(c.id) ?? 0,
    }));
  }

  private async requireCafe(id: string) {
    const cafe = await this.prisma.cafe.findUnique({ where: { id } });
    if (!cafe) throw new NotFoundException('Кафе не найдено');
    return cafe;
  }

  async suspendCafe(id: string, reason?: string) {
    await this.requireCafe(id);
    return this.prisma.cafe.update({
      where: { id },
      data: {
        status: CafeStatus.suspended,
        suspendedAt: new Date(),
        suspendedReason: reason?.trim() || 'Приостановлено администратором',
      },
    });
  }

  async resumeCafe(id: string) {
    await this.requireCafe(id);
    return this.prisma.cafe.update({
      where: { id },
      data: { status: CafeStatus.active, suspendedAt: null, suspendedReason: null },
    });
  }

  /** Установить «оплачено до». Если дата в будущем и resumeIfPaid — возобновляем кафе. */
  async updateSubscription(id: string, paidUntil: string | null | undefined, resumeIfPaid = true) {
    await this.requireCafe(id);
    const date = paidUntil ? new Date(paidUntil) : null;
    const paidInFuture = !!date && date.getTime() > Date.now();
    return this.prisma.cafe.update({
      where: { id },
      data: {
        paidUntil: date,
        ...(paidInFuture && resumeIfPaid
          ? { status: CafeStatus.active, suspendedAt: null, suspendedReason: null }
          : {}),
      },
    });
  }

  /** Создать кафе + первого OWNER + дефолтные Settings (телефон глобально уникален). */
  async createCafe(dto: CreateCafeDto) {
    const phone = dto.ownerPhone.replace(/[^\d+]/g, '');
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      throw new BadRequestException(`Телефон ${phone} уже занят (телефоны глобально уникальны)`);
    }
    const passwordHash = await bcrypt.hash(dto.ownerPassword, 10);
    return this.prisma.$transaction(async (tx) => {
      const cafe = await tx.cafe.create({ data: { name: dto.cafeName.trim() } });
      await tx.user.create({
        data: { cafeId: cafe.id, name: dto.ownerName.trim(), phone, role: Role.OWNER, passwordHash },
      });
      await tx.settings.create({ data: { cafeId: cafe.id, cafeName: dto.cafeName.trim() } });
      return { id: cafe.id, name: cafe.name, ownerPhone: phone };
    });
  }
}
