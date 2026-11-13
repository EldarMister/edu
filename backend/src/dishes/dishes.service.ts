import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decodeDishImage, dishImageRef } from './dish-image';
import { MenuModifiersService } from '../warehouse/menu-modifiers';
import { projectDishStock } from '../warehouse/dish-stock-projection';

@Injectable()
export class DishesService {
  constructor(private prisma: PrismaService) {}

  modifiers(id: string) { return new MenuModifiersService(this.prisma).get(id, true); }

  /** Активные блюда для меню официанта. Можно фильтровать по категории и поиску. */
  async findAll(params: { categoryId?: string; search?: string }) {
    const where: Prisma.DishWhereInput = {
      isActive: true,
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.search
        ? { name: { contains: params.search, mode: 'insensitive' } }
        : {}),
    };

    const dishes = await this.prisma.dish.findMany({
      where,
      // Популярность — главный ключ: в «Все» самые заказываемые блюда поднимаются
      // наверх по всему меню. Раньше первичной была сортировка по categoryId, из-за
      // чего «Все» показывал просто первую по uuid категорию, игнорируя популярность.
      orderBy: [{ popularityScore: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        categoryId: true,
        name: true,
        description: true,
        price: true,
        imageUrl: true,
        updatedAt: true,
        discountType: true,
        discountValue: true,
        isAvailable: true,
        isSet: true,
        isWeighted: true,
        allowIngredientExclusions: true,
        _count: { select: { modifierGroups: true } },
        weightedMeasure: true,
        weightedPriceBase: true,
        prepStation: true,
        category: { select: { prepStation: true } },
        stockIngredientId: true,
        stockAmount: true,
        variants: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            price: true,
            sortOrder: true,
            stockIngredientId: true,
            stockAmount: true,
          },
        },
        setComponents: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            quantity: true,
            removable: true,
            replaceable: true,
            dishVariantId: true,
            dish: { select: { id: true, name: true, price: true } },
            dishVariant: { select: { id: true, name: true, price: true } },
          },
        },
      },
    });

    // Вместо тяжёлого base64 отдаём лёгкую ссылку на картинку блюда.
    const stock = await projectDishStock(this.prisma, dishes);
    return dishes.map(({ updatedAt, stockIngredientId, stockAmount, category, _count, variants, ...d }) => ({
      ...d,
      trackInventory: stock.get(d.id)!.trackInventory,
      stock: stock.get(d.id)!.stock,
      variants: variants.map(({ stockIngredientId, stockAmount, ...variant }) => ({ ...variant, stock: stock.get(d.id)!.variantStocks.get(variant.id) ?? null })),
      hasModifiers: _count.modifierGroups > 0 || d.allowIngredientExclusions,
      imageUrl: dishImageRef(d.id, updatedAt, d.imageUrl),
    }));
  }

  /** Фото блюда как бинарь (для эндпоинта-картинки). */
  async getDishImage(id: string): Promise<{ buffer: Buffer; mime: string } | null> {
    const dish = await this.prisma.dish.findUnique({ where: { id }, select: { imageUrl: true } });
    return decodeDishImage(dish?.imageUrl ?? null);
  }
}
