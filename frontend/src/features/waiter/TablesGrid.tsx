import { useLayoutEffect, useRef, useState } from 'react';
import type { Hall, TableStatus } from '@/types';
import { TABLE_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';

const LEGEND: TableStatus[] = ['free', 'occupied', 'accepted', 'ready', 'waiting_payment'];
const GRID_GAP_PX = 12;
const MIN_TABLE_SIZE_PX = 74;

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
  // 3–8: две колонки; 9–19: три; с 20: четыре.
  const adaptiveGrid = tableCount >= 3;
  const columns = tableCount <= 8 ? 2 : tableCount <= 19 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(tableCount / columns));
  const gridRef = useRef<HTMLDivElement>(null);
  const [tableSize, setTableSize] = useState(MIN_TABLE_SIZE_PX);

  // Меняем только масштаб квадратных карточек. Размер рабочей области и
  // постоянный зазор между ячейками остаются прежними.
  useLayoutEffect(() => {
    if (!adaptiveGrid) return;
    const grid = gridRef.current;
    if (!grid) return;

    const updateTableSize = () => {
      const { width, height } = grid.getBoundingClientRect();
      if (!width || !height) return;
      const byWidth = (width - GRID_GAP_PX * (columns - 1)) / columns;
      const byHeight = (height - GRID_GAP_PX * (rows - 1)) / rows;
      setTableSize(Math.max(MIN_TABLE_SIZE_PX, Math.floor(Math.min(byWidth, byHeight))));
    };

    updateTableSize();
    const observer = new ResizeObserver(updateTableSize);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [adaptiveGrid, columns, rows]);

  const cardSizeClass = fullscreenSingle
    ? 'min-h-[300px] h-full max-h-[460px] text-[54px] sm:min-h-[340px] sm:max-h-[520px] sm:text-6xl'
    : splitVertical
      ? 'h-full min-h-0 text-[44px] sm:text-[52px]'
      : columns === 2
        ? 'text-[38px] sm:text-[44px]'
        : columns === 3
          ? 'text-2xl'
          : 'text-xl';
  const cardPaddingClass = fullscreenSingle || splitVertical || columns === 2 ? 'p-4' : 'p-2';
  const dotClass =
    fullscreenSingle || splitVertical || columns === 2 ? 'right-4 top-4 h-4 w-4' : 'right-2 top-2 h-2.5 w-2.5';
  const adaptiveCardStyle = adaptiveGrid ? { width: tableSize, height: tableSize } : undefined;

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

      {/* Колонки и масштаб карточек подбираются отдельно; зазор всегда 12px. */}
      <div
        ref={gridRef}
        className={`no-scrollbar grid min-h-0 flex-1 gap-3 overflow-y-auto ${
          adaptiveGrid ? 'content-start justify-center justify-items-center' : 'grid-cols-1 auto-rows-fr'
        }`}
        style={
          adaptiveGrid
            ? {
                gridTemplateColumns: `repeat(${columns}, ${tableSize}px)`,
                gridTemplateRows: `repeat(${rows}, ${tableSize}px)`,
              }
            : undefined
        }
      >
        {hall?.tables.map((t) => {
          const meta = TABLE_STATUS[t.status];
          const selected = t.id === selectedTableId;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`relative flex ${adaptiveGrid ? '' : 'w-full'} flex-col items-center justify-center rounded-[22px] border font-medium transition-all ${cardSizeClass} ${cardPaddingClass} ${
                selected
                  ? 'border-primary/90 bg-primary/90 text-white shadow-soft'
                  : 'border-border bg-white text-text-primary hover:border-primary/40'
              }`}
              style={adaptiveCardStyle}
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
