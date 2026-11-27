import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_URL } from '@/lib/api';
import type { WaiterOrderPermissions } from '@/lib/order-permissions';
import type { PaymentMethod, ReceiptPrintSettings } from '@/types';

/** Преобразует значение QR из настроек в пригодный для <img src> адрес.
 *  Публичные настройки отдают лёгкую ссылку (/settings/qr?v=…), админские — data URL. */
export function resolveQrSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('data:') || value.startsWith('http')) return value;
  return `${API_URL}/api${value.startsWith('/') ? value : `/${value}`}`;
}

export interface Settings extends Partial<ReceiptPrintSettings> {
  workShiftApprovalRequired?: boolean;
  taxesEnabled?: boolean;
  roundOrderTotal?: boolean;
  telegramStockAlertsEnabled?: boolean;
  telegramStockChatId?: string | null;
  telegramStockBotConfigured?: boolean;
  receiptLogoData?: string | null;
  receiptPrintRequestsOnly: boolean;
  waiterOrderPermissions: WaiterOrderPermissions;
  id: string;
  cafeId: string | null;
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  instagram: string | null;
  website: string | null;
  receiptText: string;
  language: 'ru' | 'ky';
  payQr: boolean;
  payCash: boolean;
  payCard: boolean;
  cardProcessingFeeRate: number;
  qrProcessingFeeRate: number;
  cardSettlementAccountId: string | null;
  qrSettlementAccountId: string | null;
  cashCollectionAccountId: string | null;
  qrImageUrl: string | null;
  printerConnected: boolean;
  // Интеграция сайта/приложения доставки
  deliveryEnabled: boolean;
  deliveryApiKeyConfigured: boolean;
  deliveryApiKeyPrefix: string | null;
  // Экран очереди заказов (табло в зале)
  queueDisplayEnabled: boolean;
  queueDisplayMode: 'table' | 'number';
  queueDisplayCode: string | null;
  // QR-меню: гео-проверка присутствия
  qrGeoEnabled: boolean;
  qrGeoLat: number | null;
  qrGeoLng: number | null;
  qrGeoRadius: number;
  // ККМ / фискализация
  fiscalProvider: string | null; // mock или сохранённый ранее провайдер.
  fiscalEkassaApiKey: string | null;
  fiscalEkassaUrl: string | null;
  fiscalEkassaInn: string | null;
  fiscalYakassaApiKey: string | null;
  fiscalYakassaUrl: string | null;
  updatedAt: string;
}

export interface PublicSettings {
  roundOrderTotal?: boolean;
  useFloorPlan?: boolean;
  receiptPrintRequestsOnly: boolean;
  waiterOrderPermissions: WaiterOrderPermissions;
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  instagram: string | null;
  website: string | null;
  receiptText: string;
  language: 'ru' | 'ky';
  paymentMethods: PaymentMethod[];
  qrImageUrl: string | null;
  printerConnected: boolean;
  fiscalEnabled: boolean;
  deliveryEnabled: boolean;
}

/** Публичные настройки (реквизиты + включённые способы оплаты) — для всех ролей. */
export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: async () => (await api.get<PublicSettings>('/settings')).data,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

/** Полные настройки — только владелец. */
export function useAdminSettings() {
  return useQuery({
    queryKey: ['settings', 'admin'],
    queryFn: async () => (await api.get<Settings>('/admin/settings')).data,
  });
}

export function usePaymentSettlementAccounts(enabled: boolean) {
  return useQuery({
    queryKey: ['settings', 'payment-accounts'],
    queryFn: async () => (await api.get<{ id: string; name: string; isDefault: boolean }[]>('/admin/settings/payment-accounts')).data,
    enabled,
  });
}

export function useCashCollectionAccounts() {
  return useQuery({
    queryKey: ['settings', 'collection-accounts'],
    queryFn: async () => (await api.get<{ id: string; name: string; isCollection: boolean }[]>('/admin/settings/collection-accounts')).data,
  });
}

export type SettingsInput = Partial<Omit<Settings, 'id' | 'cafeId' | 'queueDisplayCode' | 'updatedAt' | 'printerConnected' | 'telegramStockBotConfigured'>>;

/** Проверка соединения с ККМ (кнопка в блоке настроек). */
export function useTestFiscalConnection() {
  return useMutation({
    mutationFn: async () => (await api.post<{ ok: boolean }>('/fiscal/test-connection')).data,
  });
}

/** Выпускает новый ключ доставки; полный ключ сервер показывает только в этом ответе. */
export function useGenerateDeliveryApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ apiKey: string; prefix: string }>('/admin/settings/delivery-api-key')).data,
    onSuccess: ({ prefix }) => {
      qc.setQueryData<Settings>(['settings', 'admin'], (current) =>
        current
          ? { ...current, deliveryApiKeyConfigured: true, deliveryApiKeyPrefix: prefix }
          : current,
      );
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['settings', 'admin'] });
      const previous = qc.getQueryData<Settings>(['settings', 'admin']);
      if (previous) {
        qc.setQueryData<Settings>(['settings', 'admin'], {
          ...previous,
          ...patch,
          updatedAt: new Date().toISOString(),
        });
      }
      return { previous };
    },
    mutationFn: async (body: SettingsInput) =>
      (await api.patch<Settings>('/admin/settings', body)).data,
    onError: (_error, _patch, context) => {
      if (context?.previous) {
        qc.setQueryData(['settings', 'admin'], context.previous);
      }
    },
    onSuccess: (data) => {
      qc.setQueryData(['settings', 'admin'], data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    },
  });
}
