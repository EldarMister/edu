import { useLayoutEffect, useRef, useState } from 'react';
import type { Hall, TableStatus } from '@/types';
import { TABLE_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';

const LEGEND: TableStatus[] = ['free', 'occupied', 'accepted', 'ready', 'waiting_payment'];
const GRID_GAP_PX = 12;
const MIN_TABLE_HEIGHT_PX = 74;

/**
 * Подбирает число колонок под реальные размеры свободной области, а не только
 * под количество столов. Оцениваем короткую сторону карточки: так сетка
 * получает самые крупные, близкие к квадрату столы без пустого места снизу.
 */
function bestColumnCount(tableCount: number, width: number, height: number) {
  if (tableCount <= 1) return 1;

  let bestColumns = 1;
  let bestSize = 0;

  for (let columns = 1; columns <= Math.min(tableCount, 5); columns += 1) {
    const rows = Math.ceil(tableCount / columns);
    const cardWidth = (width - GRID_GAP_PX * (columns - 1)) / columns;
    const cardHeight = Math.max(
      MIN_TABLE_HEIGHT_PX,
      (height - GRID_GAP_PX * (rows - 1)) / rows,
    );
    const size = Math.min(cardWidth, cardHeight);

    if (size > bestSize) {
      bestColumns = columns;
      bestSize = size;
    }
  }

  return bestColumns;
}

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
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridColumns, setGridColumns] = useState(() => Math.min(Math.max(tableCount, 1), 3));

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const updateColumns = () => {
      const { width, height } = grid.getBoundingClientRect();
      if (!width || !height) return;
      const nextColumns = bestColumnCount(tableCount, width, height);
      setGridColumns((current) => (current === nextColumns ? current : nextColumns));
    };

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [tableCount]);

  const gridRows = Math.max(1, Math.ceil(tableCount / gridColumns));
  const cardSizeClass =
    gridColumns === 1
      ? 'text-[44px] sm:text-[52px]'
      : gridColumns === 2
        ? 'text-[38px] sm:text-[44px]'
        : gridColumns === 3
          ? 'text-[30px] sm:text-[34px]'
          : 'text-2xl';
  const cardPaddingClass = gridColumns <= 2 ? 'p-4' : gridColumns === 3 ? 'p-3' : 'p-2';
  const dotClass = gridColumns <= 2 ? 'right-4 top-4 h-4 w-4' : gridColumns === 3 ? 'right-3 top-3 h-3 w-3' : 'right-2 top-2 h-2.5 w-2.5';

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

      {/* Сетка всегда заполняет доступную область: число колонок пересчитывается при смене зала и размера экрана. */}
      <div
        ref={gridRef}
        className="no-scrollbar grid min-h-0 flex-1 gap-3 overflow-y-auto"
        style={{
          gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${gridRows}, minmax(${MIN_TABLE_HEIGHT_PX}px, 1fr))`,
        }}
      >
        {hall?.tables.map((t) => {
          const meta = TABLE_STATUS[t.status];
          const selected = t.id === selectedTableId;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`relative flex h-full min-h-[74px] w-full flex-col items-center justify-center rounded-[22px] border font-medium transition-all ${cardSizeClass} ${cardPaddingClass} ${
                selected
                  ? 'border-primary/90 bg-primary/90 text-white shadow-soft'
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
