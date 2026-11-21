import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MenuTax, MenuTaxType } from '@/types';

export const TAX_TYPE_LABELS: Record<MenuTaxType, string> = { vat: 'Добавленная стоимость', turnover: 'С оборота' };
const key = ['admin', 'taxes'];
const endpoint = '/admin/settings/taxes';

export function useTaxDirectory(params: { search?: string; type?: MenuTaxType; sort: 'asc' | 'desc' }) {
  return useQuery({
    queryKey: [...key, 'directory', params],
    queryFn: async () => (await api.get<MenuTax[]>(endpoint, { params })).data,
  });
}

export function useMenuTaxOptions() {
  return useQuery({
    queryKey: [...key, 'menu'],
    queryFn: async () => (await api.get<MenuTax[]>('/admin/menu/taxes')).data,
  });
}

export function useTaxMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: key });
  return {
    save: useMutation({
      mutationFn: async ({ id, ...body }: { id?: string; name: string; rate: number; type: MenuTaxType }) => {
        if (id) await api.patch(`${endpoint}/${id}`, body);
        else await api.post(endpoint, body);
      },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => { await api.delete(`${endpoint}/${id}`); },
      onSuccess: refresh,
    }),
  };
}

export const TAX_REPORT_ENDPOINT = '/admin/statistics/taxes';
export const TAX_REPORT_LABELS = {
  fiscal: 'Продажи с фискальным чеком',
  nonFiscal: 'Продажи без фискального чека',
  reversal: 'Возвраты в EDU POS',
} as const;
type TaxReportRow = Omit<MenuTax, 'id'> & {
  taxId: string;
  kind: keyof typeof TAX_REPORT_LABELS;
  salesAmount: string;
  amount: string;
};

export function useTaxReport(params: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ['admin', 'stats', 'taxes', params],
    queryFn: async () => (await api.get<TaxReportRow[]>(TAX_REPORT_ENDPOINT, { params })).data,
  });
}
