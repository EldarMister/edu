import { create } from 'zustand';
import type { CartLine, CartSetComponent, Dish, DishVariant } from '@/types';
import { dishUnitPrice } from '@/lib/format';

interface TableCart {
  lines: CartLine[];
  comment: string;
  // Открыто ли поле комментария. Закрытое поле НЕ отправляется с заказом,
  // но текст сохраняется (снова покажется при открытии).
  commentOpen: boolean;
}

interface CartState {
  tableId: string | null;
  // Зеркало корзины активного стола (для удобства потребителей).
  lines: CartLine[];
  comment: string;
  commentOpen: boolean;
  // Черновики корзин по каждому столу — не сбрасываются при переключении.
  carts: Record<string, TableCart>;
  selectTable: (tableId: string) => void;
  // Переносит текущий черновик корзины на другой стол (смена стола на экране меню).
  moveDraftTo: (targetTableId: string) => void;
  add: (dish: Dish, variant?: DishVariant) => void;
  /** Добавляет сет отдельной линией (сеты не сливаются — у каждого свой состав). */
  addSet: (dish: Dish, components: CartSetComponent[]) => void;
  replaceLines: (lines: CartLine[], comment: string) => void;
  inc: (lineKey: string) => void;
  dec: (lineKey: string) => void;
  remove: (lineKey: string) => void;
  setLineComment: (lineKey: string, comment: string) => void;
  setLineTakeaway: (lineKey: string, takeaway: boolean) => void;
  /** Пометить «с собой» все позиции (тумблер на весь заказ). */
  setAllTakeaway: (takeaway: boolean) => void;
  setComment: (comment: string) => void;
  /** Показать/скрыть поле комментария (закрытое не уходит с заказом). */
  setCommentOpen: (open: boolean) => void;
  clear: () => void;
}

const EMPTY: TableCart = { lines: [], comment: '', commentOpen: false };

export function cartLineKeyFromParts(dishId: string, variantId?: string | null) {
  return `${dishId}:${variantId ?? 'base'}`;
}

export function cartLineKey(line: CartLine) {
  return line.lineId ?? cartLineKeyFromParts(line.dish.id, line.variant?.id);
}

export function cartLineName(line: CartLine) {
  if (line.set) return line.dish.name;
  return line.variant ? `${line.dish.name} · ${line.variant.name}` : line.dish.name;
}

/** У сета изменён состав, если есть убранные/заменённые позиции. */
export function cartSetChanged(line: CartLine) {
  return !!line.set?.components.some((c) => c.action !== 'default');
}

export function cartLineBasePrice(line: CartLine) {
  return line.variant?.price ?? line.dish.price;
}

export function cartLineUnitPrice(line: CartLine) {
  return dishUnitPrice(cartLineBasePrice(line), line.dish.discountType, line.dish.discountValue);
}

/** Применяет изменение к корзине активного стола и синхронизирует зеркало. */
function mutate(s: CartState, fn: (cart: TableCart) => TableCart): Partial<CartState> {
  if (!s.tableId) return s;
  const current = s.carts[s.tableId] ?? EMPTY;
  const next = fn(current);
  return {
    lines: next.lines,
    comment: next.comment,
    commentOpen: next.commentOpen,
    carts: { ...s.carts, [s.tableId]: next },
  };
}

export const useCart = create<CartState>((set) => ({
  tableId: null,
  lines: [],
  comment: '',
  commentOpen: false,
  carts: {},

  // Переключение стола сохраняет корзину прежнего и восстанавливает корзину нового.
  selectTable: (tableId) =>
    set((s) => {
      if (s.tableId === tableId) return s;
      const c = s.carts[tableId] ?? EMPTY;
      return { tableId, lines: c.lines, comment: c.comment, commentOpen: c.commentOpen };
    }),

  // Переносит черновик текущего стола на целевой (перезаписывает его черновик) и переключается.
  moveDraftTo: (targetTableId) =>
    set((s) => {
      if (!s.tableId || s.tableId === targetTableId) return s;
      const current = s.carts[s.tableId] ?? EMPTY;
      const carts = { ...s.carts };
      delete carts[s.tableId];
      carts[targetTableId] = current;
      return {
        tableId: targetTableId,
        lines: current.lines,
        comment: current.comment,
        commentOpen: current.commentOpen,
        carts,
      };
    }),

  add: (dish, variant) =>
    set((s) =>
      mutate(s, (c) => {
        const key = cartLineKeyFromParts(dish.id, variant?.id);
        const existing = c.lines.find((l) => cartLineKey(l) === key);
        const lines = existing
          ? c.lines.map((l) => (cartLineKey(l) === key ? { ...l, quantity: l.quantity + 1 } : l))
          : [...c.lines, { dish, variant, quantity: 1 }];
        return { ...c, lines };
      }),
    ),

  addSet: (dish, components) =>
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
        lines: c.lines.map((l) => (cartLineKey(l) === lineKey ? { ...l, quantity: l.quantity + 1 } : l)),
      })),
    ),

  dec: (lineKey) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines
          .map((l) => (cartLineKey(l) === lineKey ? { ...l, quantity: l.quantity - 1 } : l))
          .filter((l) => l.quantity > 0),
      })),
    ),

  remove: (lineKey) =>
    set((s) => mutate(s, (c) => ({ ...c, lines: c.lines.filter((l) => cartLineKey(l) !== lineKey) }))),

  setLineComment: (lineKey, comment) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines.map((l) => (cartLineKey(l) === lineKey ? { ...l, comment } : l)),
      })),
    ),

  setLineTakeaway: (lineKey, takeaway) =>
    set((s) =>
      mutate(s, (c) => ({
        ...c,
        lines: c.lines.map((l) => (cartLineKey(l) === lineKey ? { ...l, takeaway } : l)),
      })),
    ),

  setAllTakeaway: (takeaway) =>
    set((s) => mutate(s, (c) => ({ ...c, lines: c.lines.map((l) => ({ ...l, takeaway })) }))),

  setComment: (comment) => set((s) => mutate(s, (c) => ({ ...c, comment }))),

  setCommentOpen: (open) => set((s) => mutate(s, (c) => ({ ...c, commentOpen: open }))),

  // Очищает корзину активного стола (после отправки заказа).
  clear: () =>
    set((s) => {
      if (!s.tableId) return { lines: [], comment: '', commentOpen: false };
      const carts = { ...s.carts };
      delete carts[s.tableId];
      return { lines: [], comment: '', commentOpen: false, carts };
    }),
}));

export function cartTotals(lines: CartLine[]) {
  let total = 0;
  let discount = 0;
  let count = 0;
  for (const l of lines) {
    const unit = Number(cartLineBasePrice(l));
    const unitFinal = cartLineUnitPrice(l);
    total += unit * l.quantity;
    discount += (unit - unitFinal) * l.quantity;
    count += l.quantity;
  }
  return { total, discount, final: total - discount, count };
}
