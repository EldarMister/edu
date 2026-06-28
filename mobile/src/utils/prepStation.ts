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
): { kitchen: boolean; bar: boolean; none: boolean; hasPrep: boolean } {
  const byCategory = stationByCategory(categories);
  let kitchen = false;
  let bar = false;
  let none = false;
  for (const line of lines) {
    const station = dishStation(line.dish, byCategory);
    if (station === 'kitchen') kitchen = true;
    else if (station === 'bar') bar = true;
    else none = true;
  }
  return { kitchen, bar, none, hasPrep: kitchen || bar };
}
