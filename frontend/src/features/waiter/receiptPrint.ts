import { create } from 'zustand';
import type { Receipt, ReceiptPrintRequest, ReceiptPrintStatus } from '@/types';

/**
 * Состояние активного запроса официанта на печать чека.
 * Живёт отдельно от UI, чтобы realtime-обработчик (useWaiterRealtime) и
 * нижний лист (ReceiptPrintSheet) работали с одними и теми же данными.
 */
interface ReceiptPrintState {
  request: ReceiptPrintRequest | null;
  /** Чек для печати на устройстве официанта после подтверждения админом. */
  receipt: Receipt | null;
  /** pending → ожидание, printed → успех, rejected → отказ. */
  status: ReceiptPrintStatus;
  sheetOpen: boolean;

  /** Создан новый запрос — открываем лист ожидания. */
  begin: (request: ReceiptPrintRequest, receipt: Receipt) => void;
  /** Пришло решение администратора — меняем состояние листа. */
  resolve: (status: ReceiptPrintStatus) => void;
  /** «Продолжить работу» в ожидании — закрываем лист, запрос остаётся активным. */
  closeSheet: () => void;
  /** «Готово» / закрытие после решения — полностью сбрасываем. */
  dismiss: () => void;
}

export const useReceiptPrint = create<ReceiptPrintState>((set) => ({
  request: null,
  receipt: null,
  status: 'pending',
  sheetOpen: false,

  begin: (request, receipt) => set({ request, receipt, status: 'pending', sheetOpen: true }),
  resolve: (status) => set({ status, sheetOpen: true }),
  closeSheet: () => set({ sheetOpen: false }),
  dismiss: () => set({ request: null, receipt: null, status: 'pending', sheetOpen: false }),
}));
