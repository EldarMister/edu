import { create } from 'zustand';
import type { CartLine, Dish, DishVariant } from '@/types';
import { dishUnitPrice } from '@/utils/format';
import { calcSetPrice } from '@/utils/set';

/** Цена линии с учётом варианта и количества. */
export function linePrice(line: CartLine): number {
  return cartLineUnitPrice(line) * line.quantity;
}

export function cartLineKey(line: CartLine): string {
  return line.lineId ?? `${line.dish.id}:${line.variant?.id ?? 'base'}`;
}

export function cartLineName(line: CartLine): string {
  if (line.set) return line.dish.name;
  return line.variant ? `${line.dish.name} · ${line.variant.name}` : line.dish.name;
}

export function cartLineUnitPrice(line: CartLine): number {
  const base = dishUnitPrice(
    line.variant?.price ?? line.dish.price,
    line.dish.discountType,
    line.dish.discountValue,
  );
  return line.set ? calcSetPrice(String(base), line.set.components) : base;
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + linePrice(line), 0);
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
  /** Редактирование существующего заказа через PATCH /orders/:id. */
  editingOrderId: string | null;
  editingOrderNumber: string | null;
  selectTable: (table: { id: string; number: number; hallName?: string }, activeOrderId?: string | null) => void;
  moveDraftTo: (table: { id: string; number: number; hallName?: string }, activeOrderId?: string | null) => void;
  clearTable: () => void;
  startEditing: (
    table: { id: string; number: number; hallName?: string },
    order: { id: string; orderNumber: string; comment?: string | null },
    lines: CartLine[],
  ) => void;
  cancelEditing: () => void;
  replaceLines: (lines: CartLine[], comment?: string | null) => void;
  setOrderComment: (comment: string) => void;
  add: (dish: Dish, variant?: DishVariant) => void;
  addLine: (line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  setComment: (index: number, comment: string) => void;
  setTakeaway: (index: number, takeaway: boolean) => void;
  setAllTakeaway: (takeaway: boolean) => void;
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
  editingOrderId: null,
  editingOrderNumber: null,
  selectTable: (table, activeOrderId = null) =>
    set((s) => {
      const cart = s.carts[table.id] ?? EMPTY_CART;
      return {
        tableId: table.id,
        tableNumber: table.number,
        hallName: table.hallName ?? null,
        activeOrderId,
        editingOrderId: null,
        editingOrderNumber: null,
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
        editingOrderId: null,
        editingOrderNumber: null,
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
      editingOrderId: null,
      editingOrderNumber: null,
      lines: [],
      comment: '',
      ...syncActiveCart(s.tableId, s.carts, [], ''),
    })),
  startEditing: (table, order, lines) =>
    set((s) => ({
      tableId: table.id,
      tableNumber: table.number,
      hallName: table.hallName ?? null,
      activeOrderId: order.id,
      editingOrderId: order.id,
      editingOrderNumber: order.orderNumber,
      lines,
      comment: order.comment ?? '',
      ...syncActiveCart(table.id, s.carts, lines, order.comment ?? ''),
    })),
  cancelEditing: () =>
    set((s) => ({
      editingOrderId: null,
      editingOrderNumber: null,
      lines: [],
      comment: '',
      ...syncActiveCart(s.tableId, s.carts, [], ''),
    })),
  replaceLines: (lines, comment = '') =>
    set((s) => ({
      lines,
      comment: comment ?? '',
      ...syncActiveCart(s.tableId, s.carts, lines, comment ?? ''),
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
  setAllTakeaway: (takeaway) =>
    set((s) => {
      const lines = s.lines.map((line) => ({ ...line, takeaway }));
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
      return { lines: [], comment: '', carts, editingOrderId: null, editingOrderNumber: null };
    }),
  total: () => cartTotal(get().lines),
  count: () => get().lines.reduce((sum, l) => sum + l.quantity, 0),
}));
