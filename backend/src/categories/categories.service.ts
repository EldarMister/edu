import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        prepStation: true,
        dishes: {
          where: { isActive: true },
          select: { popularityScore: true },
        },
      },
    });

    return categories
      .map(({ dishes, ...category }) => ({
        ...category,
        popularityScore: dishes.reduce((sum, dish) => sum + dish.popularityScore, 0),
      }))
      .sort((a, b) => b.popularityScore - a.popularityScore || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map(({ popularityScore, ...category }) => category);
  }
}
