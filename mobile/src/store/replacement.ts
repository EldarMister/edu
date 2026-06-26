import { create } from 'zustand';
import type { OrderItem } from '@/types';

interface ReplacementTarget {
  orderId: string;
  table: { id: string; number: number; hallName?: string };
  item: OrderItem;
}

interface ReplacementState {
  target: ReplacementTarget | null;
  setTarget: (target: ReplacementTarget) => void;
  clear: () => void;
}

export const useReplacement = create<ReplacementState>((set) => ({
  target: null,
  setTarget: (target) => set({ target }),
  clear: () => set({ target: null }),
}));
