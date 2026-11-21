import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AdminDish, DishInput } from './admin';
import type { PreparationProcessingMethod, RecipeItem } from './warehouse';
import type { UnitCode } from './warehouseUnits';

export interface MenuRecipeMetadata {
  instructions?: string;
  outputQuantity?: number;
  outputUnit?: string;
  photoUrl?: string;
}
export type MenuRecipeItem = RecipeItem & {
  baseAmount?: number;
  costKnown?: boolean;
  netAmount?: number | null;
  lossPercent?: number;
  processingMethod?: PreparationProcessingMethod | null;
  warehouseId?: string | null;
  variantAmounts?: Record<string, number>;
};
export interface MenuRecipeInput {
  metadata?: MenuRecipeMetadata;
  items: {
    ingredientId: string; amount: number; unit: UnitCode;
    netAmount?: number | null; lossPercent?: number; processingMethod?: PreparationProcessingMethod | null;
    fromCommonWarehouse?: boolean; warehouseId?: string | null; variantAmounts?: Record<string, number>;
  }[];
}
type MenuEntryDishInput = Omit<DishInput, 'stock' | 'initialStock' | 'trackInventory' | 'voiceName' | 'variants'> & {
  voiceName?: string | null;
  variants?: (NonNullable<DishInput['variants']>[number] & { clientKey?: string })[];
};
export interface MenuEntry {
  dish: AdminDish;
  recipe: { version: number; items: MenuRecipeItem[]; metadata?: MenuRecipeMetadata | null };
  modifiers?: MenuEntryModifiers;
}
export type MenuEntryModifiers = { allowIngredientExclusions: boolean; groups: MenuModifierGroup[] };
export type MenuModifierGroup = {
  id?: string; name: string; minSelections: number; maxSelections: number | null; sortOrder?: number;
  options: MenuModifierOption[];
};
export type MenuModifierOption = {
  id?: string; name: string; price: number; ingredientId?: string | null; amount?: number; unit?: UnitCode;
  fromCommonWarehouse?: boolean; warehouseId?: string | null; maxQuantity?: number; isActive?: boolean; sortOrder?: number;
};
export type MenuEntryInput = {
  catalogKind: 'goods' | 'recipe';
  dish: MenuEntryDishInput;
  recipe?: MenuRecipeInput;
  modifiers?: MenuEntryModifiers;
  expectedVersion?: number;
  requestKey: string;
};
export function useMenuEntry(id?: string) {
  return useQuery({
    queryKey: ['admin', 'menu-entry', id], enabled: !!id, gcTime: 15 * 60_000,
    queryFn: async () => (await api.get<MenuEntry>(`/admin/menu/entries/${encodeURIComponent(id!)}`)).data,
  });
}
export function useSaveMenuEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: MenuEntryInput & { id?: string }) =>
      (await (id ? api.put(`/admin/menu/entries/${encodeURIComponent(id)}`, body) : api.post('/admin/menu/entries', body))).data,
    onSuccess: async () => {
      await Promise.all([['admin'], ['dishes'], ['categories'], ['menu']].map(queryKey => qc.invalidateQueries({ queryKey })));
    },
  });
}
