import { PositionEditor } from './PositionEditor';
import { OwnerOperationsEditor } from './OwnerOperationsEditor';
import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { resolvePermissions } from '@/lib/permissions';
import { apiError } from '@/lib/api';
import { IconEdit, IconTrash } from '../components/icons';
import { WorkspaceSearch } from './WorkspaceSearch';
import { WorkspaceHeaderCount } from './WorkspaceHeader';
import { QueryState } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter, usePageFilters } from './warehouse/workspace-route';
import { useStaffPositionMutations, useStaffPositions, type StaffPosition } from './positions-api';
import { positionAccessSummary } from './position-permissions';
import { FinanceRegister } from './finance/FinanceRegister';
import type { Role } from '@/types';

const accessFilters = [{ value: 'terminal', label: 'Доступ к кассе' }, { value: 'admin', label: 'Доступ к админ-панели' }, { value: 'production', label: 'Экран приготовления' }];
const roleDots: Record<Role, string> = {
  OWNER: 'bg-success', ADMIN: 'bg-primary/70', WAITER: 'bg-primary', KITCHEN: 'bg-success/75', BAR: 'bg-warning',
};

export function PositionsPage() {
  const { isOwner } = usePermissions();
  const query = useStaffPositions(isOwner);
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [{ search, role: roleFilter }, setFilters] = usePageFilters({ search: '', role: '' });
  const [sortDirection, setSortDirection] = usePageFilter('sort', 'asc');
  const [removePosition, setRemovePosition] = useState<StaffPosition | null>(null);
  const [replacementId, setReplacementId] = useState('');
  const [ownerEditorOpen, setOwnerEditorOpen] = useState(false);
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
  const positionEditor = editor?.type === 'position' ? editor : null;
  const entry = positionEditor?.id ? query.data?.find(({ id }) => id === positionEditor.id) : undefined;
  return <div className="min-w-0 overflow-hidden rounded-t-2xl bg-card text-sm">
    <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />
    <QueryState pending={query.isPending} error={query.error}>
      <FinanceRegister title="Должности" columnPreference="staff-positions"
        columns={[
          { key: 'name', label: 'Название должности', width: '42%',
            sort: { ascending: sortDirection !== 'desc', toggle: () => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc') } },
          { key: 'access', label: 'Права доступа' },
          { key: 'employees', label: 'Сотрудники', width: 100, numeric: true },
        ]}
        defaultColumns={['name', 'access', 'employees']}
        filters={<>
          <WorkspaceSearch label="Поиск должностей" placeholder="Поиск..." value={search}
            onChange={(value) => setFilters({ search: value })} />
          <Select ariaLabel="Фильтр должностей" value={roleFilter} onChange={(value) => setFilters({ role: value })}
            options={[{ value: '', label: 'Все должности' }, ...accessFilters]} />
          {(search || roleFilter) && <button type="button" className="finance-tool"
            onClick={() => setFilters({ search: '', role: '' })}>Сбросить</button>}
        </>}
        tools={<button type="button" className="btn-primary btn-md" aria-label="Добавить должность"
          onClick={() => openEditor({ type: 'position' })}>Добавить</button>}
        rows={rows.map(({ id, name, role, access, position }) => ({ id, values: {
          name: { value: name, display: <div className="flex items-center gap-2">
              <span aria-hidden className={'h-2 w-2 shrink-0 rounded-full ' + roleDots[role]} />
              {position ? <button type="button" className="text-left" onClick={() => openEditor({ type: 'position', id })}>{name}</button> : name}
            </div> },
          access: { value: access },
          employees: { value: position?.employees ?? null, display: position?.employees ?? '—' },
        }, action: position ? <div className="flex items-center justify-end gap-1">
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
            </div> : <div className="flex justify-end">
              <button type="button" title="Редактировать" aria-label="Редактировать права владельца"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-background hover:text-primary"
                onClick={() => setOwnerEditorOpen(true)}><IconEdit className="h-4 w-4" /></button>
            </div> }))}
        empty="Должности не найдены" />
    </QueryState>
    {ownerEditorOpen && <OwnerOperationsEditor onClose={() => setOwnerEditorOpen(false)} />}
    {positionEditor && (positionEditor.id && !entry
      ? <Modal open title="Должность" onClose={closeEditor}>
          <QueryState pending={query.isPending} error={query.error}>
            <p>Должность по этой ссылке не найдена.</p>
          </QueryState>
        </Modal>
      : <PositionEditor key={entry?.id ?? 'new'} position={entry} onClose={closeEditor} />)}
    {removePosition && <Modal open title="Удалить должность?" onClose={() => { if (!remove.isPending) setRemovePosition(null); }}
      footer={<div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-md" disabled={remove.isPending} onClick={() => setRemovePosition(null)}>Отмена</button>
        <button type="button" className="btn-danger btn-md" disabled={remove.isPending || (removePosition.employees > 0 && !replacementId)}
          onClick={() => remove.mutate({
            id: removePosition.id, replacementPositionId: replacementId || undefined,
          }, { onSuccess: () => setRemovePosition(null) })}>Удалить</button>
      </div>}>
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
