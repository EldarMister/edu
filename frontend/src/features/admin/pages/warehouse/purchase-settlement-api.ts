import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cashShiftKey, financeKey } from '../finance/api';
import type { PurchasePaymentStatus } from './api';

export const purchasePaymentLabels: Record<PurchasePaymentStatus, string> = {
  untracked: 'Требует сверки', unpaid: 'Не оплачена', partly_paid: 'Частично оплачена', paid: 'Оплачена', overpaid: 'Переплата',
};

const warehouseKey = ['admin', 'warehouse'] as const;
const base = '/admin/warehouse/purchases';

export function usePurchaseSettlementAccounts(enabled: boolean) {
  return useQuery({
    enabled,
    queryKey: [...warehouseKey, 'purchase-settlement-accounts'],
    queryFn: async () => (await api.get<{ id: string; name: string }[]>(`${base}/settlement/accounts`)).data,
  });
}

export function usePurchaseSettlementMutations(purchaseId: string) {
  const query = useQueryClient();
  const url = `${base}/${purchaseId}`;
  async function invalidate() {
    await Promise.all([warehouseKey, financeKey, cashShiftKey].map((queryKey) => query.invalidateQueries({ queryKey })));
  }
  const pay = useMutation({
    mutationFn: (input: { requestKey: string; payments: { accountId: string; amount: number; occurredAt?: string; note?: string }[] }) =>
      api.post(`${url}/payments`, input),
    onSuccess: invalidate,
  });
  const reconcile = useMutation({
    mutationFn: (input: { paidAmount: number; reason: string }) => api.post(`${url}/settlement/reconcile`, input),
    onSuccess: invalidate,
  });
  const reverse = useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) => api.post(`${url}/payments/${paymentId}/reverse`, { reason }),
    onSuccess: invalidate,
  });
  return { pay, reconcile, reverse };
}
