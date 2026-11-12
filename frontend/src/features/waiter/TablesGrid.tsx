import { useLayoutEffect, useRef, useState } from 'react';
import type { Hall, TableStatus } from '@/types';
import { TABLE_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';

const LEGEND: TableStatus[] = ['free', 'occupied', 'accepted', 'ready', 'waiting_payment'];
const TABLE_GAP = 12;

/** Size squares by the available width and let extra rows scroll. */
function tableGridLayout(count: number, width: number, height: number) {
  const gap = TABLE_GAP;
  const fewTables = count <= 2;
  const stack = count <= 1 || (count === 2 && height >= width);
  const phoneColumns = stack ? 1 : count <= 6 || width < 240 ? 2 : 3;
  const columns = width >= 600 && !fewTables
    ? Math.min(count, 6, Math.max(phoneColumns, Math.floor((width + gap) / (168 + gap))))
    : phoneColumns;
  const itemWidth = (width - gap * (columns - 1)) / columns;
  const rows = Math.max(1, Math.ceil(count / columns));
  const heightPerRow = (height - gap * (rows - 1)) / rows;
  const maxSide = fewTables ? Math.min(420, Math.max(96, heightPerRow)) : 240;
  const fittedSide = count >= 3 && count <= 6 ? Math.min(maxSide, Math.max(0, heightPerRow)) : maxSide;
  return { columns, side: Math.max(0, Math.floor(Math.min(itemWidth, fittedSide))), gap };
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    function measure(width: number, height: number) {
      setViewport((current) => current.width === width && current.height === height ? current : { width, height });
    }
    measure(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      measure(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { columns, side, gap } = tableGridLayout(hall?.tables.length ?? 0, viewport.width || 340, viewport.height || 420);
  const tableFontSize = Math.max(18, Math.min(54, Math.round(side / 5)));
  const dotClass = side >= 150 ? 'right-4 top-4 h-4 w-4' : 'right-2 top-2 h-2.5 w-2.5';

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

      <div ref={viewportRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div
          className="grid items-start justify-center"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, ${side}px))`, gap, fontSize: tableFontSize }}
        >
          {hall?.tables.map((table) => {
            const meta = TABLE_STATUS[table.status];
            const selected = table.id === selectedTableId;
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => onSelect(table.id)}
                className={`relative flex aspect-square w-full min-w-0 items-center justify-center rounded-[22px] border font-medium transition-colors ${
                  selected
                    ? 'border-primary/90 bg-primary/90 text-white shadow-soft'
                    : 'border-border bg-white text-text-primary hover:border-primary/40'
                }`}
              >
                <span>{table.number}</span>
                {!selected && (
                  <span className={`absolute rounded-full ${dotClass} ${meta.dot}`} />
                )}
              </button>
            );
          })}
        </div>
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
