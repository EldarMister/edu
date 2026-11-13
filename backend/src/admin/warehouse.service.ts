import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IngredientsService } from '../warehouse/ingredients.service';
import { projectDishStock } from '../warehouse/dish-stock-projection';

/** Compatibility endpoints for older clients. Quantities come exclusively from
 * the unified catalog; legacy Dish.stock fields are migration evidence only. */
@Injectable()
export class AdminWarehouseService {
  constructor(private prisma: PrismaService) {}

  async overview() {
    const items = await new IngredientsService(this.prisma).findAll({});
    return { totalProducts: items.length, totalDrinks: items.filter((item) => item.kind === 'beverage').length,
      lowStockCount: items.filter((item) => item.isLow).length,
      totalUnits: items.filter((item) => item.unitType === 'count').reduce((sum, item) => sum + item.stock, 0) };
  }

  async getItems(search?: string, categoryId?: string) {
    const dishes = await this.prisma.dish.findMany({
      where: { isActive: true, ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        ...(categoryId ? { categoryId } : {}), OR: [{ stockIngredientId: { not: null } }, { variants: { some: { stockIngredientId: { not: null } } } }] },
      orderBy: { name: 'asc' }, include: { category: { select: { id: true, name: true, prepStation: true } }, variants: { orderBy: { sortOrder: 'asc' } } },
    });
    const stock = await projectDishStock(this.prisma, dishes);
    return dishes.map((dish) => ({ ...dish, trackInventory: stock.get(dish.id)!.trackInventory, stock: stock.get(dish.id)!.stock,
      variants: dish.variants.map((variant) => ({ ...variant,
        stock: stock.get(dish.id)!.variantStocks.get(variant.id) ?? null })) }));
  }
}
