import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecipeItemDto, UpdateRecipeItemDto } from './dto';

/**
 * Техкарта блюда: ингредиенты на 1 порцию.
 * foodCost = Σ(amount × ingredient.avgCost); маржа = (price − foodCost)/price × 100.
 * Считается на лету (без кэша в БД).
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
            unit: true,
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
      const amount = Number(ri.amount);
      const avgCost = Number(ri.ingredient.avgCost);
      const lineCost = amount * avgCost;
      foodCost += lineCost;
      const stock = Number(ri.ingredient.stock);
      const threshold = Number(ri.ingredient.lowStockThreshold);
      return {
        id: ri.id,
        ingredientId: ri.ingredientId,
        name: ri.ingredient.name,
        unit: ri.ingredient.unit,
        amount,
        avgCost,
        lineCost,
        stock,
        isLow: stock <= threshold,
        isActive: ri.ingredient.isActive,
      };
    });

    const price = Number(dish.price);
    const marginPercent = price > 0 ? ((price - foodCost) / price) * 100 : 0;

    return {
      dishId: dish.id,
      dishName: dish.name,
      price,
      foodCost,
      marginPercent,
      items,
    };
  }

  async addItem(dishId: string, dto: CreateRecipeItemDto) {
    const dish = await this.prisma.dish.findUnique({ where: { id: dishId }, select: { id: true } });
    if (!dish) throw new NotFoundException('Блюдо не найдено');
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { id: dto.ingredientId },
      select: { id: true },
    });
    if (!ingredient) throw new NotFoundException('Сырьё не найдено');

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
        amount: new Prisma.Decimal(dto.amount),
      },
    });
    return this.getByDish(dishId);
  }

  async updateItem(id: string, dto: UpdateRecipeItemDto) {
    const item = await this.prisma.recipeItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Строка техкарты не найдена');
    await this.prisma.recipeItem.update({
      where: { id },
      data: { amount: new Prisma.Decimal(dto.amount) },
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
