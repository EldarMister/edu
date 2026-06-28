import type { CartLine, CartSetComponent, Dish } from '@/types';
import { makeIdempotencyKey } from './format';

/** Состав сета по умолчанию, как в PWA SetSheets.defaultSetComponents. */
export function defaultSetComponents(dish: Dish): CartSetComponent[] {
  return (dish.setComponents ?? []).map((c) => ({
    componentId: c.id,
    originalDishId: c.dish.id,
    originalVariantId: c.dishVariantId ?? undefined,
    originalName: c.dishVariant ? `${c.dish.name} ${c.dishVariant.name}` : c.dish.name,
    originalPrice: c.dishVariant?.price ?? c.dish.price,
    quantity: c.quantity,
    removable: c.removable,
    replaceable: c.replaceable,
    action: 'default',
  }));
}

/** Итоговая цена сета с учётом удаления/замены компонентов. */
export function calcSetPrice(basePrice: string, components: CartSetComponent[]): number {
  let delta = 0;
  for (const component of components) {
    if (component.action === 'removed') {
      delta -= Number(component.originalPrice) * component.quantity;
    } else if (component.action === 'replaced' && component.finalPrice !== undefined) {
      delta += (Number(component.finalPrice) - Number(component.originalPrice)) * component.quantity;
    }
  }
  return Math.max(0, Number(basePrice) + delta);
}

export function setChanged(line: CartLine): boolean {
  return !!line.set?.components.some((component) => component.action !== 'default');
}

/** Строит линию корзины для сета. */
export function buildSetLine(dish: Dish, components: CartSetComponent[] = defaultSetComponents(dish)): CartLine {
  return {
    dish,
    quantity: 1,
    lineId: makeIdempotencyKey(),
    set: { components },
  };
}
