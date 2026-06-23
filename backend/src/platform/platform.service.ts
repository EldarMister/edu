import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CafeStatus, Prisma, Role, TableStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCafeDto } from './dto';

export type CleanupScope = 'orders' | 'menu' | 'warehouse';
const TX_OPTS = { timeout: 120_000, maxWait: 10_000 };

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

  // ---------- Частичная очистка и удаление ----------
  // Все таблицы скоупятся явным cafeId. Порядок учитывает FK RESTRICT (дети → родители).

  private async wipeOrders(tx: Prisma.TransactionClient, cafeId: string) {
    const where = { cafeId };
    await tx.orderItemSetComponent.deleteMany({ where });
    await tx.payment.deleteMany({ where });
    await tx.kitchenEvent.deleteMany({ where });
    await tx.orderAction.deleteMany({ where });
    await tx.receiptPrintRequest.deleteMany({ where });
    await tx.incident.deleteMany({ where });
    await tx.qrSessionItem.deleteMany({ where });
    await tx.qrGuest.deleteMany({ where });
    await tx.orderItem.deleteMany({ where });
    await tx.qrTableSession.deleteMany({ where });
    await tx.order.deleteMany({ where });
    await tx.table.updateMany({ where, data: { status: TableStatus.free } });
  }

  private async wipeMenu(tx: Prisma.TransactionClient, cafeId: string) {
    const where = { cafeId };
    await tx.setComponent.deleteMany({ where });
    await tx.recipeItem.deleteMany({ where });
    await tx.dishVariant.deleteMany({ where });
    await tx.dish.deleteMany({ where });
    await tx.category.deleteMany({ where });
  }

  private async wipeWarehouse(tx: Prisma.TransactionClient, cafeId: string) {
    const where = { cafeId };
    await tx.purchaseItem.deleteMany({ where });
    await tx.stockMovement.deleteMany({ where });
    await tx.purchase.deleteMany({ where });
    await tx.recipeItem.deleteMany({ where });
    await tx.ingredient.deleteMany({ where });
  }

  /** Частичная очистка. Меню/склад тянут за собой заказы (история ссылается на них). */
  async cleanupCafe(id: string, scopes: CleanupScope[]) {
    await this.requireCafe(id);
    const set = new Set(scopes);
    if (set.size === 0) throw new BadRequestException('Не выбрано, что очищать');
    if (set.has('menu') || set.has('warehouse')) set.add('orders');

    await this.prisma.$transaction(async (tx) => {
      if (set.has('orders')) await this.wipeOrders(tx, id);
      if (set.has('menu')) await this.wipeMenu(tx, id);
      if (set.has('warehouse')) await this.wipeWarehouse(tx, id);
    }, TX_OPTS);
    return { cleaned: [...set] };
  }

  /** Полное удаление кафе. Требует точного совпадения названия (защита). */
  async deleteCafe(id: string, confirmName: string) {
    const cafe = await this.requireCafe(id);
    if ((confirmName ?? '').trim() !== cafe.name) {
      throw new BadRequestException('Название не совпадает — удаление отменено');
    }
    await this.prisma.$transaction(async (tx) => {
      const where = { cafeId: id };
      await this.wipeOrders(tx, id);
      await this.wipeMenu(tx, id);
      await this.wipeWarehouse(tx, id);
      await tx.shiftCashReport.deleteMany({ where });
      await tx.waiterShift.deleteMany({ where });
      await tx.penaltyReward.deleteMany({ where });
      await tx.auditLog.deleteMany({ where });
      await tx.pushSubscription.deleteMany({ where });
      await tx.table.deleteMany({ where });
      await tx.hall.deleteMany({ where });
      await tx.user.deleteMany({ where });
      await tx.settings.deleteMany({ where });
      await tx.cafe.delete({ where: { id } });
    }, TX_OPTS);
    return { deleted: true, name: cafe.name };
  }

  // ---------- Персонал кафе ----------

  async getCafeStaff(cafeId: string) {
    await this.requireCafe(cafeId);
    const staff = await this.prisma.user.findMany({
      where: { cafeId },
      select: { id: true, name: true, phone: true, role: true, isActive: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return staff;
  }

  private async requireCafeUser(cafeId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, cafeId } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    return user;
  }

  async setStaffActive(cafeId: string, userId: string, isActive: boolean) {
    await this.requireCafeUser(cafeId, userId);
    return this.prisma.user.update({ where: { id: userId }, data: { isActive } });
  }

  /** Жёсткое удаление сотрудника. Владельца нельзя; при наличии истории — только деактивация. */
  async deleteStaff(cafeId: string, userId: string) {
    const user = await this.requireCafeUser(cafeId, userId);
    if (user.role === Role.OWNER) {
      throw new BadRequestException('Владельца удалить нельзя. Удалите кафе целиком или смените владельца.');
    }
    try {
      await this.prisma.user.delete({ where: { id: userId } });
      return { deleted: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BadRequestException('У сотрудника есть история (заказы/оплаты). Его можно только деактивировать.');
      }
      throw err;
    }
  }
}
