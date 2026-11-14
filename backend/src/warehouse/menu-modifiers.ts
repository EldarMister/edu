import { EventsGateway } from '../realtime/events.gateway';
import { SERVER_EVENTS } from '../realtime/events';
import { BadRequestException, Body, Controller, Get, Injectable, Optional, NotFoundException, Param, Put } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { lockRecipeGraph } from './recipe-resolution';
import { assertUnitMatchesType, fromBase, normalizeUnit, toBase, UnitCode } from './units';

class ModifierOptionDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(120) name: string;
  @IsNumber() @Min(0) @Max(1000000) price: number;
  @IsOptional() @IsString() ingredientId?: string | null;
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
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ModifierGroupDto) groups: ModifierGroupDto[];
}
export type ModifierSelectionSnapshot = {
  optionId: string; groupId: string; name: string; quantity: number; price: string;
  ingredientId: string | null; amount: string; amountUnit: string; fromCommonWarehouse: boolean; warehouseId: string | null;
};
export function selectionIdentity(options: unknown, exclusions: unknown) {
  return JSON.stringify({ options: (Array.isArray(options) ? options : []).map((option) => ({ optionId: option.optionId, quantity: option.quantity })).sort((a, b) => a.optionId.localeCompare(b.optionId)),
    exclusions: (Array.isArray(exclusions) ? exclusions : []).slice().sort() });
}

/** Resolve only catalog ids; all prices, ingredient quantities and routes are server snapshots. */
export async function resolveMenuSelections(tx: Prisma.TransactionClient, dishId: string,
  selections: { optionId: string; quantity: number }[] = [], exclusions: string[] = [], existing?: { modifierSelections: Prisma.JsonValue | null; excludedIngredientIds: Prisma.JsonValue | null; excludedIngredientNames: Prisma.JsonValue | null }) {
  if (new Set(selections.map((item) => item.optionId)).size !== selections.length || new Set(exclusions).size !== exclusions.length) throw new BadRequestException('Добавка или исключение указаны дважды');
  if (existing && selectionIdentity(selections, exclusions) === selectionIdentity(existing.modifierSelections, existing.excludedIngredientIds)) {
    const options = (existing.modifierSelections ?? []) as ModifierSelectionSnapshot[];
    return { options, exclusions, exclusionNames: (existing.excludedIngredientNames ?? []) as string[], price: options.reduce((sum, option) => sum.add(new Prisma.Decimal(option.price).mul(option.quantity)), new Prisma.Decimal(0)) };
  }
  const dish = await tx.dish.findUnique({ where: { id: dishId }, include: { modifierGroups: { include: { options: true } }, recipeItems: { include: { ingredient: true } } } });
  if (!dish) throw new NotFoundException('Блюдо не найдено');
  const byId = new Map(dish.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, option] as const)));
  const options: ModifierSelectionSnapshot[] = [];
  for (const selected of selections) {
    const option = byId.get(selected.optionId);
    if (!option || !option.isActive || !Number.isInteger(selected.quantity) || selected.quantity < 1 || selected.quantity > option.maxQuantity) throw new BadRequestException('Выберите доступную добавку и допустимое количество');
    options.push({ optionId: option.id, groupId: option.groupId, name: option.name, quantity: selected.quantity, price: option.price.toString(),
      ingredientId: option.ingredientId, amount: option.amount.toString(), amountUnit: option.amountUnit, fromCommonWarehouse: option.fromCommonWarehouse, warehouseId: option.warehouseId });
  }
  for (const group of dish.modifierGroups) {
    const count = options.filter((option) => option.groupId === group.id).reduce((sum, option) => sum + option.quantity, 0);
    if (count < group.minSelections || (group.maxSelections != null && count > group.maxSelections)) throw new BadRequestException(`Проверьте количество добавок в группе «${group.name}»`);
  }
  const roots = new Map(dish.recipeItems.map((row) => [row.ingredientId, row.ingredient.name]));
  if (exclusions.length && (!dish.allowIngredientExclusions || exclusions.some((id) => !roots.has(id)))) throw new BadRequestException('Нельзя исключить выбранный ингредиент из этого блюда');
  return { options, exclusions, exclusionNames: exclusions.map((id) => roots.get(id)!), price: options.reduce((sum, option) => sum.add(new Prisma.Decimal(option.price).mul(option.quantity)), new Prisma.Decimal(0)) };
}

@Injectable()
export class MenuModifiersService {
  constructor(private prisma: PrismaService, @Optional() private events?: EventsGateway) {}
  async get(dishId: string, publicView = false) {
    const dish = await this.prisma.dish.findUnique({ where: { id: dishId }, include: { modifierGroups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } }, recipeItems: { include: { ingredient: { select: { id: true, name: true } } } } } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    return { dishId, allowIngredientExclusions: dish.allowIngredientExclusions,
      excludableIngredients: dish.allowIngredientExclusions ? dish.recipeItems.map((row) => row.ingredient) : [],
      groups: dish.modifierGroups.map((group) => ({ id: group.id, name: group.name, minSelections: group.minSelections, maxSelections: group.maxSelections, sortOrder: group.sortOrder,
        options: group.options.filter((option) => !publicView || option.isActive).map((option) => ({ id: option.id, name: option.name, price: Number(option.price), maxQuantity: option.maxQuantity, isActive: option.isActive, sortOrder: option.sortOrder,
          ...(!publicView ? { ingredientId: option.ingredientId, amount: fromBase(Number(option.amount), option.amountUnit as UnitCode), unit: option.amountUnit, fromCommonWarehouse: option.fromCommonWarehouse, warehouseId: option.warehouseId } : {}) })) })) };
  }
  async save(dishId: string, dto: MenuModifiersDto) {
    await this.prisma.$transaction(async (tx) => {
      await lockRecipeGraph(tx);
      await this.saveInTransaction(tx, dishId, dto);
    });
    this.events?.emitBroadcast(SERVER_EVENTS.MENU_UPDATED, { dishId });
    return this.get(dishId);
  }
  async saveInTransaction(tx: Prisma.TransactionClient, dishId: string, dto: MenuModifiersDto, archive = true) {
      const dish = await tx.dish.findUnique({ where: { id: dishId }, include: { recipeItems: true, variants: true, modifierGroups: { include: { options: true } } } });
      if (!dish) throw new NotFoundException('Блюдо не найдено');
      if (archive) await tx.recipeRevision.upsert({ where: { dishId_version: { dishId, version: dish.recipeVersion } }, update: {}, create: { dishId, version: dish.recipeVersion, snapshot: JSON.parse(JSON.stringify({ modifierGroups: dish.modifierGroups, allowIngredientExclusions: dish.allowIngredientExclusions, metadata: dish.recipeMetadata, stockIngredientId: dish.stockIngredientId, stockAmount: dish.stockAmount, items: dish.recipeItems, variants: dish.variants })) } });
      const groupIds = new Set(dish.modifierGroups.map((group) => group.id)), optionIds = new Set(dish.modifierGroups.flatMap((group) => group.options.map((option) => option.id)));
      const keptGroups: string[] = [], seenOptions = new Set<string>();
      for (const [groupIndex, input] of dto.groups.entries()) {
        if (!input.name.trim() || (input.id && (!groupIds.has(input.id) || keptGroups.includes(input.id)))) throw new BadRequestException('Проверьте название и идентификатор группы');
        if (input.maxSelections != null && input.maxSelections < (input.minSelections ?? 0)) throw new BadRequestException('Максимум добавок меньше минимума');
        const data = { dishId, name: input.name.trim(), minSelections: input.minSelections ?? 0, maxSelections: input.maxSelections ?? null, sortOrder: input.sortOrder ?? groupIndex };
        const group = input.id ? await tx.menuModifierGroup.update({ where: { id: input.id }, data }) : await tx.menuModifierGroup.create({ data });
        keptGroups.push(group.id);
        const keptOptions: string[] = [];
        for (const [optionIndex, option] of input.options.entries()) {
          if (!option.name.trim() || (option.id && (!optionIds.has(option.id) || seenOptions.has(option.id)))) throw new BadRequestException('Проверьте название и идентификатор добавки');
          if (option.id) seenOptions.add(option.id);
          let amount = new Prisma.Decimal(0), unit: UnitCode = 'pcs';
          if (option.ingredientId) {
            const ingredient = await tx.ingredient.findFirst({ where: { id: option.ingredientId, isActive: true } });
            if (!ingredient) throw new BadRequestException('Складская позиция добавки недоступна');
            unit = normalizeUnit(option.unit ?? ingredient.displayUnit); assertUnitMatchesType(unit, ingredient.unitType);
            amount = new Prisma.Decimal(option.amount ?? 0).mul(toBase(1, unit)).toDecimalPlaces(3);
            if (amount.lte(0) || amount.gte(100000000000)) throw new BadRequestException('Укажите расход продукта для добавки');
          }
          if (option.warehouseId && !await tx.warehouse.findUnique({ where: { id: option.warehouseId } })) throw new BadRequestException('Склад добавки не найден');
          const data = { groupId: group.id, name: option.name.trim(), price: new Prisma.Decimal(option.price), ingredientId: option.ingredientId ?? null,
            amount, amountUnit: unit, fromCommonWarehouse: option.fromCommonWarehouse ?? false, warehouseId: option.warehouseId ?? null,
            maxQuantity: option.maxQuantity ?? 1, isActive: option.isActive ?? true, sortOrder: option.sortOrder ?? optionIndex };
          const saved = option.id ? await tx.menuModifierOption.update({ where: { id: option.id }, data }) : await tx.menuModifierOption.create({ data });
          keptOptions.push(saved.id);
        }
        if (input.options.filter((option) => option.isActive !== false).reduce((sum, option) => sum + (option.maxQuantity ?? 1), 0) < (input.minSelections ?? 0)) throw new BadRequestException('Недостаточно доступных добавок для обязательного выбора');
        await tx.menuModifierOption.deleteMany({ where: { groupId: group.id, id: { notIn: keptOptions } } });
      }
      await tx.menuModifierGroup.deleteMany({ where: { dishId, id: { notIn: keptGroups } } });
      await tx.dish.update({ where: { id: dishId }, data: { allowIngredientExclusions: dto.allowIngredientExclusions, ...(archive ? { recipeVersion: { increment: 1 } } : {}) } });
  }
}

@Controller('admin/warehouse/dishes')
@Roles(Role.OWNER, Role.ADMIN, Role.KITCHEN, Role.BAR)
@RequirePermission('sections.warehouse')
export class MenuModifiersController {
  constructor(private modifiers: MenuModifiersService) {}
  @Get(':id/modifiers') get(@Param('id') id: string) { return this.modifiers.get(id); }
  @Put(':id/modifiers') @RequirePermission('actions.warehouseRecipes')
  save(@Param('id') id: string, @Body() dto: MenuModifiersDto) { return this.modifiers.save(id, dto); }
}
