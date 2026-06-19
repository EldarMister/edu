import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IngredientUnitType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdjustIngredientDto, CreateIngredientDto, UpdateIngredientDto } from './dto';
import {
  assertUnitMatchesType,
  baseUnitForType,
  costFromBase,
  costToBase,
  costUnitLabel,
  fromBase,
  normalizeUnit,
  toBase,
  unitLabel,
  unitType as unitTypeOf,
  type UnitCode,
} from './units';

type IngredientRow = {
  id: string;
  name: string;
  unitType: IngredientUnitType;
  displayUnit: string;
  stock: Prisma.Decimal;
  avgCost: Prisma.Decimal;
  lowStockThreshold: Prisma.Decimal;
  isActive: boolean;
};

/**
 * Сырьё (ингредиенты). Всё в БД — в базовых единицах (g|ml|pcs); конвертация в
 * display-единицу админа происходит на границе (serialize / парсинг ввода).
 * Низкий остаток: stockBase <= lowStockThresholdBase.
 */
@Injectable()
export class IngredientsService {
  constructor(private prisma: PrismaService) {}

  private serialize(i: IngredientRow) {
    const display = i.displayUnit as UnitCode;
    const stockBase = Number(i.stock);
    const thresholdBase = Number(i.lowStockThreshold);
    const avgCostBase = Number(i.avgCost);
    return {
      id: i.id,
      name: i.name,
      unitType: i.unitType,
      baseUnit: baseUnitForType(i.unitType as 'mass' | 'volume' | 'count'),
      displayUnit: display,
      unit: unitLabel(display), // кириллица для UI
      // Значения в display-единице — то, что видит и вводит админ.
      stock: round3(fromBase(stockBase, display)),
      avgCost: round2(costFromBase(avgCostBase, display)), // за display-единицу (напр. 400 с/кг)
      lowStockThreshold: round3(fromBase(thresholdBase, display)),
      costUnitLabel: costUnitLabel(display),
      // Базовые значения — для тех, кому нужна «сырая» цифра.
      stockBase: round3(stockBase),
      avgCostBase,
      isActive: i.isActive,
      isLow: stockBase <= thresholdBase,
    };
  }

  async findAll(params: { search?: string; includeInactive?: boolean }) {
    const where: Prisma.IngredientWhereInput = {
      ...(params.includeInactive ? {} : { isActive: true }),
      ...(params.search ? { name: { contains: params.search, mode: 'insensitive' } } : {}),
    };
    const items = await this.prisma.ingredient.findMany({ where, orderBy: { name: 'asc' } });
    return items.map((i) => this.serialize(i));
  }

  async overview() {
    const active = await this.prisma.ingredient.findMany({
      where: { isActive: true },
      select: { displayUnit: true, stock: true, avgCost: true, lowStockThreshold: true },
    });
    const totalIngredients = active.length;
    let lowStockCount = 0;
    let costSum = 0;
    for (const i of active) {
      if (Number(i.stock) <= Number(i.lowStockThreshold)) lowStockCount++;
      // Себестоимость приводим к display-единице, чтобы среднее было в человеко-масштабе.
      costSum += costFromBase(Number(i.avgCost), i.displayUnit as UnitCode);
    }
    const avgCost = totalIngredients > 0 ? round2(costSum / totalIngredients) : 0;
    return { totalIngredients, lowStockCount, avgCost };
  }

  async create(dto: CreateIngredientDto) {
    const unit = normalizeUnit(dto.unit);
    const type = unitTypeOf(unit);
    const ingredient = await this.prisma.ingredient.create({
      data: {
        name: dto.name.trim(),
        unitType: type as IngredientUnitType,
        displayUnit: unit,
        stock: new Prisma.Decimal(toBase(dto.stock ?? 0, unit)),
        avgCost: new Prisma.Decimal(costToBase(dto.avgCost ?? 0, unit)),
        lowStockThreshold: new Prisma.Decimal(toBase(dto.lowStockThreshold ?? 0, unit)),
      },
    });
    return this.serialize(ingredient);
  }

  async update(id: string, dto: UpdateIngredientDto) {
    const current = await this.ensure(id);
    // Единица, в которой админ прислал значения (новая, если меняет; иначе текущая).
    const unit = dto.unit !== undefined ? normalizeUnit(dto.unit) : (current.displayUnit as UnitCode);
    const type = unitTypeOf(unit);

    const data: Prisma.IngredientUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.unit !== undefined) {
      data.displayUnit = unit;
      data.unitType = type as IngredientUnitType;
    }
    if (dto.stock !== undefined) data.stock = new Prisma.Decimal(toBase(dto.stock, unit));
    if (dto.avgCost !== undefined) data.avgCost = new Prisma.Decimal(costToBase(dto.avgCost, unit));
    if (dto.lowStockThreshold !== undefined)
      data.lowStockThreshold = new Prisma.Decimal(toBase(dto.lowStockThreshold, unit));
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const beforeStockBase = Number(current.stock);
    const afterStockBase = dto.stock !== undefined ? toBase(dto.stock, unit) : beforeStockBase;
    const beforeCostBase = Number(current.avgCost);
    const afterCostBase = dto.avgCost !== undefined ? costToBase(dto.avgCost, unit) : beforeCostBase;
    const stockChanged = dto.stock !== undefined && beforeStockBase !== afterStockBase;
    const costChanged = dto.avgCost !== undefined && beforeCostBase !== afterCostBase;

    const ingredient = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ingredient.update({ where: { id }, data });
      if (stockChanged || costChanged) {
        const comments: string[] = [];
        if (stockChanged)
          comments.push(`остаток: ${fmt(fromBase(beforeStockBase, unit))} -> ${fmt(fromBase(afterStockBase, unit))} ${unitLabel(unit)}`);
        if (costChanged)
          comments.push(`себестоимость: ${fmt(costFromBase(beforeCostBase, unit))} -> ${fmt(costFromBase(afterCostBase, unit))} ${costUnitLabel(unit)}`);
        await tx.stockMovement.create({
          data: {
            ingredientId: id,
            type: 'correction',
            sourceType: 'manual',
            sourceId: null,
            beforeStock: new Prisma.Decimal(beforeStockBase),
            change: new Prisma.Decimal(afterStockBase - beforeStockBase),
            afterStock: new Prisma.Decimal(afterStockBase),
            costAtMoment: new Prisma.Decimal(afterCostBase),
            comment: `Ручная корректировка (${comments.join(', ')})`,
          },
        });
      }
      return updated;
    });
    return this.serialize(ingredient);
  }

  /** Ручная корректировка остатка: добавить / списать / установить (ТЗ §8). */
  async adjust(id: string, dto: AdjustIngredientDto) {
    const current = await this.ensure(id);
    const unit = normalizeUnit(dto.unit);
    assertUnitMatchesType(unit, current.unitType as 'mass' | 'volume' | 'count');
    const qtyBase = toBase(dto.quantity, unit);
    const beforeBase = Number(current.stock);

    let afterBase: number;
    let comment: string;
    if (dto.mode === 'add') {
      afterBase = beforeBase + qtyBase;
      comment = `Ручное поступление: +${fmt(dto.quantity)} ${unitLabel(unit)}`;
    } else if (dto.mode === 'writeoff') {
      afterBase = beforeBase - qtyBase;
      if (afterBase < 0) {
        throw new BadRequestException('Нельзя списать больше текущего остатка');
      }
      comment = `Ручное списание: -${fmt(dto.quantity)} ${unitLabel(unit)}`;
    } else {
      afterBase = qtyBase;
      comment = `Установлен остаток: ${fmt(dto.quantity)} ${unitLabel(unit)}`;
    }

    const ingredient = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ingredient.update({
        where: { id },
        data: { stock: new Prisma.Decimal(afterBase) },
      });
      await tx.stockMovement.create({
        data: {
          ingredientId: id,
          type: 'correction',
          sourceType: 'manual',
          sourceId: null,
          beforeStock: new Prisma.Decimal(beforeBase),
          change: new Prisma.Decimal(afterBase - beforeBase),
          afterStock: new Prisma.Decimal(afterBase),
          costAtMoment: current.avgCost,
          comment,
        },
      });
      return updated;
    });
    return this.serialize(ingredient);
  }

  /**
   * Если сырьё используется в техкартах/закупках — деактивируем (isActive=false),
   * чтобы не сломать историю. Иначе удаляем физически.
   */
  async remove(id: string) {
    await this.ensure(id);
    const used = await this.prisma.recipeItem.count({ where: { ingredientId: id } });
    const purchased = await this.prisma.purchaseItem.count({ where: { ingredientId: id } });
    if (used > 0 || purchased > 0) {
      const ingredient = await this.prisma.ingredient.update({
        where: { id },
        data: { isActive: false },
      });
      return { ok: true, deactivated: true, ingredient: this.serialize(ingredient) };
    }
    await this.prisma.ingredient.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  private async ensure(id: string) {
    const ingredient = await this.prisma.ingredient.findUnique({ where: { id } });
    if (!ingredient) throw new NotFoundException('Сырьё не найдено');
    return ingredient;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
