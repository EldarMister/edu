import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import type {
  Category,
  CartLine,
  Dish,
  Hall,
  Order,
  PaymentMethod,
  ReceiptPrintType,
  WaiterShift,
} from '@/types';

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
    staleTime: 5 * 60_000,
  });
}

export function useDishes() {
  return useQuery({
    queryKey: ['dishes'],
    queryFn: async () => (await api.get<Dish[]>('/dishes')).data,
    staleTime: 5 * 60_000,
  });
}

export function useActiveOrders() {
  return useQuery({
    queryKey: ['orders', 'active'],
    queryFn: async () => (await api.get<Order[]>('/orders/active')).data,
  });
}

export function useOrderDetails(id: string | null) {
  return useQuery({
    queryKey: ['orders', 'detail', id],
    queryFn: async () => (await api.get<Order>(`/orders/${id}`)).data,
    enabled: !!id,
  });
}

export function useCurrentShift(enabled = true) {
  return useQuery({
    queryKey: ['waiter', 'shift', 'current'],
    queryFn: async () => (await api.get<WaiterShift | null>('/waiter/shifts/current')).data,
    enabled,
  });
}

export function useStartShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post<WaiterShift>('/waiter/shifts/start')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['waiter', 'shift'] }),
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

// ---------- Действия со столом ----------

export function useCloseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableId: string) => api.post(`/tables/${tableId}/close`).then((r) => r.data),
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
    },
  });
}

/** Линии корзины → позиции заказа (учитывает состав сета). */
function linesToItems(lines: CartLine[]) {
  return lines.map((l) => ({
    dishId: l.dish.id,
    variantId: l.variant?.id,
    quantity: l.quantity,
    comment: l.comment?.trim() || undefined,
    takeaway: l.takeaway || undefined,
    setComponents: l.set
      ? l.set.components.map((c) => ({
          originalDishId: c.originalDishId,
          originalVariantId: c.originalVariantId,
          finalDishId: c.action === 'replaced' ? c.finalDishId : undefined,
          action: c.action,
        }))
      : undefined,
  }));
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      tableId: string;
      comment?: string;
      idempotencyKey: string;
      lines: CartLine[];
    }) => {
      const { data } = await api.post<Order>('/orders', {
        tableId: payload.tableId,
        comment: payload.comment?.trim() || undefined,
        idempotencyKey: payload.idempotencyKey,
        items: linesToItems(payload.lines),
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

export function useAddItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orderId: string; idempotencyKey: string; lines: CartLine[] }) => {
      const { data } = await api.post<Order>(`/orders/${payload.orderId}/items`, {
        idempotencyKey: payload.idempotencyKey,
        items: linesToItems(payload.lines),
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
function useOrderAction(path: (id: string) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => (await api.post<Order>(path(orderId))).data,
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export const usePickedUp = () => useOrderAction((id) => `/orders/${id}/picked-up`);
export const useServed = () => useOrderAction((id) => `/orders/${id}/served`);
export const useToPayment = () => useOrderAction((id) => `/orders/${id}/to-payment`);
export const useResolvePartialRejection = () =>
  useOrderAction((id) => `/orders/${id}/resolve-partial-rejection`);

export function useRemoveRejectedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; itemId: string }) =>
      (await api.post<Order>(`/orders/${p.orderId}/rejected-items/${p.itemId}/remove`)).data,
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { orderId: string; reason?: string }) =>
      (await api.post<Order>(`/orders/${p.orderId}/cancel`, { reason: p.reason })).data,
    retry: networkRetry,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

export function usePay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      orderId: string;
      method: PaymentMethod;
      cashAmount?: number;
      qrAmount?: number;
    }) => (await api.post<Order>('/payments', p)).data,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['halls'] });
      qc.invalidateQueries({ queryKey: ['waiter', 'shift'] });
    },
  });
}

/** Официант создаёт запрос на печать чека/счёта (уходит администратору). */
export function useCreateReceiptPrintRequest() {
  return useMutation({
    mutationFn: async (vars: { orderId: string; type?: ReceiptPrintType }) =>
      (await api.post('/receipt-prints', vars)).data,
    retry: networkRetry,
  });
}
