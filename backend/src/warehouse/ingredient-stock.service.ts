import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

type OrderLine = { dishId?: string | null; quantity?: number | null };

/**
 * Списание/возврат сырья по техкарте при продаже/отмене блюд.
 *
 * Вызывается ИЗ транзакций заказа (`orders.service.ts`) рядом с существующей
 * логикой остатков блюд (`deductInventory`/`restoreInventory`). Работает
 * независимо от `trackInventory`: списываются ингредиенты любого блюда, у
 * которого есть техкарта (RecipeItem). Блюда без техкарты пропускаются —
 * заказ при этом не ломается.
 *
 * Идемпотентность наследуется от точек жизненного цикла заказа: метод
 * вызывается в тех же местах, что и списание/возврат остатков блюд, поэтому
 * двойного списания/возврата не происходит.
 */
@Injectable()
export class IngredientStockService {
  /** Списание ингредиентов при продаже блюд. */
  async applyDishSale(tx: Prisma.TransactionClient, orderId: string, lines: OrderLine[]) {
    await this.applyMovement(tx, orderId, lines, 'sale');
  }

  /** Возврат ингредиентов при отмене заказа / отказе позиции. */
  async restoreDishSale(tx: Prisma.TransactionClient, orderId: string, lines: OrderLine[]) {
    await this.applyMovement(tx, orderId, lines, 'return');
  }

  private async applyMovement(
    tx: Prisma.TransactionClient,
    orderId: string,
    lines: OrderLine[],
    direction: 'sale' | 'return',
  ) {
    // Агрегируем количество порций по блюду.
    const portionsByDish = new Map<string, number>();
    for (const line of lines) {
      if (!line.dishId || !line.quantity) continue;
      portionsByDish.set(line.dishId, (portionsByDish.get(line.dishId) ?? 0) + line.quantity);
    }
    if (portionsByDish.size === 0) return;

    const dishIds = [...portionsByDish.keys()];
    const recipeItems = await tx.recipeItem.findMany({
      where: { dishId: { in: dishIds } },
      include: {
        dish: { select: { name: true } },
        ingredient: { select: { id: true, name: true } },
      },
    });
    if (recipeItems.length === 0) return;

    const sign = direction === 'sale' ? -1 : 1;
    const type: StockMovementType = direction === 'sale' ? 'sale' : 'return';

    for (const ri of recipeItems) {
      const portions = portionsByDish.get(ri.dishId) ?? 0;
      if (portions <= 0) continue;
      const qty = Number(ri.amount) * portions;
      if (qty <= 0) continue;

      // Берём актуальный остаток/себестоимость внутри транзакции.
      const ingredient = await tx.ingredient.findUnique({
        where: { id: ri.ingredientId },
        select: { stock: true, avgCost: true },
      });
      if (!ingredient) continue;

      const before = Number(ingredient.stock);
      const change = sign * qty;
      const after = before + change;
      const avgCost = Number(ingredient.avgCost);

      await tx.ingredient.update({
        where: { id: ri.ingredientId },
        data: { stock: new Prisma.Decimal(after) },
      });

      const comment =
        direction === 'sale'
          ? `Списание по техкарте: ${ri.dish.name} × ${portions}`
          : `Возврат по отмене/отказу: ${ri.dish.name} × ${portions}`;

      await tx.stockMovement.create({
        data: {
          ingredientId: ri.ingredientId,
          type,
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
