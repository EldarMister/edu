import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Ingredient, IngredientInput } from './warehouse';

export type CatalogueIngredient = Ingredient & { supplier?: string | null };
export function useCatalogueIngredients(enabled = true) {
  return useQuery({ queryKey: ['admin', 'warehouse', 'catalogue'], enabled,
    queryFn: async () => (await api.get<CatalogueIngredient[]>('/admin/warehouse/ingredients?includeInactive=true')).data });
}
export function useCatalogueIngredientMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'warehouse'] });
  const save = useMutation({
    mutationFn: async ({ id, ...body }: IngredientInput & { id?: string; category: string | null }) =>
      (await (id ? api.patch<CatalogueIngredient>(`/admin/warehouse/ingredients/${encodeURIComponent(id)}`, body)
        : api.post<CatalogueIngredient>('/admin/warehouse/ingredients', { ...body, kind: 'raw' }))).data,
    onSuccess: invalidate,
  });
  const renameCategory = useMutation({
    mutationFn: async (body: { from: string; to: string }) => (await api.post('/admin/warehouse/ingredients/categories/rename', body)).data,
    onSuccess: invalidate,
  });
  return { save, renameCategory };
}
