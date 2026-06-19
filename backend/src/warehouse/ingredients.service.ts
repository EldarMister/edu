import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateIngredientDto, UpdateIngredientDto } from './dto';

/**
 * Сырьё (ингредиенты). Низкий остаток: stock <= lowStockThreshold.
 * Деньги/количества хранятся как Decimal — наружу отдаём числами.
 */
@Injectable()
export class IngredientsService {
  constructor(private prisma: PrismaService) {}

  private serialize(i: {
    id: string;
    name: string;
    unit: string;
    stock: Prisma.Decimal;
    avgCost: Prisma.Decimal;
    lowStockThreshold: Prisma.Decimal;
    isActive: boolean;
  }) {
    const stock = Number(i.stock);
    const threshold = Number(i.lowStockThreshold);
    return {
      id: i.id,
      name: i.name,
      unit: i.unit,
      stock,
      avgCost: Number(i.avgCost),
      lowStockThreshold: threshold,
      isActive: i.isActive,
      isLow: stock <= threshold,
    };
  }

  async findAll(params: { search?: string; includeInactive?: boolean }) {
    const where: Prisma.IngredientWhereInput = {
      ...(params.includeInactive ? {} : { isActive: true }),
      ...(params.search
        ? { name: { contains: params.search, mode: 'insensitive' } }
        : {}),
    };
    const items = await this.prisma.ingredient.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return items.map((i) => this.serialize(i));
  }

  async overview() {
    const active = await this.prisma.ingredient.findMany({
      where: { isActive: true },
      select: { stock: true, avgCost: true, lowStockThreshold: true },
    });
    const totalIngredients = active.length;
    let lowStockCount = 0;
    let costSum = 0;
    for (const i of active) {
      if (Number(i.stock) <= Number(i.lowStockThreshold)) lowStockCount++;
      costSum += Number(i.avgCost);
    }
    const avgCost = totalIngredients > 0 ? costSum / totalIngredients : 0;
    return { totalIngredients, lowStockCount, avgCost };
  }

  async create(dto: CreateIngredientDto) {
    const ingredient = await this.prisma.ingredient.create({
      data: {
        name: dto.name.trim(),
        unit: dto.unit.trim(),
        stock: new Prisma.Decimal(dto.stock ?? 0),
        avgCost: new Prisma.Decimal(dto.avgCost ?? 0),
        lowStockThreshold: new Prisma.Decimal(dto.lowStockThreshold ?? 0),
      },
    });
    return this.serialize(ingredient);
  }

  async update(id: string, dto: UpdateIngredientDto) {
    const current = await this.ensure(id);
    const data: Prisma.IngredientUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.unit !== undefined) data.unit = dto.unit.trim();
    if (dto.stock !== undefined) data.stock = new Prisma.Decimal(dto.stock);
    if (dto.avgCost !== undefined) data.avgCost = new Prisma.Decimal(dto.avgCost);
    if (dto.lowStockThreshold !== undefined)
      data.lowStockThreshold = new Prisma.Decimal(dto.lowStockThreshold);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const beforeStock = Number(current.stock);
    const afterStock = dto.stock !== undefined ? Number(dto.stock) : beforeStock;
    const beforeCost = Number(current.avgCost);
    const afterCost = dto.avgCost !== undefined ? Number(dto.avgCost) : beforeCost;
    const stockChanged = dto.stock !== undefined && beforeStock !== afterStock;
    const costChanged = dto.avgCost !== undefined && beforeCost !== afterCost;

    const ingredient = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ingredient.update({ where: { id }, data });
      if (stockChanged || costChanged) {
        const comments: string[] = [];
        if (stockChanged) comments.push(`остаток: ${beforeStock} -> ${afterStock}`);
        if (costChanged) comments.push(`себестоимость: ${beforeCost} -> ${afterCost}`);
        await tx.stockMovement.create({
          data: {
            ingredientId: id,
            type: 'correction',
            sourceType: 'manual',
            sourceId: null,
            beforeStock: new Prisma.Decimal(beforeStock),
            change: new Prisma.Decimal(afterStock - beforeStock),
            afterStock: new Prisma.Decimal(afterStock),
            costAtMoment: new Prisma.Decimal(afterCost),
            comment: `Ручная корректировка (${comments.join(', ')})`,
          },
        });
      }
      return updated;
    });
    return this.serialize(ingredient);
  }

  /**
   * Если сырьё используется в техкартах — деактивируем (isActive=false),
   * чтобы не сломать историю/блюда. Иначе удаляем физически.
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
