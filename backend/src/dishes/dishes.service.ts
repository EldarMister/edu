import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decodeDishImage, dishImageRef } from './dish-image';

@Injectable()
export class DishesService {
  constructor(private prisma: PrismaService) {}

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
      orderBy: [{ categoryId: 'asc' }, { popularityScore: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
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
        variants: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            price: true,
            sortOrder: true,
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
    return dishes.map(({ updatedAt, ...d }) => ({
      ...d,
      imageUrl: dishImageRef(d.id, updatedAt, d.imageUrl),
    }));
  }

  /** Фото блюда как бинарь (для эндпоинта-картинки). */
  async getDishImage(id: string): Promise<{ buffer: Buffer; mime: string } | null> {
    const dish = await this.prisma.dish.findUnique({ where: { id }, select: { imageUrl: true } });
    return decodeDishImage(dish?.imageUrl ?? null);
  }
}
