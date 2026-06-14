import { useState } from 'react';
import type { Hall, TableStatus } from '@/types';
import { TABLE_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';

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
  const t = useT();
  const [hallId, setHallId] = useState(halls[0]?.id ?? '');
  const hall = halls.find((h) => h.id === hallId) ?? halls[0];
  const tableCount = hall?.tables.length ?? 0;
  const fullscreenSingle = tableCount === 1;
  const splitVertical = tableCount === 2;
  const roomyTwoColumn = tableCount >= 3 && tableCount <= 6;
  const compactGrid = tableCount > 10;
  const gridClass = fullscreenSingle
    ? 'grid-cols-1 grid-rows-1'
    : splitVertical
      ? 'grid-cols-1 grid-rows-2'
      : roomyTwoColumn && tableCount <= 4
        ? 'grid-cols-2 grid-rows-2'
        : roomyTwoColumn
          ? 'grid-cols-2 grid-rows-3'
          : compactGrid
            ? 'grid-cols-4'
            : 'grid-cols-3';
  const gridFlowClass =
    fullscreenSingle || splitVertical || roomyTwoColumn ? 'auto-rows-fr' : 'content-start auto-rows-max';
  const cardSizeClass = fullscreenSingle
    ? 'h-full min-h-0 text-[54px] sm:text-6xl'
    : splitVertical
      ? 'h-full min-h-0 text-[44px] sm:text-[52px]'
      : roomyTwoColumn
        ? 'h-full min-h-0 text-[38px] sm:text-[44px]'
        : compactGrid
        ? 'aspect-square min-h-[74px] text-xl'
        : 'aspect-square min-h-[104px] text-2xl';
  const cardPaddingClass = fullscreenSingle || splitVertical || roomyTwoColumn ? 'p-4' : 'p-2';
  const dotClass =
    fullscreenSingle || splitVertical || roomyTwoColumn ? 'right-4 top-4 h-4 w-4' : 'right-2 top-2 h-2.5 w-2.5';

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

      {/* Сетка столов: мало столов -> крупнее, много -> компактнее. */}
      <div className={`no-scrollbar grid min-h-0 flex-1 ${gridClass} ${gridFlowClass} gap-3 overflow-y-auto`}>
        {hall?.tables.map((t) => {
          const meta = TABLE_STATUS[t.status];
          const selected = t.id === selectedTableId;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`relative flex w-full flex-col items-center justify-center rounded-[22px] border font-medium transition-all ${cardSizeClass} ${cardPaddingClass} ${
                selected
                  ? 'border-primary bg-primary text-white shadow-soft'
                  : 'border-border bg-white text-text-primary hover:border-primary/40'
              }`}
            >
              <span>{t.number}</span>
              {!selected && (
                <span className={`absolute rounded-full ${dotClass} ${meta.dot}`} />
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
            {t(TABLE_STATUS[s].label)}
          </span>
        ))}
      </div>
    </div>
  );
}
