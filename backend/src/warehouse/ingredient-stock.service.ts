import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { fromBase, unitLabel, type UnitCode } from './units';

type OrderLine = { id?: string | null; dishId?: string | null; quantity?: number | null };

export type IngredientStockWarning = {
  ingredientId: string;
  ingredient: string;
  unit: string;
  needed: number;
  available: number;
  missing: number;
};

/**
 * Списание/возврат сырья по техкарте при продаже/отмене блюд.
 *
 * Вызывается ИЗ транзакций заказа (`orders.service.ts`) рядом с существующей
 * логикой остатков блюд (`deductInventory`/`restoreInventory`). Работает
 * независимо от `trackInventory`: списываются ингредиенты любого блюда, у
 * которого есть техкарта (RecipeItem). Блюда без техкарты пропускаются —
 * заказ при этом не ломается.
 *
 * Идемпотентность держится на StockMovement: одна позиция заказа
 * (orderItemId) может списать/вернуть конкретный ингредиент только один раз.
 */
@Injectable()
export class IngredientStockService {
  /** Списание ингредиентов при продаже блюд. */
  async applyDishSale(
    tx: Prisma.TransactionClient,
    orderId: string,
    lines: OrderLine[],
  ): Promise<IngredientStockWarning[]> {
    return this.applyMovement(tx, orderId, lines, 'sale');
  }

  /** Возврат ингредиентов при отмене заказа / отказе позиции. */
  async restoreDishSale(
    tx: Prisma.TransactionClient,
    orderId: string,
    lines: OrderLine[],
  ): Promise<IngredientStockWarning[]> {
    return this.applyMovement(tx, orderId, lines, 'return');
  }

  private async applyMovement(
    tx: Prisma.TransactionClient,
    orderId: string,
    lines: OrderLine[],
    direction: 'sale' | 'return',
  ): Promise<IngredientStockWarning[]> {
    const normalizedLines = lines.filter((line) => line.dishId && line.quantity && line.quantity > 0);
    if (normalizedLines.length === 0) return [];

    const dishIds = [...new Set(normalizedLines.map((line) => line.dishId).filter((id): id is string => !!id))];
    const recipeItems = await tx.recipeItem.findMany({
      where: { dishId: { in: dishIds } },
      include: {
        dish: { select: { name: true } },
        ingredient: { select: { id: true, name: true, displayUnit: true, stock: true, avgCost: true } },
      },
    });
    if (recipeItems.length === 0) return [];

    const recipeByDish = new Map<string, typeof recipeItems>();
    for (const ri of recipeItems) {
      const list = recipeByDish.get(ri.dishId) ?? [];
      list.push(ri);
      recipeByDish.set(ri.dishId, list);
    }

    const type: StockMovementType = direction === 'sale' ? 'sale' : 'return';
    const lineIds = normalizedLines.map((line) => line.id).filter((id): id is string => !!id);
    const existingKeys = new Set<string>();
    if (lineIds.length > 0) {
      const existing = await tx.stockMovement.findMany({
        where: {
          type,
          sourceType: 'order',
          sourceId: orderId,
          orderItemId: { in: lineIds },
        },
        select: { orderItemId: true, ingredientId: true },
      });
      for (const movement of existing) {
        if (movement.orderItemId) {
          existingKeys.add(`${movement.orderItemId}:${movement.ingredientId}`);
        }
      }
    }

    const planned: Array<{
      line: OrderLine;
      recipeItem: (typeof recipeItems)[number];
      qty: number;
    }> = [];

    for (const line of normalizedLines) {
      if (!line.dishId || !line.quantity) continue;
      for (const ri of recipeByDish.get(line.dishId) ?? []) {
        if (line.id && existingKeys.has(`${line.id}:${ri.ingredientId}`)) continue;
        const qty = Number(ri.amount) * line.quantity;
        if (qty > 0) planned.push({ line, recipeItem: ri, qty });
      }
    }
    if (planned.length === 0) return [];

    if (direction === 'sale') {
      const warnings = await this.shortages(tx, planned);
      if (warnings.length > 0) {
        const settings = await tx.settings.upsert({
          where: { id: 'default' },
          update: {},
          create: { id: 'default' },
          select: { allowNegativeIngredientStock: true },
        });
        if (!settings.allowNegativeIngredientStock) {
          throw new BadRequestException({
            message: 'Недостаточно сырья',
            shortages: warnings,
          });
        }
        await this.createMovements(tx, orderId, planned, direction);
        return warnings;
      }
    }

    await this.createMovements(tx, orderId, planned, direction);
    return [];
  }

  private async shortages(
    tx: Prisma.TransactionClient,
    planned: Array<{
      recipeItem: {
        ingredientId: string;
        ingredient: { name: string; displayUnit: string; stock: Prisma.Decimal };
      };
      qty: number;
    }>,
  ): Promise<IngredientStockWarning[]> {
    // needed/available — в базовых единицах (qty и stock уже в базе).
    const neededByIngredient = new Map<
      string,
      { ingredient: string; displayUnit: UnitCode; needed: number; available: number }
    >();
    for (const row of planned) {
      const current = neededByIngredient.get(row.recipeItem.ingredientId) ?? {
        ingredient: row.recipeItem.ingredient.name,
        displayUnit: row.recipeItem.ingredient.displayUnit as UnitCode,
        needed: 0,
        available: Number(row.recipeItem.ingredient.stock),
      };
      current.needed += row.qty;
      neededByIngredient.set(row.recipeItem.ingredientId, current);
    }

    const warnings: IngredientStockWarning[] = [];
    for (const [ingredientId, row] of neededByIngredient.entries()) {
      if (row.needed <= row.available) continue;
      // В предупреждение отдаём display-единицу (понятнее официанту/админу).
      warnings.push({
        ingredientId,
        ingredient: row.ingredient,
        unit: unitLabel(row.displayUnit),
        needed: round3(fromBase(row.needed, row.displayUnit)),
        available: round3(fromBase(row.available, row.displayUnit)),
        missing: round3(fromBase(row.needed - row.available, row.displayUnit)),
      });
    }
    return warnings;
  }

  private async createMovements(
    tx: Prisma.TransactionClient,
    orderId: string,
    planned: Array<{
      line: OrderLine;
      recipeItem: {
        ingredientId: string;
        dish: { name: string };
      };
      qty: number;
    }>,
    direction: 'sale' | 'return',
  ) {
    for (const line of planned) {
      const ri = line.recipeItem;
      const qty = line.qty;

      // Берём актуальный остаток/себестоимость внутри транзакции.
      const ingredient = await tx.ingredient.findUnique({
        where: { id: ri.ingredientId },
        select: { stock: true, avgCost: true },
      });
      if (!ingredient) continue;

      const before = Number(ingredient.stock);
      const sign = direction === 'sale' ? -1 : 1;
      const change = sign * qty;
      const after = before + change;
      const avgCost = Number(ingredient.avgCost);

      await tx.ingredient.update({
        where: { id: ri.ingredientId },
        data: { stock: new Prisma.Decimal(after) },
      });

      const comment =
        direction === 'sale'
          ? `Списание по техкарте: ${ri.dish.name} × ${line.line.quantity}`
          : `Возврат по отмене/отказу: ${ri.dish.name} × ${line.line.quantity}`;

      await tx.stockMovement.create({
        data: {
          ingredientId: ri.ingredientId,
          orderItemId: line.line.id ?? null,
          type: direction === 'sale' ? 'sale' : 'return',
          sourceType: 'order',
          sourceId: orderId,
          beforeStock: new Prisma.Decimal(before),
          change: new Prisma.Decimal(change),
          afterStock: new Prisma.Decimal(after),
          costAtMoment: new Prisma.Decimal(avgCost),
          comment,
        },
      });
    }
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
