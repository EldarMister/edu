import { create } from 'zustand';
import type { Receipt, ReceiptPrintRequest, ReceiptPrintStatus } from '@/types';

interface ReceiptPrintState {
  request: ReceiptPrintRequest | null;
  receipt: Receipt | null;
  status: ReceiptPrintStatus;
  sheetOpen: boolean;
  begin: (request: ReceiptPrintRequest, receipt: Receipt) => void;
  resolve: (status: ReceiptPrintStatus) => void;
  closeSheet: () => void;
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
