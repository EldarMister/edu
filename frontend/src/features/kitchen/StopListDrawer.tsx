import { useEffect, useMemo, useState } from 'react';
import { Toggle } from '@/components/Toggle';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { useStopList, useSaveStopList } from './api';

/**
 * Боковая панель «Стоп-лист»: кухня временно отключает блюда.
 * Toggle включён → блюдо недоступно (в стоп-листе) и его нельзя заказать.
 */
export function StopListDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stopListQ = useStopList(open);
  const save = useSaveStopList();
  const push = useNotifications((s) => s.push);

  const [search, setSearch] = useState('');
  // Черновик доступности: dishId → isAvailable. Не применяется, пока не нажат «Сохранить».
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  // Инициализируем черновик при открытии / получении данных.
  useEffect(() => {
    if (!open) return;
    const data = stopListQ.data;
    if (!data) return;
    const next: Record<string, boolean> = {};
    for (const cat of data) for (const d of cat.dishes) next[d.id] = d.isAvailable;
    setDraft(next);
    setSearch('');
  }, [open, stopListQ.data]);

  const categories = useMemo(() => {
    const data = stopListQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data
      .map((c) => ({ ...c, dishes: c.dishes.filter((d) => d.name.toLowerCase().includes(q)) }))
      .filter((c) => c.dishes.length > 0);
  }, [stopListQ.data, search]);

  async function onSave() {
    const data = stopListQ.data ?? [];
    const items: { dishId: string; isAvailable: boolean }[] = [];
    for (const cat of data) {
      for (const d of cat.dishes) {
        const next = draft[d.id];
        if (next !== undefined && next !== d.isAvailable) items.push({ dishId: d.id, isAvailable: next });
      }
    }
    if (items.length === 0) {
      onClose();
      return;
    }
    try {
      await save.mutateAsync(items);
      push({ message: 'Стоп-лист обновлён', type: 'success', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />

      <aside className="relative z-10 flex h-full w-full max-w-[420px] flex-col bg-white shadow-soft">
        {/* Заголовок */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Стоп-лист</h2>
            <p className="mt-0.5 text-sm text-text-muted">
              Выберите блюда, которые временно недоступны
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="-mr-1 text-text-light transition-colors hover:text-text-secondary"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Поиск */}
        <div className="shrink-0 px-5 py-3">
          <input
            className="input"
            placeholder="Поиск блюда"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Список блюд по категориям */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {stopListQ.isLoading ? (
            <div className="flex justify-center py-10 text-primary">
              <Spinner className="h-6 w-6" />
            </div>
          ) : categories.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-muted">Ничего не найдено</p>
          ) : (
            categories.map((cat) => (
              <div key={cat.id} className="mb-4">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-light">
                  {cat.name}
                </p>
                <div className="space-y-1">
                  {cat.dishes.map((d) => {
                    const available = draft[d.id] ?? d.isAvailable;
                    return (
                      <div
                        key={d.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
                      >
                        <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">
                          {d.name}
                        </span>
                        <span
                          className={`shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${
                            available ? 'bg-slate-100 text-text-muted' : 'bg-primary/10 text-primary'
                          }`}
                        >
                          {available ? 'Доступно' : 'Недоступно'}
                        </span>
                        {/* Toggle включён = недоступно (в стоп-листе) */}
                        <Toggle
                          checked={!available}
                          onChange={(stopped) => setDraft((p) => ({ ...p, [d.id]: !stopped }))}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Кнопки */}
        <div className="flex shrink-0 gap-2 border-t border-border px-5 py-4">
          <button className="btn-secondary btn-lg flex-1" onClick={onClose} disabled={save.isPending}>
            Отменить
          </button>
          <button
            className="btn-primary btn-lg flex-1 font-semibold"
            onClick={onSave}
            disabled={save.isPending || stopListQ.isLoading}
          >
            {save.isPending ? <Spinner /> : 'Сохранить'}
          </button>
        </div>
      </aside>
    </div>
  );
}
