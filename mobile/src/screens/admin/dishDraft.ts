type Variant = { id?: string; name: string; price: string; unit: string };

/** The base weighted price is independent of the fixed-size variant prices. */
export function initialDishPrice(dish: { price: string | number; isWeighted?: boolean; variants: unknown[] } | null): string {
  return dish ? (dish.variants.length > 0 && !dish.isWeighted ? '' : String(Number(dish.price))) : '';
}

/** Inventory belongs to stock documents. Omitted legacy balances/bindings stay on the server. */
export function dishVariantPayload({ unit, variants }: {
  unit: string; variants: Variant[];
}) {
  return {
    unit,
    variants: variants.map(v => ({
      id: v.id,
      name: v.name,
      price: Number(v.price.trim().replace(',', '.')),
      unit: v.unit,
    })),
  };
}
