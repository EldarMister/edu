import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, networkRetry } from '@/lib/api';
import type {
  Category,
  Dish,
  Hall,
  Order,
  OrderStatus,
  PaymentMethod,
  Receipt,
  ReceiptPrintRequest,
  ReceiptPrintType,
  WaiterShift,
} from '@/types';
import type { CartLine } from '@/types';

export interface CabinetRecentOrder {
  id: string;
  orderNumber: string;
  tableNumber: number;
  finalAmount: string;
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

export function useCurrentShift() {
  return useQuery({
    queryKey: ['waiter', 'shift', 'current'],
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
    mutationFn: async () => (await api.post<WaiterShift>('/waiter/shifts/start')).data,
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
          finalVariantId: c.action === 'replaced' ? c.finalVariantId : undefined,
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
      const items = linesToItems(payload.lines);
      const { data } = await api.post<Order>('/orders', {
        tableId: payload.tableId,
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
    mutationFn: async (payload: { orderId: string; comment?: string; lines: CartLine[] }) => {
      const items = linesToItems(payload.lines);
      const { data } = await api.patch<Order>(`/orders/${payload.orderId}`, {
        comment: payload.comment?.trim() || undefined,
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
export const useResolvePartialRejection = () => useOrderAction((id) => `/orders/${id}/resolve-partial-rejection`);
export const useClaimQrOrder = () => useOrderAction((id) => `/orders/${id}/claim-qr`);

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

export function usePay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orderId: string;
      method: PaymentMethod;
      cashAmount?: number;
      qrAmount?: number;
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
