import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { FloorPlan, FLOOR_COLUMNS, FLOOR_MAX_ROWS, FLOOR_MIN_SIZE, layoutFloorTables } from '@/components/FloorPlan';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import type { FloorPlanTable } from '@/types';
import { useFloorPlanMutations, type AdminHall, type AdminTableItem } from '../api';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
type Drag = { table: FloorPlanTable; x: number; y: number; unit: number; resize: boolean };

export function HallFloorPlanEditor({ halls, editable, onAdd, onEdit, onRemove }: {
  halls: AdminHall[];
  editable: boolean;
  onAdd: (hall: AdminHall) => void;
  onEdit: (hall: AdminHall, table: AdminTableItem) => void;
  onRemove: (table: AdminTableItem) => void;
}) {
  const [hallId, setHallId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<{ hallId: string; version: number; tables: FloorPlanTable[] } | null>(null);
  const [error, setError] = useState('');
  const { save } = useFloorPlanMutations();
  const hall = halls.find(({ id }) => id === hallId) ?? halls[0];
  const activeDraft = draft?.hallId === hall?.id ? draft : null;
  const { markSaved } = useEditorDirty(!!activeDraft);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  if (!hall) return <p className="py-8 text-center text-sm text-text-muted">Добавьте зал, чтобы составить карту.</p>;
  const placements = layoutFloorTables(hall.tables, activeDraft?.tables ?? hall.floorPlan);
  const selected = placements.find(({ tableId }) => tableId === selectedId);
  const tablesById = new Map(hall.tables.map((table) => [table.id, table]));
  const selectedTable = tablesById.get(selectedId);
  const canEdit = editable && !save.isPending;

  function change(table: FloorPlanTable, patch: Partial<FloorPlanTable>) {
    if (!canEdit || Object.entries(patch).every(([key, value]) => table[key as keyof FloorPlanTable] === value)) return;
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

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <Select ariaLabel="Зал на карте" value={hall.id} disabled={!!activeDraft}
        options={halls.map(({ id, name }) => ({ value: id, label: name }))}
        onChange={(id) => { setHallId(id); setSelectedId(''); setError(''); }} />
      {editable && <button type="button" className="btn-secondary btn-md" disabled={!canEdit} onClick={() => onAdd(hall)}>Добавить стол</button>}
      {editable && <div className="ml-auto flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-md" disabled={!activeDraft || !canEdit}
          onClick={() => { setDraft(null); setError(''); }}>Отменить правки</button>
        <button type="button" className="btn-primary btn-md" disabled={!activeDraft || !canEdit} onClick={submit}>
          {save.isPending ? 'Сохранение…' : 'Сохранить карту'}
        </button>
      </div>}
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {editable && <p className="text-xs text-text-muted">Перетащите стол, чтобы переместить его. Потяните за угол, чтобы изменить размер. С клавиатуры используйте стрелки, а для изменения размера — Shift и стрелки.</p>}
    <div className="max-w-[560px]">
      <FloorPlan placements={placements} canvasRef={canvas} editing={editable} renderTable={(table, style) => {
        const number = tablesById.get(table.tableId)?.number;
        const selected = table.tableId === selectedId;
        const pointer = {
          onPointerMove: move,
          onLostPointerCapture: () => { drag.current = null; },
        };
        return <div key={table.tableId} className="floor-plan-table" data-shape={table.shape} data-selected={selected} style={style}>
          <button type="button" className="floor-plan-drag flex h-full w-full items-center justify-center rounded-[inherit] px-1 text-sm font-semibold"
            aria-label={`Стол ${number}${table.label ? ` · ${table.label}` : ''}`} aria-pressed={selected}
            onClick={() => setSelectedId(table.tableId)} onFocus={() => setSelectedId(table.tableId)}
            onPointerDown={(event) => start(event, table, false)} onKeyDown={(event) => keyboard(event, table)}
            onDoubleClick={() => change(table, { shape: table.shape === 'round' ? 'rectangle' : 'round' })} {...pointer}>
            <span className="truncate">{table.label?.trim() || number}</span>
          </button>
          {canEdit && selected && <button type="button" aria-label={`Изменить размер стола ${number}`}
            className="floor-plan-resize absolute bottom-0 right-0 grid h-7 w-7 place-items-center rounded-lg bg-primary text-white"
            onPointerDown={(event) => start(event, table, true)} onKeyDown={(event) => keyboard(event, table, true)} {...pointer}>
            <span aria-hidden="true">↘</span>
          </button>}
        </div>;
      }} />
    </div>
    {selected && selectedTable && editable && <div className="flex max-w-4xl flex-wrap items-center gap-2 rounded-xl border border-border bg-white p-3">
      <span className="text-sm font-medium">Стол {selectedTable.number}</span>
      <Select ariaLabel="Форма стола" value={selected.shape} disabled={!canEdit}
        options={[{ value: 'rectangle', label: 'Прямоугольная' }, { value: 'round', label: 'Круглая' }]}
        onChange={(shape) => change(selected, { shape: shape as FloorPlanTable['shape'] })} />
      <input className="input max-w-52" aria-label="Подпись стола на карте" placeholder="Подпись на карте" maxLength={30}
        disabled={!canEdit} value={selected.label ?? ''} onChange={(event) => change(selected, { label: event.target.value })} />
      <button type="button" className="btn-secondary btn-md" disabled={!canEdit} onClick={() => onEdit(hall, selectedTable)}>Редактировать стол</button>
      <button type="button" className="btn-ghost btn-md text-danger" disabled={!canEdit} onClick={() => onRemove(selectedTable)}>Удалить стол</button>
    </div>}
  </div>;
}
