import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecipeItemDto, UpdateRecipeItemDto } from './dto';
import {
  assertUnitMatchesType,
  costFromBase,
  costUnitLabel,
  fromBase,
  normalizeUnit,
  toBase,
  unitLabel,
  type UnitCode,
} from './units';

/**
 * Техкарта блюда: ингредиенты на 1 порцию. Количество хранится в базовых
 * единицах (amount), но вводится/показывается в выбранной единице (amountUnit).
 * foodCost = Σ(amountBase × avgCostBase) — единый базис, единицы не смешиваются.
 */
@Injectable()
export class RecipesService {
  constructor(private prisma: PrismaService) {}

  async getByDish(dishId: string) {
    const dish = await this.prisma.dish.findUnique({
      where: { id: dishId },
      select: { id: true, name: true, price: true },
    });
    if (!dish) throw new NotFoundException('Блюдо не найдено');

    const recipeItems = await this.prisma.recipeItem.findMany({
      where: { dishId },
      orderBy: { createdAt: 'asc' },
      include: {
        ingredient: {
          select: {
            id: true,
            name: true,
            unitType: true,
            displayUnit: true,
            avgCost: true,
            stock: true,
            lowStockThreshold: true,
            isActive: true,
          },
        },
      },
    });

    let foodCost = 0;
    const items = recipeItems.map((ri) => {
      const amountUnit = ri.amountUnit as UnitCode;
      const amountBase = Number(ri.amount);
      const avgCostBase = Number(ri.ingredient.avgCost);
      const lineCost = amountBase * avgCostBase; // в базе → корректная сумма
      foodCost += lineCost;
      const stockBase = Number(ri.ingredient.stock);
      const thresholdBase = Number(ri.ingredient.lowStockThreshold);
      return {
        id: ri.id,
        ingredientId: ri.ingredientId,
        name: ri.ingredient.name,
        // Вся строка — в единице amountUnit, чтобы числа были согласованы.
        unit: unitLabel(amountUnit),
        amountUnit,
        unitType: ri.ingredient.unitType,
        ingredientDisplayUnit: ri.ingredient.displayUnit,
        amount: round3(fromBase(amountBase, amountUnit)),
        avgCost: round2(costFromBase(avgCostBase, amountUnit)),
        costUnitLabel: costUnitLabel(amountUnit),
        lineCost: round2(lineCost),
        stock: round3(fromBase(stockBase, amountUnit)),
        isLow: stockBase <= thresholdBase,
        isActive: ri.ingredient.isActive,
      };
    });

    const price = Number(dish.price);
    const marginPercent = price > 0 ? ((price - foodCost) / price) * 100 : 0;

    return {
      dishId: dish.id,
      dishName: dish.name,
      price,
      foodCost: round2(foodCost),
      marginPercent,
      items,
    };
  }

  async addItem(dishId: string, dto: CreateRecipeItemDto) {
    const dish = await this.prisma.dish.findUnique({ where: { id: dishId }, select: { id: true } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: dto.ingredientId },
      select: { id: true, unitType: true, displayUnit: true },
    });
    if (!ingredient) throw new NotFoundException('Сырьё не найдено');

    const unit = dto.unit ? normalizeUnit(dto.unit) : (ingredient.displayUnit as UnitCode);
    assertUnitMatchesType(unit, ingredient.unitType as 'mass' | 'volume' | 'count');

    const exists = await this.prisma.recipeItem.findUnique({
      where: { dishId_ingredientId: { dishId, ingredientId: dto.ingredientId } },
    });
    if (exists) {
      throw new BadRequestException('Этот ингредиент уже есть в техкарте');
    }

    await this.prisma.recipeItem.create({
      data: {
        dishId,
        ingredientId: dto.ingredientId,
        amount: new Prisma.Decimal(toBase(dto.amount, unit)),
        amountUnit: unit,
      },
    });
    return this.getByDish(dishId);
  }

  async updateItem(id: string, dto: UpdateRecipeItemDto) {
    const item = await this.prisma.recipeItem.findUnique({
      where: { id },
      include: { ingredient: { select: { unitType: true } } },
    });
    if (!item) throw new NotFoundException('Строка техкарты не найдена');

    const unit = dto.unit ? normalizeUnit(dto.unit) : (item.amountUnit as UnitCode);
    assertUnitMatchesType(unit, item.ingredient.unitType as 'mass' | 'volume' | 'count');

    await this.prisma.recipeItem.update({
      where: { id },
      data: { amount: new Prisma.Decimal(toBase(dto.amount, unit)), amountUnit: unit },
    });
    return this.getByDish(item.dishId);
  }

  async removeItem(id: string) {
    const item = await this.prisma.recipeItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Строка техкарты не найдена');
    await this.prisma.recipeItem.delete({ where: { id } });
    return this.getByDish(item.dishId);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
