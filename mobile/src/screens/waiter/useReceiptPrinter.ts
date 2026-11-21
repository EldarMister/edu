import { isAxiosError } from 'axios';
import { api, apiError } from '@/lib/api';
import { printNativeReceipt } from '@/screens/admin/print';
import type { FiscalResult } from '@/services/api/admin';
import { usePublicSettings } from '@/services/api/settings';
import { useNotifications } from '@/store/notifications';
import type { Receipt } from '@/types';

export function useReceiptPrinter() {
  const settings = usePublicSettings();
  const push = useNotifications((state) => state.push);

  return async (orderId: string, options: { preliminary?: boolean; requestId?: string; signal?: AbortSignal } = {}) => {
    const { preliminary, requestId, signal } = options;
    const params = { print: 'true', requestId };
    const receipt = (await api.get<Receipt>(`/payments/${orderId}/receipt`, { params, signal })).data;
    if (signal?.aborted) return;
    let fiscal: FiscalResult | undefined;
    if (!preliminary && settings.data?.fiscalEnabled) {
      try {
        const result = (await api.post<FiscalResult | null>(`/fiscal/orders/${orderId}/print`, undefined, { params: { requestId }, signal })).data;
        if (result?.success) fiscal = result;
        else if (result?.error) push({ message: `Ошибка ККМ: ${result.error}`, type: 'error', at: new Date().toISOString() });
      } catch (error) {
        if (signal?.aborted || isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)) throw error;
        push({ message: `ККМ недоступна: ${apiError(error)}`, type: 'error', at: new Date().toISOString() });
      }
    }
    if (!signal?.aborted) await printNativeReceipt(receipt, preliminary, fiscal, signal);
  };
}
