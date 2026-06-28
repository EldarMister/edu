import type { CartLine, CartSetComponent, Dish, Order } from '@/types';

/** Восстанавливает заказ в линии корзины для режима редактирования. */
export function orderToCartLines(order: Order, dishes: Dish[]): CartLine[] {
  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));

  return order.items
    .filter((item) => item.status !== 'rejected' && item.status !== 'cancelled')
    .map((item): CartLine | null => {
      const dish = item.dishId ? dishById.get(item.dishId) : undefined;
      if (!dish) return null;

      if (dish.isSet && item.setComponents?.length) {
        const defKey = (dishId: string | null | undefined, variantName?: string | null) =>
          `${dishId ?? ''}|${variantName ?? ''}`;
        const defs = new Map(
          (dish.setComponents ?? []).map((component) => [
            defKey(component.dish.id, component.dishVariant?.name),
            component,
          ]),
        );

        const components: CartSetComponent[] = item.setComponents.map((component) => {
          const def = defs.get(defKey(component.originalDishId, component.originalVariantNameSnapshot));
          const finalDish = component.finalDishId ? dishById.get(component.finalDishId) : undefined;
          const originalName = component.originalVariantNameSnapshot
            ? `${component.originalNameSnapshot} ${component.originalVariantNameSnapshot}`
            : component.originalNameSnapshot;

          return {
            componentId: def?.id ?? component.id,
            originalDishId: component.originalDishId ?? '',
            originalVariantId: def?.dishVariant?.id,
            originalName,
            originalPrice: def?.dishVariant?.price ?? def?.dish.price ?? '0',
            quantity: component.quantity,
            removable: def?.removable ?? true,
            replaceable: def?.replaceable ?? true,
            action: component.action,
            finalDishId: component.finalDishId ?? undefined,
            finalName: component.finalNameSnapshot ?? undefined,
            finalPrice: finalDish?.price,
          };
        });

        return {
          dish,
          quantity: item.quantity,
          takeaway: item.takeaway ?? undefined,
          lineId: `set-edit-${item.id}`,
          set: { components },
        };
      }

      const variant = item.dishVariantId
        ? dish.variants.find((candidate) => candidate.id === item.dishVariantId)
        : undefined;

      return {
        dish,
        variant,
        quantity: item.quantity,
        comment: item.comment ?? undefined,
        takeaway: item.takeaway ?? undefined,
      };
    })
    .filter((line): line is CartLine => line !== null);
}
