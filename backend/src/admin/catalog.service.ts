import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { getCafeId } from '../tenant/tenant-context';
import { ensureMainMenuCategory, mainMenuCategoryId } from './main-menu-category';
import { archiveRecipes, earliestRestorableDate } from './recipe-trash';
import { SERVER_EVENTS } from '../realtime/events';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { AuditAction, AuditEntity } from '../audit/audit.constants';
import { normalizeDishImage, withDishImageRef } from '../dishes/dish-image';
import { normalizeUnit, unitLabel } from '../warehouse/units';
import { projectDishStock } from '../warehouse/dish-stock-projection';
import { lockRecipeGraph } from '../warehouse/recipe-resolution';
import { archiveDishRecipe } from '../warehouse/recipe-revisions';
import { assertAssignableStation, BUILTIN_STATIONS, defaultCategoryStation, lockStationRouting, stationCatalog } from '../kitchen/preparation-stations';
import { goodsExportColumns, writeGoodsWorkbook, type GoodsExportQuery } from './goods-xlsx';
import { dishTaxFields } from '../settings/order-taxes';
import { categorySettings, categoryTaxMode, updateInheritedTaxes } from './menu-category-tax';
import { categoryImageRef, categoryPhoto } from '../categories/category-image';
import { type SaveFloorPlanDto, withinFloorPlan } from './floor-plan.dto';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { MenuPriceBatchDto } from './menu-prices.dto';
import { saveMenuPrices } from './menu-prices';
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

const categoryOrder: Prisma.CategoryOrderByWithRelationInput[] = [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }];
const categorySelect = { id: true, name: true, parentId: true, sortOrder: true, isActive: true, prepStation: true, taxId: true,
  inheritTax: true, imageKey: true, _count: { select: { dishes: { where: { archivedAt: null } } } } } as const;
function adminCategory({ imageKey, inheritTax, ...category }: Prisma.CategoryGetPayload<{ select: typeof categorySelect }>) {
  return { ...category, taxMode: categoryTaxMode({ inheritTax, taxId: category.taxId }), imageUrl: categoryImageRef(category.id, imageKey) };
}

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
    const physicalTables = { NOT: { hallId: { startsWith: 'delivery-hall:' } } };
    const [hallsCount, tablesCount, activeTables, occupied] = await Promise.all([
      this.prisma.hall.count({ where: { isActive: true } }),
      this.prisma.table.count({ where: physicalTables }),
      this.prisma.table.count({ where: { ...physicalTables, isActive: true } }),
      this.prisma.table.count({ where: { ...physicalTables, status: { not: TableStatus.free } } }),
    ]);
    return {
      hallsCount,
      tablesCount,
      activeTablesCount: activeTables,
      occupiedCount: occupied,
    };
  }

  /** Залы с действующими столами для управления. Архивные столы в интерфейс не попадают. */
  hallsWithTables() {
    return this.prisma.hall.findMany({
      where: { NOT: { id: { startsWith: 'delivery-hall:' } } },
      orderBy: { sortOrder: 'asc' },
      include: {
        tables: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
          select: {
            id: true,
            number: true,
            name: true,
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

  async saveFloorPlan(hallId: string, dto: SaveFloorPlanDto) {
    if (hallId.startsWith('delivery-hall:')) throw new NotFoundException('Зал не найден');
    const cafeId = getCafeId();
    if (!cafeId) throw new BadRequestException('Не выбрано заведение');
    if (dto.tables.some((table) => !withinFloorPlan(table))) {
      throw new BadRequestException('Столы должны находиться в границах карты');
    }
    const tables = dto.tables.map(({ tableId, x, y, width, height, shape, label }) => ({
      tableId, x, y, width, height, shape, ...(label?.trim() ? { label: label.trim() } : {}),
    }));
    const result = await this.prisma.$transaction(async (tx) => {
      const hall = await tx.hall.findFirst({ where: { id: hallId, cafeId }, select: { id: true } });
      if (!hall) throw new NotFoundException('Зал не найден');
      const count = await tx.table.count({
        where: { cafeId, hallId, isActive: true, id: { in: tables.map(({ tableId }) => tableId) } },
      });
      if (count !== tables.length) throw new ConflictException('Список столов изменился. Обновите карту зала');
      const saved = await tx.hall.updateMany({
        where: { id: hallId, cafeId, floorPlanVersion: dto.version },
        data: { floorPlan: tables, floorPlanVersion: { increment: 1 } },
      });
      if (!saved.count) throw new ConflictException('Карта зала изменилась. Отмените правки и откройте актуальную версию');
      return { floorPlan: tables, floorPlanVersion: dto.version + 1 };
    });
    this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { hallId, action: 'floor-plan' });
    return result;
  }

  async setFloorPlanMode(useFloorPlan: boolean) {
    const cafeId = getCafeId();
    if (!cafeId) throw new BadRequestException('Не выбрано заведение');
    await this.prisma.settings.upsert({ where: { cafeId }, update: { useFloorPlan }, create: { cafeId, useFloorPlan } });
    this.events.emitBroadcast(SERVER_EVENTS.SETTINGS_UPDATED, { fields: ['useFloorPlan'] });
    return { useFloorPlan };
  }

  async createHall(dto: CreateHallDto) {
    const hall = await this.prisma.hall.create({
      data: { name: dto.name, sortOrder: dto.sortOrder ?? 0, useFloorPlan: dto.useFloorPlan },
    });
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
    const { hallId, seats, number: requestedNumber } = dto;
    const name = dto.name === undefined ? undefined : dto.name?.trim() || null;
    if (hallId.startsWith('delivery-hall:')) throw new NotFoundException('Зал не найден');
    const table = await this.prisma.$transaction(async (tx) => {
      const cafeId = getCafeId();
      // Serialize table creation per hall and verify access before reading its numbers.
      const halls = cafeId
        ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM halls WHERE id = ${hallId} AND cafe_id = ${cafeId} FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM halls WHERE id = ${hallId} FOR UPDATE`;
      if (!halls.length) throw new NotFoundException('Зал не найден');

      let number = requestedNumber;
      if (number == null) {
        const activeTables = await tx.table.findMany({
          where: { hallId, isActive: true, number: { gte: 1 } },
          select: { number: true },
          orderBy: { number: 'asc' },
        });
        number = 1;
        for (const activeTable of activeTables) {
          if (activeTable.number !== number) break;
          number++;
        }
        if (number > 2147483647) throw new BadRequestException('Достигнут максимальный номер стола');
      } else {
        const existing = await tx.table.findFirst({
          where: { hallId, number, isActive: true },
          select: { id: true },
        });
        if (existing) {
          throw new BadRequestException(`Стол №${number} уже есть в этом зале`);
        }
      }

      return tx.table.create({ data: { hallId, number, name, seats, sortOrder: number } });
    });
    this.events.emitBroadcast(SERVER_EVENTS.TABLES_UPDATED, { tableId: table.id, hallId: table.hallId, action: 'create-table' });
    return table;
  }

  async updateTable(id: string, dto: UpdateTableDto) {
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table) throw new NotFoundException('Стол не найден');
    const name = dto.name === undefined ? undefined : dto.name?.trim() || null;
    const updated = await this.prisma.table.update({ where: { id }, data: { ...dto, name } });
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
    if (id.startsWith('delivery-hall:')) throw new NotFoundException('Зал не найден');
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

  async categoriesAll() {
    const categories = await this.prisma.category.findMany({
      orderBy: categoryOrder,
      select: categorySelect,
    });
    return categories.map(adminCategory);
  }

  async createCategory(dto: CreateCategoryDto, actor: AuditActor) {
    const photo = await categoryPhoto(dto.imageUrl);
    const category = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx);
      const prepStation = dto.prepStation ?? await defaultCategoryStation(tx);
      await assertAssignableStation(tx, prepStation);
      const settings = await categorySettings(tx, dto);
      return tx.category.create({
        data: { name: dto.name, sortOrder: dto.sortOrder ?? 0, prepStation, ...settings, ...photo },
        select: categorySelect,
      });
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_CREATED,
      entityType: AuditEntity.CATEGORY,
      entityId: category.id,
      description: `${actor.name ?? 'Сотрудник'} добавил категорию «${category.name}»`,
      newValue: { name: category.name, taxId: category.taxId },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { categoryId: category.id, action: 'create-category' });
    return adminCategory(category);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actor: AuditActor) {
    if (id === mainMenuCategoryId()) throw new BadRequestException('Главный экран — корневой раздел меню');
    const { position, parentId, taxId, taxMode, imageUrl, ...fields } = dto;
    const photo = await categoryPhoto(imageUrl);
    const { before, updated } = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx);
      const before = await tx.category.findUnique({ where: { id }, select: categorySelect });
      if (!before) throw new NotFoundException('Категория не найдена');
      await assertAssignableStation(tx, fields.prepStation);
      const settings = await categorySettings(tx, { parentId, taxId, taxMode }, before);
      const data = { ...fields, prepStation: fields.prepStation ?? undefined, ...photo, ...settings };
      if (position != null) {
        const categories = await tx.category.findMany({ where: { id: { not: mainMenuCategoryId() } }, orderBy: categoryOrder, select: { id: true, sortOrder: true } });
        const index = categories.findIndex((category) => category.id === id);
        if (index < 0) throw new NotFoundException('Категория не найдена');
        if (position < 1 || position > categories.length) {
          throw new BadRequestException('Позиция категории вне диапазона. Обновите список категорий.');
        }
        const [category] = categories.splice(index, 1);
        categories.splice(position - 1, 0, category);
        for (const [sortOrder, entry] of categories.entries()) {
          if (entry.id !== id && entry.sortOrder !== sortOrder) {
            await tx.category.update({ where: { id: entry.id }, data: { sortOrder } });
          }
        }
        data.sortOrder = position - 1;
      }
      const updated = await tx.category.update({ where: { id }, data, select: categorySelect });
      if (updated.taxId !== before.taxId) await updateInheritedTaxes(tx, id, updated.taxId);
      return { before, updated };
    });
    await this.audit.log({
      actor,
      actionType: AuditAction.CATEGORY_UPDATED,
      entityType: AuditEntity.CATEGORY,
      entityId: id,
      description: `${actor.name ?? 'Сотрудник'} изменил категорию «${before.name}»`,
      oldValue: { name: before.name, isActive: before.isActive, taxId: before.taxId, sortOrder: before.sortOrder },
      newValue: { name: updated.name, isActive: updated.isActive, taxId: updated.taxId, sortOrder: updated.sortOrder },
    });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { categoryId: id, action: 'update-category' });
    return adminCategory(updated);
  }

  async deleteCategory(id: string, dto: DeleteCategoryDto, actor: AuditActor) {
    if (id === mainMenuCategoryId()) throw new BadRequestException('Главный экран — корневой раздел меню');
    const { before, dishes } = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await lockStationRouting(tx);
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Категория не найдена');
      const rows = await tx.dish.findMany({ where: { categoryId: id }, select: { id: true, isSet: true, catalogKind: true, archivedAt: true } });
      const dishes = rows.filter((dish) => !dish.archivedAt).length;
      if (dto.strategy === 'move' && rows.length) {
        const target = dto.targetCategoryId && dto.targetCategoryId !== id && await tx.category.findUnique({ where: { id: dto.targetCategoryId } });
        if (!target) throw new BadRequestException('Выберите категорию, в которую перенести блюда');
        await tx.dish.updateMany({ where: { categoryId: id }, data: { categoryId: target.id } });
      } else {
        if (dishes && dto.strategy !== 'delete') throw new BadRequestException('В категории есть блюда. Выберите: перенести их или удалить вместе с категорией.');
        await archiveRecipes(tx, rows, rows.filter((dish) => dish.isSet).map((dish) => dish.id));
        if (rows.some((dish) => !dish.isSet && dish.catalogKind === 'recipe')) {
          const main = await ensureMainMenuCategory(tx);
          await tx.dish.updateMany({ where: { categoryId: id, archivedAt: { not: null } }, data: { categoryId: main.id } });
        }
      }
      const parent = before.parentId ? await tx.category.findUnique({ where: { id: before.parentId }, select: { taxId: true } }) : null;
      if (before.taxId !== (parent?.taxId ?? null)) await updateInheritedTaxes(tx, id, parent?.taxId ?? null);
      await tx.category.updateMany({ where: { parentId: id }, data: { parentId: before.parentId } });
      await tx.category.delete({ where: { id } });
      return { before, dishes };
    });
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
    await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx);
      const categories = await tx.category.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (categories.length !== ids.length) throw new BadRequestException('Категория не найдена');
      for (const [sortOrder, id] of ids.entries()) {
        await tx.category.update({ where: { id }, data: { sortOrder } });
      }
    });
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
  async dishesAll(params: { categoryId?: string; search?: string; goodsOnly?: boolean }) {
    const where: Prisma.DishWhereInput = {
      archivedAt: null,
      ...(params.goodsOnly ? { catalogKind: 'goods' } : {}),
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
    };
    const dishes = await this.prisma.dish.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: this.dishInclude(),
    });
    const recipeDishIds = new Set((await this.prisma.recipeItem.findMany({ where: { dishId: { in: dishes.map((dish) => dish.id) } }, select: { dishId: true }, distinct: ['dishId'] })).map((row) => row.dishId));
    const stock = await projectDishStock(this.prisma, dishes);
    return dishes.map((dish) => withDishImageRef({ ...dish, trackInventory: stock.get(dish.id)!.trackInventory, stock: stock.get(dish.id)!.stock,
      variants: dish.variants.map((variant) => ({ ...variant, stock: stock.get(dish.id)!.variantStocks.get(variant.id) ?? null })),
      hasRecipe: recipeDishIds.has(dish.id),
      hasDirectStock: !!dish.stockIngredientId || dish.variants.some((variant) => !!variant.stockIngredientId) }));
  }

  async goodsAll() {
    const goods = await this.dishesAll({ goodsOnly: true });
    return goods.map((dish) => {
      const variants = dish.variants;
      const units = dish.isWeighted
        ? [`${dish.weightedPriceBase} ${dish.weightedMeasure === 'volume' ? 'мл' : 'г'}`]
        : variants.length ? [...new Set(variants.map((variant) => variant.unit || dish.unit))] : [dish.unit];
      const price = variants.length ? Math.min(...variants.map((variant) => {
        const value = Number(variant.price);
        const discount = Number(dish.discountValue);
        if (dish.discountType === 'percent') return Math.max(0, value - value * discount / 100);
        if (dish.discountType === 'fixed') return Math.max(0, value - discount);
        return value;
      })) : Number(dish.price);
      return { ...dish, goodsStation: dish.prepStation ?? dish.category.prepStation ?? 'none', goodsUnits: units, goodsPrice: price };
    });
  }

  async exportGoods(query: GoodsExportQuery) {
    const columns = goodsExportColumns(query.columns);
    const cafeId = getCafeId();
    const [goods, stations, taxes] = await Promise.all([
      this.goodsAll(),
      cafeId ? this.prisma.preparationStation.findMany({ where: { cafeId }, select: { id: true, name: true, isActive: true } }) : [],
      columns.includes('tax') || query.taxSort
        ? this.prisma.menuTax.findMany({ where: { cafeId: cafeId ?? null }, select: { id: true, name: true, rate: true } }) : [],
    ]);
    const names = new Map((cafeId ? stationCatalog(stations, cafeId) : BUILTIN_STATIONS).map((station) => [station.id, station.name]));
    return writeGoodsWorkbook(goods, query, columns, names,
      new Map(taxes.map((tax) => [tax.id, `${tax.name} · ${tax.rate.toNumber().toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`])));
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
        unit: this.normalizeInventoryUnit(variant.unit),
      };
    });
  }

  private normalizeInventoryUnit(unit: string | undefined): string | undefined {
    if (unit === undefined) return undefined;
    return unitLabel(normalizeUnit(unit));
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
      category: { select: { id: true, name: true, prepStation: true, taxId: true } },
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
    if (dto.trackInventory || Number(dto.stock ?? 0) !== 0 || dto.variants?.some((variant) => Number(variant.stock ?? 0) !== 0)) {
      throw new BadRequestException('Складской учёт настраивается в «Состав и себестоимость». Остатки вносятся приходом или инвентаризацией');
    }
    await this.ensureCategory(dto.categoryId);
    const variants = this.normalizeVariants(dto.variants);
    const price = this.resolveDishPrice(dto.price, variants);
    const imageUrl = await normalizeDishImage(dto.imageUrl);
    const dish = await this.prisma.$transaction(async (tx) => {
      await lockStationRouting(tx);
      await assertAssignableStation(tx, dto.prepStation);
      return tx.dish.create({
        data: {
          name: dto.name,
          categoryId: dto.categoryId,
          price: new Prisma.Decimal(price),
          description: dto.description,
          imageUrl,
          discountType: dto.discountType ?? 'none',
          discountValue: new Prisma.Decimal(dto.discountValue ?? 0),
          cookingTime: dto.cookingTime,
          isAvailable: dto.isAvailable ?? true,
          isWeighted: dto.isWeighted ?? false,
          weightedMeasure: dto.weightedMeasure ?? 'weight',
          weightedPriceBase: dto.weightedPriceBase ?? 100,
          trackInventory: false,
          unit: this.normalizeInventoryUnit(dto.unit),
          prepStation: dto.prepStation ?? null,
          ...await dishTaxFields(tx, dto),
          voiceName: dto.voiceName?.trim() || null,
          variants: variants.length
            ? {
                create: variants.map((variant) => ({
                  name: variant.name,
                  price: new Prisma.Decimal(variant.price),
                  sortOrder: variant.sortOrder,
                  unit: variant.unit,
                })),
              }
            : undefined,
        },
        include: this.dishInclude(),
      });
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
    const dish = await this.prisma.dish.findUnique({
      where: { id, archivedAt: null },
      include: { _count: { select: { variants: true } }, variants: true },
    });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    const legacyError = 'Остатки изменяются в складе документом прихода или инвентаризации. Способ учёта — в «Состав и себестоимость»';
    if ((dto.trackInventory !== undefined && dto.trackInventory !== dish.trackInventory)
      || (dto.stock !== undefined && dto.stock !== dish.stock)
      || (dto.initialStock !== undefined && dto.initialStock !== dish.initialStock)) throw new BadRequestException(legacyError);
    for (const variant of dto.variants ?? []) {
      const previous = dish.variants.find((entry) => entry.id === variant.id);
      if ((variant.stock !== undefined && variant.stock !== (previous?.stock ?? 0))
        || (variant.initialStock !== undefined && variant.initialStock !== (previous?.initialStock ?? 0))) throw new BadRequestException(legacyError);
    }
    const { variants: variantsDto, stock: _stock, initialStock: _initialStock, trackInventory: _trackInventory,
      taxId: _taxId, taxExempt: _taxExempt, ...dishDto } = dto;
    const variants = variantsDto !== undefined ? this.normalizeVariants(variantsDto) : undefined;
    const data: Prisma.DishUpdateInput = { ...dishDto } as Prisma.DishUpdateInput;
    if (variants !== undefined || dto.price !== undefined) {
      data.price = new Prisma.Decimal(this.resolveDishPrice(dto.price, variants ?? [], dish.price));
    }
    if (dto.discountValue !== undefined) data.discountValue = new Prisma.Decimal(dto.discountValue);
    if (dto.voiceName !== undefined) data.voiceName = dto.voiceName?.trim() || null;
    if (dto.imageUrl !== undefined) data.imageUrl = await normalizeDishImage(dto.imageUrl);
    if (dto.unit !== undefined) data.unit = this.normalizeInventoryUnit(dto.unit);
    if (dto.categoryId) await this.ensureCategory(dto.categoryId);
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await lockStationRouting(tx);
      if (!await tx.dish.findUnique({ where: { id, archivedAt: null }, select: { id: true } })) throw new NotFoundException('Блюдо не найдено');
      await assertAssignableStation(tx, dto.prepStation);
      Object.assign(data, await dishTaxFields(tx, dto));
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
        isWeighted: updated.isWeighted,
        variants: updated.variants.map((variant) => ({ name: variant.name, price: Number(variant.price) })),
      },
    });
    return withDishImageRef(updated);
  }

  async applyMenuPrices(dto: MenuPriceBatchDto, actor: AuthUser) {
    const { changedDishIds, ...result } = await saveMenuPrices(this.prisma, dto, actor);
    if (result.changed) this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { cafeId: actor.cafeId, dishIds: changedDishIds });
    return result;
  }

  async deleteDish(id: string, actor: AuditActor) {
    const { dish, used } = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      const dish = await tx.dish.findUnique({ where: { id, archivedAt: null } });
      if (!dish) throw new NotFoundException('Блюдо не найдено');
      const used = await tx.orderItem.count({ where: { dishId: id } });
      if (!dish.isSet && dish.catalogKind === 'recipe') await archiveRecipes(tx, [dish]);
      else await tx.dish.delete({ where: { id } });
      return { dish, used };
    });
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

  trashedRecipes() {
    return this.prisma.dish.findMany({ where: { isSet: false, catalogKind: 'recipe', archivedAt: { gt: earliestRestorableDate() } },
      orderBy: [{ archivedAt: 'desc' }, { id: 'asc' }], select: { id: true, name: true, archivedAt: true, category: { select: { name: true } } } });
  }

  async restoreRecipe(id: string, actor: AuditActor) {
    const recipe = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      const dish = await tx.dish.findFirst({ where: { id, isSet: false, catalogKind: 'recipe', archivedAt: { gt: earliestRestorableDate() } } });
      if (!dish) throw new NotFoundException('Техкарта отсутствует в корзине или срок восстановления истёк');
      return tx.dish.update({ where: { id }, data: { archivedAt: null, activeBeforeArchive: null, isActive: dish.activeBeforeArchive ?? true },
        select: { id: true, name: true } });
    });
    await this.audit.log({ actor, actionType: AuditAction.MENU_ITEM_UPDATED, entityType: AuditEntity.MENU_ITEM, entityId: id,
      description: `${actor.name ?? 'Сотрудник'} восстановил техкарту «${recipe.name}» из корзины` });
    this.events.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId: id });
    return recipe;
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
    const set = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await lockStationRouting(tx);
      await this.validateSetComponents(dto.components, tx);
      await assertAssignableStation(tx, dto.prepStation);
      const categoryId = await this.ensureSetsCategory(tx);
      return tx.dish.create({
        data: {
          name: dto.name,
          categoryId,
          price: new Prisma.Decimal(dto.price),
          isSet: true,
          prepStation: dto.prepStation,
          ...await dishTaxFields(tx, dto),
          trackInventory: false,
          setComponents: { create: this.mapSetComponents(dto.components) },
        },
        include: this.dishInclude(),
      });
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

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.components) await lockRecipeGraph(tx);
      await lockStationRouting(tx);
      await assertAssignableStation(tx, dto.prepStation);
      let compositionChanged = false;
      if (dto.components) {
        await this.validateSetComponents(dto.components, tx);
        const components = this.mapSetComponents(dto.components);
        const saved = await tx.setComponent.findMany({
          where: { setId: id },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });
        compositionChanged = saved.length !== components.length || components.some((component, index) => {
          const previous = saved[index];
          return previous.dishId !== component.dishId || previous.dishVariantId !== component.dishVariantId
            || previous.quantity !== component.quantity || previous.removable !== component.removable
            || previous.replaceable !== component.replaceable;
        });
        if (compositionChanged) {
          await archiveDishRecipe(tx, id, actor);
          await tx.setComponent.deleteMany({ where: { setId: id } });
          await tx.setComponent.createMany({ data: components.map((component) => ({ ...component, setId: id })) });
        }
      }
      return tx.dish.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(compositionChanged ? { recipeVersion: { increment: 1 } } : {}),
          prepStation: dto.prepStation,
          ...await dishTaxFields(tx, dto),
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
  private async validateSetComponents(components: SetComponentDto[], db: Prisma.TransactionClient = this.prisma) {
    const ids = [...new Set(components.map((c) => c.dishId))];
    if (ids.length === 0) throw new BadRequestException('Добавьте блюда в состав сета');
    const dishes = await db.dish.findMany({
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
  private async ensureSetsCategory(tx: Prisma.TransactionClient): Promise<string> {
    const existing = await tx.category.findFirst({ where: { name: 'Сеты' } });
    if (existing) return existing.id;
    const agg = await tx.category.aggregate({ _max: { sortOrder: true } });
    const cat = await tx.category.create({
      data: { name: 'Сеты', sortOrder: (agg._max.sortOrder ?? 0) + 1, prepStation: await defaultCategoryStation(tx) },
    });
    return cat.id;
  }

  private async ensureCategory(id: string) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('Категория не найдена');
    return cat;
  }
}
