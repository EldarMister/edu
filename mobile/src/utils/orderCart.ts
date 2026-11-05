import { waiterItemPermission, type WaiterOrderPermissions } from '@/lib/order-permissions';
import type { CartLine, CartSetComponent, Dish, Order } from '@/types';

/** Восстанавливает заказ в линии корзины для режима редактирования. */
export function orderToCartLines(order: Order, dishes: Dish[], policies?: WaiterOrderPermissions): CartLine[] {
  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));

  // Do not silently drop a live item: saving would cancel it on the server.
  if (order.items.some((item) => !['rejected', 'cancelled'].includes(item.status) && (!item.dishId || !dishById.has(item.dishId)))) return [];

  return order.items
    .filter((item) => item.status !== 'rejected' && item.status !== 'cancelled')
    .map((item): CartLine | null => {
      const dish = item.dishId ? dishById.get(item.dishId) : undefined;
      if (!dish) return null;
      const editPermission = waiterItemPermission(order, item, 'edit', policies);
      const cancelPermission = waiterItemPermission(order, item, 'cancel', policies);
      const origin = {
        orderItemId: item.id, lineId: `edit-${item.id}`,
        editAllowed: editPermission.allowed, cancelAllowed: cancelPermission.allowed,
        restrictionReason: !editPermission.allowed ? editPermission.reason : !cancelPermission.allowed ? cancelPermission.reason : undefined,
      };

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
          const finalVariant = component.finalVariantId
            ? finalDish?.variants.find((v) => v.id === component.finalVariantId)
            : undefined;
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
            finalVariantId: component.finalVariantId ?? undefined,
            finalName: component.finalNameSnapshot ?? undefined,
            finalPrice: finalVariant?.price ?? finalDish?.price,
          };
        });

        return {
          ...origin,
          dish,
          comment: item.comment ?? undefined,
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
        ...origin,
        dish,
        variant,
        weightGrams: item.weightGrams ?? undefined,
        quantity: item.quantity,
        comment: item.comment ?? undefined,
        takeaway: item.takeaway ?? undefined,
      };
    })
    .filter((line): line is CartLine => line !== null);
}
