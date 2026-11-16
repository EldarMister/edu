import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { useStaff, useStaffMutations, type StaffMember } from '../api';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';
import { StaffEditor } from './StaffPage';
import { EditorPage } from './warehouse/EditorPage';
import { QueryState } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';

/** Access directory is separate from sales, attendance and cash reconciliation. */
export function StaffDirectory() {
  const query = useStaff('', '');
  const { remove } = useStaffMutations();
  const { isOwner, canAction, canEditSection } = usePermissions();
  const currentUser = useAuth((state) => state.user);
  const notify = useNotifications((state) => state.push);
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const [search, setSearch] = usePageFilter('search');
  const [position, setPosition] = usePageFilter('position');
  const [status, setStatus] = usePageFilter('status', 'active');
  const [deleting, setDeleting] = useState<StaffMember | null>(null);
  const canManage = isOwner || (canEditSection('staff') && canAction('manageStaff'));
  const canEdit = (member: StaffMember) => canManage && (member.canManage ?? isOwner);
  const positions = [...new Map((query.data ?? []).map((member) =>
    [member.positionId ?? member.role, member.positionName ?? (member.role === 'OWNER' ? 'Владелец' : 'Без должности')])).entries()];
  const term = search.trim().toLocaleLowerCase('ru');
  const rows = (query.data ?? []).filter((member) =>
    (!term || `${member.name} ${member.phone}`.toLocaleLowerCase('ru').includes(term))
    && (!position || (member.positionId ?? member.role) === position)
    && (status === 'all' || member.isActive === (status !== 'inactive')))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  if (editor?.type === 'employee') {
    const member = editor.id ? query.data?.find(({ id }) => id === editor.id) : null;
    if (!canManage || (member && !canEdit(member))) return <EditorPage title="Карточка сотрудника" onClose={closeEditor}>
      <p role="alert">Редактирование сотрудников недоступно для вашей должности.</p>
    </EditorPage>;
    if (editor.id && !member) return <EditorPage title="Карточка сотрудника" onClose={closeEditor}>
      <QueryState pending={query.isPending} error={query.error}><p>Сотрудник не найден.</p></QueryState>
    </EditorPage>;
    return <StaffEditor key={editor.id ?? 'new'} member={member ?? null} onClose={closeEditor} />;
  }

  return <div>
    <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />
    <WorkspaceHeaderActions>{canManage && <button type="button" className="btn-primary btn-md"
      onClick={() => openEditor({ type: 'employee' })}>Добавить сотрудника</button>}</WorkspaceHeaderActions>
    <div className="poster-toolbar">
      <WorkspaceSearch label="Поиск сотрудников" placeholder="Имя или телефон" value={search} onChange={setSearch} />
      <Select ariaLabel="Должность сотрудника" value={position} onChange={setPosition}
        options={[{ value: '', label: 'Все должности' }, ...positions.map(([value, label]) => ({ value, label }))]} />
      <Select ariaLabel="Статус сотрудника" value={status} onChange={setStatus} options={[
        { value: 'active', label: 'Активные' }, { value: 'inactive', label: 'Отключённые' }, { value: 'all', label: 'Все сотрудники' },
      ]} />
    </div>
    <QueryState pending={query.isPending} error={query.error}>
      <div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm">
        <thead><tr><th>Имя</th><th>Телефон / логин</th><th>Должность</th><th>Статус</th><th className="text-right">Действия</th></tr></thead>
        <tbody>{rows.map((member) => <tr key={member.id}>
          <td>{canEdit(member) ? <button className="text-left text-primary" onClick={() => openEditor({ type: 'employee', id: member.id })}>{member.name}</button> : member.name}</td>
          <td className="tabular-nums">{member.phone}</td>
          <td>{member.positionName ?? (member.role === 'OWNER' ? 'Владелец' : 'Без должности')}</td>
          <td><span className={member.isActive ? 'text-success' : 'text-text-muted'}>{member.isActive ? 'Активен' : 'Отключён'}</span></td>
          <td><div className="poster-row-actions">{canEdit(member) && <>
            <button aria-label={`Открыть сотрудника ${member.name}`} onClick={() => openEditor({ type: 'employee', id: member.id })}>Открыть →</button>
            {member.id !== currentUser?.id && <button aria-label={`Удалить сотрудника ${member.name}`} onClick={() => { remove.reset(); setDeleting(member); }}>Удалить</button>}
          </>}</div></td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <p className="py-12 text-center text-text-muted">Сотрудники не найдены</p>}
    </QueryState>
    {deleting && <Modal open title="Удалить сотрудника?" onClose={() => { if (!remove.isPending) setDeleting(null); }}
      footer={<button className="btn-danger btn-md" disabled={remove.isPending} onClick={async () => {
        try {
          const result = await remove.mutateAsync(deleting.id);
          notify({ message: result?.isActive === false ? 'Сотрудник отключён. История сохранена.' : 'Сотрудник удалён', at: new Date().toISOString() });
          setDeleting(null);
        } catch { /* The error stays in the dialog. */ }
      }}>Удалить</button>}>
      <p>«{deleting.name}» потеряет доступ к системе. Если есть история работы или расчётов, сотрудник останется в списке отключённых.</p>
      {remove.error && <p role="alert" className="mt-3 text-danger">{apiError(remove.error)}</p>}
    </Modal>}
  </div>;
}
