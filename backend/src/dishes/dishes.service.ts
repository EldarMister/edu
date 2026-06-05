import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DishesService {
  constructor(private prisma: PrismaService) {}

  /** Активные блюда для меню официанта. Можно фильтровать по категории и поиску. */
  findAll(params: { categoryId?: string; search?: string }) {
    const where: Prisma.DishWhereInput = {
      isActive: true,
      ...(params.categoryId ? { categoryId: params.categoryId } : {}),
      ...(params.search
        ? { name: { contains: params.search, mode: 'insensitive' } }
        : {}),
    };

    return this.prisma.dish.findMany({
      where,
      orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        categoryId: true,
        name: true,
        description: true,
        price: true,
        imageUrl: true,
        discountType: true,
        discountValue: true,
        isAvailable: true,
      },
    });
  }
}
