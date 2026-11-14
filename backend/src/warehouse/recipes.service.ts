import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { BadRequestException, ConflictException, Injectable, Optional, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { getWarehouseBalance } from './warehouse-location';
import { PrismaService } from '../prisma/prisma.service';
import { RecipeDraftDto, RecipeItemInputDto, RecipeItemUpdateDto, RecipeSettingsDto } from './recipes.dto';
import { MenuModifiersService } from './menu-modifiers';
import { RecipeResolver, recipeAmount, lockRecipeGraph } from './recipe-resolution';
import { assertUnitMatchesType, costFromBase, costUnitLabel, fromBase, normalizeUnit, toBase, unitLabel, type UnitCode } from './units';

@Injectable()
export class RecipesService {
  constructor(private prisma: PrismaService, @Optional() private events?: EventsGateway) {}

  async getDraft(dishId: string) {
    return this.prisma.$transaction(async (tx) => {
      const dish = await tx.dish.findUnique({ where: { id: dishId }, select: { isSet: true, catalogKind: true } });
      if (!dish) throw new NotFoundException('Блюдо не найдено');
      return {
        recipe: { ...await new RecipesService(tx as PrismaService).getByDish(dishId), ...dish },
        modifiers: await new MenuModifiersService(tx as PrismaService).get(dishId),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async saveDraft(dishId: string, dto: RecipeDraftDto) {
    await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      const dish = await tx.dish.findUnique({ where: { id: dishId }, include: { recipeItems: true } });
      if (!dish) throw new NotFoundException('Блюдо не найдено');
      if (dish.catalogKind === 'goods' || dish.stockIngredientId || dish.isSet) throw new BadRequestException('Состав этой позиции изменяется в меню');
      if (dto.expectedVersion !== dish.recipeVersion) throw new ConflictException('Техкарта уже изменена. Обновите страницу перед сохранением.');
      const ids = dto.items.map((row) => row.ingredientId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Ингредиент указан дважды');
      await this.archiveRevision(tx, dishId);
      for (const row of dto.items) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: row.ingredientId } });
        const previous = dish.recipeItems.find((item) => item.ingredientId === row.ingredientId);
        if (!ingredient || (!ingredient.isActive && !previous)) throw new BadRequestException('Ингредиент недоступен');
        const data = await this.rowData(tx, dishId, ingredient.unitType, ingredient.displayUnit, row, previous, ingredient.processingLosses);
        await tx.recipeItem.upsert({ where: { dishId_ingredientId: { dishId, ingredientId: row.ingredientId } },
          create: { dishId, ingredientId: row.ingredientId, ...data }, update: data });
      }
      await tx.recipeItem.deleteMany({ where: { dishId, ingredientId: { notIn: ids } } });
      if (dto.modifiers) await new MenuModifiersService(tx as PrismaService).saveInTransaction(tx, dishId, dto.modifiers, false);
      await tx.dish.update({ where: { id: dishId }, data: {
        recipeVersion: { increment: 1 },
        ...(dto.metadata === undefined ? {} : { recipeMetadata: dto.metadata as Prisma.InputJsonValue }),
      } });
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.getDraft(dishId);
  }

  async listDishes(search?: string) {
    const dishes = await this.prisma.dish.findMany({ where: { isActive: true, ...(search?.trim() ? { name: { contains: search.trim(), mode: 'insensitive' as const } } : {}) },
      select: { id: true, name: true, price: true, catalogKind: true, isSet: true, imageUrl: true, stockIngredientId: true, variants: { select: { stockIngredientId: true } }, _count: { select: { recipeItems: true } }, category: { select: { id: true, name: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return dishes.map(({ _count, variants, ...dish }) => ({ ...dish, hasRecipe: _count.recipeItems > 0, hasDirectStock: !!dish.stockIngredientId || variants.some((variant) => !!variant.stockIngredientId) }));
  }

  async getByDish(dishId: string, variantId?: string, path: string[] = [], exact?: { foodCost: Prisma.Decimal; packagingCost: Prisma.Decimal }) {
    if (path.includes(dishId) || path.length >= 32) throw new BadRequestException('Циклический состав сетов');
    const dish = await this.prisma.dish.findUnique({ where: { id: dishId }, include: { variants: true, category: true, setComponents: true } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    if (variantId && !dish.variants.some((variant) => variant.id === variantId)) throw new BadRequestException('Вариант не относится к блюду');
    const recipeItems = await this.prisma.recipeItem.findMany({ where: { dishId }, orderBy: { createdAt: 'asc' }, include: { ingredient: true } });
    const cafeId = getCafeId();
    const stationId = dish.prepStation ?? dish.category.prepStation;
    const route = cafeId ? await this.prisma.stationWarehouse.findUnique({ where: { cafeId_stationId: { cafeId, stationId } }, include: { warehouse: true } }) : null;
    const warehouses = cafeId ? await this.prisma.warehouse.findMany({ where: { cafeId } }) : [];
    const byWarehouse = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const resolver = new RecipeResolver(this.prisma, { allowInactive: true });
    let foodCost = new Prisma.Decimal(0), packagingCost = new Prisma.Decimal(0);
    const missingCosts = new Set<string>(), inactiveIngredients = new Set<string>();
    const items = [];
    for (const ri of recipeItems) {
      const warehouse = ri.warehouseId ? byWarehouse.get(ri.warehouseId) : ri.fromCommonWarehouse ? null : route?.warehouse ?? null;
      if (ri.warehouseId && !warehouse) throw new BadRequestException('Склад рецептуры недоступен');
      const balance = await getWarehouseBalance(this.prisma, warehouse ?? null, ri.ingredient);
      const amountUnit = ri.amountUnit as UnitCode;
      const amount = recipeAmount(ri, variantId);
      let lineCost = new Prisma.Decimal(0);
      let lineCostKnown = true;
      const parts = await resolver.expand(ri.ingredientId, amount, warehouse ?? null);
      for (const part of parts) {
        const partBalance = await getWarehouseBalance(this.prisma, part.warehouse, part.ingredient);
        const cost = part.amount.mul(partBalance.avgCost);
        lineCost = lineCost.add(cost);
        if (!partBalance.valuationKnown) { missingCosts.add(part.ingredient.name); lineCostKnown = false; }
        if (!part.ingredient.isActive) inactiveIngredients.add(part.ingredient.name);
        if (part.ingredient.kind === 'consumable') packagingCost = packagingCost.add(cost);
      }
      foodCost = foodCost.add(lineCost);
      const amountBase = Number(amount);
      items.push({
        id: ri.id, ingredientId: ri.ingredientId, fromCommonWarehouse: ri.fromCommonWarehouse, warehouseId: ri.warehouseId,
        warehouseName: warehouse?.name ?? 'Основной склад', isPrepared: ri.ingredient.isPrepared, preparationMode: ri.ingredient.preparationMode,
        name: ri.ingredient.name, unit: unitLabel(amountUnit), amountUnit, unitType: ri.ingredient.unitType, ingredientDisplayUnit: ri.ingredient.displayUnit,
        amount: round3(fromBase(amountBase, amountUnit)), baseAmount: round3(fromBase(Number(ri.amount), amountUnit)),
        netAmount: ri.netAmount == null ? null : round3(fromBase(Number(ri.netAmount), amountUnit)), lossPercent: Number(ri.lossPercent), processingMethod: ri.processingMethod,
        variantAmounts: Object.fromEntries(Object.entries((ri.variantAmounts ?? {}) as Record<string, number>).map(([id, value]) => [id, fromBase(Number(value), amountUnit)])),
        costKnown: lineCostKnown, avgCost: lineCostKnown ? round2(amountBase > 0 ? costFromBase(Number(lineCost.div(amount)), amountUnit) : costFromBase(Number(balance.avgCost), amountUnit)) : null,
        costUnitLabel: costUnitLabel(amountUnit), lineCost: lineCostKnown ? round2(Number(lineCost)) : null, stock: round3(fromBase(Number(balance.stock), amountUnit)),
        isLow: balance.stock.lte(ri.ingredient.lowStockThreshold), isActive: ri.ingredient.isActive,
      });
    }
    const variant = dish.variants.find((value) => value.id === variantId);
    const directId = variant?.stockIngredientId ?? dish.stockIngredientId;
    const directAmount = variant?.stockIngredientId ? variant.stockAmount : dish.stockAmount;
    let stockItem: { id: string; name: string; unit: string; amount: number } | null = null;
    const components: { dishId: string; dishName: string; variantId: string | null; quantity: number; foodCost: number | null; accountingConfigured: boolean }[] = [];
    if (directId) {
      foodCost = new Prisma.Decimal(0); packagingCost = new Prisma.Decimal(0); missingCosts.clear();
      const parts = await resolver.expand(directId, directAmount, route?.warehouse ?? null);
      for (const part of parts) {
        const balance = await getWarehouseBalance(this.prisma, part.warehouse, part.ingredient);
        foodCost = foodCost.add(part.amount.mul(balance.avgCost));
        if (!balance.valuationKnown) missingCosts.add(part.ingredient.name);
        if (!part.ingredient.isActive) inactiveIngredients.add(part.ingredient.name);
      }
      const ingredient = await this.prisma.ingredient.findUniqueOrThrow({ where: { id: directId } });
      stockItem = { id: directId, name: ingredient.name, unit: ingredient.displayUnit, amount: fromBase(Number(directAmount), ingredient.displayUnit as UnitCode) };
    }
    if (!directId && !recipeItems.length && dish.isSet) {
      for (const component of dish.setComponents) {
        const recipe = await this.componentRecipe(component.dishId, component.dishVariantId ?? undefined, [...path, dishId]);
        foodCost = foodCost.add(recipe.foodCost.mul(component.quantity));
        packagingCost = packagingCost.add(recipe.packagingCost.mul(component.quantity));
        for (const name of recipe.missingCosts) missingCosts.add(name);
        if (!recipe.accountingConfigured) missingCosts.add('Не настроено: ' + recipe.dishName);
        components.push({ dishId: component.dishId, dishName: recipe.dishName, variantId: component.dishVariantId, quantity: component.quantity,
          foodCost: recipe.missingCosts.length || !recipe.accountingConfigured ? null : Number(recipe.foodCost.mul(component.quantity).toDecimalPlaces(2)), accountingConfigured: recipe.accountingConfigured });
      }
    }
    const price = Number(variant?.price ?? dish.price), cost = Number(foodCost);
    const accountingConfigured = !!directId || recipeItems.length > 0 || (components.length > 0 && components.every((component) => component.accountingConfigured));
    const costKnown = !missingCosts.size && accountingConfigured;
    if (exact) { exact.foodCost = foodCost; exact.packagingCost = packagingCost; }
    return {
      dishId: dish.id, dishName: dish.name, price, foodCost: costKnown ? round2(cost) : null, ingredientCost: costKnown ? round2(cost - Number(packagingCost)) : null,
      packagingCost: costKnown ? round2(Number(packagingCost)) : null, marginAmount: costKnown ? round2(price - cost) : null, marginPercent: costKnown ? (price > 0 ? (price - cost) / price * 100 : 0) : null,
      foodCostPercent: costKnown ? (price > 0 ? cost / price * 100 : 0) : null, items, version: dish.recipeVersion, metadata: dish.recipeMetadata ?? {},
      stockIngredientId: directId, stockAmount: Number(directAmount), stockItem,
      variants: dish.variants.map((variant) => ({ id: variant.id, name: variant.name, stockIngredientId: variant.stockIngredientId, stockAmount: Number(variant.stockAmount) })),
      costKnown, missingCosts: [...missingCosts], inactiveIngredients: [...inactiveIngredients], components, accountingConfigured,
    };
  }

  private async componentRecipe(dishId: string, variantId: string | undefined, path: string[]): Promise<{
    dishName: string; foodCost: Prisma.Decimal; packagingCost: Prisma.Decimal; missingCosts: string[]; accountingConfigured: boolean;
  }> {
    const exact = { foodCost: new Prisma.Decimal(0), packagingCost: new Prisma.Decimal(0) };
    const recipe = await this.getByDish(dishId, variantId, path, exact);
    return { dishName: recipe.dishName, ...exact, missingCosts: recipe.missingCosts, accountingConfigured: recipe.accountingConfigured };
  }

  async addItem(dishId: string, dto: RecipeItemInputDto) {
    await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await this.assertDish(tx, dishId);
      const ingredient = await tx.ingredient.findFirst({ where: { id: dto.ingredientId, isActive: true } });
      if (!ingredient) throw new NotFoundException('Позиция склада не найдена');
      if (await tx.recipeItem.findUnique({ where: { dishId_ingredientId: { dishId, ingredientId: dto.ingredientId } } })) throw new BadRequestException('Этот ингредиент уже есть в техкарте');
      const data = await this.rowData(tx, dishId, ingredient.unitType, ingredient.displayUnit, dto, undefined, ingredient.processingLosses);
      await this.archiveRevision(tx, dishId);
      await tx.recipeItem.create({ data: { dishId, ingredientId: dto.ingredientId, ...data } });
      await tx.dish.update({ where: { id: dishId }, data: { recipeVersion: { increment: 1 } } });
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.getByDish(dishId);
  }

  async updateItem(id: string, dto: RecipeItemUpdateDto) {
    const dishId = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      const item = await tx.recipeItem.findUnique({ where: { id }, include: { ingredient: true } });
      if (!item) throw new NotFoundException('Строка техкарты не найдена');
      const data = await this.rowData(tx, item.dishId, item.ingredient.unitType, item.amountUnit, dto, item, item.ingredient.processingLosses);
      await this.archiveRevision(tx, item.dishId);
      await tx.recipeItem.update({ where: { id }, data });
      await tx.dish.update({ where: { id: item.dishId }, data: { recipeVersion: { increment: 1 } } });
      return item.dishId;
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.getByDish(dishId);
  }

  async removeItem(id: string) {
    const dishId = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      const item = await tx.recipeItem.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('Строка техкарты не найдена');
      await this.archiveRevision(tx, item.dishId);
      await tx.recipeItem.delete({ where: { id } });
      await tx.dish.update({ where: { id: item.dishId }, data: { recipeVersion: { increment: 1 } } });
      return item.dishId;
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.getByDish(dishId);
  }

  async updateSettings(dishId: string, dto: RecipeSettingsDto) {
    await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await this.assertDish(tx, dishId);
      if (dto.variantId && !await tx.dishVariant.findFirst({ where: { id: dto.variantId, dishId } })) throw new BadRequestException('Вариант не относится к блюду');
      const current = dto.variantId ? await tx.dishVariant.findUniqueOrThrow({ where: { id: dto.variantId } }) : await tx.dish.findUniqueOrThrow({ where: { id: dishId } });
      const binding = dto.stockIngredientId === undefined ? current.stockIngredientId : dto.stockIngredientId;
      let stockAmount = current.stockAmount;
      if (binding) {
        const ingredient = await tx.ingredient.findFirst({ where: { id: binding, isActive: true } });
        if (!ingredient) throw new NotFoundException('Товар для прямой продажи не найден');
        if (ingredient.preparationMode === 'virtual') throw new BadRequestException('Для прямой продажи выберите товар с отдельным остатком');
        const unit = normalizeUnit(dto.stockUnit ?? ingredient.displayUnit);
        assertUnitMatchesType(unit, ingredient.unitType);
        if (dto.stockAmount !== undefined) stockAmount = this.quantity(dto.stockAmount, unit);
        else if (dto.stockIngredientId !== undefined && dto.stockIngredientId !== current.stockIngredientId) stockAmount = this.quantity(1, unit);
      } else if (dto.stockAmount !== undefined || dto.stockUnit !== undefined) throw new BadRequestException('Сначала выберите товар для прямой продажи');
      if (dto.metadata?.photoUrl && !/^(https?:\/\/|\/)/.test(dto.metadata.photoUrl)) throw new BadRequestException('Укажите ссылку на фото');
      await this.archiveRevision(tx, dishId);
      const data = { stockIngredientId: binding, stockAmount };
      if (dto.variantId) await tx.dishVariant.update({ where: { id: dto.variantId }, data });
      await tx.dish.update({ where: { id: dishId }, data: {
        ...(dto.variantId ? {} : data), recipeVersion: { increment: 1 },
        ...(dto.metadata === undefined ? {} : { recipeMetadata: dto.metadata as Prisma.InputJsonValue }),
      } });
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.getByDish(dishId, dto.variantId);
  }

  async revisions(dishId: string) {
    await this.assertDish(this.prisma, dishId);
    return this.prisma.recipeRevision.findMany({ where: { dishId }, orderBy: { version: 'desc' }, take: 100 });
  }

  async archiveRevision(tx: Prisma.TransactionClient, dishId: string) {
    const dish = await tx.dish.findUniqueOrThrow({ where: { id: dishId }, include: { recipeItems: true, variants: true, modifierGroups: { include: { options: true } } } });
    await tx.recipeRevision.upsert({
      where: { dishId_version: { dishId, version: dish.recipeVersion } },
      create: { dishId, version: dish.recipeVersion, snapshot: JSON.parse(JSON.stringify({ modifierGroups: dish.modifierGroups, allowIngredientExclusions: dish.allowIngredientExclusions, metadata: dish.recipeMetadata, stockIngredientId: dish.stockIngredientId, stockAmount: dish.stockAmount, items: dish.recipeItems, variants: dish.variants.map(({ id, name, stockIngredientId, stockAmount }) => ({ id, name, stockIngredientId, stockAmount })) })) },
      update: {},
    });
  }

  private async assertDish(tx: Prisma.TransactionClient, dishId: string) {
    if (!await tx.dish.findUnique({ where: { id: dishId }, select: { id: true } })) throw new NotFoundException('Блюдо не найдено');
  }

  private quantity(value: number, unit: UnitCode) {
    if (!Number.isFinite(value) || value < 0) throw new BadRequestException('Количество должно быть неотрицательным числом');
    const amount = new Prisma.Decimal(value).mul(toBase(1, unit)).toDecimalPlaces(3);
    if (amount.gte(100_000_000_000)) throw new BadRequestException('Количество вне допустимого диапазона');
    return amount;
  }

  async rowData(tx: Prisma.TransactionClient, dishId: string, unitType: 'mass' | 'volume' | 'count', defaultUnit: string, dto: RecipeItemUpdateDto, previous?: Prisma.RecipeItemGetPayload<{}>, processingLosses?: Prisma.JsonValue | null) {
    const unit = normalizeUnit(dto.unit ?? defaultUnit);
    assertUnitMatchesType(unit, unitType);
    const amount = this.quantity(dto.amount, unit);
    const warehouseId = dto.warehouseId === undefined ? previous?.warehouseId : dto.warehouseId;
    if (warehouseId && !await tx.warehouse.findFirst({ where: { id: warehouseId, cafeId: getCafeId() } })) throw new BadRequestException('Склад не найден');
    const variants = await tx.dishVariant.findMany({ where: { dishId }, select: { id: true } });
    const ids = new Set(variants.map((variant) => variant.id));
    let variantAmounts: Prisma.InputJsonValue | undefined;
    if (dto.variantAmounts !== undefined) {
      const entries = Object.entries(dto.variantAmounts);
      if (entries.some(([id, value]) => !ids.has(id) || typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new BadRequestException('Укажите допустимые нормы существующих вариантов блюда');
      variantAmounts = Object.fromEntries(entries.map(([id, value]) => [id, this.quantity(value, unit).toString()]));
    }
    const processingMethod = dto.processingMethod === undefined ? previous?.processingMethod ?? null : dto.processingMethod;
    const defaults = (processingLosses ?? {}) as Record<string, number>;
    const lossPercent = dto.lossPercent ?? (processingMethod && dto.processingMethod !== undefined ? Number(defaults[processingMethod] ?? 0) : Number(previous?.lossPercent ?? 0));
    if (!Number.isFinite(lossPercent) || lossPercent < 0 || lossPercent > 100) throw new BadRequestException('Потери должны быть от 0 до 100%');
    const netAmount = dto.netAmount === null ? null : dto.netAmount === undefined ? amount.mul(new Prisma.Decimal(100).sub(lossPercent)).div(100).toDecimalPlaces(3) : this.quantity(dto.netAmount, unit);
    if (netAmount?.gt(amount)) throw new BadRequestException('Нетто не может превышать брутто');
    return { processingMethod, amount, amountUnit: unit, fromCommonWarehouse: dto.fromCommonWarehouse, warehouseId, netAmount, lossPercent: dto.netAmount != null && amount.gt(0) ? new Prisma.Decimal(100).sub(netAmount!.mul(100).div(amount)).toDecimalPlaces(2) : new Prisma.Decimal(lossPercent), variantAmounts };
  }
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function round3(n: number) { return Math.round(n * 1000) / 1000; }
