import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { layoutFloorTables } from '@/components/FloorPlan';
import { apiError } from '@/lib/api';
import { tableLabel } from '@/lib/format';
import { useNotifications } from '@/store/notifications';
import type { FloorPlanTable } from '@/types';
import { useTableMutations, useTableChanges, type AdminHall, type AdminTableItem } from '../api';
import { WorkspacePending } from './WorkspacePending';

const shapes = [
  { value: 'rectangle', label: 'Прямоугольная' },
  { value: 'round', label: 'Круглая' },
] satisfies { value: FloorPlanTable['shape']; label: string }[];

export function TableEditor({ hall, table, copy, onClose }: {
  hall: AdminHall;
  table: AdminTableItem | null;
  copy?: AdminTableItem;
  onClose: () => void;
}) {
  const formId = useId();
  const { create, update } = useTableMutations();
  const push = useNotifications((s) => s.push);
  const [tab, setTab] = useState<'general' | 'history'>('general');
  const [number, setNumber] = useState(table ? String(table.number) : '');
  const [name, setName] = useState(table?.name ?? (copy ? tableLabel(copy).slice(0, 32) + ' · копия' : ''));
  const [seats, setSeats] = useState(String(table?.seats ?? copy?.seats ?? 2));
  const [isActive, setIsActive] = useState(table?.isActive ?? true);
  const saved = hall.floorPlan?.find(({ tableId }) => tableId === (table?.id ?? copy?.id));
  const [shape, setShape] = useState<FloorPlanTable['shape']>(saved?.shape ?? 'rectangle');
  const [label, setLabel] = useState(table ? saved?.label ?? '' : '');
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      push({ message: 'UUID скопирован', at: new Date().toISOString() });
    } catch {
      setError('Не удалось скопировать UUID');
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError('');
    const draftId = table?.id ?? 'draft-table';
    const base = layoutFloorTables(table ? hall.tables : [...hall.tables, { id: draftId }], hall.floorPlan)
      .find(({ tableId }) => tableId === draftId);
    const placement = base && (shape !== base.shape || label.trim() !== (base.label ?? ''))
      ? { x: base.x, y: base.y, width: base.width, height: base.height, shape, label, version: hall.floorPlanVersion ?? 0 }
      : undefined;
    const values = { number: number === '' ? undefined : Number(number), name: name.trim() || null, seats: Number(seats), placement };
    try {
      if (table) await update.mutateAsync({ id: table.id, ...values, isActive });
      else await create.mutateAsync({ hallId: hall.id, ...values });
      push({ message: table ? 'Стол обновлён' : 'Стол добавлен', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal open panelClassName="max-w-[44rem]" onClose={() => !pending && onClose()}
      title={table ? 'Изменение стола' : copy ? 'Копирование стола' : 'Новый стол'}
      toolbar={table && (
        <div className="flex gap-5" role="group" aria-label="Данные стола">
          {(['general', 'history'] as const).map((key) => (
            <button type="button" key={key} aria-pressed={tab === key} disabled={pending}
              className={`border-b-2 py-3 text-sm font-medium ${tab === key ? 'border-primary text-link' : 'border-transparent text-text-secondary'}`}
              onClick={() => setTab(key)}>
              {key === 'general' ? 'Общее' : 'История изменений'}
            </button>
          ))}
        </div>
      )}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary btn-md" disabled={pending} onClick={onClose}>
            {tab === 'general' ? 'Отмена' : 'Закрыть'}
          </button>
          {tab === 'general' && <button type="submit" form={formId} className="btn-primary btn-md" disabled={pending}>
            {pending ? <Spinner /> : table ? 'Сохранить' : 'Добавить стол'}
          </button>}
        </div>
      }>
      {tab === 'history' && table ? <TableHistory tableId={table.id} /> : (
        <form id={formId} onSubmit={onSubmit} className="space-y-3 px-0.5 py-2">
          {table && <div className="grid items-center gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
            <span className="text-sm font-medium text-text-secondary">UUID</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 break-all rounded-md bg-background px-2 py-1 text-xs">{table.id}</code>
              <button type="button" className="btn-secondary btn-md shrink-0" onClick={() => void copyId(table.id)}>Копировать</button>
            </div>
          </div>}
          <TableField label="Название стола" htmlFor={formId + '-name'}>
            <input id={formId + '-name'} className="input" value={name} maxLength={40}
              placeholder={table ? tableLabel({ number: table.number }) : 'Например, У окна'} onChange={(event) => setName(event.target.value)} />
          </TableField>
          <TableField label="Номер стола" htmlFor={formId + '-number'}>
            <input id={formId + '-number'} className="input" type="number" inputMode="numeric"
              min={1} max={2147483647} step={1} required={!!table} placeholder="Автоматически"
              value={number} onChange={(event) => setNumber(event.target.value)} />
          </TableField>
          <TableField label="Форма стола" htmlFor={formId + '-shape'}>
            <select id={formId + '-shape'} className="input" value={shape}
              onChange={(event) => setShape(event.target.value === 'round' ? 'round' : 'rectangle')}>
              {shapes.map(({ value, label: caption }) => <option key={value} value={value}>{caption}</option>)}
            </select>
          </TableField>
          <TableField label="Количество мест" htmlFor={formId + '-seats'}>
            <input id={formId + '-seats'} className="input" type="number" inputMode="numeric" min={1} max={2147483647} step={1}
              required value={seats} onChange={(event) => setSeats(event.target.value)} />
          </TableField>
          <TableField label="Подпись на карте" htmlFor={formId + '-label'}>
            <input id={formId + '-label'} className="input" value={label} maxLength={30}
              placeholder="Как в названии стола" onChange={(event) => setLabel(event.target.value)} />
          </TableField>
          {table && <label className="flex items-center gap-2 text-sm text-text-secondary sm:ml-[9.75rem]">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            Стол активен
          </label>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </form>
      )}
    </Modal>
  );
}

function TableField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return <div className="grid items-center gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
    <label htmlFor={htmlFor} className="text-sm font-medium text-text-secondary">{label}</label>
    {children}
  </div>;
}

const historyFields: Record<string, string> = {
  name: 'Название', number: 'Номер', seats: 'Места', shape: 'Форма', label: 'Подпись на карте', isActive: 'Статус',
};
const historyDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bishkek' });

function historyValue(key: string, value: unknown) {
  if (typeof value === 'boolean') return value ? 'Активен' : 'Отключён';
  if (key === 'shape') return shapes.find((shape) => shape.value === value)?.label ?? '—';
  return String(value ?? '—');
}

function TableHistory({ tableId }: { tableId: string }) {
  const query = useTableChanges(tableId);
  if (query.isPending) return <WorkspacePending />;
  if (query.isError) return <div className="space-y-2">
    <p role="alert" className="text-sm text-danger">{apiError(query.error)}</p>
    <button type="button" className="btn-secondary btn-md" onClick={() => void query.refetch()}>Повторить</button>
  </div>;
  if (!query.data.length) return <p className="py-4 text-sm text-text-muted">За последние 7 дней изменений нет</p>;
  return <ul className="divide-y divide-border">
    {query.data.map(({ id, description, createdAt, userName, oldValue, newValue }) => (
      <li key={id} className="space-y-2 py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <span className="font-medium">{description}</span>
          <time className="text-text-muted" dateTime={createdAt}>{historyDate.format(new Date(createdAt))}</time>
        </div>
        {userName && <p className="text-text-muted">{userName}</p>}
        <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-2 gap-y-1">
          {Object.entries(newValue ?? {}).filter(([key]) => Object.prototype.hasOwnProperty.call(historyFields, key)).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-text-secondary">{historyFields[key]}</dt>
              <dd className="break-words">{oldValue && key in oldValue && historyValue(key, oldValue[key]) + ' → '}{historyValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      </li>
    ))}
  </ul>;
}
