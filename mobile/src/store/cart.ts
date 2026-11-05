import { create } from 'zustand';
import type { CartLine, Dish, DishVariant } from '@/types';
import { dishUnitPrice } from '@/utils/format';
import { calcSetPrice } from '@/utils/set';

/** Цена линии с учётом варианта и количества. */
export function linePrice(line: CartLine): number {
  return cartLineUnitPrice(line) * line.quantity;
}

export function cartLineKey(line: CartLine): string {
  return line.lineId ?? `${line.dish.id}:${line.variant?.id ?? 'base'}:${line.weightGrams ?? 'fixed'}`;
}

export function cartLineName(line: CartLine): string {
  if (line.set) return line.dish.name;
  if (line.variant) return `${line.dish.name} · ${line.variant.name}`;
  if (line.weightGrams) return `${line.dish.name} · ${formatWeightedAmount(line.weightGrams, line.dish.weightedMeasure)}`;
  return line.dish.name;
}

export function formatWeightedAmount(amount: number, measure: Dish['weightedMeasure'] = 'weight') {
  const volume = measure === 'volume';
  if (amount < 1000) return `${amount} ${volume ? 'мл' : 'г'}`;
  const scaled = amount / 1000;
  const value = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${value} ${volume ? 'л' : 'кг'}`;
}

export function cartLineUnitPrice(line: CartLine): number {
  const weightedBase = line.dish.isWeighted && line.weightGrams
    ? String(Number(line.dish.price) * line.weightGrams / (line.dish.weightedPriceBase ?? 100))
    : undefined;
  const base = dishUnitPrice(
    weightedBase ?? line.variant?.price ?? line.dish.price,
    line.dish.discountType,
    line.dish.discountValue,
  );
  return line.set ? calcSetPrice(String(base), line.set.components) : base;
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + linePrice(line), 0);
}

interface CartState {
  pendingTables: Record<string, CartLine[]>;
  beginSubmission: (tableId: string) => boolean;
  endSubmission: (tableId: string, submittedLines: CartLine[]) => void;
  completeSubmission: (tableId: string, submittedLines: CartLine[], orderId: string) => boolean;
  lines: CartLine[];
  comment: string;
  /** Открыто ли поле комментария. Закрытое поле не уходит с заказом,
   *  но текст сохраняется (снова покажется при открытии). */
  commentOpen: boolean;
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
  /** Показать/скрыть поле комментария (закрытое не уходит с заказом). */
  setCommentOpen: (open: boolean) => void;
  add: (dish: Dish, variant?: DishVariant, weightGrams?: number) => void;
  addLine: (line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  setComment: (index: number, comment: string) => void;
  setTakeaway: (index: number, takeaway: boolean) => void;
  setAllTakeaway: (takeaway: boolean) => void;
  remove: (index: number) => void;
  clear: () => void;
  resetAll: () => void;
  total: () => number;
  count: () => number;
}

/** Ключ слияния обычных позиций (сеты не сливаются — у них lineId). */
interface TableCart {
  lines: CartLine[];
  comment: string;
  commentOpen?: boolean;
  editingOrderId?: string | null;
  editingOrderNumber?: string | null;
}

const EMPTY_CART: TableCart = { lines: [], comment: '' };

function sameLine(a: CartLine, dish: Dish, variant?: DishVariant, weightGrams?: number): boolean {
  return !a.set && !a.orderItemId && a.dish.id === dish.id && a.variant?.id === variant?.id && a.weightGrams === weightGrams;
}

function syncActiveCart(
  tableId: string | null,
  carts: Record<string, TableCart>,
  lines: CartLine[],
  comment: string,
  context: Pick<CartState, 'commentOpen' | 'editingOrderId' | 'editingOrderNumber'>,
) {
  if (!tableId) return { carts };
  return { carts: { ...carts, [tableId]: { lines, comment, commentOpen: context.commentOpen, editingOrderId: context.editingOrderId, editingOrderNumber: context.editingOrderNumber } } };
}

export const useCart = create<CartState>((set, get) => ({
  pendingTables: {},
  beginSubmission: (tableId) => {
    const current = get();
    if (current.tableId !== tableId || current.pendingTables[tableId]) return false;
    set((s) => ({ pendingTables: { ...s.pendingTables, [tableId]: current.lines } }));
    return true;
  },
  endSubmission: (tableId, submittedLines) => set((s) => {
    if (s.pendingTables[tableId] !== submittedLines) return s;
    const pendingTables = { ...s.pendingTables };
    delete pendingTables[tableId];
    return { pendingTables };
  }),
  completeSubmission: (tableId, submittedLines, orderId) => {
    let cleared = false;
    set((s) => {
      const active = s.tableId === tableId;
      const current = active ? s.lines : s.carts[tableId]?.lines;
      // A late response owns only the submitted draft version, never another table.
      if (s.pendingTables[tableId] !== submittedLines || current !== submittedLines) return s;
      cleared = true;
      const carts = { ...s.carts };
      delete carts[tableId];
      return active
        ? { carts, lines: [], comment: '', commentOpen: false, editingOrderId: null, editingOrderNumber: null, activeOrderId: orderId }
        : { carts };
    });
    return cleared;
  },
  lines: [],
  comment: '',
  commentOpen: false,
  carts: {},
  tableId: null,
  tableNumber: null,
  hallName: null,
  activeOrderId: null,
  editingOrderId: null,
  editingOrderNumber: null,
  selectTable: (table, activeOrderId = null) =>
    set((s) => {
      const saved = s.carts[table.id] ?? EMPTY_CART;
      // An edit must never be reinterpreted as new items after switching tables.
      const cart = !s.pendingTables[table.id] && saved.editingOrderId && saved.editingOrderId !== activeOrderId ? EMPTY_CART : saved;
      return {
        tableId: table.id,
        tableNumber: table.number,
        hallName: table.hallName ?? null,
        activeOrderId,
        editingOrderId: cart.editingOrderId ?? null,
        editingOrderNumber: cart.editingOrderNumber ?? null,
        lines: cart.lines,
        comment: cart.comment,
        commentOpen: cart.commentOpen ?? (cart.comment ?? '').trim().length > 0,
      };
    }),
  moveDraftTo: (table, activeOrderId = null) =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      if (s.editingOrderId || s.pendingTables[table.id]) return s;
      const draft = { lines: s.lines, comment: s.comment, commentOpen: s.commentOpen };
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
        commentOpen: draft.commentOpen,
        carts,
      };
    }),
  clearTable: () =>
    set((s) => s.tableId && s.pendingTables[s.tableId] ? s : ({
      tableId: null,
      tableNumber: null,
      hallName: null,
      activeOrderId: null,
      editingOrderId: null,
      editingOrderNumber: null,
      lines: [],
      comment: '',
      commentOpen: false,
      ...syncActiveCart(s.tableId, s.carts, [], '', { commentOpen: false, editingOrderId: null, editingOrderNumber: null }),
    })),
  startEditing: (table, order, lines) =>
    set((s) => s.pendingTables[table.id] ? s : ({
      tableId: table.id,
      tableNumber: table.number,
      hallName: table.hallName ?? null,
      activeOrderId: order.id,
      editingOrderId: order.id,
      editingOrderNumber: order.orderNumber,
      lines,
      comment: order.comment ?? '',
      commentOpen: (order.comment ?? '').trim().length > 0,
      ...syncActiveCart(table.id, s.carts, lines, order.comment ?? '', { commentOpen: (order.comment ?? '').trim().length > 0, editingOrderId: order.id, editingOrderNumber: order.orderNumber }),
    })),
  cancelEditing: () =>
    set((s) => s.tableId && s.pendingTables[s.tableId] ? s : ({
      editingOrderId: null,
      editingOrderNumber: null,
      lines: [],
      comment: '',
      commentOpen: false,
      ...syncActiveCart(s.tableId, s.carts, [], '', { commentOpen: false, editingOrderId: null, editingOrderNumber: null }),
    })),
  replaceLines: (lines, comment = '') =>
    set((s) => s.tableId && s.pendingTables[s.tableId] ? s : ({
      lines,
      comment: comment ?? '',
      commentOpen: (comment ?? '').trim().length > 0,
      ...syncActiveCart(s.tableId, s.carts, lines, comment ?? '', { ...s, commentOpen: (comment ?? '').trim().length > 0 }),
    })),
  setOrderComment: (comment) =>
    set((s) => s.tableId && s.pendingTables[s.tableId] ? s : ({
      comment,
      ...syncActiveCart(s.tableId, s.carts, s.lines, comment, s),
    })),
  setCommentOpen: (open) => set((s) => s.tableId && s.pendingTables[s.tableId] ? s : ({ commentOpen: open, ...syncActiveCart(s.tableId, s.carts, s.lines, s.comment, { ...s, commentOpen: open }) })),
  add: (dish, variant, weightGrams) =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      const idx = s.lines.findIndex((l) => sameLine(l, dish, variant, weightGrams));
      let lines: CartLine[];
      if (idx >= 0) {
        lines = [...s.lines];
        lines[idx] = { ...lines[idx], quantity: lines[idx].quantity + 1 };
      } else {
        lines = [...s.lines, { dish, variant, weightGrams, quantity: 1 }];
      }
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment, s) };
    }),
  addLine: (line) =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      const lines = [...s.lines, line];
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment, s) };
    }),
  setQuantity: (index, quantity) =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      const current = s.lines[index];
      if (!current || !Number.isFinite(quantity) || current.editAllowed === false || (quantity < current.quantity && current.cancelAllowed === false)) return s;
      if (quantity <= 0) {
        const lines = s.lines.filter((_, i) => i !== index);
        return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment, s) };
      }
      const lines = [...s.lines];
      lines[index] = { ...lines[index], quantity };
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment, s) };
    }),
  setComment: (index, comment) =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      if (!s.lines[index] || s.lines[index].editAllowed === false) return s;
      const lines = [...s.lines];
      lines[index] = { ...lines[index], comment };
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment, s) };
    }),
  setTakeaway: (index, takeaway) =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      if (!s.lines[index] || s.lines[index].editAllowed === false) return s;
      const lines = [...s.lines];
      lines[index] = { ...lines[index], takeaway };
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment, s) };
    }),
  setAllTakeaway: (takeaway) =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      const lines = s.lines.map((line) => line.editAllowed === false ? line : ({ ...line, takeaway }));
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment, s) };
    }),
  remove: (index) =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      if (!s.lines[index] || s.lines[index].editAllowed === false || s.lines[index].cancelAllowed === false) return s;
      const lines = s.lines.filter((_, i) => i !== index);
      return { lines, ...syncActiveCart(s.tableId, s.carts, lines, s.comment, s) };
    }),
  clear: () =>
    set((s) => {
      if (s.tableId && s.pendingTables[s.tableId]) return s;
      const carts = { ...s.carts };
      if (s.tableId) delete carts[s.tableId];
      return { lines: [], comment: '', commentOpen: false, carts, editingOrderId: null, editingOrderNumber: null };
    }),
  resetAll: () => set({ pendingTables: {}, lines: [], comment: '', commentOpen: false, carts: {}, tableId: null, tableNumber: null, hallName: null, activeOrderId: null, editingOrderId: null, editingOrderNumber: null }),
  total: () => cartTotal(get().lines),
  count: () => get().lines.reduce((sum, l) => sum + l.quantity, 0),
}));
