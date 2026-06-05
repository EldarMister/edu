import { create } from 'zustand';
import type { CartLine, Dish } from '@/types';
import { dishUnitPrice } from '@/lib/format';

interface CartState {
  tableId: string | null;
  lines: CartLine[];
  comment: string;
  selectTable: (tableId: string) => void;
  add: (dish: Dish) => void;
  inc: (dishId: string) => void;
  dec: (dishId: string) => void;
  remove: (dishId: string) => void;
  setLineComment: (dishId: string, comment: string) => void;
  setComment: (comment: string) => void;
  clear: () => void;
}

export const useCart = create<CartState>((set) => ({
  tableId: null,
  lines: [],
  comment: '',
  selectTable: (tableId) =>
    set((s) => (s.tableId === tableId ? s : { tableId, lines: [], comment: '' })),
  add: (dish) =>
    set((s) => {
      const existing = s.lines.find((l) => l.dish.id === dish.id);
      if (existing) {
        return {
          lines: s.lines.map((l) =>
            l.dish.id === dish.id ? { ...l, quantity: l.quantity + 1 } : l,
          ),
        };
      }
      return { lines: [...s.lines, { dish, quantity: 1 }] };
    }),
  inc: (dishId) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.dish.id === dishId ? { ...l, quantity: l.quantity + 1 } : l)),
    })),
  dec: (dishId) =>
    set((s) => ({
      lines: s.lines
        .map((l) => (l.dish.id === dishId ? { ...l, quantity: l.quantity - 1 } : l))
        .filter((l) => l.quantity > 0),
    })),
  remove: (dishId) => set((s) => ({ lines: s.lines.filter((l) => l.dish.id !== dishId) })),
  setLineComment: (dishId, comment) =>
    set((s) => ({
      lines: s.lines.map((l) => (l.dish.id === dishId ? { ...l, comment } : l)),
    })),
  setComment: (comment) => set({ comment }),
  clear: () => set({ lines: [], comment: '' }),
}));

export function cartTotals(lines: CartLine[]) {
  let total = 0;
  let discount = 0;
  let count = 0;
  for (const l of lines) {
    const unit = Number(l.dish.price);
    const unitFinal = dishUnitPrice(l.dish.price, l.dish.discountType, l.dish.discountValue);
    total += unit * l.quantity;
    discount += (unit - unitFinal) * l.quantity;
    count += l.quantity;
  }
  return { total, discount, final: total - discount, count };
}
