import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import { getGuestKey } from './guest';

/** Публичный клиент QR-меню — без JWT и без auth-перехватчиков. */
export const publicApi = axios.create({
  baseURL: `${API_URL}/api/public`,
  headers: { 'Content-Type': 'application/json' },
});

// ---------- Типы ----------

export interface QrDishVariant {
  id: string;
  name: string;
  price: string;
  sortOrder: number;
}

export interface QrDish {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: string;
  imageUrl: string | null;
  isAvailable: boolean;
  isSet: boolean;
  variants: QrDishVariant[];
}

export interface QrCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface QrMenu {
  cafe: { name: string; address: string; phone: string };
  table: { id: string; number: number; hall: string | null };
  categories: QrCategory[];
  dishes: QrDish[];
}

export interface QrSessionItem {
  id: string;
  guestId: string;
  guestLabel: string;
  dishId: string | null;
  variantId: string | null;
  name: string;
  variantName: string | null;
  quantity: number;
  price: string;
  lineTotal: string;
  comment: string | null;
}

export interface QrGuest {
  id: string;
  guestLabel: string;
  isOnline: boolean;
}

export interface QrSession {
  sessionId: string | null;
  status: string;
  table: { id: string; number: number; hall: string | null };
  guests: QrGuest[];
  items: QrSessionItem[];
  itemCount: number;
  activeGuestCount: number;
  totalAmount: string;
  submittedOrderId: string | null;
}

export interface QrJoinResult {
  sessionId: string;
  guestId: string;
  guestKey: string;
  guestLabel: string;
  tableId: string;
}

export interface QrSubmitResult {
  orderId: string;
  orderNumber: string;
  status: string;
  tableNumber: number;
}

// ---------- Хуки ----------

export const qrMenuKey = (token: string) => ['qr', 'menu', token] as const;
export const qrSessionKey = (token: string) => ['qr', 'session', token] as const;

export function useQrMenu(token: string) {
  return useQuery({
    queryKey: qrMenuKey(token),
    queryFn: async () => (await publicApi.get<QrMenu>(`/menu/${token}`)).data,
    staleTime: 60_000,
    retry: 1,
  });
}

export function useQrSession(token: string, enabled: boolean) {
  return useQuery({
    queryKey: qrSessionKey(token),
    queryFn: async () => (await publicApi.get<QrSession>(`/qr-session/${token}`)).data,
    enabled,
  });
}

/** Вход гостя (создаёт/возвращает guestId, guestLabel). */
export async function joinSession(token: string): Promise<QrJoinResult> {
  const guestKey = getGuestKey();
  const { data } = await publicApi.post<QrJoinResult>(`/qr-session/${token}/join`, { guestKey });
  return data;
}

export interface AddItemBody {
  dishId: string;
  variantId?: string;
  quantity: number;
  comment?: string;
}

export function useAddItem(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddItemBody) =>
      (await publicApi.post<QrSession>(`/qr-session/${token}/items`, { guestKey: getGuestKey(), ...body })).data,
    onSuccess: (session) => qc.setQueryData(qrSessionKey(token), session),
  });
}

export function useUpdateItem(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      (await publicApi.patch<QrSession>(`/qr-session/${token}/items/${itemId}`, { guestKey: getGuestKey(), quantity })).data,
    onMutate: async ({ itemId, quantity }) => {
      const key = qrSessionKey(token);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<QrSession>(key);
      qc.setQueryData<QrSession>(key, (current) => (current ? recalcSessionTotals({
        ...current,
        items: current.items.map((item) => (item.id === itemId ? { ...item, quantity } : item)),
      }) : current));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(qrSessionKey(token), ctx.previous);
    },
    onSuccess: (session) => qc.setQueryData(qrSessionKey(token), session),
  });
}

export function useRemoveItem(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) =>
      (await publicApi.delete<QrSession>(`/qr-session/${token}/items/${itemId}`, { params: { guestKey: getGuestKey() } })).data,
    onSuccess: (session) => qc.setQueryData(qrSessionKey(token), session),
  });
}

export function useSubmitOrder(token: string) {
  return useMutation({
    mutationFn: async () =>
      (await publicApi.post<QrSubmitResult>(`/qr-session/${token}/submit`, { guestKey: getGuestKey() })).data,
  });
}

function recalcSessionTotals(session: QrSession): QrSession {
  let itemCount = 0;
  let totalAmount = 0;
  const items = session.items.map((item) => {
    const line = Number(item.price) * item.quantity;
    itemCount += item.quantity;
    totalAmount += line;
    return { ...item, lineTotal: String(round2(line)) };
  });
  const activeGuestCount = Math.max(session.activeGuestCount, new Set(items.map((item) => item.guestId)).size);
  return { ...session, items, itemCount, activeGuestCount, totalAmount: String(round2(totalAmount)) };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
