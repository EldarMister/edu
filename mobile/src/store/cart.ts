import { create } from 'zustand';
import type { CartCustomization, CartLine, Dish, DishVariant } from '@/types';

/** Цена линии с учётом варианта и количества. */
export function linePrice(line: CartLine): number {
  const base = Number(line.variant?.price ?? line.dish.price);
  const baseAmount = line.dish.isWeighted && line.weightGrams ? base * line.weightGrams / (line.dish.weightedPriceBase || 1000) : base;
  const additions = (line.modifierSelections ?? []).reduce((sum, option) => sum + Number(option.price) * option.quantity, 0);
  const unit = baseAmount + additions;
  const rate = Number(line.dish.discountValue) || 0;
  const discount = !line.set && line.dish.discountType === 'percent' ? unit * rate / 100
    : !line.set && line.dish.discountType === 'fixed' ? rate : 0;
  return Math.round(Math.max(0, unit - Math.max(0, discount)) * line.quantity * 100) / 100;
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
  add: (dish: Dish, variant?: DishVariant, customization?: CartCustomization) => void;
  addLine: (line: CartLine) => void;
  setCustomization: (index: number, customization: CartCustomization) => void;
  setQuantity: (index: number, quantity: number) => void;
  setComment: (index: number, comment: string) => void;
  setTakeaway: (index: number, takeaway: boolean) => void;
  remove: (index: number) => void;
  clear: () => void;
  total: () => number;
  count: () => number;
}

/** Ключ слияния обычных позиций (сеты не сливаются — у них lineId). */
function customizationKey(value: CartCustomization) {
  const options = (value.modifierSelections ?? []).map(({ optionId, quantity }) => [optionId, quantity] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([value.weightGrams ?? null, options, [...(value.excludedIngredientIds ?? [])].sort()]);
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
  add: (dish, variant, customization = {}) =>
    set((s) => {
      const key = customizationKey(customization);
      const idx = s.lines.findIndex((line) => !line.set && line.dish.id === dish.id && line.variant?.id === variant?.id && customizationKey(line) === key);
      if (idx >= 0) {
        const lines = [...s.lines];
        lines[idx] = { ...lines[idx], quantity: lines[idx].quantity + 1 };
        return { lines };
      }
      return { lines: [...s.lines, { dish, variant, quantity: 1, ...customization }] };
    }),
  addLine: (line) => set((s) => ({ lines: [...s.lines, line] })),
  setCustomization: (index, customization) => set((s) => ({
    lines: s.lines.map((line, i) => index === i ? { ...line, ...customization } : line),
  })),
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
