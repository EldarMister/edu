import { useState } from 'react';
import type { Hall, TableStatus } from '@/types';
import { TABLE_STATUS } from '@/lib/status';

const LEGEND: TableStatus[] = ['free', 'occupied', 'accepted', 'ready', 'waiting_payment'];

export function TablesGrid({
  halls,
  selectedTableId,
  onSelect,
}: {
  halls: Hall[];
  selectedTableId: string | null;
  onSelect: (tableId: string) => void;
}) {
  const [hallId, setHallId] = useState(halls[0]?.id ?? '');
  const hall = halls.find((h) => h.id === hallId) ?? halls[0];

  return (
    <div className="flex h-full flex-col">
      {/* Вкладки залов */}
      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {halls.map((h) => (
          <button
            key={h.id}
            onClick={() => setHallId(h.id)}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
              h.id === hall?.id
                ? 'bg-primary text-white'
                : 'bg-white text-text-secondary border border-border hover:bg-background'
            }`}
          >
            {h.name}
          </button>
        ))}
      </div>

      {/* Сетка столов — адаптивная auto-fit grid: мало столов → крупнее,
          много → уменьшаются до минимума, равномерно по ширине контейнера. */}
      <div className="grid flex-1 content-start gap-2.5 overflow-y-auto grid-cols-[repeat(auto-fit,minmax(78px,1fr))] min-[390px]:grid-cols-[repeat(auto-fit,minmax(86px,1fr))]">
        {hall?.tables.map((t) => {
          const meta = TABLE_STATUS[t.status];
          const selected = t.id === selectedTableId;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`relative flex min-h-[88px] w-full flex-col items-center justify-center rounded-xl border text-lg font-medium transition-all ${
                selected
                  ? 'border-primary bg-primary text-white shadow-soft'
                  : 'border-border bg-white text-text-primary hover:border-primary/40'
              }`}
            >
              <span>{t.number}</span>
              {!selected && (
                <span className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full ${meta.dot}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Легенда */}
      <div className="no-scrollbar mt-3 flex shrink-0 gap-3 overflow-x-auto border-t border-border pt-2">
        {LEGEND.map((s) => (
          <span key={s} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-text-muted">
            <span className={`h-2 w-2 rounded-full ${TABLE_STATUS[s].dot}`} />
            {TABLE_STATUS[s].label}
          </span>
        ))}
      </div>
    </div>
  );
}
