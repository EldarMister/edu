import type { CartLine, CartSetComponent, Dish } from '@/types';
import { makeIdempotencyKey } from './format';

/** Строит линию корзины для сета с составом по умолчанию (без правок в v1 mobile). */
export function buildSetLine(dish: Dish): CartLine {
  const components: CartSetComponent[] = (dish.setComponents ?? []).map((c) => ({
    componentId: c.id,
    originalDishId: c.dish.id,
    originalVariantId: c.dishVariantId ?? undefined,
    originalName: c.dish.name + (c.dishVariant ? ` (${c.dishVariant.name})` : ''),
    originalPrice: c.dishVariant?.price ?? c.dish.price,
    quantity: c.quantity,
    removable: c.removable,
    replaceable: c.replaceable,
    action: 'default',
  }));
  return {
    dish,
    quantity: 1,
    lineId: makeIdempotencyKey(),
    set: { components },
  };
}
