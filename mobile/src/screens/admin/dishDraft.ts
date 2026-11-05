type Variant = { id?: string; name: string; price: string; stock: string; unit: string };

/** The base weighted price is independent of the fixed-size variant prices. */
export function initialDishPrice(dish: { price: string | number; isWeighted?: boolean; variants: unknown[] } | null): string {
  return dish ? (dish.variants.length > 0 && !dish.isWeighted ? '' : String(Number(dish.price))) : '';
}

/** Match the PWA editor: changing weight mode never deletes variants or inventory. */
export function dishInventoryPayload({ isEdit, priceValue, stock, unit, variants }: {
  isEdit: boolean; priceValue?: number; stock: string; unit: string; variants: Variant[];
}) {
  return {
    trackInventory: variants.length > 0 ? variants.some(v => v.stock.trim() !== '') : stock.trim() !== '',
    stock: priceValue !== undefined && stock.trim() ? Number(stock) : undefined,
    initialStock: !isEdit && priceValue !== undefined && stock.trim() ? Number(stock) : undefined,
    unit: priceValue !== undefined ? unit : undefined,
    variants: variants.map(v => ({
      id: v.id,
      name: v.name,
      price: Number(v.price),
      stock: v.stock.trim() ? Number(v.stock) : undefined,
      initialStock: (!isEdit || !v.id) && v.stock.trim() ? Number(v.stock) : undefined,
      unit: v.unit,
    })),
  };
}
