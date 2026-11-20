import { isAxiosError } from 'axios';
import { api, apiError } from '@/lib/api';
import { usePublicSettings } from '@/features/settings/api';
import { useFiscalizeForPrint } from '@/features/admin/api';
import { useNotifications } from '@/store/notifications';
import type { Receipt } from '@/types';
import { printReceipt, type FiscalPrintData } from './printReceipt';

export function useOrderReceiptPrinter() {
  const settings = usePublicSettings();
  const { mutateAsync: fiscalize } = useFiscalizeForPrint();
  const push = useNotifications((state) => state.push);

  return async (orderId: string, printWindow: Window, {
    preliminary = false, requestId, onAfterPrint,
  }: { preliminary?: boolean; requestId?: string; onAfterPrint?: () => void } = {}) => {
    const receipt = (await api.get<Receipt>(`/payments/${orderId}/receipt`, {
      params: { print: true, requestId },
    })).data;
    let fiscal: FiscalPrintData | undefined;
    if (!preliminary && settings.data?.fiscalEnabled) {
      try {
        const result = await fiscalize({ orderId, requestId });
        if (result?.success) {
          fiscal = { receiptNumber: result.fiscalReceiptNumber, sign: result.fiscalSign, qrCode: result.qrCode };
        } else if (result?.error) {
          push({ message: `ККМ вернула ошибку: ${result.error}`, type: 'error', at: new Date().toISOString() });
        }
      } catch (error) {
        if (isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0)) throw error;
        push({ message: `ККМ недоступна: ${apiError(error)}`, type: 'error', at: new Date().toISOString() });
      }
    }
    await printReceipt(receipt, printWindow, { preliminary, fiscal, onAfterPrint });
  };
}
