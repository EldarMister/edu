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
  carts: Record<string, TableCart>;
  /** Выбранный стол (контекст меню/корзины), как в PWA. */
  tableId: string | null;
  tableNumber: number | null;
  hallName: string | null;
  /** Активный заказ стола — режим «добавить к заказу» вместо «создать». */
  activeOrderId: string | null;
  selectTable: (table: { id: string; number: number; hallName?: string }, activeOrderId?: string | null) => void;
  moveDraftTo: (table: { id: string; number: number; hallName?: string }, activeOrderId?: string | null) => void;
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
interface TableCart {
  lines: CartLine[];
  comment: string;
}

const EMPTY_CART: TableCart = { lines: [], comment: '' };

function sameLine(a: CartLine, dish: Dish, variant?: DishVariant): boolean {
  return !a.set && a.dish.id === dish.id && a.variant?.id === variant?.id;
}

function syncActiveCart(
  tableId: string | null,
  carts: Record<string, TableCart>,
  lines: CartLine[],
  comment: string,
) {
  if (!tableId) return { carts };
  return { carts: { ...carts, [tableId]: { lines, comment } } };
}

export const useCart = create<CartState>((set, get) => ({
  lines: [],
  comment: '',
  carts: {},
  tableId: null,
  tableNumber: null,
  hallName: null,
  activeOrderId: null,
  selectTable: (table, activeOrderId = null) =>
    set((s) => {
      const cart = s.carts[table.id] ?? EMPTY_CART;
      return {
        tableId: table.id,
        tableNumber: table.number,
        hallName: table.hallName ?? null,
        activeOrderId,
        lines: cart.lines,
        comment: cart.comment,
      };
    }),
  moveDraftTo: (table, activeOrderId = null) =>
    set((s) => {
      const draft = { lines: s.lines, comment: s.comment };
      const carts = { ...s.carts };
      if (s.tableId) delete carts[s.tableId];
      carts[table.id] = draft;
      return {
        tableId: table.id,
        tableNumber: table.number,
        hallName: table.hallName ?? null,
        activeOrderId,
        lines: draft.lines,
        comment: draft.comment,
        carts,
      };
    }),
  clearTable: () =>
    set((s) => ({
      tableId: null,
      tableNumber: null,
      hallName: null,
      activeOrderId: null,
      lines: [],
      comment: '',
      ...syncActiveCart(s.tableId, s.carts, [], ''),
    })),
  setOrderComment: (comment) =>
    set((s) => ({
      comment,
      ...syncActiveCart(s.tableId, s.carts, s.lines, comment),
    })),
  add: (dish, variant) =>
    set((s) => {
      const idx = s.lines.findIndex((l) => sameLine(l, dish, variant));
      let lines: CartLine[];
      if (idx >= 0) {
        lines = [...s.lines];
        lines[idx] = { ...lines[idx], quantity: lines[idx].quantity + 1 };
      } else {
        lines = [...s.lines, { dish, variant, quantity: 1 }];
      }
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment) };
    }),
  addLine: (line) =>
    set((s) => {
      const lines = [...s.lines, line];
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment) };
    }),
  setQuantity: (index, quantity) =>
    set((s) => {
      if (quantity <= 0) {
        const lines = s.lines.filter((_, i) => i !== index);
        return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment) };
      }
      const lines = [...s.lines];
      lines[index] = { ...lines[index], quantity };
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment) };
    }),
  setComment: (index, comment) =>
    set((s) => {
      const lines = [...s.lines];
      lines[index] = { ...lines[index], comment };
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment) };
    }),
  setTakeaway: (index, takeaway) =>
    set((s) => {
      const lines = [...s.lines];
      lines[index] = { ...lines[index], takeaway };
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment) };
    }),
  remove: (index) =>
    set((s) => {
      const lines = s.lines.filter((_, i) => i !== index);
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment) };
    }),
  clear: () =>
    set((s) => {
      const carts = { ...s.carts };
      if (s.tableId) delete carts[s.tableId];
      return { lines: [], comment: '', carts };
    }),
  total: () => get().lines.reduce((sum, l) => sum + linePrice(l), 0),
  count: () => get().lines.reduce((sum, l) => sum + l.quantity, 0),
}));
