import type { Category, CartLine, Dish, PrepStation } from '@/types';

/** Карта «категория → направление» (по умолчанию — кухня). */
export function stationByCategory(categories: Category[]): Map<string, PrepStation> {
  return new Map(categories.map((c) => [c.id, c.prepStation ?? 'kitchen']));
}

/** Итоговое направление блюда: приоритет у блюда, иначе — направление категории. */
export function dishStation(
  dish: Pick<Dish, 'prepStation' | 'categoryId'>,
  byCat: Map<string, PrepStation>,
): PrepStation {
  return dish.prepStation ?? byCat.get(dish.categoryId) ?? 'kitchen';
}

/**
 * Все ли позиции корзины — «Без отправки». Пустая корзина → false.
 * Используется, чтобы не показывать кухонные кнопки/тексты, когда готовить нечего.
 */
export function cartLinesAllNone(lines: CartLine[], categories: Category[]): boolean {
  if (lines.length === 0) return false;
  const byCat = stationByCategory(categories);
  return lines.every((l) => dishStation(l.dish, byCat) === 'none');
}
