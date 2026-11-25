import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { usePermissions } from '@/hooks/usePermissions';
import { api, apiError } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import type { Role } from '@/types';
import { financeKey } from './finance/api';
import { WorkShiftHistory } from './StaffPage';
import { QueryState } from './warehouse/WarehouseUi';
import { WorkspaceSearch } from './WorkspaceSearch';

interface EmployeeShift {
  id: string;
  name: string;
  role: Role;
  position: string | null;
  active: { id: string; startedAt: string } | null;
  request: { id: string; requestedAt: string } | null;
}

type ShiftAction = { employee: EmployeeShift; kind: 'start' | 'approve' | 'reject' | 'close' };
const registerKey = ['admin', 'staff', 'work-shifts'] as const;
const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', dateStyle: 'short', timeStyle: 'short' });
const actions = { start: 'Начать смену', approve: 'Подтвердить начало', reject: 'Отклонить запрос', close: 'Завершить смену' };
const roleLabel: Record<Role, string> = { OWNER: 'Владелец', ADMIN: 'Администратор', WAITER: 'Официант', KITCHEN: 'Кухня', BAR: 'Бар' };

export function WorkShiftsPage() {
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<ShiftAction | null>(null);
  const { canEditSection } = usePermissions();
  const ownId = useAuth((state) => state.user?.id);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: registerKey, enabled: tab === 'active', refetchInterval: 15_000,
    queryFn: async () => (await api.get<EmployeeShift[]>('/admin/work-shifts')).data });
  const refresh = () => void qc.invalidateQueries({ queryKey: registerKey });
  useSocketEvent('staff:shift_request_updated', refresh);
  useSocketEvent('waiter:shift_started', refresh);
  useSocketEvent('waiter:shift_ended', refresh);
  useSocketEvent('waiter:shift_updated', refresh);
  const change = useMutation({
    mutationFn: ({ employee, kind }: ShiftAction) => {
      if (kind === 'close') return api.post(`/admin/staff/shift-history/${employee.active!.id}/close`);
      const url = `/admin/work-shifts/${employee.id}`;
      if (kind === 'reject') return api.post(`${url}/requests/${employee.request!.id}/reject`);
      return api.post(`${url}/start`, { requestId: kind === 'approve' ? employee.request!.id : undefined });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'staff'] }),
        qc.invalidateQueries({ queryKey: financeKey }),
      ]);
      setAction(null);
    },
  });
  const rows = (query.data ?? []).filter((row) => `${row.name} ${row.position ?? roleLabel[row.role]}`
    .toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => Number(!!b.request) - Number(!!a.request));
  const close = () => { if (!change.isPending) setAction(null); };
  return <>
    <div className="no-scrollbar flex items-center gap-5 overflow-x-auto border-b border-border">
      <button type="button" onClick={() => setTab('active')}
        className={`relative -mb-px h-9 shrink-0 px-0.5 text-sm font-medium transition-colors ${tab === 'active' ? 'text-primary' : 'text-text-secondary hover:text-text-primary'}`}>
        Текущие смены{tab === 'active' && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
      </button>
      <button type="button" onClick={() => { setAction(null); setTab('history'); }}
        className={`relative -mb-px h-9 shrink-0 px-0.5 text-sm font-medium transition-colors ${tab === 'history' ? 'text-primary' : 'text-text-secondary hover:text-text-primary'}`}>
        История смен{tab === 'history' && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
      </button>
    </div>
    {tab === 'history' ? <WorkShiftHistory /> : <>
      <div className="poster-toolbar"><WorkspaceSearch label="Поиск сотрудника" value={search} onChange={setSearch} /></div>
      <QueryState pending={query.isPending} error={query.error} empty={!rows.length}>
        <div className="overflow-x-auto"><table className="poster-table w-full min-w-[560px]">
          <thead><tr><th>Сотрудник</th><th>Рабочая смена</th><th>Время (Бишкек)</th><th /></tr></thead>
          <tbody>{rows.map((employee) => {
            const { active, request } = employee;
            const time = active?.startedAt ?? request?.requestedAt;
            const choices = active ? ['close'] as const : request ? ['approve', 'reject'] as const : ['start'] as const;
            return <tr key={employee.id}>
              <td>{employee.name}<div className="text-xs text-text-muted">{employee.position ?? roleLabel[employee.role]}</div></td>
              <td className={active ? 'text-success' : request ? 'text-warning' : 'text-text-muted'}>
                {active ? 'Активна' : request ? 'Ожидает подтверждения' : 'Не начата'}
              </td>
              <td>{time ? date.format(new Date(time)) : '—'}</td>
              <td>{canEditSection('staff') && (active || employee.id !== ownId) && <div className="flex flex-wrap justify-end gap-2">
                {choices.map((kind) => <button key={kind} type="button" className={`${kind === 'reject' ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                  onClick={() => { change.reset(); setAction({ kind, employee }); }}>{actions[kind]}</button>)}
              </div>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </QueryState>
    </>}
    {action && <Modal open manageFocus title={actions[action.kind]} onClose={close} footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" disabled={change.isPending} onClick={close}>Отмена</button>
      <button type="button" className="btn-primary btn-md" disabled={change.isPending} onClick={() => change.mutate(action)}>{actions[action.kind]}</button>
    </div>}>
      <p>{action.employee.name}</p>
      {change.isError && <p role="alert" className="mt-2 text-sm text-danger">{apiError(change.error)}</p>}
    </Modal>}
  </>;
}
