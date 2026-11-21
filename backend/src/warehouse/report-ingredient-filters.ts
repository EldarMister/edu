import type { Prisma } from '@prisma/client';
import type { WarehouseReportQuery } from './reports.dto';

export function reportIngredientFilters({ kind, kinds, category, categories }: WarehouseReportQuery): Prisma.IngredientWhereInput {
  const selectedKinds = kinds?.length ? kinds : kind ? [kind] : [];
  const selectedCategories = categories?.length ? categories : category ? [category] : [];
  return {
    ...(selectedKinds.length ? { kind: { in: selectedKinds } } : {}),
    ...(selectedCategories.length ? { category: { in: selectedCategories } } : {}),
  };
}
