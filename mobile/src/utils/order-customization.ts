import type { OrderItem } from '@/types';

export function orderCustomizationText(item: Pick<OrderItem, 'modifierSelections' | 'excludedIngredientNames'>) {
  return [
    ...(item.modifierSelections ?? []).map(({ name, quantity, replacesIngredientName }) => replacesIngredientName
      ? `${replacesIngredientName} → ${name}` : `+ ${name}${quantity > 1 ? ` × ${quantity}` : ''}`),
    ...(item.excludedIngredientNames ?? []).map((name) => `Без ${name}`),
  ].join(' · ');
}
