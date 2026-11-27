import type { Prisma } from '@prisma/client';

export const visibleMenuCategory = { isActive: true, archivedAt: null } satisfies Prisma.CategoryWhereInput;

export const visibleMenuDish = {
  isActive: true,
  archivedAt: null,
  category: visibleMenuCategory,
} satisfies Prisma.DishWhereInput;
