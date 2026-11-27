import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { categoryImageRef } from './category-image';
import { decodeDishImage } from '../dishes/dish-image';
import { mainMenuCategoryId } from '../admin/main-menu-category';
import { visibleMenuCategory } from './menu-visibility';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const categories = await this.prisma.category.findMany({
      where: visibleMenuCategory,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        parentId: true,
        imageKey: true,
        name: true,
        sortOrder: true,
        prepStation: true,
        dishes: {
          where: { isActive: true, archivedAt: null },
          select: { popularityScore: true },
        },
      },
    });

    const visible = new Map(categories.map((category) => [category.id, category]));
    const root = mainMenuCategoryId();
    return categories
      .map(({ dishes, ...category }) => ({
        ...category,
        popularityScore: dishes.reduce((sum, dish) => sum + dish.popularityScore, 0),
      }))
      .sort((a, b) => b.popularityScore - a.popularityScore || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map(({ popularityScore, imageKey, ...category }) => {
        const ancestors: { id: string; name: string }[] = [];
        const visited = new Set([category.id]);
        let parent = category.parentId ? visible.get(category.parentId) : undefined;
        while (parent && parent.id !== root && !visited.has(parent.id)) {
          visited.add(parent.id);
          ancestors.push(parent);
          parent = parent.parentId ? visible.get(parent.parentId) : undefined;
        }
        ancestors.reverse();
        return { ...category, parentId: ancestors.at(-1)?.id ?? null, ancestorIds: ancestors.map(({ id }) => id),
          pathLabel: [...ancestors.map(({ name }) => name), category.name].join(' / '), imageUrl: categoryImageRef(category.id, imageKey) };
      });
  }

  async image(id: string, version?: string) {
    if (!version || !/^[0-9a-f-]{36}$/i.test(version)) return null;
    const category = await this.prisma.category.findFirst({ where: { id, imageKey: version, archivedAt: null }, select: { imageUrl: true } });
    return decodeDishImage(category?.imageUrl ?? null);
  }
}
