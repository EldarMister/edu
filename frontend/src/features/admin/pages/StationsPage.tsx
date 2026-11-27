import { useId, useState, type FormEvent } from 'react';
import { Select } from '@/components/Select';
import { IconEdit, IconTrash } from '../components/icons';
import { DeleteNameField } from '../components/DeleteNameField';
import { Modal } from '@/components/Modal';
import { usePreparationStations, usePreparationStationUpdates, useRemovePreparationStation, useSavePreparationStation, type PreparationStation } from '@/features/kitchen/stations';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { QueryState, DocumentField } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';
import { EditorPage, useEditorDirty } from './warehouse/EditorPage';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';

const STATUS_OPTIONS = [
  { value: '', label: 'Все станции' },
  { value: 'active', label: 'Активные' },
  { value: 'archived', label: 'В архиве' },
];

export function StationsPage() {
  const query = usePreparationStations();
  usePreparationStationUpdates();
  const owner = useAuth((state) => state.user?.role === 'OWNER');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const [status, setStatus] = usePageFilter('status');
  const [sort, setSort] = usePageFilter('sort', 'asc');
  const [removeStation, setRemoveStation] = useState<PreparationStation>();
  const ascending = sort !== 'desc';
  const editing = editor?.type === 'station';
  const station = editing ? query.data?.find((item) => item.id === editor.id) : undefined;
  const pending = query.isPending || (editing && !!editor.id && query.isPlaceholderData);
  const filterStatus = STATUS_OPTIONS.some(({ value }) => value === status) ? status : '';
  const term = search.trim().toLocaleLowerCase('ru');
  const rows = (query.data ?? []).filter((station) =>
    (!filterStatus || station.isActive === (filterStatus === 'active')) &&
    station.name.toLocaleLowerCase('ru').includes(term),
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru') * (ascending ? 1 : -1));
  if (editing && !owner) {
    return <EditorPage title="Нет доступа" onClose={closeEditor}>
      <p role="alert" className="text-text-secondary">У вас нет доступа к редактированию станций.</p>
    </EditorPage>;
  }
  if (editing && editor.id && query.isSuccess && !query.isPlaceholderData && !station) {
    return <EditorPage title="Станция не найдена" onClose={closeEditor}>
      <p role="alert" className="text-text-secondary">Станция по этой ссылке не найдена. Вернитесь к списку станций.</p>
    </EditorPage>;
  }
  return <QueryState pending={pending} error={query.error}>
    <div className="poster-directory-surface">
      <WorkspaceHeaderCount count={query.isPlaceholderData ? undefined : rows.length} />
      {owner && <WorkspaceHeaderActions>
        <button type="button" aria-label="Добавить станцию" className="btn-primary btn-md"
          onClick={() => openEditor({ type: 'station' })}>Добавить</button>
      </WorkspaceHeaderActions>}
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск станции" value={search} onChange={setSearch} />
        <Select ariaLabel="Статус станции" className="poster-filter w-44"
          value={filterStatus} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>
      <div className="overflow-x-auto">
      <table className="poster-table poster-directory-table poster-directory-table--stations w-full min-w-[460px]">
        <colgroup><col style={{ width: '38%' }} /><col /><col style={{ width: 96 }} /></colgroup>
        <thead><tr>
          <th scope="col" aria-sort={ascending ? 'ascending' : 'descending'}>
            <button type="button" className="inline-flex items-center gap-2" onClick={() => setSort(ascending ? 'desc' : 'asc')}>
              Название <span aria-hidden="true">{ascending ? '↑' : '↓'}</span>
            </button>
          </th>
          <th scope="col">Статус</th><th scope="col"><span className="sr-only">Действия</span></th>
        </tr></thead>
        <tbody>{rows.map((station) => <tr key={station.id}>
          <td>{owner ? <button type="button" className="block max-w-full truncate text-left text-primary" title={station.name}
            onClick={() => openEditor({ type: 'station', id: station.id })}>{station.name}</button>
            : <span className="block truncate" title={station.name}>{station.name}</span>}</td>
          <td className={station.isActive ? '' : 'text-text-muted'}>{station.isActive ? 'Активна' : 'В архиве'}</td>
          <td>{owner && <div className="poster-row-actions">
            <button type="button" title="Редактировать"
              aria-label={`Редактировать станцию: ${station.name}`}
              className="row-action-icon"
              onClick={() => openEditor({ type: 'station', id: station.id })}>
              <IconEdit className="h-4 w-4" />
            </button>
            {!station.isBuiltIn && <button type="button" title="Удалить"
              aria-label={`Удалить станцию: ${station.name}`}
              className="group inline-flex items-center rounded-lg p-1.5 transition-colors hover:bg-danger/10"
              onClick={() => setRemoveStation(station)}>
              <IconTrash className="h-4 w-4 text-text-muted group-hover:text-danger" />
            </button>}
          </div>}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={3} className="poster-directory-empty text-center text-text-muted">Станции не найдены</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
    {editing && (!editor.id || station) && <StationEditor key={station?.id ?? 'new'} station={station} onClose={closeEditor} />}
    {removeStation && <RemoveStationDialog station={removeStation} onClose={() => setRemoveStation(undefined)} />}
  </QueryState>;
}

function StationEditor({ station, onClose }: { station?: PreparationStation; onClose: () => void }) {
  const formId = useId();
  const [name, setName] = useState(station?.name ?? '');
  const [isActive, setIsActive] = useState(station?.isActive ?? true);
  const { markSaved } = useEditorDirty(name !== (station?.name ?? '') || isActive !== (station?.isActive ?? true));
  const save = useSavePreparationStation();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || save.isPending) return;
    save.mutate(station ? { id: station.id, name: name.trim(), isActive } : { name: name.trim() }, {
      onSuccess: () => { markSaved(); onClose(); },
    });
  }
  const close = () => { if (!save.isPending) onClose(); };
  return <Modal open title={station ? 'Редактирование станции' : 'Добавление станции'} onClose={close}
    footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" disabled={save.isPending} onClick={close}>Отмена</button>
      <button form={formId} type="submit" className="btn-primary btn-md" disabled={!name.trim() || save.isPending}>Сохранить</button>
    </div>}>
    <form id={formId} onSubmit={submit} className="space-y-4">
      <DocumentField label="Название"><input aria-label="Название станции" className="input w-full" value={name} maxLength={80} required disabled={save.isPending} placeholder="Например, «Кухня»" onChange={(event) => setName(event.target.value)} /></DocumentField>
      {station && <DocumentField label="Статус"><label className="inline-flex items-center gap-2 py-2"><input type="checkbox" checked={isActive} disabled={save.isPending} onChange={(event) => setIsActive(event.target.checked)} />Активна</label></DocumentField>}
      {save.error && <p role="alert" className="text-danger">{apiError(save.error)}</p>}
    </form>
  </Modal>;
}

function RemoveStationDialog({ station, onClose }: { station: PreparationStation; onClose: () => void }) {
  const formId = useId();
  const [confirmation, setConfirmation] = useState('');
  const remove = useRemovePreparationStation();
  const confirmed = confirmation.trim() === station.name;
  const close = () => { if (!remove.isPending) onClose(); };
  return <Modal open title="Удалить станцию?" onClose={close}
    footer={<div className="flex gap-2">
      <button type="button" className="btn-secondary btn-lg flex-1" disabled={remove.isPending} onClick={close}>Отмена</button>
      <button type="submit" form={formId} className="btn-danger btn-lg flex-1 font-semibold"
        disabled={!confirmed || remove.isPending}>{remove.isPending ? 'Удаляем…' : 'Удалить'}</button>
    </div>}>
    <form id={formId} className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      if (confirmed && !remove.isPending) remove.mutate({ id: station.id, confirmation }, { onSuccess: onClose });
    }}>
      <p className="text-sm text-text-secondary">Удалить станцию «{station.name}»?</p>
      <DeleteNameField label="Введите название станции для подтверждения" value={confirmation}
        disabled={remove.isPending} onChange={setConfirmation} />
      {remove.isError && <p role="alert" className="text-sm text-danger">{apiError(remove.error)}</p>}
    </form>
  </Modal>;
}
