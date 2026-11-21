import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { useNotifications } from '@/store/notifications';
import { useT } from '@/lib/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import { displayOrderNumber } from '@/lib/format';
import type { Order, PaymentMethod } from '@/types';

export type RefundStatus = 'pending' | 'approved' | 'rejected';
export type RefundSelection = { itemId?: string; quantity?: number };
export type RefundApproval = { fundsReturned?: boolean; restockGoods?: boolean; fiscalRefundReference?: string };
type RefundLine = { itemId: string; name: string; quantity: number; amount: string };
type PaymentPart = { method: Exclude<PaymentMethod, 'mixed'>; amount: string };

export type RefundQuote = {
  amount: string;
  items: RefundLine[];
  paymentParts: PaymentPart[];
  requireFiscalReference: boolean;
  version: string;
};
export type OrderRefund = Omit<RefundQuote, 'version'> & {
  id: string;
  orderId: string;
  orderNumber: string;
  source: Order['source'];
  tableNumber: number;
  itemId: string | null;
  reason: string;
  status: RefundStatus;
  requestedByName: string;
  decidedByName: string | null;
  createdAt: string;
  decidedAt: string | null;
  fiscalRefundReference: string | null;
  restockedGoods: boolean;
};
type RefundInput = RefundSelection & { requestId: string; reason: string; quoteVersion: string; approval?: RefundApproval };
type RefundEvent = { orderNumber: string; status: RefundStatus };

const key = ['order-refunds'] as const;
const orderPath = (orderId: string) => '/order-refunds/orders/' + encodeURIComponent(orderId);

async function invalidateRefunds(cache: QueryClient, status: RefundStatus) {
  const keys = [key, ['orders'], ['admin', 'orders']];
  if (status === 'approved') keys.push(['admin', 'stats'], ['admin', 'finance'], ['admin', 'warehouse'],
    ['admin', 'staff'], ['audit'], ['cash-shifts'], ['waiter', 'cabinet'], ['waiter', 'shift']);
  await Promise.all(keys.map((queryKey) => cache.invalidateQueries({ queryKey })));
}

export function useCanManageOrderRefunds() {
  const { effectiveRole, canEditSection, canAction, canOwnerOperation } = usePermissions();
  return (effectiveRole === 'ADMIN' || effectiveRole === 'OWNER') && canEditSection('orders')
    && canEditSection('checks') && canAction('refundChecks') && canOwnerOperation('refunds');
}

export function useRefundHistory(orderId: string | undefined) {
  return useQuery({
    queryKey: [...key, 'history', orderId],
    enabled: !!orderId,
    queryFn: async ({ signal }) => (await api.get<OrderRefund[]>(orderPath(orderId!), { signal })).data,
  });
}

export function usePendingRefunds(enabled: boolean) {
  return useQuery({
    queryKey: [...key, 'pending'],
    enabled,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => (await api.get<OrderRefund[]>('/order-refunds/pending', { signal })).data,
  });
}

export function useRefundQuote(orderId: string, selection: RefundSelection, enabled: boolean) {
  return useQuery({
    queryKey: [...key, 'quote', orderId, selection],
    enabled,
    retry: false,
    queryFn: async ({ signal }) => (await api.post<RefundQuote>(orderPath(orderId) + '/quote', selection, { signal })).data,
  });
}

export function useCreateOrderRefund(orderId: string, mode: 'request' | 'manage') {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (input: RefundInput) =>
      (await api.post<OrderRefund>(orderPath(orderId) + (mode === 'request' ? '/request' : '/complete'), input)).data,
    retry: networkRetry,
    onSuccess: (refund) => invalidateRefunds(cache, refund.status),
  });
}

export function useDecideOrderRefund(refundId: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({ decision, approval }: { decision: 'approve' | 'reject'; approval?: RefundApproval }) =>
      (await api.post<OrderRefund>('/order-refunds/' + encodeURIComponent(refundId) + '/' + decision, approval ?? {})).data,
    retry: networkRetry,
    onSuccess: (refund) => invalidateRefunds(cache, refund.status),
  });
}

export function useRefundUpdates(workspace: 'admin' | 'terminal', enabled = true) {
  const cache = useQueryClient();
  const push = useNotifications((state) => state.push);
  const t = useT();

  useSocketEvent<RefundEvent>('order:refund_updated', (event) => {
    if (!enabled) return;
    void invalidateRefunds(cache, event.status);
    if (workspace === 'admin' && event.status === 'pending') {
      push({ message: t('Новая заявка на возврат') + ' · ' + displayOrderNumber(event.orderNumber), at: new Date().toISOString() });
    }
    if (workspace === 'terminal' && event.status !== 'pending') {
      push({ message: t(event.status === 'approved' ? 'Возврат оформлен' : 'Заявка на возврат отклонена')
        + ' · ' + displayOrderNumber(event.orderNumber), at: new Date().toISOString() });
    }
  }, [enabled, workspace, cache, push, t]);
}
