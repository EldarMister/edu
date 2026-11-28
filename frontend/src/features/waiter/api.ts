import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import type {
  Category,
  Dish,
  Hall,
  Order,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Receipt,
  AdministratorCall,
  ReceiptPrintRequest,
  ReceiptPrintType,
  WaiterShift,
} from '@/types';
import type { CartLine } from '@/types';

export interface CabinetRecentOrder {
  id: string;
  orderNumber: string;
  source?: Order['source'];
  tableNumber: number;
  finalAmount: string;
  refundedAmount?: string;
  paymentStatus?: PaymentStatus;
  status: OrderStatus;
  createdAt: string;
}
export interface WaiterCabinetData {
  stats: { completed: number; cancelled: number; revenue: string };
  recentOrders: CabinetRecentOrder[];
}

export function useWaiterCabinet(period: 'day' | 'week' | 'month' = 'week') {
  return useQuery({
    queryKey: ['waiter', 'cabinet', period],
    queryFn: async () => (await api.get<WaiterCabinetData>(`/orders/cabinet?period=${period}`)).data,
  });
}

export function useWaiterOrderHistory(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['orders', 'waiter-history'],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => (await api.get<{
      items: CabinetRecentOrder[];
      nextCursor: string | null;
    }>('/orders/history', { params: { cursor: pageParam }, signal })).data,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
  });
}

export function useOrderDetails(id: string | null) {
  return useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: async () => (await api.get<Order>(`/orders/${id}`)).data,
    enabled: !!id,
  });
}

export function useHalls() {
  return useQuery({
    queryKey: ['halls'],
    queryFn: async () => (await api.get<Hall[]>('/halls')).data,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<Category[]>('/categories')).data,
  });
}

export function useDishes() {
  return useQuery({
    queryKey: ['dishes'],
    queryFn: async () => (await api.get<Dish[]>('/dishes')).data,
  });
}

export function useActiveOrders() {
  return useQuery({
    queryKey: ['orders', 'active'],
    queryFn: async () => (await api.get<Order[]>('/orders/active')).data,
  });
}

export function useCurrentShift(enabled = true) {
  return useQuery({
    queryKey: ['waiter', 'shift', 'current'],
    enabled,
    refetchInterval: (query) => query.state.data ? false : 10_000,
    queryFn: async () => (await api.get<WaiterShift | null>('/waiter/shifts/current')).data,
  });
}

// ---------- Действия со столом ----------

export interface AvailableWaiter {
  id: string;
  name: string;
}

export function useAvailableWaiters(enabled: boolean) {
  return useQuery({
    queryKey: ['tables', 'available-waiters'],
    queryFn: async () => (await api.get<AvailableWaiter[]>('/tables/available-waiters')).data,
    enabled,
  });
}

function useTableMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
    },
  });
}

export function useCloseTable() {
  return useTableMutation((tableId: string) =>
    api.post(`/tables/${tableId}/close`).then((r) => r.data),
  );
}

export function useMoveTable() {
  return useTableMutation((vars: { tableId: string; targetTableId: string }) =>
    api.post<Order>(`/tables/${vars.tableId}/move`, { targetTableId: vars.targetTableId }).then((r) => r.data),
  );
}

export function useTransferTable() {
  return useTableMutation((vars: { tableId: string; waiterId: string }) =>
    api.post<Order>(`/tables/${vars.tableId}/transfer`, { waiterId: vars.waiterId }).then((r) => r.data),
  );
}

export function useStartShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<WaiterShift | null>('/waiter/shifts/start?awaitApproval=true')).data || null,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function useEndShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<WaiterShift>('/waiter/shifts/end')).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/** Преобразует линии корзины в позиции заказа (учитывает состав сета). */
function linesToItems(lines: CartLine[]) {
  return lines.map((l) => ({
    ...(l.orderItemId ? { id: l.orderItemId } : {}),
    dishId: l.dish.id,
    variantId: l.variant?.id,
    weightGrams: l.weightGrams,
    modifierSelections: l.modifierSelections?.map(({ optionId, quantity }) => ({ optionId, quantity })),
    excludedIngredientIds: l.excludedIngredientIds,
    quantity: l.quantity,
    comment: l.comment?.trim() || undefined,
    takeaway: l.takeaway || undefined,
    setComponents: l.set
      ? l.set.components.map((c) => ({
          originalDishId: c.originalDishId,
          originalVariantId: c.originalVariantId,
          finalDishId: c.action === 'replaced' ? c.finalDishId : undefined,
          finalVariantId: c.action === 'replaced' ? c.finalVariantId : undefined,
          action: c.action,
        }))
      : undefined,
  }));
}

export interface DeliveryDetails {
  type: 'delivery';
}

type OrderDestination = { tableId: string; delivery?: never } | { tableId?: never; delivery: DeliveryDetails };

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: OrderDestination & {
      comment?: string;
      idempotencyKey: string;
      lines: CartLine[];
    }) => {
      const items = linesToItems(payload.lines);
      const { data } = await api.post<Order>(payload.delivery ? '/orders/delivery' : '/orders', {
        ...(payload.delivery ?? { tableId: payload.tableId }),
        comment: payload.comment?.trim() || undefined,
        idempotencyKey: payload.idempotencyKey,
        items,
      });
      return data;
    },
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function useUpdateOrderFulfillment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, ...payload }: OrderDestination & {
      orderId: string; expectedUpdatedAt: string; comment?: string;
    }) => (await api.patch<Order>(`/orders/${orderId}/fulfillment`, payload)).data,
    onSuccess: (updated) => qc.setQueryData<Order[]>(['orders', 'active'], (orders) =>
      orders?.map((order) => order.id === updated.id ? updated : order)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['halls'] });
    },
  });
}

export function useAddItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; idempotencyKey: string; lines: CartLine[] }) => {
      const items = linesToItems(payload.lines);
      const { data } = await api.post<Order>(`/orders/${payload.orderId}/items`, {
        idempotencyKey: payload.idempotencyKey,
        items,
      });
      return data;
    },
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function useEditOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; comment?: string; reason?: string; lines: CartLine[] }) => {
      const items = linesToItems(payload.lines);
      const { data } = await api.patch<Order>(`/orders/${payload.orderId}`, {
        reason: payload.reason,
        comment: payload.comment?.trim() ?? '',
        items,
      });
      return data;
    },
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
    },
  });
}

/** Универсальная мутация перехода статуса заказа официантом. */
function useOrderAction(path: (id: string) => string, updateCachedStatusFrom?: Order['status']) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => (await api.post<Order>(path(orderId))).data,
    retry: networkRetry,
    onSuccess: (updated) => {
      if (!updateCachedStatusFrom) return;
      qc.setQueryData<Order[]>(['orders', 'active'], (current) => current?.map((order) =>
        order.id === updated.id && order.status === updateCachedStatusFrom ? updated : order,
      ));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export const usePickedUp = () => useOrderAction((id) => `/orders/${id}/picked-up`);
export const useServed = () => useOrderAction((id) => `/orders/${id}/served`);
export const useToPayment = () => useOrderAction((id) => `/orders/${id}/to-payment`, 'served');
export const useResolvePartialRejection = () => useOrderAction((id) => `/orders/${id}/resolve-partial-rejection`);
export const useClaimQrOrder = () => useOrderAction((id) => `/orders/${id}/claim-qr`);

export type SplitOrderLine = { itemId: string; quantity: number };
type SplitOrderResult = { sourceOrder: Order; newOrder: Order };

export function useSplitOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, ...payload }: {
      orderId: string;
      items: SplitOrderLine[];
      expectedUpdatedAt: string;
      idempotencyKey: string;
    }) => (await api.post<SplitOrderResult>(`/orders/${orderId}/split`, payload)).data,
    retry: networkRetry,
    onSuccess: async ({ sourceOrder, newOrder }) => {
      const key = ['orders', 'active'];
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData<Order[]>(key, (current = []) => [
        ...current.filter((order) => order.id !== sourceOrder.id && order.id !== newOrder.id),
        ...[sourceOrder, newOrder].filter((order) => order.status !== 'paid' && order.status !== 'cancelled'),
      ]);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['halls'] });
      void qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function useRemoveRejectedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; itemId: string }) =>
      (await api.post<Order>(`/orders/${payload.orderId}/rejected-items/${payload.itemId}/remove`)).data,
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function useCancelReadyItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; itemId: string; reason: string }) =>
      (await api.post<Order>(`/orders/${payload.orderId}/items/${payload.itemId}/cancel`, { reason: payload.reason })).data,
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function useReplaceRejectedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; itemId: string; line: CartLine }) => {
      const [item] = linesToItems([payload.line]);
      const { data } = await api.post<Order>(`/orders/${payload.orderId}/rejected-items/${payload.itemId}/replace`, { item });
      return data;
    },
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; reason?: string }) =>
      (await api.post<Order>(`/orders/${payload.orderId}/cancel`, { reason: payload.reason })).data,
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function useCallAdministrator() {
  return useMutation({
    mutationFn: async (orderId: string) =>
      (await api.post<AdministratorCall>(`/orders/${orderId}/call-administrator`)).data,
    retry: networkRetry,
  });
}

export function usePay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orderId: string;
      method: PaymentMethod;
      expectedAmount: number;
      cashAmount?: number;
      qrAmount?: number;
      cardAmount?: number;
      splitPayments?: { method: Exclude<PaymentMethod, 'mixed'>; amount: number }[];
    }) => (await api.post<Order>('/payments', payload)).data,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export async function fetchReceipt(orderId: string): Promise<Receipt> {
  return (await api.get<Receipt>(`/payments/${orderId}/receipt`)).data;
}

/**
 * Официант создаёт запрос на печать чека (уходит администратору).
 * Тип `receipt` — обычный чек, `preliminary` — счёт.
 */
export function useCreateReceiptPrintRequest() {
  return useMutation({
    mutationFn: async (vars: string | { orderId: string; type?: ReceiptPrintType }) => {
      const body = typeof vars === 'string' ? { orderId: vars } : vars;
      return (await api.post<ReceiptPrintRequest>('/receipt-prints', body)).data;
    },
    retry: networkRetry,
  });
}
