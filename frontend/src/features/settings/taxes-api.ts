import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { MenuTax, MenuTaxType } from '@/types';

export const TAX_TYPE_LABELS: Record<MenuTaxType, string> = {
  vat: 'Добавленная стоимость', turnover: 'С оборота',
};

export const TAX_REPORT_LABELS = {
  fiscal: 'Продажи с фискальным чеком',
  nonFiscal: 'Продажи без фискального чека',
  reversal: 'Возвраты в EDU POS',
} as const;
export type TaxReportKind = keyof typeof TAX_REPORT_LABELS;
export type TaxReportRow = Omit<MenuTax, 'id'> & {
  taxId: string;
  kind: TaxReportKind;
  salesAmount: string;
  amount: string;
};

type TaxInput = { name: string; rate: number; type: MenuTaxType };
type QueryParams = Record<string, string | number | undefined>;
const key = ['admin', 'taxes'];
export const taxReportKey = ['admin', 'stats', 'taxes'];
export const TAX_DIRECTORY_ENDPOINT = '/admin/settings/taxes';
export const TAX_REPORT_ENDPOINT = '/admin/statistics/taxes';

export function useTaxDirectory(params: QueryParams) {
  return useQuery({
    queryKey: [...key, 'directory', params],
    queryFn: async () => (await api.get<MenuTax[]>(TAX_DIRECTORY_ENDPOINT, { params })).data,
  });
}

export function useMenuTaxOptions() {
  return useQuery({
    queryKey: [...key, 'menu'],
    queryFn: async () => (await api.get<MenuTax[]>('/admin/menu/taxes')).data,
  });
}

export function useTaxReport(params: QueryParams) {
  return useQuery({
    queryKey: [...taxReportKey, params],
    queryFn: async () => (await api.get<TaxReportRow[]>(TAX_REPORT_ENDPOINT, { params })).data,
  });
}

export function useTaxMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: key });
  return {
    save: useMutation({
      mutationFn: ({ id, ...body }: TaxInput & { id?: string }) =>
        id ? api.patch(`${TAX_DIRECTORY_ENDPOINT}/${id}`, body) : api.post(TAX_DIRECTORY_ENDPOINT, body),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`${TAX_DIRECTORY_ENDPOINT}/${id}`), onSuccess: refresh }),
  };
}

export async function downloadTaxes(endpoint: string, params: QueryParams, filename: string) {
  const response = await api.get<Blob>(`${endpoint}/export.xlsx`, { responseType: 'blob', params });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
