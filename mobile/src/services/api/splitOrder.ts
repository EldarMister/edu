import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import { useAuth } from '@/store/auth';
import type { Order } from '@/types';
import type { SplitOrderLine } from '@/screens/waiter/splitOrderPlan';

type SplitInput = {
  orderId: string;
  items: SplitOrderLine[];
  expectedUpdatedAt: string;
  idempotencyKey: string;
};
type SplitResult = { sourceOrder: Order; newOrder: Order };

export function useSplitOrder() {
  const cache = useQueryClient();
  const ownsWorkspace = (context?: { userId?: string; workspace: string | null }) => {
    const current = useAuth.getState();
    return !!context?.userId && context.userId === current.user?.id && context.workspace === current.workspace;
  };

  return useMutation({
    mutationFn: async ({ orderId, ...body }: SplitInput) =>
      (await api.post<SplitResult>(`/orders/${encodeURIComponent(orderId)}/split`, body)).data,
    retry: networkRetry,
    onMutate: () => {
      const { user, workspace } = useAuth.getState();
      return { userId: user?.id, workspace };
    },
    onSuccess: async ({ sourceOrder, newOrder }, _input, context) => {
      if (!ownsWorkspace(context)) return;
      await cache.cancelQueries({ queryKey: ['orders'] });
      if (!ownsWorkspace(context)) return;
      for (const order of [sourceOrder, newOrder]) {
        cache.setQueryData(['orders', 'detail', order.id], order);
      }
      cache.setQueryData<Order[]>(['orders', 'active'], (current = []) => [
        ...current.filter((order) => order.id !== sourceOrder.id && order.id !== newOrder.id),
        ...[sourceOrder, newOrder].filter((order) => !['paid', 'cancelled', 'rejected'].includes(order.status)),
      ]);
    },
    onSettled: (_data, _error, _input, context) => {
      if (!ownsWorkspace(context)) return;
      for (const queryKey of [['orders'], ['halls'], ['waiter', 'shift']]) {
        void cache.invalidateQueries({ queryKey });
      }
    },
  });
}
