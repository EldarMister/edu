import { useId, useState, type FormEvent } from 'react';
import { usePreparationStations, useSavePreparationStation, type PreparationStation } from '@/features/kitchen/stations';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { QueryState, DocumentField } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';
import { EditorPage } from './warehouse/EditorPage';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';

export function StationsPage() {
  const query = usePreparationStations();
  const owner = useAuth((state) => state.user?.role === 'OWNER');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const editing = editor?.type === 'station';
  const station = editing ? query.data?.find((item) => item.id === editor.id) : undefined;
  const pending = query.isPending || (editing && !!editor.id && query.isPlaceholderData);
  const rows = (query.data ?? []).filter((station) => station.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  if (editing && !owner) {
    return <EditorPage title="Нет доступа" onClose={closeEditor}>
      <p role="alert" className="text-text-secondary">У вас нет доступа к редактированию цехов.</p>
    </EditorPage>;
  }
  if (editing && editor.id && query.isSuccess && !query.isPlaceholderData && !station) {
    return <EditorPage title="Цех не найден" onClose={closeEditor}>
      <p role="alert" className="text-text-secondary">Цех по этой ссылке не найден. Вернитесь к списку цехов.</p>
    </EditorPage>;
  }
  return <QueryState pending={pending} error={query.error}>
    {editing ? <StationEditor key={editor.id ?? 'new'} station={station} onClose={closeEditor} /> : <>
      <WorkspaceHeaderCount count={query.isPlaceholderData ? undefined : query.data?.length} />
      {owner && <WorkspaceHeaderActions><button type="button" className="btn-primary btn-md" onClick={() => openEditor({ type: 'station' })}>Добавить</button></WorkspaceHeaderActions>}
      <div className="poster-toolbar"><WorkspaceSearch label="Поиск цеха" value={search} onChange={setSearch} /></div>
      <div className="overflow-x-auto">
      <table className="poster-table poster-directory-table poster-directory-table--stations w-full min-w-[460px]">
        <colgroup><col style={{ width: '38%' }} /><col /><col style={{ width: 96 }} /></colgroup>
        <thead><tr><th>Название</th><th>Статус</th><th><span className="sr-only">Действия</span></th></tr></thead>
        <tbody>{rows.map((station) => <tr key={station.id}>
          <td>{owner ? <button type="button" className="block max-w-full truncate text-left text-primary" title={station.name}
            onClick={() => openEditor({ type: 'station', id: station.id })}>{station.name}</button>
            : <span className="block truncate" title={station.name}>{station.name}</span>}</td>
          <td className={station.isActive ? '' : 'text-text-muted'}>{station.isActive ? 'Активен' : 'В архиве'}</td>
          <td>{owner && <div className="poster-row-actions"><button type="button" aria-label={`Редактировать цех: ${station.name}`} onClick={() => openEditor({ type: 'station', id: station.id })}>Ред.</button></div>}</td>
        </tr>)}
        {!rows.length && <tr><td colSpan={3} className="poster-directory-empty text-center text-text-muted">Цехи не найдены</td></tr>}
        </tbody>
      </table>
      </div>
    </>}
  </QueryState>;
}

function StationEditor({ station, onClose }: { station?: PreparationStation; onClose: () => void }) {
  const formId = useId();
  const [name, setName] = useState(station?.name ?? '');
  const [isActive, setIsActive] = useState(station?.isActive ?? true);
  const save = useSavePreparationStation();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || save.isPending) return;
    save.mutate(station ? { id: station.id, name: name.trim(), isActive } : { name: name.trim() }, { onSuccess: onClose });
  }
  return <EditorPage title={station ? 'Редактирование цеха' : 'Добавление цеха'} onClose={onClose}
    footer={<button form={formId} type="submit" className="btn-primary btn-md" disabled={!name.trim() || save.isPending}>Сохранить</button>}>
    <form id={formId} onSubmit={submit} className="poster-form poster-form--directory space-y-4">
      <DocumentField label="Название"><input aria-label="Название цеха" className="input w-full" value={name} maxLength={80} required placeholder="Например, «Кухня»" onChange={(event) => setName(event.target.value)} /></DocumentField>
      {station && <DocumentField label="Статус"><label className="inline-flex items-center gap-2 py-2"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />Активен</label></DocumentField>}
      {save.error && <p role="alert" className="text-danger">{apiError(save.error)}</p>}
    </form>
  </EditorPage>;
}
