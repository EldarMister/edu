import { PositionEditor } from './PositionEditor';
import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { resolvePermissions } from '@/lib/permissions';
import { apiError } from '@/lib/api';
import { IconEdit, IconTrash } from '../components/icons';
import { WorkspaceSearch } from './WorkspaceSearch';
import { WorkspaceHeaderCount } from './WorkspaceHeader';
import { EditorPage } from './warehouse/EditorPage';
import { QueryState } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';
import { useStaffPositionMutations, useStaffPositions, type StaffPosition } from './positions-api';
import { positionAccessSummary } from './position-permissions';
import type { Role } from '@/types';

const accessFilters = [{ value: 'terminal', label: 'Доступ к кассе' }, { value: 'admin', label: 'Доступ к админ-панели' }, { value: 'production', label: 'Экран приготовления' }];
const roleDots: Record<Role, string> = {
  OWNER: 'bg-success', ADMIN: 'bg-primary/70', WAITER: 'bg-primary', KITCHEN: 'bg-success/75', BAR: 'bg-warning',
};

export function PositionsPage() {
  const { isOwner } = usePermissions();
  const query = useStaffPositions(isOwner);
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const [roleFilter, setRoleFilter] = usePageFilter('role');
  const [sortDirection, setSortDirection] = usePageFilter('sort', 'asc');
  const [removePosition, setRemovePosition] = useState<StaffPosition | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const { remove } = useStaffPositionMutations();
  const replacementOptions = removePosition
    ? (query.data ?? []).filter(({ id }) => id !== removePosition.id)
      .map(({ id, name }) => ({ value: id, label: name }))
    : [];
  const term = search.trim().toLocaleLowerCase('ru');
  const rows = [
    { id: 'system:OWNER', name: 'Владелец', role: 'OWNER' as const, access: positionAccessSummary('OWNER'), position: null },
    ...(query.data ?? []).map((position) => ({ ...position, access: positionAccessSummary(position.role, position.permissions), position })),
  ].filter((row) => {
    const access = resolvePermissions(row.role, row.position?.permissions);
    return row.name.toLocaleLowerCase('ru').includes(term) && (!roleFilter || (roleFilter === 'terminal' ? access.terminalAccess
      : roleFilter === 'admin' ? access.adminAccess : row.role === 'KITCHEN' || row.role === 'BAR'));
  })
    .sort((a, b) => (sortDirection === 'desc' ? -1 : 1) * a.name.localeCompare(b.name, 'ru'));
  if (!isOwner) return <p role="alert">Должностями управляет владелец заведения.</p>;
  if (editor?.type === 'position') {
    if (editor.id) {
      const entry = query.data?.find(({ id }) => id === editor.id);
      if (!entry) return <EditorPage title="Должность" onClose={closeEditor}>
        <QueryState pending={query.isPending} error={query.error}>
          <p>Должность по этой ссылке не найдена.</p>
        </QueryState>
      </EditorPage>;
      return <PositionEditor key={entry.id} position={entry} onClose={closeEditor} />;
    }
    return <PositionEditor key="new" onClose={closeEditor} />;
  }
  return <div className="min-w-0 overflow-hidden rounded-t-2xl bg-card text-sm">
    <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />
    <p className="px-4 pt-4 text-text-secondary">Создайте должность, настройте права и выберите её в карточке сотрудника.</p>
    <div className="flex flex-wrap items-center gap-2 p-4">
      <WorkspaceSearch className="[&_.input]:h-9 [&_.input]:rounded-full [&_.input]:pl-8 [&_.input]:pr-8"
        label="Поиск должностей" placeholder="Поиск..." value={search} onChange={setSearch} />
      <Select ariaLabel="Фильтр должностей" className="h-9 !rounded-md !px-2 !text-sm" value={roleFilter} onChange={setRoleFilter}
        options={[{ value: '', label: 'Все должности' }, ...accessFilters]} />
      <button type="button" className="btn-primary btn-md ml-auto" aria-label="Добавить должность"
        onClick={() => openEditor({ type: 'position' })}>Добавить</button>
    </div>
    <QueryState pending={query.isPending} error={query.error}>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead><tr className="border-b border-border text-text-muted">
            <th scope="col" className="w-[42%] px-3 py-3 font-normal" aria-sort={sortDirection === 'desc' ? 'descending' : 'ascending'}>
              <button type="button" className="text-left" onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')}>
                Название должности <span aria-hidden>{sortDirection === 'desc' ? '↓' : '↑'}</span>
              </button>
            </th>
            <th scope="col" className="px-3 py-3 font-normal">Права доступа</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">Сотрудники</th>
            <th scope="col" className="px-3 py-3 text-right font-normal">Действия</th>
          </tr></thead>
          <tbody>{rows.map(({ id, name, role, access, position }) => <tr className="h-12 border-b border-border hover:bg-background/60" key={id}>
            <td className="px-3 py-2"><div className="flex items-center gap-2">
              <span aria-hidden className={'h-2 w-2 shrink-0 rounded-full ' + roleDots[role]} />
              {position ? <button type="button" className="text-left" onClick={() => openEditor({ type: 'position', id })}>{name}</button> : name}
            </div></td>
            <td className="px-3 py-2">{access}</td>
            <td className="px-3 py-2 text-right tabular-nums">{position?.employees ?? '—'}</td>
            <td className="w-24 px-3 py-2 text-right">{position ? <div className="flex items-center justify-end gap-1">
              <button type="button" title="Редактировать" aria-label={`Редактировать должность ${name}`}
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-background hover:text-primary"
                onClick={() => openEditor({ type: 'position', id })}>
                <IconEdit className="h-4 w-4" />
              </button>
              <button type="button" title="Удалить" aria-label={`Удалить должность ${name}`}
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                onClick={() => {
                  remove.reset();
                  setReplacementId('');
                  setRemovePosition(position);
                }}>
                <IconTrash className="h-4 w-4" />
              </button>
            </div> : <span className="text-xs text-text-muted">Владелец аккаунта</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {!rows.length && <p role="status" className="p-8 text-center text-text-muted">Должности не найдены</p>}
    </QueryState>
    {removePosition && <Modal open title="Удалить должность?" onClose={() => { if (!remove.isPending) setRemovePosition(null); }}
      footer={<button type="button" className="btn-danger btn-md" disabled={remove.isPending || (removePosition.employees > 0 && !replacementId)}
        onClick={() => remove.mutate({
          id: removePosition.id, replacementPositionId: replacementId || undefined,
        }, { onSuccess: () => setRemovePosition(null) })}>Удалить</button>}>
      <p>Должность «{removePosition.name}» будет удалена.</p>
      {removePosition.employees > 0 && <div className="mt-4 space-y-2">
        {replacementOptions.length ? <>
          <p className="text-sm">Выберите новую должность для сотрудников ({removePosition.employees}). Они получат её права и ставки зарплаты.</p>
          <Select ariaLabel="Новая должность" className="w-full" value={replacementId} placeholder="Выберите должность"
            onChange={setReplacementId} options={replacementOptions} disabled={remove.isPending} />
        </> : <p className="text-sm">
          Создайте другую должность, чтобы перевести сотрудников ({removePosition.employees}).
        </p>}
      </div>}
      {remove.error && <p role="alert" className="mt-2 text-danger">{apiError(remove.error)}</p>}
    </Modal>}
  </div>;
}
