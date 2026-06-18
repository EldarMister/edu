import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { normalizeDishImage, withDishImageRef } from '../dishes/dish-image';
import {
  CreateCategoryDto,
  CreateDishDto,
  CreateSetDto,
  DeleteCategoryDto,
  DishVariantDto,
  CreateHallDto,
  CreateTableDto,
  SetComponentDto,
  UpdateCategoryDto,
  UpdateDishDto,
  UpdateSetDto,
  UpdateHallDto,
  UpdateTableDto,
} from './dto';

type NormalizedDishVariant = {
  id?: string;
  name: string;
  price: number;
  sortOrder: number;
  stock?: number;
  initialStock?: number;
  unit?: string;
};

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
            qrToken: true, // для QR-меню стола (владелец печатает QR)
          },
        },
      },
    });
  }

  async createHall(dto: CreateHallDto) {
    const hall = await this.prisma.hall.create({ data: { name: dto.name, sortOrder: dto.sortOrder ?? 0 } });
    this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { hallId: hall.id, action: 'create-hall' });
    return hall;
  }

  async updateHall(id: string, dto: UpdateHallDto) {
    await this.ensureHall(id);
    const hall = await this.prisma.hall.update({ where: { id }, data: dto });
    this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { hallId: id, action: 'update-hall' });
    return hall;
  }

  async deleteHall(id: string) {
    await this.ensureHall(id);
    const tables = await this.prisma.table.count({ where: { hallId: id } });
    if (tables > 0) {
      throw new BadRequestException('Нельзя удалить зал со столами. Сначала удалите столы.');
    }
    await this.prisma.hall.delete({ where: { id } });
    this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { hallId: id, action: 'delete-hall' });
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
    this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { tableId: table.id, hallId: table.hallId, action: 'create-table' });
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
    this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { tableId: updated.id, hallId: updated.hallId, action: 'update-table' });
    return updated;
  }

  async deleteTable(id: string) {
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table) throw new NotFoundException('Стол не найден');
    const orders = await this.prisma.order.count({ where: { tableId: id } });
    if (orders > 0) {
      // У стола есть история заказов — деактивируем вместо удаления.
      const updated = await this.prisma.table.update({ where: { id }, data: { isActive: false } });
      this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { tableId: id, hallId: updated.hallId, action: 'deactivate-table' });
      return updated;
    }
    await this.prisma.table.delete({ where: { id } });
    this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { tableId: id, hallId: table.hallId, action: 'delete-table' });
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
      select: { id: true, name: true, sortOrder: true, isActive: true, prepStation: true, _count: { select: { dishes: true } } },
    });
  }

  async createCategory(dto: CreateCategoryDto, actor: AuditActor) {
    const category = await this.prisma.category.create({
      data: { name: dto.name, sortOrder: dto.sortOrder ?? 0, prepStation: dto.prepStation },
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_CREATED,
      entityType: AuditEntity.CATEGORY,
      entityId: category.id,
      description: `${actor.name ?? 'Сотрудник'} добавил категорию «${category.name}»`,
      newValue: { name: category.name },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { categoryId: category.id, action: 'create-category' });
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
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { categoryId: id, action: 'update-category' });
    return updated;
  }

  async deleteCategory(id: string, dto: DeleteCategoryDto, actor: AuditActor) {
    const before = await this.ensureCategory(id);
    const dishes = await this.prisma.dish.count({ where: { categoryId: id } });

    if (dishes > 0) {
      if (dto.strategy === 'move') {
        // Переносим блюда в другую категорию, затем удаляем пустую.
        if (!dto.targetCategoryId || dto.targetCategoryId === id) {
          throw new BadRequestException('Выберите категорию, в которую перенести блюда');
        }
        await this.ensureCategory(dto.targetCategoryId);
        await this.prisma.dish.updateMany({
          where: { categoryId: id },
          data: { categoryId: dto.targetCategoryId },
        });
      } else if (dto.strategy === 'delete') {
        // Удаляем категорию вместе с блюдами (каскад удалит блюда; история заказов
        // сохраняется по снимкам, ссылки обнуляются).
      } else {
        throw new BadRequestException('В категории есть блюда. Выберите: перенести их или удалить вместе с категорией.');
      }
    }

    // Каскад: при удалении категории удалятся её блюда (если их не перенесли).
    await this.prisma.category.delete({ where: { id } });
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_DELETED,
      entityType: AuditEntity.CATEGORY,
      entityId: id,
      description:
        `${actor.name ?? 'Сотрудник'} удалил категорию «${before.name}»` +
        (dishes > 0 ? (dto.strategy === 'move' ? ' (блюда перенесены)' : ' (вместе с блюдами)') : ''),
      oldValue: { name: before.name },
      metadata: { dishes, strategy: dishes > 0 ? dto.strategy : undefined },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { categoryId: id });
    return { ok: true };
  }

  /** Меняет порядок категорий по переданному списку id. */
  async reorderCategories(ids: string[], actor: AuditActor) {
    const categories = await this.prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (categories.length !== ids.length) throw new BadRequestException('Категория не найдена');
    await this.prisma.$transaction(
      ids.map((catId, index) =>
        this.prisma.category.update({ where: { id: catId }, data: { sortOrder: index } }),
      ),
    );
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_UPDATED,
      entityType: AuditEntity.CATEGORY,
      entityId: ids[0] ?? '',
      description: `${actor.name ?? 'Сотрудник'} изменил порядок категорий`,
      newValue: { order: ids },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { reorder: true });
    return this.categoriesAll();
  }

  /** Массовый перенос всех блюд из одной категории в другую. */
  async moveCategoryDishes(fromCategoryId: string, toCategoryId: string, actor: AuditActor) {
    if (fromCategoryId === toCategoryId) throw new BadRequestException('Категории совпадают');
    const from = await this.ensureCategory(fromCategoryId);
    const to = await this.ensureCategory(toCategoryId);
    const res = await this.prisma.dish.updateMany({
      where: { categoryId: fromCategoryId },
      data: { categoryId: toCategoryId },
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_UPDATED,
      entityType: AuditEntity.CATEGORY,
      entityId: fromCategoryId,
      description: `${actor.name ?? 'Сотрудник'} перенёс блюда (${res.count}) из «${from.name}» в «${to.name}»`,
      newValue: { from: from.name, to: to.name, count: res.count },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { moved: res.count });
    return { ok: true, moved: res.count };
  }

  /** Все блюда (включая неактивные) с категорией — для управления меню. */
  async dishesAll(params: { categoryId?: string; search?: string }) {
    const where: Prisma.DishWhereInput = {
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
    };
    const dishes = await this.prisma.dish.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: this.dishInclude(),
    });
    return dishes.map(withDishImageRef);
  }

  private normalizeVariants(variants?: DishVariantDto[]): NormalizedDishVariant[] {
    return (variants ?? []).map((variant, index) => {
      const name = variant.name?.trim();
      const price = Number(variant.price);
      if (!name) {
        throw new BadRequestException('Укажите название варианта');
      }
      if (!Number.isFinite(price) || price <= 0) {
        throw new BadRequestException('Цена варианта должна быть больше 0');
      }
      return {
        id: variant.id?.trim() || undefined,
        name,
        price,
        sortOrder: index,
        stock: variant.stock,
        initialStock: variant.initialStock,
        unit: variant.unit,
      };
    });
  }

  private resolveDishPrice(
    price: number | undefined,
    variants: NormalizedDishVariant[],
    currentPrice?: Prisma.Decimal,
  ): number {
    if (price !== undefined) {
      if (variants.length === 0 && price <= 0) {
        throw new BadRequestException('Цена блюда должна быть больше 0');
      }
      return price;
    }
    if (variants.length > 0) return Math.min(...variants.map((v) => v.price));
    if (currentPrice !== undefined && Number(currentPrice) > 0) return Number(currentPrice);
    throw new BadRequestException('Укажите цену блюда или добавьте варианты с ценами');
  }

  private dishInclude() {
    return {
      category: { select: { id: true, name: true } },
      variants: { orderBy: { sortOrder: 'asc' as const } },
      setComponents: {
        orderBy: { sortOrder: 'asc' as const },
        select: {
          id: true,
          quantity: true,
          removable: true,
          replaceable: true,
          dishVariantId: true,
          dish: { select: { id: true, name: true, price: true } },
          dishVariant: { select: { id: true, name: true, price: true } },
        },
      },
    };
  }

  async createDish(dto: CreateDishDto, actor: AuditActor) {
    await this.ensureCategory(dto.categoryId);
    const variants = this.normalizeVariants(dto.variants);
    const price = this.resolveDishPrice(dto.price, variants);
    const dish = await this.prisma.dish.create({
      data: {
        name: dto.name,
        categoryId: dto.categoryId,
        price: new Prisma.Decimal(price),
        description: dto.description,
        imageUrl: normalizeDishImage(dto.imageUrl),
        discountType: dto.discountType ?? 'none',
        discountValue: new Prisma.Decimal(dto.discountValue ?? 0),
        cookingTime: dto.cookingTime,
        isAvailable: dto.isAvailable ?? true,
        trackInventory: dto.trackInventory ?? false,
        stock: dto.stock,
        initialStock: dto.initialStock,
        unit: dto.unit,
        prepStation: dto.prepStation ?? null,
        voiceName: dto.voiceName?.trim() || null,
        variants: variants.length
          ? {
              create: variants.map((variant) => ({
                name: variant.name,
                price: new Prisma.Decimal(variant.price),
                sortOrder: variant.sortOrder,
                stock: variant.stock,
                initialStock: variant.initialStock,
                unit: variant.unit,
              })),
            }
          : undefined,
      },
      include: this.dishInclude(),
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.MENU_ITEM_CREATED,
      entityType: AuditEntity.MENU_ITEM,
      entityId: dish.id,
      description: `${actor.name ?? 'Сотрудник'} добавил блюдо «${dish.name}» (${Number(dish.price)} с)`,
      newValue: {
        name: dish.name,
        price: Number(dish.price),
        categoryId: dish.categoryId,
        variants: dish.variants.map((variant) => ({ name: variant.name, price: Number(variant.price) })),
      },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId: dish.id });
    return withDishImageRef(dish);
  }

  async updateDish(id: string, dto: UpdateDishDto, actor: AuditActor) {
    const dish = await this.prisma.dish.findUnique({ where: { id } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    const { variants: variantsDto, ...dishDto } = dto;
    const variants = variantsDto !== undefined ? this.normalizeVariants(variantsDto) : undefined;
    const data: Prisma.DishUpdateInput = { ...dishDto } as Prisma.DishUpdateInput;
    if (dto.trackInventory !== undefined) {
      data.trackInventory = dto.trackInventory;
    }
    if (variants !== undefined || dto.price !== undefined) {
      data.price = new Prisma.Decimal(this.resolveDishPrice(dto.price, variants ?? [], dish.price));
    }
    if (dto.discountValue !== undefined) data.discountValue = new Prisma.Decimal(dto.discountValue);
    if (dto.voiceName !== undefined) data.voiceName = dto.voiceName?.trim() || null;
    if (dto.imageUrl !== undefined) data.imageUrl = normalizeDishImage(dto.imageUrl);
    if (dto.categoryId) await this.ensureCategory(dto.categoryId);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (variants !== undefined) {
        const incomingIds = variants.map((variant) => variant.id).filter((variantId): variantId is string => !!variantId);
        if (incomingIds.length > 0) {
          const owned = await tx.dishVariant.count({ where: { dishId: id, id: { in: incomingIds } } });
          if (owned !== incomingIds.length) {
            throw new BadRequestException('Вариант блюда не найден');
          }
        }
        await tx.dishVariant.deleteMany({
          where: {
            dishId: id,
            ...(incomingIds.length > 0 ? { id: { notIn: incomingIds } } : {}),
          },
        });
        for (const variant of variants) {
          if (variant.id) {
            await tx.dishVariant.update({
              where: { id: variant.id },
              data: {
                name: variant.name,
                price: new Prisma.Decimal(variant.price),
                sortOrder: variant.sortOrder,
                stock: variant.stock,
                initialStock: variant.initialStock,
                unit: variant.unit,
              },
            });
          } else {
            await tx.dishVariant.create({
              data: {
                dishId: id,
                name: variant.name,
                price: new Prisma.Decimal(variant.price),
                sortOrder: variant.sortOrder,
                stock: variant.stock,
                initialStock: variant.initialStock,
                unit: variant.unit,
              },
            });
          }
        }
      }
      return tx.dish.update({
        where: { id },
        data,
        include: this.dishInclude(),
      });
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
        variants: updated.variants.map((variant) => ({ name: variant.name, price: Number(variant.price) })),
      },
    });
    return withDishImageRef(updated);
  }

  async deleteDish(id: string, actor: AuditActor) {
    const dish = await this.prisma.dish.findUnique({ where: { id } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    const used = await this.prisma.orderItem.count({ where: { dishId: id } });
    // Полностью убираем блюдо из меню. История заказов не ломается: позиции
    // хранят снимок названия/цены, а ссылки на блюдо обнуляются (ON DELETE SET NULL).
    await this.prisma.dish.delete({ where: { id } });
    await this.audit.log({
      actor,
      actionType: AuditAction.MENU_ITEM_DELETED,
      entityType: AuditEntity.MENU_ITEM,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} удалил блюдо «${dish.name}»`,
      oldValue: { name: dish.name, price: Number(dish.price) },
      metadata: { hadOrderHistory: used > 0 },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId: id });
    return { ok: true };
  }

  // ===================== СЕТЫ =====================

  /** Все сеты (включая неактивные) с составом — для управления. */
  setsAll() {
    return this.prisma.dish.findMany({
      where: { isSet: true },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: this.dishInclude(),
    });
  }

  async createSet(dto: CreateSetDto, actor: AuditActor) {
    await this.validateSetComponents(dto.components);
    const categoryId = await this.ensureSetsCategory();
    const set = await this.prisma.dish.create({
      data: {
        name: dto.name,
        categoryId,
        price: new Prisma.Decimal(dto.price),
        isSet: true,
        trackInventory: false,
        setComponents: { create: this.mapSetComponents(dto.components) },
      },
      include: this.dishInclude(),
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.MENU_ITEM_CREATED,
      entityType: AuditEntity.MENU_ITEM,
      entityId: set.id,
      description: `${actor.name ?? 'Сотрудник'} создал сет «${set.name}» (${Number(set.price)} с, ${dto.components.length} поз.)`,
      newValue: { name: set.name, price: Number(set.price), isSet: true },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId: set.id });
    return set;
  }

  async updateSet(id: string, dto: UpdateSetDto, actor: AuditActor) {
    const set = await this.prisma.dish.findUnique({ where: { id } });
    if (!set || !set.isSet) throw new NotFoundException('Сет не найден');
    if (dto.components) await this.validateSetComponents(dto.components);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.components) {
        await tx.setComponent.deleteMany({ where: { setId: id } });
        await tx.setComponent.createMany({
          data: this.mapSetComponents(dto.components).map((c) => ({ ...c, setId: id })),
        });
      }
      return tx.dish.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: this.dishInclude(),
      });
    });

    await this.audit.log({
      actor,
      actionType: AuditAction.MENU_ITEM_UPDATED,
      entityType: AuditEntity.MENU_ITEM,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} изменил сет «${updated.name}»`,
      oldValue: { name: set.name, price: Number(set.price) },
      newValue: { name: updated.name, price: Number(updated.price) },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId: id });
    return updated;
  }

  private mapSetComponents(components: SetComponentDto[]) {
    return components.map((c, idx) => ({
      dishId: c.dishId,
      dishVariantId: c.dishVariantId ?? null,
      quantity: c.quantity ?? 1,
      sortOrder: idx,
      removable: c.removable ?? true,
      replaceable: c.replaceable ?? true,
    }));
  }

  /**
   * Компоненты сета должны быть существующими активными обычными блюдами (не сетами).
   * Вариант (если указан) должен принадлежать своему блюду.
   */
  private async validateSetComponents(components: SetComponentDto[]) {
    const ids = [...new Set(components.map((c) => c.dishId))];
    if (ids.length === 0) throw new BadRequestException('Добавьте блюда в состав сета');
    const dishes = await this.prisma.dish.findMany({
      where: { id: { in: ids } },
      select: { id: true, isSet: true, isActive: true, variants: { select: { id: true } } },
    });
    if (dishes.length !== ids.length) throw new BadRequestException('Блюдо состава не найдено');
    if (dishes.some((d) => d.isSet)) throw new BadRequestException('Нельзя добавить сет внутрь сета');
    if (dishes.some((d) => !d.isActive)) throw new BadRequestException('Блюдо состава отключено');
    const byId = new Map(dishes.map((d) => [d.id, d]));
    for (const c of components) {
      const dish = byId.get(c.dishId)!;
      if (c.dishVariantId) {
        if (!dish.variants.some((v) => v.id === c.dishVariantId)) {
          throw new BadRequestException('Вариант блюда состава не найден');
        }
      } else if (dish.variants.length > 0) {
        throw new BadRequestException('Выберите вариант блюда состава');
      }
    }
  }

  /** Категория «Сеты» (создаётся при необходимости). */
  private async ensureSetsCategory(): Promise<string> {
    const existing = await this.prisma.category.findFirst({ where: { name: 'Сеты' } });
    if (existing) return existing.id;
    const agg = await this.prisma.category.aggregate({ _max: { sortOrder: true } });
    const cat = await this.prisma.category.create({
      data: { name: 'Сеты', sortOrder: (agg._max.sortOrder ?? 0) + 1 },
    });
    return cat.id;
  }

  private async ensureCategory(id: string) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Категория не найдена');
    return cat;
  }
}
