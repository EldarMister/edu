import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { BadRequestException, ConflictException, Injectable, Optional, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCafeId } from '../tenant/tenant-context';
import { assertAssignableStation } from '../kitchen/preparation-stations';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_RECIPE_PORTIONS, RecipeCostsQuery, RecipeDraftDto, RecipeItemInputDto, RecipeItemUpdateDto, RecipePreviewDto, RecipeSettingsDto } from './recipes.dto';
import { MenuModifiersService } from './menu-modifiers';
import { lockRecipeGraph } from './recipe-resolution';
import { massProcessing, measuredNetWeight, nonMassProcessing, readProcessingStages } from './recipe-processing';
import { addRecipeValue, RecipeCalculator, recipeMetrics, recipeOutput, type RecipeCostRow } from './recipe-calculation';
import { assertUnitMatchesType, normalizeUnit, toBase, unitLabel, type UnitCode } from './units';
import { archiveDishRecipe, readCompositionRevisions, type RecipeRevisionEditor } from './recipe-revisions';
import { recipeExportProcessing, type RecipeExportCard, type RecipeExportLine } from './recipe-export-workbook';

const recipeDishInclude = {
  variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  category: { include: { tax: true } }, tax: true,
  setComponents: true,
  recipeItems: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { ingredient: true } },
} satisfies Prisma.DishInclude;

type RecipeDish = Prisma.DishGetPayload<{ include: typeof recipeDishInclude }>;

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

  async saveDraft(dishId: string, dto: RecipeDraftDto, editor?: RecipeRevisionEditor) {
    await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      const dish = await tx.dish.findUnique({ where: { id: dishId }, include: { recipeItems: true } });
      if (!dish) throw new NotFoundException('Блюдо не найдено');
      if (dish.catalogKind === 'goods' || dish.stockIngredientId || dish.isSet) throw new BadRequestException('Состав этой позиции изменяется в меню');
      if (dto.expectedVersion !== dish.recipeVersion) throw new ConflictException('Техкарта уже изменена. Обновите страницу перед сохранением.');
      const ids = dto.items.map((row) => row.ingredientId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Ингредиент указан дважды');
      await this.archiveRevision(tx, dishId, editor);
      for (const row of dto.items) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: row.ingredientId } });
        const previous = dish.recipeItems.find((item) => item.ingredientId === row.ingredientId);
        if (!ingredient || (!ingredient.isActive && !previous)) throw new BadRequestException('Ингредиент недоступен');
        const data = await this.rowData(tx, dishId, ingredient.unitType, ingredient.displayUnit, row, previous,
          ingredient.processingLosses, { inputPortions: dto.inputPortions });
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

  async getByDish(dishId: string, variantId?: string): Promise<Awaited<ReturnType<RecipesService['calculateSaved']>>['response']> {
    if (typeof this.prisma.$transaction === 'function') {
      return this.prisma.$transaction((tx) => new RecipesService(tx as PrismaService).getByDish(dishId, variantId),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    }
    const calculator = await RecipeCalculator.create(this.prisma);
    const dish = await this.readRecipeDish(dishId);
    return (await this.calculateSaved(dish, calculator, variantId)).response;
  }

  async preview(dto: RecipePreviewDto) {
    return this.prisma.$transaction(async (tx) => {
      const cafeId = getCafeId() ?? null;
      const dish = dto.dishId ? await tx.dish.findUnique({ where: { id: dto.dishId, cafeId }, include: {
        variants: true, tax: true, recipeItems: true,
      } }) : null;
      if (dto.dishId && !dish) throw new NotFoundException('Блюдо не найдено');
      const categoryId = dto.categoryId ?? dish?.categoryId;
      if (!categoryId) throw new BadRequestException('Выберите категорию блюда');
      const category = await tx.category.findUnique({ where: { id: categoryId, cafeId }, include: { tax: true } });
      if (!category) throw new NotFoundException('Категория не найдена');
      if (dto.prepStation != null) await assertAssignableStation(tx, dto.prepStation);
      const station = (dto.prepStation === undefined ? dish?.prepStation : dto.prepStation) ?? category.prepStation;
      const variant = dish?.variants.find(({ id }) => id === dto.variantId);
      if (dto.variantId && !variant) throw new BadRequestException('Вариант не относится к блюду');
      const ids = dto.items.map(({ ingredientId }) => ingredientId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Ингредиент указан дважды');
      const ingredientRows = ids.length ? await tx.ingredient.findMany({ where: { cafeId, id: { in: ids } } }) : [];
      const ingredients = new Map(ingredientRows.map((ingredient) => [ingredient.id, ingredient]));
      const savedRows = new Map(dish?.recipeItems.map((row) => [row.ingredientId, row]));
      const variantIds = new Set(dish?.variants.map(({ id }) => id));
      const composition: RecipeCostRow[] = [];
      for (const item of dto.items) {
        const ingredient = ingredients.get(item.ingredientId);
        const previous = savedRows.get(item.ingredientId);
        if (!ingredient || (!ingredient.isActive && !previous)) throw new BadRequestException('Ингредиент недоступен');
        const data = await this.rowData(tx, dish?.id, ingredient.unitType, ingredient.displayUnit, item, previous,
          ingredient.processingLosses, { variantIds, inputPortions: dto.inputPortions });
        composition.push({ ...data, id: previous?.id, ingredient, ingredientId: ingredient.id,
          fromCommonWarehouse: data.fromCommonWarehouse ?? previous?.fromCommonWarehouse ?? false, warehouseId: data.warehouseId ?? null,
          processingStages: readProcessingStages(data.processingStages),
          variantAmounts: data.variantAmounts === undefined ? previous?.variantAmounts ?? null : data.variantAmounts as Prisma.JsonValue });
      }
      const calculator = await RecipeCalculator.create(tx);
      const recipe = await calculator.composition(composition, station, dto.variantId);
      const savedBinding = variant?.stockIngredientId ?? dish?.stockIngredientId ?? null;
      const directId = dto.producedStockIngredientId === undefined ? savedBinding : dto.producedStockIngredientId;
      let stockAmount = variant?.stockIngredientId ? variant.stockAmount : dish?.stockAmount ?? new Prisma.Decimal(1);
      if (directId && (dto.producedStockIngredientId !== undefined || dto.weightedPriceBase !== undefined)) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: directId, cafeId } });
        if (!ingredient) throw new BadRequestException('Складская позиция не найдена');
        if (dto.producedStockIngredientId !== undefined && (!ingredient.isPrepared || !ingredient.isActive || ingredient.preparationMode === 'virtual'))
          throw new BadRequestException('Выберите складской полуфабрикат или выпущенное блюдо');
        stockAmount = new Prisma.Decimal(dto.weightedPriceBase ?? toBase(1, normalizeUnit(ingredient.displayUnit)));
      }
      const direct = directId ? await calculator.direct(directId, stockAmount, station) : null;
      const set = dish?.isSet && !direct && !composition.length ? new RecipesService(tx as PrismaService) : null;
      const setCalculation = set ? await set.calculateSaved(await set.readRecipeDish(dish!.id), calculator, dto.variantId) : null;
      if (dto.taxExempt && dto.taxId) throw new BadRequestException('Выберите налог или режим «Без налога»');
      const overriddenTax = dto.taxId ? await tx.menuTax.findUnique({ where: { id: dto.taxId, cafeId } }) : null;
      if (dto.taxId && !overriddenTax) throw new BadRequestException('Налог не найден');
      const exempt = dto.taxExempt ?? (dto.taxId === undefined && dish?.taxExempt === true);
      const specificTax = dto.taxId === undefined ? dish?.tax : overriddenTax;
      const tax = calculator.taxesEnabled && !exempt ? specificTax ?? category.tax : null;
      const price = dto.price === undefined ? variant?.price ?? dish?.price ?? null : new Prisma.Decimal(dto.price);
      const metrics = recipeMetrics(price, direct?.value ?? setCalculation?.value ?? recipe.value,
        !!directId || recipe.items.length > 0 || setCalculation?.response.accountingConfigured === true, tax);
      return { ...metrics, items: recipe.items, stockItem: direct?.stockItem ?? null,
        output: recipeOutput(dto.metadata ?? dish?.recipeMetadata, recipe.output, composition, dto.variantId),
        compositionOutput: recipe.output,
        compositionFoodCost: recipeMetrics(null, recipe.value, recipe.items.length > 0).foodCost, compositionMissingCosts: [...recipe.value.missing],
        compositionCostForScaling: recipe.items.length && !recipe.value.missing.size ? Number(recipe.value.cost) : null,
        productionCost: direct ? metrics.foodCost : null, productionMissingCosts: direct ? [...direct.value.missing] : [] };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async costSummary(query: RecipeCostsQuery) {
    const ids = query.dishIds === undefined ? undefined : [...new Set(query.dishIds.split(',').map((id) => id.trim()).filter(Boolean))];
    if (ids && (!ids.length || ids.length > 30 || ids.some((id) => id.length > 160))) throw new BadRequestException('Укажите до 30 позиций меню');
    const search = query.search?.trim();
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 30;
    return this.prisma.$transaction(async (tx) => {
      const where: Prisma.DishWhereInput = {
        cafeId: getCafeId() ?? null,
        ...(ids ? { id: { in: ids } } : { isActive: true, catalogKind: 'recipe' }),
        categoryId: query.categoryId, ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      };
      const [dishes, total, calculator] = await Promise.all([
        tx.dish.findMany({ where, skip: offset, take: limit, orderBy: [{ name: 'asc' }, { id: 'asc' }], include: recipeDishInclude }),
        tx.dish.count({ where }),
        RecipeCalculator.create(tx),
      ]);
      const service = new RecipesService(tx as PrismaService);
      const rows = [];
      for (const dish of dishes) {
        for (const variant of dish.variants.length ? dish.variants : [null]) {
          const { response } = await service.calculateSaved(dish, calculator, variant?.id);
          const { price, foodCost, ingredientCost, packagingCost, foodCostPercent, markupPercent, marginAmount, marginPercent,
            taxAmount, profit, missingCosts, costKnown, output, warehouseName, stockItem, compositionFoodCost, productionCost } = response;
          rows.push({ dishId: dish.id, dishName: dish.name, categoryId: dish.categoryId, categoryName: dish.category.name,
            isSet: dish.isSet, catalogKind: dish.catalogKind, isActive: dish.isActive, variantId: variant?.id ?? null, variantName: variant?.name ?? null,
            price, foodCost, ingredientCost, packagingCost, foodCostPercent, markupPercent, marginAmount, marginPercent, taxAmount,
            profit, missingCosts, costKnown, output, warehouseName, stockItem, compositionFoodCost, productionCost });
        }
      }
      return { rows, total, offset, limit };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  }

  async exportCards(ids: string[], includeComposition: boolean): Promise<RecipeExportCard[]> {
    return this.prisma.$transaction(async (tx) => {
      const orderedIds = [...new Set(ids)];
      const [dishes, calculator] = await Promise.all([
        tx.dish.findMany({ where: { cafeId: getCafeId() ?? null, catalogKind: 'recipe', id: { in: orderedIds } }, include: recipeDishInclude }),
        RecipeCalculator.create(tx),
      ]);
      const byId = new Map(dishes.map((dish) => [dish.id, dish]));
      const cards: RecipeExportCard[] = [];
      const service = new RecipesService(tx as PrismaService);
      for (const id of orderedIds) {
        const dish = byId.get(id);
        if (!dish) continue;
        for (const variant of dish.variants.length ? dish.variants : [null]) {
          const { response } = await service.calculateSaved(dish, calculator, variant?.id);
          const items: RecipeExportLine[] = includeComposition ? response.items.map((item) => ({
            name: item.name, gross: item.amount, unit: item.unit, net: item.netAmount, netGrams: item.netWeightGrams,
            processing: recipeExportProcessing(item.processingStages, item.processingMethod), warehouse: item.warehouseName, cost: item.lineCost,
          })) : [];
          if (includeComposition && !items.length && response.stockItem) {
            const stock = response.stockItem;
            items.push({ name: stock.name, gross: stock.amount, unit: unitLabel(stock.unit), net: null,
              warehouse: stock.warehouseName, cost: response.foodCost });
          }
          if (includeComposition && !items.length) for (const component of response.components) {
            items.push({ name: [component.dishName, component.variantName].filter(Boolean).join(' · '), gross: component.quantity,
              unit: 'шт', net: null, cost: component.foodCost });
          }
          cards.push({ name: dish.name, category: dish.category.name, type: dish.isSet ? 'Сет' : 'Техкарта',
            variant: variant?.name ?? null, price: response.price, cost: response.foodCost, items,
            output: response.output ? { amount: response.output.amount, unit: unitLabel(response.output.unit) } : null });
        }
      }
      return cards;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  }

  private async readRecipeDish(dishId: string) {
    const dish = await this.prisma.dish.findUnique({ where: { id: dishId }, include: recipeDishInclude });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    return dish;
  }

  private async calculateSaved(dish: RecipeDish, calculator: RecipeCalculator, variantId?: string, path: string[] = []) {
    if (path.includes(dish.id) || path.length >= 32) throw new BadRequestException('Циклический состав сетов');
    const variant = dish.variants.find((value) => value.id === variantId);
    if (variantId && !variant) throw new BadRequestException('Вариант не относится к блюду');
    const station = dish.prepStation ?? dish.category.prepStation;
    const composition = await calculator.composition(dish.recipeItems, station, variantId);
    const directId = variant?.stockIngredientId ?? dish.stockIngredientId;
    const directAmount = variant?.stockIngredientId ? variant.stockAmount : dish.stockAmount;
    const direct = directId ? await calculator.direct(directId, directAmount, station) : null;
    const value = direct?.value ?? composition.value;
    const components: { dishId: string; dishName: string; variantId: string | null; variantName: string | null; quantity: number; foodCost: number | null; accountingConfigured: boolean }[] = [];
    if (!direct && !dish.recipeItems.length && dish.isSet) {
      for (const component of dish.setComponents) {
        const child = await this.readRecipeDish(component.dishId);
        let accountingConfigured = false;
        let foodCost: number | null = null;
        try {
          const result = await this.calculateSaved(child, calculator, component.dishVariantId ?? undefined, [...path, dish.id]);
          accountingConfigured = result.response.accountingConfigured;
          addRecipeValue(value, result.value, component.quantity);
          foodCost = result.response.costKnown ? Number(result.value.cost.mul(component.quantity).toDecimalPlaces(2)) : null;
        } catch (error) {
          if (!(error instanceof BadRequestException)) throw error;
        }
        if (!accountingConfigured) value.missing.add('Не настроено: ' + child.name);
        components.push({ dishId: component.dishId, dishName: child.name, variantId: component.dishVariantId,
          variantName: child.variants.find(({ id }) => id === component.dishVariantId)?.name ?? null,
          quantity: component.quantity, foodCost, accountingConfigured });
      }
    }
    const configured = !!directId || dish.recipeItems.length > 0 || (components.length > 0 && components.every((item) => item.accountingConfigured));
    const tax = calculator.taxesEnabled && !dish.taxExempt ? dish.tax ?? dish.category.tax : null;
    const price = variant?.price ?? dish.price;
    const metrics = recipeMetrics(price, value, configured, tax);
    return { value, response: {
      ...metrics, price: Number(price), dishId: dish.id, dishName: dish.name, items: composition.items, version: dish.recipeVersion,
      metadata: dish.recipeMetadata ?? {}, output: recipeOutput(dish.recipeMetadata, composition.output, dish.recipeItems, variantId),
      compositionOutput: composition.output,
      stockIngredientId: directId, stockAmount: Number(directAmount), stockItem: direct?.stockItem ?? null,
      variants: dish.variants.map(({ id, name, stockIngredientId, stockAmount }) => ({ id, name, stockIngredientId, stockAmount: Number(stockAmount) })),
      components, warehouseName: direct?.stockItem?.warehouseName ?? calculator.stationWarehouseName(station),
      productionCost: direct ? metrics.foodCost : null, productionMissingCosts: direct ? [...value.missing] : [],
      compositionFoodCost: recipeMetrics(null, composition.value, composition.items.length > 0).foodCost,
      compositionMissingCosts: [...composition.value.missing],
    } };
  }

  async addItem(dishId: string, dto: RecipeItemInputDto, editor?: RecipeRevisionEditor) {
    await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await this.assertDish(tx, dishId);
      const ingredient = await tx.ingredient.findFirst({ where: { id: dto.ingredientId, isActive: true } });
      if (!ingredient) throw new NotFoundException('Позиция склада не найдена');
      if (await tx.recipeItem.findUnique({ where: { dishId_ingredientId: { dishId, ingredientId: dto.ingredientId } } })) throw new BadRequestException('Этот ингредиент уже есть в техкарте');
      const data = await this.rowData(tx, dishId, ingredient.unitType, ingredient.displayUnit, dto, undefined, ingredient.processingLosses);
      await this.archiveRevision(tx, dishId, editor);
      await tx.recipeItem.create({ data: { dishId, ingredientId: dto.ingredientId, ...data } });
      await tx.dish.update({ where: { id: dishId }, data: { recipeVersion: { increment: 1 } } });
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.getByDish(dishId);
  }

  async updateItem(id: string, dto: RecipeItemUpdateDto, editor?: RecipeRevisionEditor) {
    const dishId = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      const item = await tx.recipeItem.findUnique({ where: { id }, include: { ingredient: true } });
      if (!item) throw new NotFoundException('Строка техкарты не найдена');
      const data = await this.rowData(tx, item.dishId, item.ingredient.unitType, item.amountUnit, dto, item, item.ingredient.processingLosses);
      await this.archiveRevision(tx, item.dishId, editor);
      await tx.recipeItem.update({ where: { id }, data });
      await tx.dish.update({ where: { id: item.dishId }, data: { recipeVersion: { increment: 1 } } });
      return item.dishId;
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.getByDish(dishId);
  }

  async removeItem(id: string, editor?: RecipeRevisionEditor) {
    const dishId = await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      const item = await tx.recipeItem.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('Строка техкарты не найдена');
      await this.archiveRevision(tx, item.dishId, editor);
      await tx.recipeItem.delete({ where: { id } });
      await tx.dish.update({ where: { id: item.dishId }, data: { recipeVersion: { increment: 1 } } });
      return item.dishId;
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.getByDish(dishId);
  }

  async updateSettings(dishId: string, dto: RecipeSettingsDto, editor?: RecipeRevisionEditor) {
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
      await this.archiveRevision(tx, dishId, editor);
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

  async compositionRevisions(dishId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertDish(tx, dishId);
      return readCompositionRevisions(tx, dishId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async archiveRevision(tx: Prisma.TransactionClient, dishId: string, editor?: RecipeRevisionEditor) {
    await archiveDishRecipe(tx, dishId, editor);
  }

  private async assertDish(tx: Prisma.TransactionClient, dishId: string) {
    if (!await tx.dish.findUnique({ where: { id: dishId }, select: { id: true } })) throw new NotFoundException('Блюдо не найдено');
  }

  private quantity(value: number, unit: UnitCode, portions = 1) {
    if (!Number.isFinite(value) || value < 0) throw new BadRequestException('Количество должно быть неотрицательным числом');
    const amount = new Prisma.Decimal(value).mul(toBase(1, unit)).div(portions).toDecimalPlaces(3);
    if (amount.gte(100_000_000_000)) throw new BadRequestException('Количество вне допустимого диапазона');
    if (portions > 1 && value > 0 && amount.isZero()) throw new BadRequestException('Количество на одну порцию меньше допустимой точности');
    return amount;
  }

  async rowData(tx: Prisma.TransactionClient, dishId: string | undefined, unitType: 'mass' | 'volume' | 'count', defaultUnit: string,
    dto: RecipeItemUpdateDto, previous?: Prisma.RecipeItemGetPayload<{}>, processingLosses?: Prisma.JsonValue | null,
    { variantIds, inputPortions: portions = 1 }: { variantIds?: ReadonlySet<string>; inputPortions?: number } = {}) {
    const unit = normalizeUnit(dto.unit ?? defaultUnit);
    assertUnitMatchesType(unit, unitType);
    if (!Number.isInteger(portions) || portions < 1 || portions > MAX_RECIPE_PORTIONS) {
      throw new BadRequestException(`Укажите от 1 до ${MAX_RECIPE_PORTIONS} порций в рецептуре`);
    }
    const amount = this.quantity(dto.amount, unit, portions);
    const input = portions > 1 && dto.netAmount != null
      ? { ...dto, netAmount: this.quantity(dto.netAmount, unit, portions).div(toBase(1, unit)).toNumber() } : dto;
    const warehouseId = dto.warehouseId === undefined ? previous?.warehouseId : dto.warehouseId;
    if (warehouseId && !await tx.warehouse.findFirst({ where: { id: warehouseId, cafeId: getCafeId() } })) throw new BadRequestException('Склад не найден');
    let variantAmounts: Prisma.InputJsonValue | undefined;
    if (dto.variantAmounts !== undefined) {
      const variants = !variantIds && dishId ? await tx.dishVariant.findMany({ where: { dishId }, select: { id: true } }) : [];
      const ids = variantIds ?? new Set(variants.map(({ id }) => id));
      const entries = Object.entries(dto.variantAmounts);
      if (entries.some(([id, value]) => !ids.has(id) || typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new BadRequestException('Укажите допустимые нормы существующих вариантов блюда');
      variantAmounts = Object.fromEntries(entries.map(([id, value]) => [id, this.quantity(value, unit, portions).toString()]));
    }
    const processing = unitType === 'mass' ? massProcessing(amount, unit, input, previous, processingLosses)
      : { amount, ...nonMassProcessing(amount, unit, input, previous), processingStages: [], processingBasis: null };
    return { ...processing, processingStages: processing.processingStages.length ? processing.processingStages : Prisma.DbNull,
      measuredNetWeightGrams: measuredNetWeight(unitType, processing.amount, dto.measuredNetWeightGrams, previous?.measuredNetWeightGrams, portions),
      amountUnit: unit, fromCommonWarehouse: dto.fromCommonWarehouse, warehouseId, variantAmounts };
  }
}
