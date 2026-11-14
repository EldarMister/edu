import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PreparationRecipe } from './api';
import type { UnitCode } from './units';

export type PreparationCard = PreparationRecipe & { category?: string | null; updatedAt?: string };
export function useSavePreparationCard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: Omit<PreparationRecipe, 'id' | 'name' | 'displayUnit' | 'unitType' | 'items'> & {
      items: Omit<PreparationRecipe['items'][number], 'name'>[];
      id?: string;
      name: string;
      unit: UnitCode;
      category?: string | null;
      requestKey?: string;
      expectedUpdatedAt?: string;
    }) =>
      (id
        ? await api.put<PreparationCard>(`/admin/warehouse/preparation/${id}/card`, body)
        : await api.post<PreparationCard>('/admin/warehouse/preparation/card', body)
      ).data,
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'warehouse'] }),
  });
}
