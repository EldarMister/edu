import { useEffect, useMemo, useRef, useState } from 'react';
import type { CartSetComponent, Category, Dish } from '@/types';
import { money } from '@/lib/format';

const SHEET_MS = 440;
const SHEET_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** Состав сета по умолчанию (все позиции без изменений). */
export function defaultSetComponents(set: Dish): CartSetComponent[] {
  return (set.setComponents ?? []).map((c) => ({
    componentId: c.id,
    originalDishId: c.dish.id,
    originalVariantId: c.dishVariant?.id,
    // Название с вариантом (например, «Coca-Cola 1 л») и цена варианта, если он задан.
    originalName: c.dishVariant ? `${c.dish.name} ${c.dishVariant.name}` : c.dish.name,
    originalPrice: c.dishVariant?.price ?? c.dish.price,
    quantity: c.quantity,
    removable: c.removable,
    replaceable: c.replaceable,
    action: 'default' as const,
  }));
}

/** Вычисляет итоговую цену сета с учётом изменений состава. */
function calcSetPrice(basePrice: string, components: CartSetComponent[]): number {
  let delta = 0;
  for (const c of components) {
    if (c.action === 'removed') {
      delta -= Number(c.originalPrice) * c.quantity;
    } else if (c.action === 'replaced' && c.finalPrice !== undefined) {
      delta += (Number(c.finalPrice) - Number(c.originalPrice)) * c.quantity;
    }
  }
  return Math.max(0, Number(basePrice) + delta);
}

/**
 * Основа для bottom sheet с анимацией входа/выхода и свайпом вниз.
 * open=true  → анимируется вверх из translateY(100%)
 * open=false → анимируется вниз, затем компонент размонтируется
 */
function SheetShell({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startY = useRef<number | null>(null);
  const dragRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setRender(true);
      setDrag(0);
      dragRef.current = 0;
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setVisible(false);
    const id = setTimeout(() => {
      setRender(false);
      setDrag(0);
      dragRef.current = 0;
    }, SHEET_MS);
    return () => clearTimeout(id);
  }, [open]);

  if (!render) return null;

  const sheetTransform = visible ? `translateY(${drag}px)` : 'translateY(100%)';

  function onPointerDown(e: React.PointerEvent) {
    startY.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (startY.current === null) return;
    const dy = e.clientY - startY.current;
    const next = dy > 0 ? dy : 0;
    dragRef.current = next;
    setDrag(next);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (startY.current === null) return;
    startY.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
    if (dragRef.current > 110) onCloseRef.current();
    else requestAnimationFrame(() => { dragRef.current = 0; setDrag(0); });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      {/* Затемнение */}
      <div
        className="absolute inset-0 bg-black/40"
        style={{ transition: `opacity ${SHEET_MS}ms ease`, opacity: visible ? 1 : 0 }}
        onClick={onClose}
        aria-hidden
      />
      {/* Лист */}
      <div
        className="relative z-10 flex max-h-[82vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-soft"
        style={{
          transform: sheetTransform,
          transition: dragging ? 'none' : `transform ${SHEET_MS}ms ${SHEET_EASE}`,
        }}
        role="dialog"
      >
        {/* Drag handle + заголовок */}
        <div
          className="shrink-0 cursor-grab touch-none px-4 pb-1 pt-2.5"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bottom sheet «Выберите сет»: radio-список с глазком настройки. */
export function SetPickerSheet({
  open,
  sets,
  onClose,
  onPick,
  onConfigure,
}: {
  open: boolean;
  sets: Dish[];
  onClose: () => void;
  onPick: (set: Dish) => void;
  onConfigure: (set: Dish) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(sets[0]?.id ?? null);
  const selected = sets.find((s) => s.id === selectedId) ?? null;

  return (
    <SheetShell open={open} onClose={onClose} title="Сеты" subtitle="Выберите сет">
      <div className="no-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-3 pt-1">
        {sets.map((s) => {
          const isSel = s.id === selectedId;
          const count = (s.setComponents ?? []).reduce((sum, c) => sum + c.quantity, 0);
          return (
            <div
              key={s.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                isSel ? 'border-primary bg-primary/5' : 'border-border bg-white'
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={isSel}
                onClick={() => setSelectedId(s.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    isSel ? 'border-primary' : 'border-slate-400'
                  }`}
                >
                  {isSel && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-text-primary">{s.name}</span>
                  <span className="block text-xs text-text-muted">{count} блюд</span>
                </span>
                <span className="ml-auto shrink-0 text-[15px] font-semibold text-text-primary">
                  {money(s.price)}
                </span>
              </button>
              <button
                type="button"
                aria-label="Состав"
                onClick={() => onConfigure(s)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-light transition-colors hover:bg-background hover:text-primary"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          );
        })}
        {sets.length === 0 && <p className="py-8 text-center text-sm text-text-muted">Сетов пока нет</p>}
      </div>

      <div className="shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
        <button
          type="button"
          className="btn-primary h-12 w-full rounded-lg font-semibold disabled:opacity-50"
          disabled={!selected}
          onClick={() => selected && onPick(selected)}
        >
          Добавить
        </button>
      </div>
    </SheetShell>
  );
}

/** Bottom sheet «Настроить сет»: убрать / заменить блюда состава.
 *
 * При нажатии «Заменить» показываем полноценное меню выбора блюда
 * поверх основного контента (не отдельный sheet), чтобы UX был
 * таким же, как при выборе обычного блюда в меню.
 */
export function SetConfigSheet({
  open,
  set,
  menuDishes,
  categories,
  onClose,
  onAdd,
}: {
  open: boolean;
  set: Dish | null;
  /** Обычные блюда меню для замены (без сетов). */
  menuDishes: Dish[];
  categories: Category[];
  onClose: () => void;
  onAdd: (components: CartSetComponent[]) => void;
}) {
  const [components, setComponents] = useState<CartSetComponent[]>([]);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string>('all');

  // При открытии нового сета — сбрасываем состав
  useEffect(() => {
    if (set && open) {
      setComponents(defaultSetComponents(set));
      setReplacingId(null);
      setSearch('');
      setActiveCat('all');
    }
  }, [set?.id, open]);

  const currentPrice = useMemo(
    () => (set ? calcSetPrice(set.price, components) : 0),
    [set?.price, components],
  );

  function patch(componentId: string, p: Partial<CartSetComponent>) {
    setComponents((cur) => cur.map((c) => (c.componentId === componentId ? { ...c, ...p } : c)));
  }

  function toggleRemove(c: CartSetComponent) {
    patch(c.componentId, c.action === 'removed'
      ? { action: 'default' }
      : { action: 'removed', finalDishId: undefined, finalName: undefined, finalPrice: undefined });
  }

  function applyReplace(componentId: string, dish: Dish) {
    patch(componentId, {
      action: 'replaced',
      finalDishId: dish.id,
      finalName: dish.name,
      finalPrice: dish.price,
    });
    setReplacingId(null);
    setSearch('');
    setActiveCat('all');
  }

  function beginReplace(component: CartSetComponent) {
    const originalDish = menuDishes.find((d) => d.id === component.originalDishId);
    setReplacingId(component.componentId);
    setSearch('');
    setActiveCat(originalDish?.categoryId ?? 'all');
  }

  function cancelChange(componentId: string) {
    patch(componentId, { action: 'default', finalDishId: undefined, finalName: undefined, finalPrice: undefined });
  }

  // Список категорий для фильтрации в режиме замены
  const availableCats = useMemo(() => {
    const catIdsInMenu = new Set(menuDishes.map((d) => d.categoryId));
    return categories.filter((c) => catIdsInMenu.has(c.id));
  }, [menuDishes, categories]);

  const replaceOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuDishes.filter((d) => {
      const byAvail = d.isAvailable;
      const byCat = activeCat === 'all' || d.categoryId === activeCat;
      const byQ = !q || d.name.toLowerCase().includes(q);
      return byAvail && byCat && byQ;
    });
  }, [menuDishes, search, activeCat]);

  // Режим выбора блюда замены — полноэкранный overlay поверх sheet
  if (replacingId) {
    const replacingComp = components.find((c) => c.componentId === replacingId);
    return (
      <div className="fixed inset-0 z-[80] flex flex-col bg-white">
        {/* Шапка */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <button
            onClick={() => { setReplacingId(null); setSearch(''); setActiveCat('all'); }}
            aria-label="Назад"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-secondary hover:bg-background"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-text-primary">Выберите замену</h2>
            {replacingComp && (
              <p className="truncate text-xs text-text-muted">вместо: {replacingComp.originalName}</p>
            )}
          </div>
        </div>

        {/* Поиск */}
        <div className="shrink-0 px-4 pt-3 pb-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-light">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" />
              </svg>
            </span>
            <input
              className="input pl-9"
              placeholder="Поиск блюда"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Категории */}
        <div className="no-scrollbar shrink-0 flex gap-2 overflow-x-auto px-4 pb-2">
          <button
            onClick={() => setActiveCat('all')}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeCat === 'all' ? 'bg-primary text-white' : 'border border-border bg-white text-text-secondary hover:bg-background'
            }`}
          >
            Все
          </button>
          {availableCats.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeCat === c.id ? 'bg-primary text-white' : 'border border-border bg-white text-text-secondary hover:bg-background'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>

        {/* Список блюд */}
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {replaceOptions.length === 0 ? (
            <p className="py-12 text-center text-sm text-text-muted">Ничего не найдено</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 pt-1 pb-4">
              {replaceOptions.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => applyReplace(replacingId, d)}
                  className="flex h-[90px] flex-col rounded-xl border border-border bg-white px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 active:bg-primary/10"
                >
                  <span className="line-clamp-2 min-w-0 flex-1 text-[14px] font-medium leading-snug text-text-primary">
                    {d.name}
                  </span>
                  <span className="mt-auto text-[14px] font-semibold text-text-primary">
                    {money(d.price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasChanges = components.some((c) => c.action !== 'default');

  return (
    <SheetShell open={open} onClose={onClose} title="Настроить сет">
      {/* Инфо-блок: название + актуальная цена */}
      <div className="shrink-0 px-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2.5">
          <span className="text-[15px] font-semibold text-text-primary">{set?.name}</span>
          <div className="flex items-baseline gap-1.5">
            {hasChanges && set && Number(set.price) !== currentPrice && (
              <span className="text-[13px] text-text-light line-through">{money(set.price)}</span>
            )}
            <span
              className={`text-[15px] font-semibold transition-colors ${
                hasChanges ? 'text-primary' : 'text-text-primary'
              }`}
            >
              {money(currentPrice)}
            </span>
          </div>
        </div>
        <p className="mt-3 text-sm font-medium text-text-secondary">
          Состав сета ({components.length} позиций)
        </p>
      </div>

      {/* Список компонентов */}
      <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-3 pt-2">
        {components.map((c) => {
          const removed = c.action === 'removed';
          const replaced = c.action === 'replaced';
          const priceDiff = replaced && c.finalPrice !== undefined
            ? (Number(c.finalPrice) - Number(c.originalPrice)) * c.quantity
            : null;
          return (
            <div key={c.componentId} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors ${
              removed ? 'border-border bg-slate-50 opacity-60' : replaced ? 'border-primary/30 bg-primary/5' : 'border-border bg-white'
            }`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1">
                  <span className={`text-[14.5px] ${removed ? 'text-text-light line-through' : 'text-text-primary'}`}>
                    {c.originalName}
                  </span>
                  {c.quantity > 1 && !removed && (
                    <span className="text-xs text-text-muted">×{c.quantity}</span>
                  )}
                </div>
                {replaced && (
                  <div className="mt-0.5 flex items-center gap-1">
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium text-primary">
                      → {c.finalName}
                    </span>
                    {priceDiff !== null && priceDiff !== 0 && (
                      <span className={`text-[12px] font-medium ${priceDiff > 0 ? 'text-danger' : 'text-success'}`}>
                        {priceDiff > 0 ? `+${money(priceDiff)}` : `−${money(Math.abs(priceDiff))}`}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Действия */}
              {replaced || removed ? (
                <button
                  type="button"
                  onClick={() => cancelChange(c.componentId)}
                  className="shrink-0 rounded-lg px-2 py-1 text-[13px] font-medium text-primary hover:bg-primary/5"
                >
                  {removed ? 'Вернуть' : 'Отменить'}
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  {c.removable && (
                    <button
                      type="button"
                      onClick={() => toggleRemove(c)}
                      className="rounded-lg px-2 py-1 text-[13px] font-medium text-danger hover:bg-red-50"
                    >
                      Убрать
                    </button>
                  )}
                  {c.replaceable && (
                    <button
                      type="button"
                      onClick={() => beginReplace(c)}
                      className="rounded-lg px-2 py-1 text-[13px] font-medium text-primary hover:bg-primary/5"
                    >
                      Заменить
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
        <button
          type="button"
          className="btn-primary h-12 w-full rounded-lg font-semibold"
          onClick={() => set && onAdd(components)}
        >
          {hasChanges ? `Добавить · ${money(currentPrice)}` : 'Добавить в заказ'}
        </button>
      </div>
    </SheetShell>
  );
}
