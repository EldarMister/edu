import { useEffect, useMemo, useState } from 'react';
import type { PrepStation } from '@/types';
import { Toggle } from '@/components/Toggle';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { useStopList, useSaveStopList } from './api';

/**
 * Боковая панель «Стоп-лист»: станция временно отключает свои блюда.
 * Toggle включён → блюдо недоступно (в стоп-листе) и его нельзя заказать.
 * Изменение сохраняется автоматически при переключении ползунка.
 */
export function StopListDrawer({
  open,
  station = 'kitchen',
  onClose,
}: {
  open: boolean;
  station?: PrepStation;
  onClose: () => void;
}) {
  const stopListQ = useStopList(open, station);
  const save = useSaveStopList();
  const push = useNotifications((s) => s.push);

  const [search, setSearch] = useState('');
  // Локальная доступность для мгновенного отклика: dishId → isAvailable.
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  // Синхронизируем локальное состояние с сервером при открытии / обновлении данных.
  useEffect(() => {
    if (!open) return;
    const data = stopListQ.data;
    if (!data) return;
    const next: Record<string, boolean> = {};
    for (const cat of data) for (const d of cat.dishes) next[d.id] = d.isAvailable;
    setDraft(next);
  }, [open, stopListQ.data]);

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const categories = useMemo(() => {
    const data = stopListQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data
      .map((c) => ({ ...c, dishes: c.dishes.filter((d) => d.name.toLowerCase().includes(q)) }))
      .filter((c) => c.dishes.length > 0);
  }, [stopListQ.data, search]);

  // Автосохранение: переключили ползунок → сразу пишем на сервер.
  async function toggleDish(dishId: string, makeStopped: boolean) {
    const nextAvailable = !makeStopped;
    setDraft((p) => ({ ...p, [dishId]: nextAvailable }));
    try {
      await save.mutateAsync([{ dishId, isAvailable: nextAvailable }]);
    } catch (err) {
      setDraft((p) => ({ ...p, [dishId]: !nextAvailable })); // откат
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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
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
                        {/* Toggle включён = недоступно (в стоп-листе); сохраняется сразу */}
                        <Toggle checked={!available} onChange={(stopped) => toggleDish(d.id, stopped)} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
