import { useMemo, useState } from 'react';
import type { CartSetComponent, Dish } from '@/types';
import { money } from '@/lib/format';

/** Состав сета по умолчанию (все позиции без изменений). */
export function defaultSetComponents(set: Dish): CartSetComponent[] {
  return (set.setComponents ?? []).map((c) => ({
    componentId: c.id,
    originalDishId: c.dish.id,
    originalName: c.dish.name,
    quantity: c.quantity,
    removable: c.removable,
    replaceable: c.replaceable,
    action: 'default' as const,
  }));
}

function SheetShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[78vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-soft">
        {children}
      </div>
    </div>
  );
}

function CloseBtn({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Закрыть"
      className="-mr-1 text-text-light transition-colors hover:text-text-secondary"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

/** Bottom sheet «Выберите сет»: radio-список с глазком настройки. */
export function SetPickerSheet({
  sets,
  onClose,
  onPick,
  onConfigure,
}: {
  sets: Dish[];
  onClose: () => void;
  onPick: (set: Dish) => void;
  onConfigure: (set: Dish) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(sets[0]?.id ?? null);
  const selected = sets.find((s) => s.id === selectedId) ?? null;

  return (
    <SheetShell onClose={onClose}>
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Сеты</h2>
          <p className="mt-0.5 text-sm text-text-muted">Выберите сет</p>
        </div>
        <CloseBtn onClose={onClose} />
      </div>

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

/** Bottom sheet «Настроить сет»: убрать / заменить блюда состава. */
export function SetConfigSheet({
  set,
  menuDishes,
  onClose,
  onAdd,
}: {
  set: Dish;
  /** Обычные блюда меню для замены (без сетов). */
  menuDishes: Dish[];
  onClose: () => void;
  onAdd: (components: CartSetComponent[]) => void;
}) {
  const [components, setComponents] = useState<CartSetComponent[]>(() => defaultSetComponents(set));
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  function patch(componentId: string, p: Partial<CartSetComponent>) {
    setComponents((cur) => cur.map((c) => (c.componentId === componentId ? { ...c, ...p } : c)));
  }

  function toggleRemove(c: CartSetComponent) {
    patch(c.componentId, c.action === 'removed'
      ? { action: 'default' }
      : { action: 'removed', finalDishId: undefined, finalName: undefined });
  }

  function applyReplace(componentId: string, dish: Dish) {
    patch(componentId, { action: 'replaced', finalDishId: dish.id, finalName: dish.name });
    setReplacingId(null);
    setSearch('');
  }

  function cancelChange(componentId: string) {
    patch(componentId, { action: 'default', finalDishId: undefined, finalName: undefined });
  }

  const replaceOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuDishes.filter((d) => d.isAvailable && (!q || d.name.toLowerCase().includes(q)));
  }, [menuDishes, search]);

  // Режим выбора блюда замены.
  if (replacingId) {
    return (
      <SheetShell onClose={() => setReplacingId(null)}>
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
          <button
            onClick={() => setReplacingId(null)}
            aria-label="Назад"
            className="-ml-1 text-text-light hover:text-text-secondary"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-text-primary">Заменить блюдо</h2>
        </div>
        <div className="shrink-0 px-4 pb-2">
          <input
            className="input"
            placeholder="Поиск блюда"
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1">
          {replaceOptions.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => applyReplace(replacingId, d)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:border-primary/40"
            >
              <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">{d.name}</span>
              <span className="shrink-0 text-[15px] font-semibold text-text-primary">{money(d.price)}</span>
            </button>
          ))}
          {replaceOptions.length === 0 && (
            <p className="py-8 text-center text-sm text-text-muted">Ничего не найдено</p>
          )}
        </div>
      </SheetShell>
    );
  }

  return (
    <SheetShell onClose={onClose}>
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-3">
        <h2 className="text-lg font-semibold text-text-primary">Настроить сет</h2>
        <CloseBtn onClose={onClose} />
      </div>

      <div className="shrink-0 px-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2.5">
          <span className="text-[15px] font-semibold text-text-primary">{set.name}</span>
          <span className="text-[15px] font-semibold text-text-primary">{money(set.price)}</span>
        </div>
        <p className="mt-3 text-sm font-medium text-text-secondary">
          Состав сета ({components.length} позиций)
        </p>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-3 pt-2">
        {components.map((c) => {
          const removed = c.action === 'removed';
          const replaced = c.action === 'replaced';
          return (
            <div key={c.componentId} className="flex items-center gap-2 rounded-xl border border-border px-2.5 py-2">
              <span className="shrink-0 cursor-grab select-none text-text-light" aria-hidden>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
                  <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
                  <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <span className={`text-[14.5px] ${removed ? 'text-text-light line-through' : 'text-text-primary'}`}>
                  {c.originalName}
                </span>
                {replaced && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium text-primary align-middle">
                    → {c.finalName}
                    <button onClick={() => cancelChange(c.componentId)} aria-label="Отменить замену" className="leading-none">✕</button>
                  </span>
                )}
              </div>

              {/* Действия */}
              {replaced || removed ? (
                <button
                  type="button"
                  onClick={() => cancelChange(c.componentId)}
                  className="shrink-0 text-[13px] font-medium text-primary hover:underline"
                >
                  {removed ? 'Вернуть' : 'Отменить'}
                </button>
              ) : (
                <div className="flex shrink-0 items-center gap-2.5">
                  {c.removable && (
                    <button
                      type="button"
                      onClick={() => toggleRemove(c)}
                      className="text-[13px] font-medium text-danger hover:underline"
                    >
                      Убрать
                    </button>
                  )}
                  {c.replaceable && (
                    <button
                      type="button"
                      onClick={() => setReplacingId(c.componentId)}
                      className="text-[13px] font-medium text-primary hover:underline"
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
          onClick={() => onAdd(components)}
        >
          Добавить в заказ
        </button>
      </div>
    </SheetShell>
  );
}
