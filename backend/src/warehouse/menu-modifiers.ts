import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { BadRequestException, Body, Controller, Get, Injectable, Optional, NotFoundException, Param, Put } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { visibleMenuDish } from '../categories/menu-visibility';
import { CurrentUser, type AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { lockRecipeGraph, recipeAmount, recipeRowsForVariant } from './recipe-resolution';
import { archiveDishRecipe, type RecipeRevisionEditor } from './recipe-revisions';
import { assertUnitMatchesType, fromBase, normalizeUnit, toBase, UnitCode } from './units';

class ModifierOptionDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(120) name: string;
  @IsNumber() @Min(0) @Max(1000000) price: number;
  @IsOptional() @IsString() ingredientId?: string | null;
  @IsOptional() @IsString() replacesIngredientId?: string | null;
  @IsOptional() @IsNumber() @Min(0) amount?: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsBoolean() fromCommonWarehouse?: boolean;
  @IsOptional() @IsString() warehouseId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxQuantity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
class ModifierGroupDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(120) name: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) minSelections?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxSelections?: number | null;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ModifierOptionDto) options: ModifierOptionDto[];
}
export class MenuModifiersDto {
  @IsBoolean() allowIngredientExclusions: boolean;
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(250) @IsString({ each: true }) excludableIngredientIds?: string[] | null;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ModifierGroupDto) groups: ModifierGroupDto[];
}
type ExclusionDish = {
  allowIngredientExclusions: boolean;
  excludableIngredientIds: Prisma.JsonValue | null;
  stockIngredientId: string | null;
  variants: { id: string; stockIngredientId: string | null; recipeMetadata?: Prisma.JsonValue }[];
  recipeItems: { ingredientId: string; variantId?: string | null; amount: Prisma.Decimal; variantAmounts: Prisma.JsonValue | null;
    ingredient: { id: string; name: string } }[];
};

function exclusionAllowlist(value: Prisma.JsonValue | null): string[] | null {
  // Null keeps the original recipe-wide permission on existing dishes.
  return value === null ? null : Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string') : [];
}

function servingIngredients(dish: ExclusionDish, variantId?: string | null) {
  const variant = variantId ? dish.variants.find(({ id }) => id === variantId) : null;
  if (variantId && !variant) throw new BadRequestException('Вариант не относится к выбранному блюду');
  if (dish.stockIngredientId || variant?.stockIngredientId) return [];
  const servingRows = (value?: ExclusionDish['variants'][number] | null) => recipeRowsForVariant(dish.recipeItems, value)
    .filter((row) => recipeAmount(row, value?.recipeMetadata == null ? value?.id : undefined).gt(0));
  const rows = variantId ? servingRows(variant)
    : [...servingRows(), ...dish.variants.filter((entry) => !entry.stockIngredientId).flatMap(servingRows)];
  return [...new Map(rows.map(({ ingredient }) => [ingredient.id, ingredient])).values()];
}

function excludableIngredients(dish: ExclusionDish, ingredients: { id: string; name: string }[]) {
  if (!dish.allowIngredientExclusions) return [];
  const ids = exclusionAllowlist(dish.excludableIngredientIds);
  return ids === null ? ingredients : ingredients.filter(({ id }) => ids.includes(id));
}

function modifierOrderGroup<T extends { isActive: boolean; replacesIngredientId: string | null; maxQuantity: number }>(
  group: { minSelections: number; options: T[] }, recipeNames: ReadonlyMap<string, string>,
) {
  const active = group.options.filter(({ isActive }) => isActive);
  const options = active.filter(({ replacesIngredientId }) => !replacesIngredientId || recipeNames.has(replacesIngredientId));
  if (options.length === active.length) return { options, minSelections: group.minSelections };
  const replacementTargets = new Set(options.flatMap(({ replacesIngredientId }) => replacesIngredientId ? [replacesIngredientId] : []));
  const capacity = options.reduce((total, option) => total + (option.replacesIngredientId ? 0 : option.maxQuantity), replacementTargets.size);
  return { options, minSelections: Math.min(group.minSelections, capacity) };
}
export type ModifierSelectionSnapshot = {
  optionId: string; groupId: string; name: string; quantity: number; price: string;
  ingredientId: string | null; amount: string; amountUnit: string; fromCommonWarehouse: boolean; warehouseId: string | null;
  replacesIngredientId?: string;
  replacesIngredientName?: string;
};
export function selectionIdentity(options: unknown, exclusions: unknown) {
  return JSON.stringify({ options: (Array.isArray(options) ? options : []).map((option) => ({ optionId: option.optionId, quantity: option.quantity })).sort((a, b) => a.optionId.localeCompare(b.optionId)),
    exclusions: (Array.isArray(exclusions) ? exclusions : []).slice().sort() });
}

/** Resolve only catalog ids; all prices, ingredient quantities and routes are server snapshots. */
export async function resolveMenuSelections(tx: Prisma.TransactionClient, dishId: string,
  selections: { optionId: string; quantity: number }[] = [], exclusions: string[] = [], existing?: { dishVariantId: string | null; modifierSelections: Prisma.JsonValue | null; excludedIngredientIds: Prisma.JsonValue | null; excludedIngredientNames: Prisma.JsonValue | null }, variantId?: string | null) {
  if (new Set(selections.map((item) => item.optionId)).size !== selections.length || new Set(exclusions).size !== exclusions.length) throw new BadRequestException('Добавка или исключение указаны дважды');
  if (existing && existing.dishVariantId === (variantId ?? null) && selectionIdentity(selections, exclusions) === selectionIdentity(existing.modifierSelections, existing.excludedIngredientIds)) {
    const options = (existing.modifierSelections ?? []) as ModifierSelectionSnapshot[];
    return { options, exclusions, exclusionNames: (existing.excludedIngredientNames ?? []) as string[], price: options.reduce((sum, option) => sum.add(new Prisma.Decimal(option.price).mul(option.quantity)), new Prisma.Decimal(0)) };
  }
  const dish = await tx.dish.findUnique({ where: { id: dishId }, include: { modifierGroups: { include: { options: true } },
    variants: { select: { id: true, stockIngredientId: true, recipeMetadata: true } }, recipeItems: { include: { ingredient: { select: { id: true, name: true } } } } } });
  if (!dish) throw new NotFoundException('Блюдо не найдено');
  const byId = new Map(dish.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)));
  const ingredients = servingIngredients(dish, variantId);
  const recipeNames = new Map(ingredients.map(({ id, name }) => [id, name]));
  const replaced = new Set<string>();
  const options: ModifierSelectionSnapshot[] = [];
  for (const selected of selections) {
    const option = byId.get(selected.optionId);
    if (!option || !option.isActive || !Number.isInteger(selected.quantity) || selected.quantity < 1 || selected.quantity > option.maxQuantity) throw new BadRequestException('Выберите доступную добавку и допустимое количество');
    const target = option.replacesIngredientId;
    const replacesIngredientName = target ? recipeNames.get(target) : undefined;
    if (target && (!option.ingredientId || !replacesIngredientName || selected.quantity !== 1 || replaced.has(target))) {
      throw new BadRequestException('В этой порции каждый ингредиент можно заменить только один раз');
    }
    if (target) replaced.add(target);
    options.push({ optionId: option.id, groupId: option.groupId, name: option.name, quantity: selected.quantity, price: option.price.toString(),
      ingredientId: option.ingredientId, amount: option.amount.toString(), amountUnit: option.amountUnit, fromCommonWarehouse: option.fromCommonWarehouse, warehouseId: option.warehouseId,
      ...(target && replacesIngredientName && { replacesIngredientId: target, replacesIngredientName }) });
  }
  for (const group of dish.modifierGroups) {
    const count = options.filter((option) => option.groupId === group.id).reduce((sum, option) => sum + option.quantity, 0);
    const { minSelections } = modifierOrderGroup(group, recipeNames);
    if (count < minSelections || (group.maxSelections != null && count > group.maxSelections)) throw new BadRequestException(`Проверьте количество добавок в группе «${group.name}»`);
  }
  const roots = new Map(excludableIngredients(dish, ingredients).map(({ id, name }) => [id, name]));
  if (exclusions.some((id) => !roots.has(id))) throw new BadRequestException('Нельзя исключить выбранный ингредиент из этого блюда');
  return { options, exclusions, exclusionNames: exclusions.map((id) => roots.get(id)!), price: options.reduce((sum, option) => sum.add(new Prisma.Decimal(option.price).mul(option.quantity)), new Prisma.Decimal(0)) };
}

@Injectable()
export class MenuModifiersService {
  constructor(private prisma: PrismaService, @Optional() private events?: EventsGateway) {}
  async get(dishId: string, publicView = false, variantId?: string) {
    const where = { id: dishId, ...(publicView ? visibleMenuDish : { archivedAt: null }) };
    const dish = await this.prisma.dish.findUnique({ where, include: { modifierGroups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
      variants: { select: { id: true, stockIngredientId: true, recipeMetadata: true } }, recipeItems: { include: { ingredient: { select: { id: true, name: true } } } } } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    const ingredients = servingIngredients(dish, variantId);
    const targetNames = new Map(ingredients.map(({ id, name }) => [id, name]));
    return { dishId, allowIngredientExclusions: dish.allowIngredientExclusions,
      ...(!publicView && { excludableIngredientIds: exclusionAllowlist(dish.excludableIngredientIds) }),
      excludableIngredients: excludableIngredients(dish, ingredients),
      groups: dish.modifierGroups.map((group) => {
        const { options, minSelections } = publicView ? modifierOrderGroup(group, targetNames) : group;
        return { id: group.id, name: group.name, minSelections, maxSelections: group.maxSelections, sortOrder: group.sortOrder,
          options: options.map((option) => ({ id: option.id, name: option.name, price: Number(option.price), maxQuantity: option.maxQuantity, isActive: option.isActive, sortOrder: option.sortOrder,
          ...(option.replacesIngredientId && { replacesIngredientId: option.replacesIngredientId, replacesIngredientName: targetNames.get(option.replacesIngredientId) }),
            ...(!publicView ? { ingredientId: option.ingredientId, amount: fromBase(Number(option.amount), option.amountUnit as UnitCode), unit: option.amountUnit, fromCommonWarehouse: option.fromCommonWarehouse, warehouseId: option.warehouseId } : {}) })) };
      }) };
  }
  async save(dishId: string, dto: MenuModifiersDto, editor?: RecipeRevisionEditor) {
    await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await this.saveInTransaction(tx, dishId, dto, true, editor);
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.get(dishId);
  }
  async saveInTransaction(tx: Prisma.TransactionClient, dishId: string, dto: MenuModifiersDto, archive = true, editor?: RecipeRevisionEditor) {
      const dish = await tx.dish.findUnique({ where: { id: dishId, archivedAt: null }, include: { recipeItems: true, variants: true, modifierGroups: { include: { options: true } } } });
      if (!dish) throw new NotFoundException('Блюдо не найдено');
      const exclusionIds = dto.excludableIngredientIds;
      if (Array.isArray(exclusionIds) && (new Set(exclusionIds).size !== exclusionIds.length
        || exclusionIds.some((id) => !dish.recipeItems.some((row) => row.ingredientId === id)))) {
        throw new BadRequestException('Выберите ингредиенты, которые входят в состав блюда');
      }
      if (archive) await archiveDishRecipe(tx, dishId, editor, 'full');
      const groupIds = new Set(dish.modifierGroups.map((group) => group.id));
      const existingOptions = new Map(dish.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)));
      const keptGroups: string[] = [], seenOptions = new Set<string>();
      for (const [groupIndex, input] of dto.groups.entries()) {
        if (!input.name.trim() || (input.id && (!groupIds.has(input.id) || keptGroups.includes(input.id)))) throw new BadRequestException('Проверьте название и идентификатор группы');
        if (input.maxSelections != null && input.maxSelections < (input.minSelections ?? 0)) throw new BadRequestException('Максимум добавок меньше минимума');
        const data = { dishId, name: input.name.trim(), minSelections: input.minSelections ?? 0, maxSelections: input.maxSelections ?? null, sortOrder: input.sortOrder ?? groupIndex };
        const group = input.id ? await tx.menuModifierGroup.update({ where: { id: input.id }, data }) : await tx.menuModifierGroup.create({ data });
        keptGroups.push(group.id);
        const keptOptions: string[] = [];
        const activeReplacementTargets = new Set<string>();
        let activeAdditionsCapacity = 0;
        for (const [optionIndex, option] of input.options.entries()) {
          const existing = option.id ? existingOptions.get(option.id) : undefined;
          if (!option.name.trim() || (option.id && (!existing || seenOptions.has(option.id)))) throw new BadRequestException('Проверьте название и идентификатор добавки');
          if (option.id) seenOptions.add(option.id);
          const replacesIngredientId = option.replacesIngredientId === undefined ? existing?.replacesIngredientId : option.replacesIngredientId;
          if (replacesIngredientId && (dish.isSet || dish.stockIngredientId || !option.ingredientId || replacesIngredientId === option.ingredientId
            || !dish.recipeItems.some((row) => row.ingredientId === replacesIngredientId))) {
            throw new BadRequestException('Укажите другой складской ингредиент для замены позиции из состава блюда');
          }
          let amount = new Prisma.Decimal(0), unit: UnitCode = 'pcs';
          if (option.ingredientId) {
            const preservesLink = existing?.ingredientId === option.ingredientId;
            const reactivatesOption = existing?.isActive === false && option.isActive !== false;
            const ingredient = await tx.ingredient.findFirst({ where: {
              id: option.ingredientId,
              ...(!preservesLink || reactivatesOption ? { isActive: true } : {}),
            } });
            if (!ingredient) throw new BadRequestException('Складская позиция добавки недоступна');
            unit = normalizeUnit(option.unit ?? ingredient.displayUnit); assertUnitMatchesType(unit, ingredient.unitType);
            amount = new Prisma.Decimal(option.amount ?? 0).mul(toBase(1, unit)).toDecimalPlaces(3);
            if (amount.lte(0) || amount.gte(100000000000)) throw new BadRequestException('Укажите расход продукта для добавки');
          }
          if (option.warehouseId && !await tx.warehouse.findUnique({ where: { id: option.warehouseId } })) throw new BadRequestException('Склад добавки не найден');
          const data = { groupId: group.id, name: option.name.trim(), price: new Prisma.Decimal(option.price), ingredientId: option.ingredientId ?? null,
            replacesIngredientId: replacesIngredientId ?? null,
            amount, amountUnit: unit, fromCommonWarehouse: option.fromCommonWarehouse ?? false, warehouseId: option.warehouseId ?? null,
            maxQuantity: replacesIngredientId ? 1 : option.maxQuantity ?? 1, isActive: option.isActive ?? true, sortOrder: option.sortOrder ?? optionIndex };
          const saved = option.id ? await tx.menuModifierOption.update({ where: { id: option.id }, data }) : await tx.menuModifierOption.create({ data });
          keptOptions.push(saved.id);
          if (saved.isActive) {
            if (replacesIngredientId) activeReplacementTargets.add(replacesIngredientId);
            else activeAdditionsCapacity += saved.maxQuantity;
          }
        }
        if (activeAdditionsCapacity + activeReplacementTargets.size < (input.minSelections ?? 0)) {
          throw new BadRequestException('Недостаточно доступных добавок для обязательного выбора');
        }
        await tx.menuModifierOption.deleteMany({ where: { groupId: group.id, id: { notIn: keptOptions } } });
      }
      await tx.menuModifierGroup.deleteMany({ where: { dishId, id: { notIn: keptGroups } } });
      await tx.dish.update({ where: { id: dishId }, data: { allowIngredientExclusions: dto.allowIngredientExclusions,
        ...(exclusionIds !== undefined && { excludableIngredientIds: exclusionIds ?? Prisma.DbNull }),
        ...(archive ? { recipeVersion: { increment: 1 } } : {}) } });
  }
}

@Controller('admin/warehouse/dishes')
@Roles(Role.OWNER, Role.ADMIN, Role.KITCHEN, Role.BAR)
@RequirePermission('sections.warehouse')
export class MenuModifiersController {
  constructor(private modifiers: MenuModifiersService) {}
  @Get(':id/modifiers') get(@Param('id') id: string) { return this.modifiers.get(id); }
  @Put(':id/modifiers') @RequirePermission('actions.warehouseRecipes')
  save(@Param('id') id: string, @Body() dto: MenuModifiersDto, @CurrentUser() user: AuthUser) {
    return this.modifiers.save(id, dto, user);
  }
}
