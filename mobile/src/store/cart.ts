import { create } from 'zustand';
import type { CartLine, Dish, DishVariant } from '@/types';

/** Цена линии с учётом варианта и количества. */
export function linePrice(line: CartLine): number {
  const base = Number(line.variant?.price ?? line.dish.price);
  return base * line.quantity;
}

interface CartState {
  lines: CartLine[];
  comment: string;
  /** Выбранный стол (контекст меню/корзины), как в PWA. */
  tableId: string | null;
  tableNumber: number | null;
  hallName: string | null;
  /** Активный заказ стола — режим «добавить к заказу» вместо «создать». */
  activeOrderId: string | null;
  selectTable: (table: { id: string; number: number; hallName?: string }, activeOrderId?: string | null) => void;
  clearTable: () => void;
  setOrderComment: (comment: string) => void;
  add: (dish: Dish, variant?: DishVariant) => void;
  addLine: (line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  setComment: (index: number, comment: string) => void;
  setTakeaway: (index: number, takeaway: boolean) => void;
  remove: (index: number) => void;
  clear: () => void;
  total: () => number;
  count: () => number;
}

/** Ключ слияния обычных позиций (сеты не сливаются — у них lineId). */
function sameLine(a: CartLine, dish: Dish, variant?: DishVariant): boolean {
  return !a.set && a.dish.id === dish.id && a.variant?.id === variant?.id;
}

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  comment: '',
  tableId: null,
  tableNumber: null,
  hallName: null,
  activeOrderId: null,
  selectTable: (table, activeOrderId = null) =>
    set({
      tableId: table.id,
      tableNumber: table.number,
      hallName: table.hallName ?? null,
      activeOrderId,
      // Новый стол — чистим черновик корзины.
      lines: [],
      comment: '',
    }),
  clearTable: () =>
    set({ tableId: null, tableNumber: null, hallName: null, activeOrderId: null, lines: [], comment: '' }),
  setOrderComment: (comment) => set({ comment }),
  add: (dish, variant) =>
    set((s) => {
      const idx = s.lines.findIndex((l) => sameLine(l, dish, variant));
      if (idx >= 0) {
        const lines = [...s.lines];
        lines[idx] = { ...lines[idx], quantity: lines[idx].quantity + 1 };
        return { lines };
      }
      return { lines: [...s.lines, { dish, variant, quantity: 1 }] };
    }),
  addLine: (line) => set((s) => ({ lines: [...s.lines, line] })),
  setQuantity: (index, quantity) =>
    set((s) => {
      if (quantity <= 0) return { lines: s.lines.filter((_, i) => i !== index) };
      const lines = [...s.lines];
      lines[index] = { ...lines[index], quantity };
      return { lines };
    }),
  setComment: (index, comment) =>
    set((s) => {
      const lines = [...s.lines];
      lines[index] = { ...lines[index], comment };
      return { lines };
    }),
  setTakeaway: (index, takeaway) =>
    set((s) => {
      const lines = [...s.lines];
      lines[index] = { ...lines[index], takeaway };
      return { lines };
    }),
  remove: (index) => set((s) => ({ lines: s.lines.filter((_, i) => i !== index) })),
  clear: () => set({ lines: [], comment: '' }),
  total: () => get().lines.reduce((sum, l) => sum + linePrice(l), 0),
  count: () => get().lines.reduce((sum, l) => sum + l.quantity, 0),
}));
