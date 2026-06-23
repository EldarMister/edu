import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, API_URL } from '@/lib/api';
import type { PaymentMethod } from '@/types';

/** Преобразует значение QR из настроек в пригодный для <img src> адрес.
 *  Публичные настройки отдают лёгкую ссылку (/settings/qr?v=…), админские — data URL. */
export function resolveQrSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('data:') || value.startsWith('http')) return value;
  return `${API_URL}/api${value.startsWith('/') ? value : `/${value}`}`;
}

export interface Settings {
  id: string;
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  instagram: string | null;
  website: string | null;
  receiptText: string;
  serviceChargeAmount: string;
  language: 'ru' | 'ky';
  payQr: boolean;
  payCash: boolean;
  payCard: boolean;
  qrImageUrl: string | null;
  printerConnected: boolean;
  // Экран очереди заказов (табло в зале)
  queueDisplayEnabled: boolean;
  queueDisplayMode: 'table' | 'number';
  // QR-меню: гео-проверка присутствия
  qrGeoEnabled: boolean;
  qrGeoLat: number | null;
  qrGeoLng: number | null;
  qrGeoRadius: number;
  // ККМ / фискализация
  fiscalProvider: string | null; // 'ekassa' | 'yakassa' | null
  fiscalEkassaApiKey: string | null;
  fiscalEkassaUrl: string | null;
  fiscalEkassaInn: string | null;
  fiscalYakassaApiKey: string | null;
  fiscalYakassaUrl: string | null;
  updatedAt: string;
}

export interface PublicSettings {
  cafeName: string;
  address: string;
  phone: string;
  phone2: string;
  instagram: string | null;
  website: string | null;
  receiptText: string;
  serviceChargeAmount: string;
  language: 'ru' | 'ky';
  paymentMethods: PaymentMethod[];
  qrImageUrl: string | null;
  printerConnected: boolean;
  fiscalEnabled: boolean;
}

/** Публичные настройки (реквизиты + включённые способы оплаты) — для всех ролей. */
export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: async () => (await api.get<PublicSettings>('/settings')).data,
    staleTime: 30_000,
  });
}

/** Полные настройки — только владелец. */
export function useAdminSettings() {
  return useQuery({
    queryKey: ['settings', 'admin'],
    queryFn: async () => (await api.get<Settings>('/admin/settings')).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export type SettingsInput = Partial<Omit<Settings, 'id' | 'updatedAt' | 'printerConnected' | 'serviceChargeAmount'>> & {
  serviceChargeAmount?: number;
};

/** Проверка соединения с ККМ (кнопка в блоке настроек). */
export function useTestFiscalConnection() {
  return useMutation({
    mutationFn: async () => (await api.post<{ ok: boolean }>('/fiscal/test-connection')).data,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['settings', 'admin'] });
      const previous = qc.getQueryData<Settings>(['settings', 'admin']);
      if (previous) {
        const { serviceChargeAmount, ...restPatch } = patch;
        const optimisticPatch: Partial<Settings> = {
          ...restPatch,
          ...(serviceChargeAmount !== undefined
            ? { serviceChargeAmount: String(serviceChargeAmount) }
            : {}),
        };
        qc.setQueryData<Settings>(['settings', 'admin'], {
          ...previous,
          ...optimisticPatch,
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
