import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  isActive: boolean;
  address?: string | null;
  taxId?: string | null;
  purchasesCount?: number;
  purchasesTotal?: number;
}
const KEY = ['admin', 'warehouse'] as const;
export function useSuppliers(enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...KEY, 'suppliers'],
    queryFn: async () => (await api.get<Supplier[]>('/admin/warehouse/suppliers')).data,
  });
}
export function useSupplierMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const save = useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id?: string;
      name: string;
      phone?: string;
      email?: string;
      note?: string;
      address?: string;
      taxId?: string;
    }) =>
      (id
        ? await api.patch(`/admin/warehouse/suppliers/${id}`, body)
        : await api.post('/admin/warehouse/suppliers', body)
      ).data,
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/warehouse/suppliers/${id}`),
    onSuccess: invalidate,
  });
  return { save, archive };
}
export interface WarehousePolicy {
  allowNegativeIngredientStock: boolean;
  warning: string;
  valuationRule: string;
}
export function useWarehousePolicy() {
  return useQuery({
    queryKey: [...KEY, 'policy'],
    queryFn: async () => (await api.get<WarehousePolicy>('/admin/warehouse/policy')).data,
  });
}
export function useUpdateWarehousePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { allowNegativeIngredientStock: boolean }) =>
      api.patch('/admin/warehouse/policy', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
