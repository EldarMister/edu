import { useState, type FormEvent } from 'react';
import { usePreparationStations, useSavePreparationStation, type PreparationStation } from '@/features/kitchen/stations';
import { useAuth } from '@/store/auth';
import { apiError } from '@/lib/api';
import { QueryState, DocumentField } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';
import { EditorPage } from './warehouse/EditorPage';
import { WorkspaceHeaderActions } from './WorkspaceHeader';

export function StationsPage() {
  const query = usePreparationStations();
  const owner = useAuth((state) => state.user?.role === 'OWNER');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const editing = owner && editor?.type === 'station';
  const station = editing ? query.data?.find((item) => item.id === editor.id) : undefined;
  const pending = query.isPending || (editing && !!editor.id && query.isPlaceholderData);
  const rows = (query.data ?? []).filter((station) => station.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if (editing && editor.id && query.isSuccess && !query.isPlaceholderData && !station) {
    return <EditorPage title="Цех не найден" onClose={closeEditor}>
      <p role="alert" className="text-text-secondary">Цех по этой ссылке не найден. Вернитесь к списку цехов.</p>
    </EditorPage>;
  }
  return <QueryState pending={pending} error={query.error}>
    {editing ? <StationEditor key={editor.id ?? 'new'} station={station} onClose={closeEditor} /> : <>
      {owner && <WorkspaceHeaderActions><button className="btn-primary btn-md" onClick={() => openEditor({ type: 'station' })}>Добавить</button></WorkspaceHeaderActions>}
      <div className="poster-toolbar"><input aria-label="Поиск цеха" className="input" placeholder="Быстрый поиск" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <table className="poster-table w-full text-left"><thead><tr><th>Название</th><th>Статус</th><th /></tr></thead>
        <tbody>{rows.map((station) => <tr key={station.id}>
          <td>{station.name}</td><td>{station.isActive ? 'Активен' : 'В архиве'}</td>
          <td>{owner && <div className="poster-row-actions"><button onClick={() => openEditor({ type: 'station', id: station.id })}>Ред.</button></div>}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="py-8 text-center text-text-muted">Цехи не найдены</p>}
    </>}
  </QueryState>;
}

function StationEditor({ station, onClose }: { station?: PreparationStation; onClose: () => void }) {
  const [name, setName] = useState(station?.name ?? '');
  const [isActive, setIsActive] = useState(station?.isActive ?? true);
  const save = useSavePreparationStation();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || save.isPending) return;
    save.mutate(station ? { id: station.id, name: name.trim(), isActive } : { name: name.trim() }, { onSuccess: onClose });
  }
  return <EditorPage title={station ? 'Редактирование цеха' : 'Добавление цеха'} onClose={onClose}
    footer={<button form="station-editor" type="submit" className="btn-primary btn-md" disabled={!name.trim() || save.isPending}>Сохранить</button>}>
    <form id="station-editor" onSubmit={submit} className="poster-form poster-form--directory space-y-4">
      <DocumentField label="Название"><input autoFocus aria-label="Название цеха" className="input" value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} /></DocumentField>
      {station && <DocumentField label="Статус"><label className="inline-flex items-center gap-2 py-2"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />Активен</label></DocumentField>}
      {save.error && <p role="alert" className="text-danger">{apiError(save.error)}</p>}
    </form>
  </EditorPage>;
}
