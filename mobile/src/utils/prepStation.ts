import type { Category, CartLine, Dish, PrepStation } from '@/types';

/** Карта «категория -> направление»; по умолчанию backend/PWA считают кухню. */
export function stationByCategory(categories: Category[]): Map<string, PrepStation> {
  return new Map(categories.map((category) => [category.id, category.prepStation ?? 'kitchen']));
}

/** Итоговое направление блюда: приоритет у блюда, иначе у категории. */
export function dishStation(
  dish: Pick<Dish, 'prepStation' | 'categoryId'>,
  byCategory: Map<string, PrepStation>,
): PrepStation {
  return dish.prepStation ?? byCategory.get(dish.categoryId) ?? 'kitchen';
}

/** Какие направления есть в корзине. */
export function cartStations(
  lines: CartLine[],
  categories: Category[],
): { kitchen: boolean; bar: boolean; none: boolean; hasPrep: boolean; multipleOrCustom: boolean } {
  const byCategory = stationByCategory(categories);
  const stations = new Set<PrepStation>();
  for (const line of lines) {
    stations.add(dishStation(line.dish, byCategory));
  }
  const none = stations.delete('none');
  const kitchen = stations.has('kitchen');
  const bar = stations.has('bar');
  return { kitchen, bar, none, hasPrep: stations.size > 0, multipleOrCustom: stations.size > 1 || (stations.size > 0 && !kitchen && !bar) };
}
