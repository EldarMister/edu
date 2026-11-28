import { create } from 'zustand';
import type { CartLine, CartSetComponent, Dish, DishVariant } from '@/types';
import { dishUnitPrice, roundOrderAmount } from '@/lib/format';

interface CartDraft {
  lines: CartLine[];
  comment: string;
  // Открыто ли поле комментария. Закрытое поле НЕ отправляется с заказом,
  // но текст сохраняется (снова покажется при открытии).
  commentOpen: boolean;
}

export type CartModifiers = Pick<CartLine, 'modifierSelections' | 'excludedIngredientIds' | 'excludedIngredientNames'>;

type CartTarget = { kind: 'table'; tableId: string } | { kind: 'delivery'; orderId?: string };

interface CartState {
  target: CartTarget | null;
  // Зеркало активной корзины для меню и панели заказа.
  lines: CartLine[];
  comment: string;
  commentOpen: boolean;
  carts: Record<string, CartDraft>;
  select: (target: CartTarget | null) => void;
  selectTable: (tableId: string) => void;
  // Переносит текущий черновик корзины на другой стол (смена стола на экране меню).
  moveDraftTo: (targetTableId: string) => void;
  moveNewOrderDraft: (target: CartTarget) => boolean;
  add: (dish: Dish, variant?: DishVariant, weightGrams?: number, modifiers?: CartModifiers) => void;
  /** Добавляет сет отдельной линией (сеты не сливаются — у каждого свой состав). */
  addSet: (dish: Dish, components: CartSetComponent[], modifiers?: CartModifiers) => void;
  replaceLines: (lines: CartLine[], comment: string) => void;
  inc: (lineKey: string) => void;
  dec: (lineKey: string) => void;
  remove: (lineKey: string) => void;
  setLineModifiers: (lineKey: string, modifiers: CartModifiers) => void;
  setLineComment: (lineKey: string, comment: string) => void;
  setLineTakeaway: (lineKey: string, takeaway: boolean) => void;
  /** Пометить «с собой» все позиции (тумблер на весь заказ). */
  setAllTakeaway: (takeaway: boolean) => void;
  setComment: (comment: string) => void;
  /** Показать/скрыть поле комментария (закрытое не уходит с заказом). */
  setCommentOpen: (open: boolean) => void;
  clear: () => void;
}

const EMPTY: CartDraft = { lines: [], comment: '', commentOpen: false };

function draftKey(target: CartTarget) {
  return target.kind === 'table' ? `table:${target.tableId}` : `delivery:${target.orderId ?? ''}`;
}

export function cartLineKeyFromParts(dishId: string, variantId?: string | null, weightGrams?: number | null, modifiers?: CartModifiers) {
  const selected = (modifiers?.modifierSelections ?? []).map((option) => `${option.optionId}:${option.quantity}`).sort().join(',');
  const excluded = (modifiers?.excludedIngredientIds ?? []).slice().sort().join(',');
  return `${dishId}:${variantId ?? 'base'}:${weightGrams ?? 'fixed'}:${selected}:${excluded}`;
}

export function cartLineKey(line: CartLine) {
  return line.lineId ?? cartLineKeyFromParts(line.dish.id, line.variant?.id, line.weightGrams, line);
}

export function cartLineName(line: CartLine) {
  if (line.set) return line.dish.name;
  if (line.variant) return `${line.dish.name} · ${line.variant.name}`;
  if (line.weightGrams) {
    const volume = line.dish.weightedMeasure === 'volume';
    const amount = line.weightGrams;
    const value = amount < 1000 ? amount : Number((amount / 1000).toFixed(2));
    const unit = amount < 1000 ? (volume ? 'мл' : 'г') : (volume ? 'л' : 'кг');
    return `${line.dish.name} · ${value} ${unit}`;
  }
  return line.dish.name;
}

/** У сета изменён состав, если есть убранные/заменённые позиции. */
export function cartSetChanged(line: CartLine) {
  return !!line.set?.components.some((c) => c.action !== 'default');
}

export function cartLineBasePrice(line: CartLine) {
  const extra = (line.modifierSelections ?? []).reduce((sum, option) => sum + Number(option.price) * option.quantity, 0);
  if (line.dish.isWeighted && line.weightGrams) {
    return Number(line.dish.price) * line.weightGrams / (line.dish.weightedPriceBase ?? 100) + extra;
  }
  return Number(line.variant?.price ?? line.dish.price) + extra;
}

export function cartLineUnitPrice(line: CartLine) {
  return dishUnitPrice(String(cartLineBasePrice(line)), line.dish.discountType, line.dish.discountValue);
}

function mutate(s: CartState, fn: (cart: CartDraft) => CartDraft): Partial<CartState> {
  if (!s.target) return s;
  const key = draftKey(s.target);
  const current = s.carts[key] ?? EMPTY;
  const next = fn(current);
  return {
    lines: next.lines,
    comment: next.comment,
    commentOpen: next.commentOpen,
    carts: { ...s.carts, [key]: next },
  };
}

export const useCart = create<CartState>((set, get) => ({
  target: null,
  lines: [],
  comment: '',
  commentOpen: false,
  carts: {},

  select: (target) => set((s) => ({ target, ...(target ? s.carts[draftKey(target)] ?? EMPTY : EMPTY) })),
  selectTable: (tableId) => get().select({ kind: 'table', tableId }),

  // Переносит черновик текущего стола на целевой (перезаписывает его черновик) и переключается.
  moveDraftTo: (targetTableId) =>
    set((s) => {
      if (s.target?.kind !== 'table' || s.target.tableId === targetTableId) return s;
      const from = draftKey(s.target);
      const target = { kind: 'table', tableId: targetTableId } as const;
      const current = s.carts[from] ?? EMPTY;
      const carts = { ...s.carts };
      delete carts[from];
      carts[draftKey(target)] = current;
      return {
        target,
        lines: current.lines,
        comment: current.comment,
        commentOpen: current.commentOpen,
        carts,
      };
    }),

  moveNewOrderDraft: (target) => {
    const { target: current, carts } = get();
    const from = current && draftKey(current);
    const to = draftKey(target);
    if (from === to) return true;
    const draft = from ? carts[from] : undefined;
    const destination = carts[to];
    if (destination?.lines.length && (draft?.lines.length || draft?.comment)) return false;
    const next = draft?.lines.length || draft?.comment ? draft : destination ?? EMPTY;
    const nextCarts = { ...carts, [to]: next };
    if (from) delete nextCarts[from];
    set({ target, ...next, carts: nextCarts });
    return true;
  },

  add: (dish, variant, weightGrams, modifiers) =>
    set((s) =>
      mutate(s, (c) => {
        const key = cartLineKeyFromParts(dish.id, variant?.id, weightGrams, modifiers);
        const existing = c.lines.find((l) => cartLineKey(l) === key);
        const lines = existing
          ? c.lines.map((l) => (cartLineKey(l) === key ? { ...l, quantity: l.quantity + 1 } : l))
          : [...c.lines, { dish, variant, weightGrams, quantity: 1, ...modifiers }];
        return { ...c, lines };
      }),
    ),

  addSet: (dish, components, modifiers) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: [
          ...c.lines,
          {
            dish,
            quantity: 1,
            lineId: `set-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            set: { components },
            ...modifiers,
          },
        ],
      })),
    ),

  // Загружает позиции существующего заказа в корзину активного стола (режим редактирования).
  // Если у заказа уже есть комментарий — поле сразу открыто.
  replaceLines: (lines, comment) =>
    set((s) => mutate(s, () => ({ lines, comment, commentOpen: comment.trim().length > 0 }))),

  inc: (lineKey) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines.map((l) => (cartLineKey(l) === lineKey && l.editAllowed !== false ? { ...l, quantity: l.quantity + 1 } : l)),
      })),
    ),

  dec: (lineKey) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines
          .map((l) => (cartLineKey(l) === lineKey && l.editAllowed !== false && l.cancelAllowed !== false ? { ...l, quantity: l.quantity - 1 } : l))
          .filter((l) => l.quantity > 0),
      })),
    ),

  remove: (lineKey) =>
    set((s) => mutate(s, (c) => ({ ...c, lines: c.lines.filter((l) => cartLineKey(l) !== lineKey || l.editAllowed === false || l.cancelAllowed === false) }))),

  setLineModifiers: (lineKey, modifiers) => set((s) => mutate(s, (c) => ({ ...c, lines: c.lines.map((line) => cartLineKey(line) === lineKey && line.editAllowed !== false && line.cancelAllowed !== false ? { ...line, ...modifiers, lineId: line.lineId ?? `configured-${Date.now()}-${Math.random().toString(36).slice(2)}` } : line) }))),

  setLineComment: (lineKey, comment) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines.map((l) => (cartLineKey(l) === lineKey && l.editAllowed !== false ? { ...l, comment } : l)),
      })),
    ),

  setLineTakeaway: (lineKey, takeaway) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines.map((l) => (cartLineKey(l) === lineKey && l.editAllowed !== false ? { ...l, takeaway } : l)),
      })),
    ),

  setAllTakeaway: (takeaway) =>
    set((s) => mutate(s, (c) => ({ ...c, lines: c.lines.map((l) => l.editAllowed === false ? l : ({ ...l, takeaway })) }))),

  setComment: (comment) => set((s) => mutate(s, (c) => ({ ...c, comment }))),

  setCommentOpen: (open) => set((s) => mutate(s, (c) => ({ ...c, commentOpen: open }))),

  // Очищает корзину активного стола (после отправки заказа).
  clear: () =>
    set((s) => {
      if (!s.target) return EMPTY;
      const carts = { ...s.carts };
      delete carts[draftKey(s.target)];
      return { lines: [], comment: '', commentOpen: false, carts };
    }),
}));

export function cartTotals(lines: CartLine[], roundTotal = false) {
  let total = 0;
  let discount = 0;
  let roundedLineSum = 0;
  let count = 0;
  for (const l of lines) {
    const unit = Number(cartLineBasePrice(l));
    const unitFinal = cartLineUnitPrice(l);
    total += unit * l.quantity;
    discount += (unit - unitFinal) * l.quantity;
    roundedLineSum += Math.round(unitFinal * l.quantity * 100) / 100;
    count += l.quantity;
  }
  const beforeRounding = roundTotal ? roundedLineSum : total - discount;
  const final = roundTotal ? roundOrderAmount(beforeRounding) : beforeRounding;
  return { total, discount, final, count, roundingAmount: Math.round((beforeRounding - final) * 100) / 100 };
}
