import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { usePermissions } from '@/hooks/usePermissions';
import { api, apiError } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import { useAuth } from '@/store/auth';
import type { Role } from '@/types';
import { IconCheck, IconClock, IconLogout, IconX } from '../components/icons';
import { financeKey } from './finance/api';
import { WorkShiftHistory } from './StaffPage';
import { WorkspaceHeaderActions } from './WorkspaceHeader';
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
const actions = {
  start: { label: 'Начать смену', icon: IconClock,
    color: 'border-primary/30 bg-primary/10 text-[rgb(var(--edu-link))] hover:bg-primary/20' },
  approve: { label: 'Подтвердить начало', icon: IconCheck,
    color: 'border-success/30 bg-success/10 text-[light-dark(#166534,rgb(var(--edu-success)))] hover:bg-success/20' },
  reject: { label: 'Отклонить запрос', icon: IconX,
    color: 'border-border text-text-secondary hover:bg-background hover:text-text-primary' },
  close: { label: 'Завершить смену', icon: IconLogout,
    color: 'border-warning/30 bg-warning/10 text-[light-dark(#854d0e,rgb(var(--edu-warning)))] hover:bg-warning/20' },
};
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
    <WorkspaceHeaderActions>
      <div className="flex items-center gap-5" role="tablist" aria-label="Раздел смен">
        <button type="button" onClick={() => setTab('active')}
          role="tab" aria-selected={tab === 'active'}
          className={`relative h-9 shrink-0 px-0.5 text-sm font-medium transition-colors ${tab === 'active' ? 'text-primary' : 'text-text-secondary hover:text-text-primary'}`}>
          Текущие смены{tab === 'active' && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
        </button>
        <button type="button" onClick={() => { setAction(null); setTab('history'); }}
          role="tab" aria-selected={tab === 'history'}
          className={`relative h-9 shrink-0 px-0.5 text-sm font-medium transition-colors ${tab === 'history' ? 'text-primary' : 'text-text-secondary hover:text-text-primary'}`}>
          История смен{tab === 'history' && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
        </button>
      </div>
    </WorkspaceHeaderActions>
    {tab === 'history' ? <WorkShiftHistory /> : <>
      <div className="poster-toolbar"><WorkspaceSearch label="Поиск сотрудника" value={search} onChange={setSearch} /></div>
      <QueryState pending={query.isPending} error={query.error} empty={!rows.length}>
        <div className="overflow-x-auto"><table className="poster-table w-full min-w-[560px]">
          <thead><tr><th>Сотрудник</th><th>Рабочая смена</th><th>Время (Бишкек)</th><th><span className="sr-only">Действия</span></th></tr></thead>
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
                {choices.map((kind) => {
                  const { label, icon: Icon, color } = actions[kind];
                  return <button key={kind} type="button"
                    className={`btn min-h-10 w-44 shrink-0 whitespace-nowrap rounded-lg border px-3 text-[13px] ${color}`}
                    onClick={() => { change.reset(); setAction({ kind, employee }); }}>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {label}
                  </button>;
                })}
              </div>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </QueryState>
    </>}
    {action && <Modal open manageFocus title={actions[action.kind].label} onClose={close} footer={<div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" disabled={change.isPending} onClick={close}>Отмена</button>
      <button type="button" className="btn-primary btn-md" disabled={change.isPending} onClick={() => change.mutate(action)}>{actions[action.kind].label}</button>
    </div>}>
      <p>{action.employee.name}</p>
      {change.isError && <p role="alert" className="mt-2 text-sm text-danger">{apiError(change.error)}</p>}
    </Modal>}
  </>;
}
