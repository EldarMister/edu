import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { FloorPlan, FLOOR_COLUMNS, FLOOR_MAX_ROWS, FLOOR_MIN_SIZE, layoutFloorTables } from '@/components/FloorPlan';
import { apiError } from '@/lib/api';
import { tableLabel } from '@/lib/format';
import type { FloorPlanTable } from '@/types';
import { useFloorPlanMutations, type AdminHall, type AdminTableItem } from '../api';
import { IconEdit, IconPlus, IconTrash } from './icons';
import './hall-floor-editor.css';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
type Drag = { table: FloorPlanTable; x: number; y: number; unit: number; resize: boolean };

export function HallFloorPlanEditor({ halls, editable, onAddHall, onEditHall, onRemoveHall, onAdd, onEdit, onCopy, onRemove }: {
  halls: AdminHall[];
  editable: boolean;
  onAddHall: () => void;
  onEditHall: (hall: AdminHall) => void;
  onRemoveHall: (hall: AdminHall) => void;
  onAdd: (hall: AdminHall) => void;
  onEdit: (hall: AdminHall, table: AdminTableItem) => void;
  onCopy: (hall: AdminHall, table: AdminTableItem) => void;
  onRemove: (table: AdminTableItem) => void;
}) {
  const [active, setActive] = useState(true);
  const [hallId, setHallId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<{ hallId: string; version: number; tables: FloorPlanTable[] } | null>(null);
  const [error, setError] = useState('');
  const { save } = useFloorPlanMutations();
  const visibleHalls = halls.filter((hall) => hall.isActive === active);
  const hall = visibleHalls.find(({ id }) => id === hallId) ?? visibleHalls[0];
  const activeDraft = draft?.hallId === hall?.id ? draft : null;
  const { markSaved } = useEditorDirty(!!draft);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const placements = hall ? layoutFloorTables(hall.tables, activeDraft?.tables ?? hall.floorPlan) : [];
  const tablesById = new Map(hall?.tables.map((table) => [table.id, table]));
  const canDiscard = editable && !save.isPending;
  const canEdit = canDiscard && (!draft || !!activeDraft);
  const canChangeRecords = canEdit && !draft;

  function chooseHall(id: string) {
    setHallId(id);
    setSelectedId('');
    setError('');
  }

  function change(table: FloorPlanTable, patch: Partial<FloorPlanTable>) {
    if (!hall || !canEdit || Object.entries(patch).every(([key, value]) => table[key as keyof FloorPlanTable] === value)) return;
    setError('');
    setDraft((current) => {
      const existing = current?.hallId === hall.id ? current : null;
      const tables = layoutFloorTables(hall.tables, existing?.tables ?? hall.floorPlan);
      return {
        hallId: hall.id,
        version: existing?.version ?? hall.floorPlanVersion ?? 0,
        tables: tables.map((item) => item.tableId === table.tableId ? { ...item, ...patch } : item),
      };
    });
  }

  function shift(table: FloorPlanTable, dx: number, dy: number, resize: boolean) {
    return resize
      ? { width: clamp(table.width + dx, FLOOR_MIN_SIZE, FLOOR_COLUMNS - table.x),
          height: clamp(table.height + dy, FLOOR_MIN_SIZE, FLOOR_MAX_ROWS - table.y) }
      : { x: clamp(table.x + dx, 0, FLOOR_COLUMNS - table.width),
          y: clamp(table.y + dy, 0, FLOOR_MAX_ROWS - table.height) };
  }

  function start(event: PointerEvent<HTMLButtonElement>, table: FloorPlanTable, resize: boolean) {
    if (!canEdit || !event.isPrimary || event.button !== 0) return;
    const width = canvas.current?.getBoundingClientRect().width;
    if (!width) return;
    setSelectedId(table.tableId);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { table, x: event.clientX, y: event.clientY, unit: width / FLOOR_COLUMNS, resize };
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const dx = Math.round((event.clientX - gesture.x) / gesture.unit);
    const dy = Math.round((event.clientY - gesture.y) / gesture.unit);
    const table = placements.find(({ tableId }) => tableId === gesture.table.tableId);
    if (table) change(table, shift(gesture.table, dx, dy, gesture.resize));
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, table: FloorPlanTable, resize = false) {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!canEdit || !direction) return;
    event.preventDefault();
    change(table, shift(table, direction[0], direction[1], resize || event.shiftKey));
  }

  async function submit() {
    if (!activeDraft || !canEdit) return;
    try {
      setError('');
      await save.mutateAsync({ id: activeDraft.hallId, version: activeDraft.version, tables: placements });
      markSaved();
      setDraft(null);
    } catch (failure) {
      setError(apiError(failure));
    }
  }

  return <section aria-label="Редактор столов" className="hall-editor grid overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]">
    <aside className="min-w-0 border-b border-border md:border-b-0 md:border-r">
      <div className="hall-editor-bar">
        <h2 className="font-semibold">Залы</h2>
        {editable && <button type="button" className="btn-secondary btn-md" disabled={!canChangeRecords} onClick={onAddHall}>
          <IconPlus className="h-4 w-4" /> Добавить зал
        </button>}
      </div>
      <div className="flex gap-4 border-b border-border px-4" role="group" aria-label="Статус залов">
        {[true, false].map((value) => (
          <button type="button" key={String(value)} aria-pressed={active === value} disabled={!!draft}
            className={`border-b-2 py-3 text-sm font-medium ${active === value ? 'border-primary text-link' : 'border-transparent text-text-secondary'}`}
            onClick={() => { setActive(value); chooseHall(''); }}>
            {value ? 'Активные' : 'Отключённые'}
          </button>
        ))}
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto p-2 md:max-h-[65dvh]">
        {visibleHalls.map((entry) => (
          <li key={entry.id} className={`flex items-center gap-1 rounded-lg border pr-1 ${entry.id === hall?.id
            ? 'border-primary/25 bg-primary/10' : 'border-transparent hover:bg-background'}`}>
            <button type="button" aria-current={entry.id === hall?.id ? 'true' : undefined} disabled={!!draft}
              className="min-w-0 flex-1 px-2.5 py-2.5 text-left" onClick={() => chooseHall(entry.id)}>
              <span className="block truncate text-sm font-semibold">{entry.name}</span>
              <span className="text-xs text-text-muted">Столов: {entry.tables.length}</span>
            </button>
            {editable && <>
              <button type="button" className="hall-editor-icon" aria-label={`Изменить зал · ${entry.name}`}
                title="Изменить зал" disabled={!canChangeRecords} onClick={() => onEditHall(entry)}><IconEdit className="h-4 w-4" /></button>
              <button type="button" className="hall-editor-icon hover:text-danger" aria-label={`Удалить зал · ${entry.name}`}
                title="Удалить зал" disabled={!canChangeRecords} onClick={() => onRemoveHall(entry)}><IconTrash className="h-4 w-4" /></button>
            </>}
          </li>
        ))}
        {!visibleHalls.length && <li className="px-2 py-3 text-sm text-text-muted">{active ? 'Активных залов пока нет' : 'Отключённых залов нет'}</li>}
      </ul>
    </aside>
    <div className="flex min-w-0 flex-col">
      <div className="hall-editor-bar flex-wrap">
        <h2 className="min-w-0 break-words font-semibold">{hall ? hall.name : 'План зала'}</h2>
        {editable && hall && <button type="button" className="btn-primary btn-md" disabled={!canChangeRecords} onClick={() => onAdd(hall)}>
          <IconPlus className="h-4 w-4" /> Добавить стол
        </button>}
      </div>
      {hall ? <>
        <div className="hall-editor-workarea">
          <div className="hall-editor-map">
            <FloorPlan placements={placements} canvasRef={canvas} editing={editable} renderTable={(table, style) => {
              const item = tablesById.get(table.tableId)!;
              const title = table.label?.trim() || tableLabel(item);
              const selected = table.tableId === selectedId;
              const pointer = {
                onPointerMove: move,
                onLostPointerCapture: () => { drag.current = null; },
              };
              return <div key={table.tableId} id={`hall-table-${table.tableId}`} className="floor-plan-table hall-editor-table"
                data-shape={table.shape} data-selected={selected} style={style}>
                <button type="button" className="floor-plan-drag flex h-full w-full min-w-0 flex-col items-center justify-center gap-1 rounded-[inherit] px-1.5"
                  aria-label={title} title={title} aria-pressed={selected}
                  onClick={() => setSelectedId(table.tableId)} onFocus={() => setSelectedId(table.tableId)}
                  onPointerDown={(event) => start(event, table, false)} onKeyDown={(event) => keyboard(event, table)}
                  onDoubleClick={() => { if (canChangeRecords) onEdit(hall, item); }} {...pointer}>
                  <span className="text-xs text-text-muted">{item.seats} мест</span>
                  <span className="max-w-full truncate text-sm font-semibold">{title}</span>
                </button>
                {editable && selected && <>
                  <div className="hall-editor-table-tools">
                    <button type="button" className="hall-editor-icon" aria-label={`Копировать стол · ${title}`}
                      title="Копировать стол" disabled={!canChangeRecords} onClick={() => onCopy(hall, item)}>
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                        <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                      </svg>
                    </button>
                    <button type="button" className="hall-editor-icon" aria-label={`Изменить стол · ${title}`}
                      title="Изменить стол" disabled={!canChangeRecords} onClick={() => onEdit(hall, item)}><IconEdit className="h-4 w-4" /></button>
                    <button type="button" className="hall-editor-icon hover:text-danger" aria-label={`Удалить стол · ${title}`}
                      title="Удалить стол" disabled={!canChangeRecords} onClick={() => onRemove(item)}><IconTrash className="h-4 w-4" /></button>
                  </div>
                  <button type="button" aria-label={`Изменить размер · ${title}`} disabled={!canEdit}
                    className="floor-plan-resize absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-lg border border-primary/30 bg-card text-link"
                    onPointerDown={(event) => start(event, table, true)} onKeyDown={(event) => keyboard(event, table, true)} {...pointer}>
                    <span aria-hidden="true">↘</span>
                  </button>
                </>}
              </div>;
            }} />
            {!placements.length && <p className="pointer-events-none absolute inset-x-6 top-9 text-center text-sm text-text-muted">В зале пока нет столов</p>}
          </div>
        </div>
        {editable && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p role="status" className="text-sm text-text-muted">{draft ? 'Есть несохранённые изменения' : hall.floorPlanVersion ? 'Карта сохранена' : 'Автоматическая раскладка'}</p>
          {draft && <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary btn-md" disabled={!canDiscard}
              onClick={() => { setDraft(null); setError(''); }}>Отменить правки</button>
            <button type="button" className="btn-primary btn-md" disabled={!activeDraft || !canEdit} onClick={submit}>
              {save.isPending ? 'Сохранение…' : 'Сохранить карту'}
            </button>
          </div>}
          {error && <p role="alert" className="basis-full text-sm text-danger">{error}</p>}
        </div>}
      </> : <p className="grid min-h-64 flex-1 place-items-center px-4 text-center text-sm text-text-muted">
        {active ? 'Добавьте зал, чтобы составить карту' : 'Выберите зал, чтобы открыть его план'}
      </p>}
      {!hall && draft && <div className="flex items-center justify-between gap-2 border-t border-border p-3">
        <p role="status" className="text-sm text-text-muted">Зал больше недоступен</p>
        <button type="button" className="btn-secondary btn-md" disabled={!canDiscard}
          onClick={() => { setDraft(null); setError(''); }}>Отменить правки</button>
      </div>}
    </div>
  </section>;
}
