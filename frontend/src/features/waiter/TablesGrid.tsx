import { useLayoutEffect, useRef, useState } from 'react';
import type { Hall, TableStatus } from '@/types';
import { TABLE_STATUS } from '@/lib/status';
import { useT } from '@/lib/i18n';
import { tableLabel } from '@/lib/format';
import { FloorPlan, layoutFloorTables } from '@/components/FloorPlan';

const LEGEND: TableStatus[] = ['free', 'occupied', 'accepted', 'ready', 'waiting_payment'];
const TABLE_GAP = 12;

/** Keep the hall's column count stable when the viewport changes. */
function tableGridLayout(count: number, width: number, height: number) {
  const gap = TABLE_GAP;
  const columns = Math.min(Math.max(1, count), count <= 6 || count === 8 ? 2 : 3);
  const rowsToFit = Math.max(1, Math.ceil(Math.min(count, 9) / columns));
  const maxSide = count <= 2 ? 420 : 240;
  const sideAtWidth = Math.max(0, Math.floor((width - gap * (columns - 1)) / columns));
  const sideAtHeight = Math.floor((height - gap * (rowsToFit - 1)) / rowsToFit);
  const side = Math.min(maxSide, sideAtWidth, Math.max(64, sideAtHeight));
  return { columns, side };
}

export function TablesGrid({
  halls,
  selectedTableId,
  onSelect,
  useMap = false,
}: {
  halls: Hall[];
  selectedTableId: string | null;
  onSelect: (tableId: string) => void;
  useMap?: boolean;
}) {
  const t = useT();
  const [hallId, setHallId] = useState(() => halls.find((hall) =>
    hall.tables.some(({ id }) => id === selectedTableId))?.id ?? halls[0]?.id ?? '');
  const hall = halls.find((h) => h.id === hallId) ?? halls[0];
  const showMap = hall?.useFloorPlan ?? useMap;
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

  const { columns, side } = tableGridLayout(hall?.tables.length ?? 0, viewport.width || 340, viewport.height || 420);
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
        {showMap && hall ? <WaiterFloorPlan hall={hall} selectedTableId={selectedTableId} onSelect={onSelect} /> : <div
          className="grid items-start justify-center"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, ${side}px))`, gap: TABLE_GAP, fontSize: tableFontSize }}
        >
          {hall?.tables.map((table) => {
            const meta = TABLE_STATUS[table.status];
            const selected = table.id === selectedTableId;
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => onSelect(table.id)}
                title={tableLabel(table, t('Стол'))}
                className={`relative flex aspect-square w-full min-w-0 items-center justify-center rounded-[22px] border font-medium transition-colors ${
                  selected
                    ? 'border-primary/90 bg-primary/90 text-white shadow-soft'
                    : 'border-border bg-white text-text-primary hover:border-primary/40'
                }`}
              >
                {table.name ? <span className="line-clamp-2 break-words px-2 text-sm leading-tight sm:text-base">{table.name}</span> : <span>{table.number}</span>}
                {!selected && (
                  <span className={`absolute rounded-full ${dotClass} ${meta.dot}`} />
                )}
              </button>
            );
          })}
        </div>}
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

function WaiterFloorPlan({ hall, selectedTableId, onSelect }: {
  hall: Hall;
  selectedTableId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const tables = new Map(hall.tables.map((table) => [table.id, table]));
  if (!tables.size) return <p className="p-3 text-sm text-text-muted">{t('В этом зале пока нет столов')}</p>;
  return <FloorPlan fit placements={layoutFloorTables(hall.tables, hall.floorPlan)} renderTable={(placement, style) => {
    const table = tables.get(placement.tableId)!;
    const status = TABLE_STATUS[table.status];
    const selected = table.id === selectedTableId;
    const name = placement.label?.trim() || tableLabel(table, t('Стол'));
    const description = [name, t(status.label), table.occupiedBy?.name].filter(Boolean).join(' · ');
    return <button key={table.id} type="button" style={style} className="floor-plan-table flex-col gap-0.5 overflow-hidden px-1"
      data-shape={placement.shape} data-selected={selected} aria-pressed={selected}
      aria-label={description} title={description} onClick={() => onSelect(table.id)}>
      {!selected && <span className={`absolute right-[15%] top-[15%] h-2 w-2 shrink-0 rounded-full ${status.dot}`} />}
      <span className="floor-plan-table-number max-w-full truncate font-semibold">{placement.label?.trim() || table.name || table.number}</span>
      {table.occupiedBy && placement.width >= 6 &&
        <span className="max-w-full truncate text-[10px] opacity-80">{table.occupiedBy.name}</span>}
    </button>;
  }} />;
}
