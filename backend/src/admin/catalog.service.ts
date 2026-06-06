import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import {
  CreateCategoryDto,
  CreateDishDto,
  CreateHallDto,
  CreateTableDto,
  UpdateCategoryDto,
  UpdateDishDto,
  UpdateHallDto,
  UpdateTableDto,
} from './dto';

/** Управление каталогом (залы, столы, категории, блюда) для админа/владельца. */
@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private audit: AuditService,
  ) {}

  // ===================== ЗАЛЫ И СТОЛЫ =====================

  async tablesOverview() {
    const [hallsCount, tablesCount, activeTables, occupied] = await Promise.all([
      this.prisma.hall.count({ where: { isActive: true } }),
      this.prisma.table.count(),
      this.prisma.table.count({ where: { isActive: true } }),
      this.prisma.table.count({ where: { status: { not: TableStatus.free } } }),
    ]);
    return {
      hallsCount,
      tablesCount,
      activeTablesCount: activeTables,
      occupiedCount: occupied,
    };
  }

  /** Все залы со столами (включая неактивные) — для управления. */
  hallsWithTables() {
    return this.prisma.hall.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        tables: {
          orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
          select: {
            id: true,
            number: true,
            seats: true,
            status: true,
            isActive: true,
            hallId: true,
          },
        },
      },
    });
  }

  createHall(dto: CreateHallDto) {
    return this.prisma.hall.create({ data: { name: dto.name, sortOrder: dto.sortOrder ?? 0 } });
  }

  async updateHall(id: string, dto: UpdateHallDto) {
    await this.ensureHall(id);
    return this.prisma.hall.update({ where: { id }, data: dto });
  }

  async deleteHall(id: string) {
    await this.ensureHall(id);
    const tables = await this.prisma.table.count({ where: { hallId: id } });
    if (tables > 0) {
      throw new BadRequestException('Нельзя удалить зал со столами. Сначала удалите столы.');
    }
    await this.prisma.hall.delete({ where: { id } });
    return { ok: true };
  }

  async createTable(dto: CreateTableDto) {
    await this.ensureHall(dto.hallId);
    const exists = await this.prisma.table.findUnique({
      where: { hallId_number: { hallId: dto.hallId, number: dto.number } },
    });
    if (exists) {
      throw new BadRequestException(`Стол №${dto.number} уже есть в этом зале`);
    }
    const table = await this.prisma.table.create({
      data: { hallId: dto.hallId, number: dto.number, seats: dto.seats, sortOrder: dto.number },
    });
    return table;
  }

  async updateTable(id: string, dto: UpdateTableDto) {
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table) throw new NotFoundException('Стол не найден');
    const updated = await this.prisma.table.update({ where: { id }, data: dto });
    if (dto.status && dto.status !== table.status) {
      this.events.emitBroadcast(SERVER_EVENTS.TABLE_STATUS_CHANGED, {
        id: updated.id,
        number: updated.number,
        status: updated.status,
        hallId: updated.hallId,
      });
    }
    return updated;
  }

  async deleteTable(id: string) {
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table) throw new NotFoundException('Стол не найден');
    const orders = await this.prisma.order.count({ where: { tableId: id } });
    if (orders > 0) {
      // У стола есть история заказов — деактивируем вместо удаления.
      return this.prisma.table.update({ where: { id }, data: { isActive: false } });
    }
    await this.prisma.table.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureHall(id: string) {
    const hall = await this.prisma.hall.findUnique({ where: { id } });
    if (!hall) throw new NotFoundException('Зал не найден');
    return hall;
  }

  // ===================== КАТЕГОРИИ И БЛЮДА =====================

  async menuOverview() {
    const [dishesCount, categoriesCount, activeDishes, agg] = await Promise.all([
      this.prisma.dish.count(),
      this.prisma.category.count({ where: { isActive: true } }),
      this.prisma.dish.count({ where: { isActive: true } }),
      this.prisma.dish.aggregate({ _avg: { price: true }, where: { isActive: true } }),
    ]);
    return {
      dishesCount,
      categoriesCount,
      activeDishesCount: activeDishes,
      avgPrice: agg._avg.price ? Number(agg._avg.price) : 0,
    };
  }

  categoriesAll() {
    return this.prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, sortOrder: true, isActive: true, _count: { select: { dishes: true } } },
    });
  }

  async createCategory(dto: CreateCategoryDto, actor: AuditActor) {
    const category = await this.prisma.category.create({
      data: { name: dto.name, sortOrder: dto.sortOrder ?? 0 },
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_CREATED,
      entityType: AuditEntity.CATEGORY,
      entityId: category.id,
      description: `${actor.name ?? 'Сотрудник'} добавил категорию «${category.name}»`,
      newValue: { name: category.name },
    });
    return category;
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actor: AuditActor) {
    const before = await this.ensureCategory(id);
    const updated = await this.prisma.category.update({ where: { id }, data: dto });
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_UPDATED,
      entityType: AuditEntity.CATEGORY,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} изменил категорию «${before.name}»`,
      oldValue: { name: before.name, isActive: before.isActive },
      newValue: { name: updated.name, isActive: updated.isActive },
    });
    return updated;
  }

  async deleteCategory(id: string, actor: AuditActor) {
    const before = await this.ensureCategory(id);
    const dishes = await this.prisma.dish.count({ where: { categoryId: id } });
    if (dishes > 0) {
      throw new BadRequestException('В категории есть блюда. Сначала перенесите или удалите их.');
    }
    await this.prisma.category.delete({ where: { id } });
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_DELETED,
      entityType: AuditEntity.CATEGORY,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} удалил категорию «${before.name}»`,
      oldValue: { name: before.name },
    });
    return { ok: true };
  }

  /** Все блюда (включая неактивные) с категорией — для управления меню. */
  dishesAll(params: { categoryId?: string; search?: string }) {
    const where: Prisma.DishWhereInput = {
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
    };
    return this.prisma.dish.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async createDish(dto: CreateDishDto, actor: AuditActor) {
    await this.ensureCategory(dto.categoryId);
    const dish = await this.prisma.dish.create({
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        price: new Prisma.Decimal(dto.price),
        description: dto.description,
        imageUrl: dto.imageUrl,
        discountType: dto.discountType ?? 'none',
        discountValue: new Prisma.Decimal(dto.discountValue ?? 0),
        cookingTime: dto.cookingTime,
      },
      include: { category: { select: { id: true, name: true } } },
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.MENU_ITEM_CREATED,
      entityType: AuditEntity.MENU_ITEM,
      entityId: dish.id,
      description: `${actor.name ?? 'Сотрудник'} добавил блюдо «${dish.name}» (${Number(dish.price)} с)`,
      newValue: { name: dish.name, price: Number(dish.price), categoryId: dish.categoryId },
    });
    return dish;
  }

  async updateDish(id: string, dto: UpdateDishDto, actor: AuditActor) {
    const dish = await this.prisma.dish.findUnique({ where: { id } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    const data: Prisma.DishUpdateInput = { ...dto } as Prisma.DishUpdateInput;
    if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
    if (dto.discountValue !== undefined) data.discountValue = new Prisma.Decimal(dto.discountValue);
    if (dto.categoryId) {
      await this.ensureCategory(dto.categoryId);
    }
    const updated = await this.prisma.dish.update({
      where: { id },
      data,
      include: { category: { select: { id: true, name: true } } },
    });
    // Меню изменилось — оповестим клиентов (официанты обновят список).
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId: id });

    const oldPrice = Number(dish.price);
    const newPrice = Number(updated.price);
    // Отдельная запись об изменении цены — самое спорное действие (ТЗ §3.4).
    if (dto.price !== undefined && oldPrice !== newPrice) {
      await this.audit.log({
        actor,
        actionType: AuditAction.MENU_ITEM_PRICE_CHANGED,
        entityType: AuditEntity.MENU_ITEM,
        entityId: id,
        description: `${actor.name ?? 'Сотрудник'} изменил цену блюда «${dish.name}» с ${oldPrice} с на ${newPrice} с`,
        oldValue: { price: oldPrice },
        newValue: { price: newPrice },
        metadata: { dishName: dish.name },
      });
    }
    // Общая запись об изменении блюда (имя/категория/доступность/скидка и т.п.).
    await this.audit.log({
      actor,
      actionType: AuditAction.MENU_ITEM_UPDATED,
      entityType: AuditEntity.MENU_ITEM,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} изменил блюдо «${dish.name}»`,
      oldValue: {
        name: dish.name,
        price: oldPrice,
        categoryId: dish.categoryId,
        isAvailable: dish.isAvailable,
        isActive: dish.isActive,
      },
      newValue: {
        name: updated.name,
        price: newPrice,
        categoryId: updated.categoryId,
        isAvailable: updated.isAvailable,
        isActive: updated.isActive,
      },
    });
    return updated;
  }

  async deleteDish(id: string, actor: AuditActor) {
    const dish = await this.prisma.dish.findUnique({ where: { id } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    const used = await this.prisma.orderItem.count({ where: { dishId: id } });
    let result: unknown;
    if (used > 0) {
      // Блюдо в истории заказов — мягко отключаем.
      result = await this.prisma.dish.update({
        where: { id },
        data: { isActive: false, isAvailable: false },
        include: { category: { select: { id: true, name: true } } },
      });
    } else {
      await this.prisma.dish.delete({ where: { id } });
      result = { ok: true };
    }
    await this.audit.log({
      actor,
      actionType: AuditAction.MENU_ITEM_DELETED,
      entityType: AuditEntity.MENU_ITEM,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} удалил блюдо «${dish.name}»${used > 0 ? ' (отключено, есть в истории заказов)' : ''}`,
      oldValue: { name: dish.name, price: Number(dish.price) },
      metadata: { softDeleted: used > 0 },
    });
    return result;
  }

  private async ensureCategory(id: string) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Категория не найдена');
    return cat;
  }
}
