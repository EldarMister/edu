export interface InventoryScopeProduct {
  id: string;
  name: string;
  kind?: string;
  category?: string | null;
  barcode?: string | null;
}

const INVENTORY_GROUPS = [
  { id: 'ingredients', name: 'Ингредиенты' },
  { id: 'prepared', name: 'Полуфабрикаты и заготовленные блюда' },
  { id: 'goods', name: 'Товары' },
] as const;

export function inventoryScopeGroups<T extends InventoryScopeProduct>(products: T[], search = '') {
  const query = search.trim().toLocaleLowerCase('ru');
  return INVENTORY_GROUPS.map((group) => {
    const items = products.filter((item) => {
      const id = item.kind === 'goods' || item.kind === 'beverage' ? 'goods'
        : item.kind === 'preparation' || item.kind === 'prepared_dish' ? 'prepared' : 'ingredients';
      return id === group.id && (!query || `${item.name} ${item.category ?? ''} ${item.barcode ?? ''}`.toLocaleLowerCase('ru').includes(query));
    }).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const categories = [...new Set(items.map((item) => item.category?.trim() || 'Без категории'))].sort((a, b) => a.localeCompare(b, 'ru'));
    return { ...group, items, categories: categories.map((name) => ({ name, items: items.filter((item) => (item.category?.trim() || 'Без категории') === name) })) };
  });
}

/** Toggle only the indicated scope. Other selections survive searches and collapsed branches. */
export function toggleInventoryScope(selected: string[], ids: string[], checked: boolean) {
  const changed = new Set(ids);
  return checked ? [...new Set([...selected, ...ids])] : selected.filter((id) => !changed.has(id));
}

export type InventoryCountFilter = '' | 'uncounted' | 'differences' | 'shortage' | 'surplus';
export interface InventoryCountValue { quantity: number | null; difference: number | null; value: number | null }

export function inventoryCountMatches(row: InventoryCountValue, filter: InventoryCountFilter) {
  if (!filter) return true;
  if (filter === 'uncounted') return row.quantity === null;
  if (row.quantity === null || row.difference === null) return false;
  const roundedDifference = Math.round(Math.abs(row.difference) * 1_000_000) / 1_000_000;
  if (!roundedDifference) return false;
  if (filter === 'shortage') return row.difference < 0;
  if (filter === 'surplus') return row.difference > 0;
  return true;
}

export function inventoryCountSummary(rows: InventoryCountValue[]) {
  const shortage = rows.filter((row) => inventoryCountMatches(row, 'shortage'));
  const surplus = rows.filter((row) => inventoryCountMatches(row, 'surplus'));
  const sum = (items: InventoryCountValue[]) => items.some((row) => row.value === null) ? null
    : Math.round(items.reduce((value, row) => value + Math.abs(row.value ?? 0), 0) * 100) / 100;
  return { total: rows.length, counted: rows.filter((row) => row.quantity !== null).length,
    uncounted: rows.filter((row) => row.quantity === null).length, shortage: shortage.length, surplus: surplus.length,
    shortageValue: sum(shortage), surplusValue: sum(surplus) };
}

/** Keep small real discrepancies visible, while suppressing floating-point noise and negative zero. */
export function inventoryQuantity(value: number, unit: string, signed = false) {
  const rounded = Math.round(Math.abs(value) * 1_000_000) / 1_000_000;
  const sign = rounded === 0 ? '' : value < 0 ? '−' : signed ? '+' : '';
  return `${sign}${rounded.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} ${unit}`;
}
