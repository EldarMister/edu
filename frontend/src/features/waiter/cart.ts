import { create } from 'zustand';
import type { CartLine, Dish } from '@/types';
import { dishUnitPrice } from '@/lib/format';

interface TableCart {
  lines: CartLine[];
  comment: string;
}

interface CartState {
  tableId: string | null;
  // Зеркало корзины активного стола (для удобства потребителей).
  lines: CartLine[];
  comment: string;
  // Черновики корзин по каждому столу — не сбрасываются при переключении.
  carts: Record<string, TableCart>;
  selectTable: (tableId: string) => void;
  add: (dish: Dish) => void;
  inc: (dishId: string) => void;
  dec: (dishId: string) => void;
  remove: (dishId: string) => void;
  setLineComment: (dishId: string, comment: string) => void;
  setComment: (comment: string) => void;
  clear: () => void;
}

const EMPTY: TableCart = { lines: [], comment: '' };

/** Применяет изменение к корзине активного стола и синхронизирует зеркало. */
function mutate(s: CartState, fn: (cart: TableCart) => TableCart): Partial<CartState> {
  if (!s.tableId) return s;
  const current = s.carts[s.tableId] ?? EMPTY;
  const next = fn(current);
  return {
    lines: next.lines,
    comment: next.comment,
    carts: { ...s.carts, [s.tableId]: next },
  };
}

export const useCart = create<CartState>((set) => ({
  tableId: null,
  lines: [],
  comment: '',
  carts: {},

  // Переключение стола сохраняет корзину прежнего и восстанавливает корзину нового.
  selectTable: (tableId) =>
    set((s) => {
      if (s.tableId === tableId) return s;
      const c = s.carts[tableId] ?? EMPTY;
      return { tableId, lines: c.lines, comment: c.comment };
    }),

  add: (dish) =>
    set((s) =>
      mutate(s, (c) => {
        const existing = c.lines.find((l) => l.dish.id === dish.id);
        const lines = existing
          ? c.lines.map((l) => (l.dish.id === dish.id ? { ...l, quantity: l.quantity + 1 } : l))
          : [...c.lines, { dish, quantity: 1 }];
        return { ...c, lines };
      }),
    ),

  inc: (dishId) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines.map((l) => (l.dish.id === dishId ? { ...l, quantity: l.quantity + 1 } : l)),
      })),
    ),

  dec: (dishId) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines
          .map((l) => (l.dish.id === dishId ? { ...l, quantity: l.quantity - 1 } : l))
          .filter((l) => l.quantity > 0),
      })),
    ),

  remove: (dishId) =>
    set((s) => mutate(s, (c) => ({ ...c, lines: c.lines.filter((l) => l.dish.id !== dishId) }))),

  setLineComment: (dishId, comment) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines.map((l) => (l.dish.id === dishId ? { ...l, comment } : l)),
      })),
    ),

  setComment: (comment) => set((s) => mutate(s, (c) => ({ ...c, comment }))),

  // Очищает корзину активного стола (после отправки заказа).
  clear: () =>
    set((s) => {
      if (!s.tableId) return { lines: [], comment: '' };
      const carts = { ...s.carts };
      delete carts[s.tableId];
      return { lines: [], comment: '', carts };
    }),
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
