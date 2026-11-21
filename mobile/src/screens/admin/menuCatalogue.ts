import type { AdminDish } from '@/services/api/admin';

export type { MenuView } from '@/navigation/adminWorkspaceNavigation';
export function menuKind(dish: Pick<AdminDish, 'catalogKind' | 'hasDirectStock' | 'isSet'>): 'goods' | 'recipe' {
  if (dish.isSet) return 'recipe';
  return dish.catalogKind ?? (dish.hasDirectStock ? 'goods' : 'recipe');
}
export function filterMenuDishes(dishes: AdminDish[], view: 'goods' | 'recipes', availability = '') {
  return dishes.filter(dish => menuKind(dish) === (view === 'goods' ? 'goods' : 'recipe') &&
    (!availability || (availability === 'visible' ? dish.isAvailable && dish.isActive : !dish.isAvailable || !dish.isActive)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}
