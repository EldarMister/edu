import { DatePicker, DateTimePicker } from '@/components/DatePicker';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Role } from '@/types';
import { useStaffPositions } from './positions-api';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { usePreparationStations, usePreparationStationUpdates } from '@/features/kitchen/stations';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { IconPlus, IconEdit, IconTrash } from '../components/icons';
import { EmployeePermissionsModal } from '../components/EmployeePermissionsModal';
import { WaiterOrdersReport } from './WaiterOrdersReport';
import { WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';
import { EditorPage, useEditorDirty } from './warehouse/EditorPage';
import { DocumentField } from './warehouse/WarehouseUi';
import { useEditorRoute } from './warehouse/workspace-route';
import {
  useShiftReport,
  useSetCashHanded,
  useShiftHistory,
  useShiftHistoryActions,
  useStaff,
  useStaffMutations,
  type ShiftReportCategory,
  type ShiftReportRow,
  type ShiftHistoryFilters,
  type ShiftHistoryPeriod,
  type ShiftHistoryResponse,
  type ShiftHistoryRow,
  type StaffMember,
} from '../api';

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
};
const EMPLOYEE_PAGE_SIZE = 25;
const POSITION_DOT: Record<Role, string> = {
  OWNER: 'bg-primary',
  ADMIN: 'bg-primary/70',
  WAITER: 'bg-primary/80',
  KITCHEN: 'bg-success',
  BAR: 'bg-warning',
};

function IconRefresh(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
function IconKey(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M10 13l8-8m-2 0h3v3" />
    </svg>
  );
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-text-light transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const WAITER_REPORT_BADGE_EXPIRES_AT = new Date('2026-09-05T19:16:46.239+06:00').getTime();

function durationLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} ч ${m} мин`;
}
function shiftLabel(row: ShiftReportRow) {
  if (!row.shiftStart) return '—';
  const start = timeHM(row.shiftStart);
  const end = row.shiftEnd ? timeHM(row.shiftEnd) : '…';
  const tail = row.durationMin != null ? durationLabel(row.durationMin) : row.shiftOpen ? 'в смене' : '';
  return `${start} — ${end}${tail ? ` (${tail})` : ''}`;
}
function signedMoney(n: number) {
  if (Math.round(n) === 0) return '0 с';
  return `${n > 0 ? '+' : '−'}${money(Math.abs(n))}`;
}

function dateDMY(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU');
}

function toDateTimeLocal(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function StaffPage() {
  const stations = usePreparationStations().data ?? [];
  usePreparationStationUpdates();
  const stationNames = new Map(stations.map(({ id, name }) => [id, name]));
  const [tab, setTab] = useState<'employees' | 'current' | 'history' | 'waiter-orders'>('employees');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeePosition, setEmployeePosition] = useState('');
  const [employeeStatus, setEmployeeStatus] = useState('');
  const [employeeSort, setEmployeeSort] = useState<'asc' | 'desc'>('asc');
  const [employeePage, setEmployeePage] = useState(1);
  const [showWaiterReportBadge, setShowWaiterReportBadge] = useState(
    () => Date.now() < WAITER_REPORT_BADGE_EXPIRES_AT,
  );
  const [date, setDate] = useState(todayYmd());
  const [historyFilters, setHistoryFilters] = useState<ShiftHistoryFilters>({ period: 'today' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftHistoryRow | null>(null);
  const [closingShift, setClosingShift] = useState<ShiftHistoryRow | null>(null);
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const staffEditor = editor?.type === 'employee' ? editor : null;
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<StaffMember | null>(null);

  const reportQ = useShiftReport(date, tab === 'current');
  const historyQ = useShiftHistory(historyFilters, tab === 'history');
  const shiftActions = useShiftHistoryActions();
  const staffQ = useStaff('', '');
  const { remove } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const tr = useT();
  const currentUser = useAuth((s) => s.user);
  const { isOwner, canAction } = usePermissions();
  const canManageStaff = isOwner || canAction('manageStaff');
  const canEditMember = (member: StaffMember) => canManageStaff && (isOwner || (member.role !== 'ADMIN' && !member.positionId));
  const positionKey = (member: StaffMember) => member.positionId ?? member.role;
  const positionLabel = (member: StaffMember) => member.positionName ?? tr(ROLE_LABEL[member.role]);
  const positionChoices = new Map((staffQ.data ?? []).map((member) => [positionKey(member), positionLabel(member)]));
  const employeeTerm = employeeSearch.trim().toLocaleLowerCase('ru');
  const employeePhone = employeeTerm.replace(/[^\d]/g, '');
  const looksLikePhone = !!employeePhone && /^[+\d ()-]+$/.test(employeeTerm);
  const employees = (staffQ.data ?? []).filter((member) =>
    (!employeePosition || positionKey(member) === employeePosition) &&
    (!employeeStatus || member.isActive === (employeeStatus === 'active')) &&
    (!employeeTerm || member.name.toLocaleLowerCase('ru').includes(employeeTerm) ||
      (looksLikePhone && (member.phone ?? '').replace(/[^\d]/g, '').includes(employeePhone))),
  ).sort((a, b) => (employeeSort === 'asc' ? 1 : -1) * a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id));
  const employeePages = Math.max(1, Math.ceil(employees.length / EMPLOYEE_PAGE_SIZE));
  const visibleEmployeePage = Math.min(employeePage, employeePages);
  const firstEmployee = (visibleEmployeePage - 1) * EMPLOYEE_PAGE_SIZE;
  const visibleEmployees = employees.slice(firstEmployee, firstEmployee + EMPLOYEE_PAGE_SIZE);

  useEffect(() => {
    if (!showWaiterReportBadge) return;
    const remaining = WAITER_REPORT_BADGE_EXPIRES_AT - Date.now();
    if (remaining <= 0) {
      setShowWaiterReportBadge(false);
      return;
    }
    const timer = window.setTimeout(() => setShowWaiterReportBadge(false), remaining);
    return () => window.clearTimeout(timer);
  }, [showWaiterReportBadge]);

  const rows = reportQ.data ?? [];
  const memberById = new Map((staffQ.data ?? []).map((m) => [m.id, m]));
  const staffOptions = useMemo(
    () => [
      { value: '', label: 'Все сотрудники' },
      ...(staffQ.data ?? []).map((m) => ({ value: m.id, label: m.name })),
    ],
    [staffQ.data],
  );
  const roleOptions = [
    { value: '', label: 'Все роли' },
    { value: 'WAITER', label: 'Официант' },
    { value: 'BAR', label: 'Бар' },
    { value: 'KITCHEN', label: 'Кухня' },
    { value: 'ADMIN', label: 'Администратор' },
  ];

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await remove.mutateAsync(pendingDelete.id);
      push({ message: 'Сотрудник удалён', at: new Date().toISOString() });
      setPendingDelete(null);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  function exportCsv() {
    const head = ['Сотрудник', 'Роль', 'Смена', 'Оборот', 'Касса (должен)', 'Касса (сдал)', 'Разница'];
    const lines = rows.map((r) => {
      const fin = r.isWaiter
        ? [shiftLabel(r), r.turnover, r.cashDue, r.cashHanded, r.difference]
        : ['—', '—', '—', '—', '—'];
      return [r.name, tr(ROLE_LABEL[r.role]), ...fin]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(';');
    });
    const csv = '﻿' + [head.join(';'), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift-report-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportHistoryCsv() {
    const historyRows = historyQ.data?.items ?? [];
    const head = ['Сотрудник', 'Роль', 'Дата', 'Пришел', 'Ушел', 'Отработал', 'Статус'];
    const lines = historyRows.map((r) => [
      r.employeeName,
      tr(ROLE_LABEL[r.role]),
      dateDMY(r.startedAt),
      timeHM(r.startedAt),
      r.endedAt ? timeHM(r.endedAt) : '—',
      durationLabel(r.durationMin),
      shiftStatusLabel(r.status),
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'));
    const csv = '﻿' + [head.join(';'), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift-history-${historyFilters.period}-${todayYmd()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function closeShift() {
    if (!closingShift) return;
    try {
      await shiftActions.close.mutateAsync(closingShift.id);
      push({ message: 'Смена закрыта', type: 'success', at: new Date().toISOString() });
      setClosingShift(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  }

  if (staffEditor) {
    const member = staffEditor.id ? memberById.get(staffEditor.id) : null;
    if (!canManageStaff || (member && !canEditMember(member))) {
      return <EditorPage title="Карточка сотрудника" onClose={closeEditor}><p role="alert">Недостаточно прав для редактирования.</p></EditorPage>;
    }
    if (staffEditor.id && !member) return <EditorPage title="Карточка сотрудника" onClose={closeEditor}>
      {staffQ.isPending ? <Spinner /> : <p role="alert">{staffQ.isError ? apiError(staffQ.error) : 'Сотрудник не найден.'}</p>}
    </EditorPage>;
    return <>
      <StaffEditor key={staffEditor.id ?? 'new'} member={member ?? null} onClose={closeEditor}
        onManagePermissions={member && isOwner && member.role === 'ADMIN' && !member.positionId && member.id !== currentUser?.id
          ? () => setPermissionsFor(member) : undefined} />
      {permissionsFor && permissionsFor.id === member?.id && <EmployeePermissionsModal member={permissionsFor} onClose={() => setPermissionsFor(null)} />}
    </>;
  }

  return (
    <div className="space-y-3">
      {tab === 'employees' && <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <WorkspaceHeaderCount count={staffQ.isSuccess ? employees.length : undefined} />
        <div className="flex flex-wrap items-center gap-2 px-3 py-4 sm:px-4">
          <WorkspaceSearch className="[&_.input]:h-8 [&_.input]:w-full [&_.input]:rounded-full [&_.input]:pl-8 [&_.input]:pr-8 [&_.input]:text-[13px]"
            label="Поиск сотрудников" placeholder="Поиск..." value={employeeSearch}
            onChange={(value) => { setEmployeeSearch(value); setEmployeePage(1); }} />
          <Select className="h-8 !rounded-md !px-2.5 !text-[13px]" ariaLabel="Должность" placeholder="Должность"
            value={employeePosition || 'all'} onChange={(value) => { setEmployeePosition(value); setEmployeePage(1); }} options={[
              { value: '', label: 'Все должности' }, ...Array.from(positionChoices, ([value, label]) => ({ value, label })),
            ]} />
          <Select className="h-8 !rounded-md !px-2.5 !text-[13px]" ariaLabel="Статус сотрудника" placeholder="+ Фильтр"
            value={employeeStatus || 'all'} onChange={(value) => { setEmployeeStatus(value); setEmployeePage(1); }} options={[
              { value: '', label: 'Все сотрудники' }, { value: 'active', label: 'Активные' }, { value: 'inactive', label: 'Неактивные' },
            ]} />
          {(employeeSearch || employeePosition || employeeStatus) && <button type="button" className="h-8 px-1 text-sm text-primary"
            onClick={() => { setEmployeeSearch(''); setEmployeePosition(''); setEmployeeStatus(''); setEmployeePage(1); }}>Сбросить</button>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className="h-8 px-2 text-[13px] text-primary hover:underline" onClick={() => setTab('current')}>Отчёты по сменам</button>
            {canManageStaff && <button type="button" className="btn-primary h-8 rounded-md px-3 text-sm"
              aria-label={tr('Добавить сотрудника')} onClick={() => openEditor({ type: 'employee' })}>{tr('Добавить')}</button>}
          </div>
        </div>
        {staffQ.isPending ? <div className="flex justify-center py-12"><Spinner /></div>
          : staffQ.isError ? <div className="space-y-2 px-4 pb-4">
            <p role="alert" className="text-danger">{apiError(staffQ.error)}</p>
            <button type="button" className="btn-secondary btn-md" onClick={() => void staffQ.refetch()}>Повторить</button>
          </div> : <>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[620px] table-fixed text-left text-sm">
                <colgroup><col className="w-[27%]" /><col className="w-[20%]" /><col /><col className="w-[19%]" /><col className="w-[86px]" /></colgroup>
                <thead className="border-b border-border text-[13px] text-text-muted"><tr>
                  <th scope="col" className="px-4 py-3 font-medium" aria-sort={employeeSort === 'asc' ? 'ascending' : 'descending'}>
                    <button type="button" className="inline-flex items-center gap-2 hover:text-primary"
                      onClick={() => { setEmployeeSort(employeeSort === 'asc' ? 'desc' : 'asc'); setEmployeePage(1); }}>
                      Имя <span aria-hidden="true">{employeeSort === 'asc' ? '↑' : '↓'}</span>
                    </button>
                  </th>
                  {['Телефон', 'Должность', 'Статус'].map((label) =>
                    <th key={label} scope="col" className="px-3 py-3 font-medium">{label}</th>)}
                  <th scope="col"><span className="sr-only">Действия</span></th>
                </tr></thead>
                <tbody>{visibleEmployees.map((member) => {
                  const canEdit = canEditMember(member);
                  const canRemove = canEdit && member.id !== currentUser?.id;
                  return <tr key={member.id} className="h-12 border-b border-border last:border-b-0 hover:bg-background/55">
                    <td className="truncate px-4 py-2" title={member.name}><span>{member.name}</span></td>
                    <td className="truncate px-3 py-2 tabular-nums">{member.phone || '—'}</td>
                    <td className="px-3 py-2"><span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${POSITION_DOT[member.role]}`} />
                      <span className="truncate" title={positionLabel(member)}>{positionLabel(member)}</span>
                    </span></td>
                    <td className="px-3 py-2"><span className={member.isActive ? 'text-text-primary' : 'text-text-muted'}>
                      {member.isActive ? 'Активен' : 'Неактивен'}
                    </span></td>
                    <td className="pr-2">{canEdit && <div className="flex justify-end gap-1">
                      <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-primary hover:bg-background"
                        aria-label={`Изменить: ${member.name}`} onClick={() => openEditor({ type: 'employee', id: member.id })}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                          <path d="M5 12h14m-6-6 6 6-6 6" />
                        </svg>
                      </button>
                      {canRemove && <Select value="" ariaLabel={`Действия сотрудника: ${member.name}`} placeholder="⋮"
                        className="!h-8 !w-7 !justify-center !rounded-md !border-transparent !bg-transparent !p-0 !text-lg [&>span]:!text-primary [&>svg]:hidden"
                        options={[{ value: 'remove', label: tr('Удалить') }]}
                        onChange={() => setPendingDelete({ id: member.id, name: member.name })} />}
                    </div>}</td>
                  </tr>;
                })}
                {!employees.length && <tr><td colSpan={5} className="p-8 text-center text-text-muted">Сотрудники не найдены</td></tr>}</tbody>
              </table>
            </div>
            {!!employees.length && <div className="flex flex-wrap items-center gap-3 border-t border-border bg-background/55 px-3 py-2 text-[13px]">
              <div className="flex items-center gap-1">
                <EmployeePageButton label="Первая страница" glyph="«" disabled={visibleEmployeePage <= 1} onClick={() => setEmployeePage(1)} />
                <EmployeePageButton label="Предыдущая страница" glyph="‹" disabled={visibleEmployeePage <= 1}
                  onClick={() => setEmployeePage(visibleEmployeePage - 1)} />
                <span className="px-1 tabular-nums">Страница {visibleEmployeePage} из {employeePages}</span>
                <EmployeePageButton label="Следующая страница" glyph="›" disabled={visibleEmployeePage >= employeePages}
                  onClick={() => setEmployeePage(visibleEmployeePage + 1)} />
                <EmployeePageButton label="Последняя страница" glyph="»" disabled={visibleEmployeePage >= employeePages}
                  onClick={() => setEmployeePage(employeePages)} />
              </div>
              <span className="tabular-nums text-text-muted">{firstEmployee + 1}–{firstEmployee + visibleEmployees.length} из {employees.length}</span>
            </div>}
          </>}
      </section>}
      {tab !== 'employees' && tab !== 'waiter-orders' && <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">{tr('Персонал и отчет по сменам')}</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {tab === 'current' && (
            <>
              <span className="text-sm text-text-secondary">{tr('Дата смены:')}</span>
              <DatePicker
                className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                value={date}
                onChange={(value) => setDate(value)}
              />
              <button
                onClick={() => reportQ.refetch()}
                disabled={reportQ.isFetching}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:bg-background"
              >
                <IconRefresh className={`h-4 w-4 ${reportQ.isFetching ? 'animate-spin' : ''}`} />
                {tr('Обновить')}
              </button>
              <button
                onClick={exportCsv}
                className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:bg-background"
              >
                {tr('Экспорт')}
              </button>
            </>
          )}
          {canManageStaff && <button
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            onClick={() => openEditor({ type: 'employee' })}
          >
            <IconPlus className="h-4 w-4" /> {tr('Добавить сотрудника')}
          </button>}
        </div>
      </div>}

      {tab !== 'employees' && <div className="no-scrollbar flex items-center gap-5 overflow-x-auto border-b border-border">
        <TabButton active={false} onClick={() => setTab('employees')}>Сотрудники</TabButton>
        <TabButton active={tab === 'current'} onClick={() => setTab('current')}>
          Текущая смена
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
          История смен
        </TabButton>
        <TabButton active={tab === 'waiter-orders'} onClick={() => setTab('waiter-orders')}>
          <span className="flex items-center gap-2">
            Отчет официанта
            {showWaiterReportBadge && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-primary">
                Новый
              </span>
            )}
          </span>
        </TabButton>
      </div>}

      {tab === 'history' && (
        <HistoryFilters
          filters={historyFilters}
          setFilters={setHistoryFilters}
          staffOptions={staffOptions}
          roleOptions={roleOptions}
          loading={historyQ.isFetching}
          onRefresh={() => historyQ.refetch()}
          onExport={exportHistoryCsv}
        />
      )}

      {tab === 'waiter-orders' ? (
        <WaiterOrdersReport staff={staffQ.data ?? []} staffLoading={staffQ.isLoading} />
      ) : tab === 'current' ? (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
        {reportQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-text-muted">{tr('Нет данных за выбранную дату')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border bg-background/40 text-left text-xs text-text-muted">
                  <th className="w-9 px-2 py-2.5" />
                  <th className="px-3 py-2.5 font-medium">{tr('Сотрудник / Роль')}</th>
                  <th className="px-3 py-2.5 font-medium">{tr('Смена')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Оборот')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Касса (должен)')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Касса (сдал)')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Разница')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Действия')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isWaiter = row.isWaiter;
                  const open = isWaiter && expanded === row.waiterId;
                  const diffCls =
                    Math.round(row.difference) === 0
                      ? 'text-text-secondary'
                      : row.difference > 0
                        ? 'text-success'
                        : 'text-danger';
                  const member = memberById.get(row.waiterId);
                  const canEdit = !!member && canEditMember(member);
                  const openEdit = () => {
                    if (member) openEditor({ type: 'employee', id: member.id });
                  };
                  return (
                    <FragmentRow key={row.waiterId}>
                      <tr
                        className={`border-b border-border ${isWaiter ? 'cursor-pointer hover:bg-background/50' : ''}`}
                        onClick={isWaiter ? () => setExpanded(open ? null : row.waiterId) : undefined}
                      >
                        <td className="px-2 py-2.5 align-middle">
                          {isWaiter && <Chevron open={open} />}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-text-primary">{row.name}</div>
                          <div className="text-xs text-text-muted">{member?.positionName ?? stationNames.get(member?.prepStation ?? (row.role === 'KITCHEN' ? 'kitchen' : row.role === 'BAR' ? 'bar' : '')) ?? tr(ROLE_LABEL[row.role])}</div>
                        </td>
                        {isWaiter ? (
                          <>
                            <td className="whitespace-nowrap px-3 py-2.5 text-text-secondary">{shiftLabel(row)}</td>
                            <td className="px-3 py-2.5 text-right font-medium text-text-primary">{money(row.turnover)}</td>
                            <td className="px-3 py-2.5 text-right text-text-secondary">{money(row.cashDue)}</td>
                            <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <CashHandedCell row={row} date={date} />
                            </td>
                            <td className={`px-3 py-2.5 text-right font-medium ${diffCls}`}>{signedMoney(row.difference)}</td>
                          </>
                        ) : (
                          // Кухня / бар / админ / владелец — без официантских финансовых колонок.
                          <td className="px-3 py-2.5 text-center text-text-light" colSpan={5}>
                            —
                          </td>
                        )}
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {canEdit && <div className="flex items-center justify-end gap-1">
                            <IconBtn title={tr('Изменить')} onClick={openEdit}>
                              <IconEdit className="h-4 w-4" />
                            </IconBtn>
                            {row.waiterId !== currentUser?.id && <IconBtn title={tr('Удалить')} danger onClick={() => setPendingDelete({ id: row.waiterId, name: row.name })}>
                              <IconTrash className="h-4 w-4" />
                            </IconBtn>}
                          </div>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border bg-background/30">
                          <td colSpan={8} className="px-3 py-3">
                            <ShiftDetails row={row} onEdit={canEdit ? openEdit : undefined} />
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>
      ) : tab === 'history' ? (
        <ShiftHistoryTable
          data={historyQ.data}
          isLoading={historyQ.isLoading}
          expanded={historyExpanded}
          setExpanded={setHistoryExpanded}
          onEdit={setEditingShift}
          onClose={setClosingShift}
        />
      ) : null}

      {editingShift && (
        <ShiftEditModal row={editingShift} onClose={() => setEditingShift(null)} />
      )}
      {closingShift && (
        <Modal
          open
          onClose={() => !shiftActions.close.isPending && setClosingShift(null)}
          title="Закрыть смену вручную"
          footer={
            <div className="flex gap-2">
              <button className="btn-secondary btn-lg flex-1" disabled={shiftActions.close.isPending} onClick={() => setClosingShift(null)}>
                Отмена
              </button>
              <button className="btn-primary btn-lg flex-1 font-semibold" disabled={shiftActions.close.isPending} onClick={closeShift}>
                {shiftActions.close.isPending ? <Spinner /> : 'Закрыть смену'}
              </button>
            </div>
          }
        >
          <p className="text-sm text-text-secondary">
            Закрыть открытую смену сотрудника «{closingShift.employeeName}» текущим временем?
          </p>
        </Modal>
      )}
      {pendingDelete && (
        <Modal
          open
          onClose={() => !remove.isPending && setPendingDelete(null)}
          title="Удалить сотрудника"
          footer={
            <div className="flex gap-2">
              <button
                className="btn-secondary btn-lg flex-1"
                disabled={remove.isPending}
                onClick={() => setPendingDelete(null)}
              >
                Отмена
              </button>
              <button
                className="btn-danger btn-lg flex-1 font-semibold"
                disabled={remove.isPending}
                onClick={confirmDelete}
              >
                {remove.isPending ? <Spinner /> : 'Удалить'}
              </button>
            </div>
          }
        >
          <p className="text-sm text-text-secondary">
            Удалить сотрудника «{pendingDelete.name}»?
          </p>
        </Modal>
      )}
    </div>
  );
}

/** Обёртка, чтобы вернуть две <tr> из map без лишнего DOM-узла. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative -mb-px h-9 shrink-0 whitespace-nowrap px-0.5 text-sm font-medium transition-colors ${
        active ? 'text-primary' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
      {active && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />}
    </button>
  );
}

function HistoryFilters({
  filters,
  setFilters,
  staffOptions,
  roleOptions,
  loading,
  onRefresh,
  onExport,
}: {
  filters: ShiftHistoryFilters;
  setFilters: React.Dispatch<React.SetStateAction<ShiftHistoryFilters>>;
  staffOptions: { value: string; label: string }[];
  roleOptions: { value: string; label: string }[];
  loading: boolean;
  onRefresh: () => void;
  onExport: () => void;
}) {
  const periodOptions: { value: ShiftHistoryPeriod; label: string }[] = [
    { value: 'today', label: 'Сегодня' },
    { value: 'week', label: 'Неделя' },
    { value: 'month', label: 'Месяц' },
    { value: 'custom', label: 'Произвольный период' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-44">
        <Select
          className="h-10 w-full"
          value={filters.period}
          onChange={(v) => setFilters((f) => ({ ...f, period: v as ShiftHistoryPeriod }))}
          options={periodOptions}
        />
      </div>
      {filters.period === 'custom' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">с</span>
            <DatePicker
              className="h-10 rounded-lg border border-border bg-white px-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              value={filters.from ?? ''}
              onChange={(value) => setFilters((f) => ({ ...f, from: value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">по</span>
            <DatePicker
              className="h-10 rounded-lg border border-border bg-white px-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              value={filters.to ?? ''}
              onChange={(value) => setFilters((f) => ({ ...f, to: value }))}
            />
          </div>
        </>
      )}
      <div className="w-full sm:w-52">
        <Select
          className="h-10 w-full"
          value={filters.employeeId ?? ''}
          onChange={(v) => setFilters((f) => ({ ...f, employeeId: v || undefined }))}
          options={staffOptions}
        />
      </div>
      <div className="w-full sm:w-44">
        <Select
          className="h-10 w-full"
          value={filters.role ?? ''}
          onChange={(v) => setFilters((f) => ({ ...f, role: (v || undefined) as ShiftHistoryFilters['role'] }))}
          options={roleOptions}
        />
      </div>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:bg-background disabled:opacity-60"
      >
        <IconRefresh className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        Обновить
      </button>
      <button
        onClick={onExport}
        className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:bg-background"
      >
        Экспорт
      </button>
    </div>
  );
}

function shiftStatusLabel(status: ShiftHistoryRow['status']) {
  if (status === 'active') return 'В смене';
  if (status === 'unclosed') return 'Не закрыта';
  return 'Завершена';
}

function ShiftStatusBadge({ status }: { status: ShiftHistoryRow['status'] }) {
  const cls =
    status === 'active'
      ? 'bg-success/10 text-success'
      : status === 'unclosed'
        ? 'bg-warning/10 text-warning'
        : 'bg-background text-text-secondary';
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {shiftStatusLabel(status)}
    </span>
  );
}

function ShiftHistoryTable({
  data,
  isLoading,
  expanded,
  setExpanded,
  onEdit,
  onClose,
}: {
  data: ShiftHistoryResponse | undefined;
  isLoading: boolean;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  onEdit: (row: ShiftHistoryRow) => void;
  onClose: (row: ShiftHistoryRow) => void;
}) {
  const rows = data?.items ?? [];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      {isLoading ? (
        <div className="flex justify-center py-12 text-primary">
          <Spinner className="h-6 w-6" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-text-muted">Нет смен за выбранный период</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-left text-xs text-text-muted">
                  <th className="w-9 px-2 py-2.5" />
                  <th className="px-3 py-2.5 font-medium">Сотрудник / роль</th>
                  <th className="px-3 py-2.5 font-medium">Дата</th>
                  <th className="px-3 py-2.5 font-medium">Пришел</th>
                  <th className="px-3 py-2.5 font-medium">Ушел</th>
                  <th className="px-3 py-2.5 font-medium">Отработал</th>
                  <th className="px-3 py-2.5 font-medium">Статус</th>
                  <th className="px-3 py-2.5 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const open = expanded === row.id;
                  return (
                    <FragmentRow key={row.id}>
                      <tr
                        className="cursor-pointer border-b border-border transition-colors hover:bg-background/60"
                        onClick={() => setExpanded(open ? null : row.id)}
                      >
                        <td className="px-2 py-2.5"><Chevron open={open} /></td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-text-primary">{row.employeeName}</div>
                          <div className="text-xs text-text-muted">{ROLE_LABEL[row.role]}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-text-secondary">{dateDMY(row.startedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-text-secondary">{timeHM(row.startedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-text-secondary">{row.endedAt ? timeHM(row.endedAt) : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-medium text-text-primary">{durationLabel(row.durationMin)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5"><ShiftStatusBadge status={row.status} /></td>
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            <IconBtn title="Редактировать время смены" onClick={() => onEdit(row)}>
                              <IconEdit className="h-4 w-4" />
                            </IconBtn>
                            {row.status !== 'closed' && (
                              <button
                                onClick={() => onClose(row)}
                                className="h-8 rounded-lg border border-warning/30 px-2.5 text-xs font-medium text-warning transition-colors hover:bg-warning/10"
                              >
                                Закрыть
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border bg-background/25">
                          <td colSpan={8} className="px-4 py-2.5">
                            <ShiftHistoryDetails row={row} />
                          </td>
                        </tr>
                      )}
                    </FragmentRow>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-1 border-t border-border bg-background/40 px-3 py-2 text-xs text-text-muted">
            <span>Всего смен: <span className="font-medium text-text-secondary">{data?.summary.shiftsCount ?? 0}</span></span>
            <span>·</span>
            <span>Общая выработка: <span className="font-medium text-text-secondary">{durationLabel(data?.summary.totalDurationMin ?? 0)}</span></span>
            <span>·</span>
            <span>В смене сейчас: <span className="font-medium text-text-secondary">{data?.summary.activeCount ?? 0}</span></span>
          </div>
        </>
      )}
    </div>
  );
}

function ShiftHistoryDetails({ row }: { row: ShiftHistoryRow }) {
  return (
    <div className="grid gap-x-8 gap-y-2 text-sm md:grid-cols-[minmax(260px,360px)_1fr]">
      <div className="grid gap-y-1.5">
        <DetailLine label="Начало" value={`${dateDMY(row.startedAt)} ${timeHM(row.startedAt)}`} />
        <DetailLine label="Окончание" value={row.endedAt ? `${dateDMY(row.endedAt)} ${timeHM(row.endedAt)}` : '—'} />
        <DetailLine label="Длительность" value={durationLabel(row.durationMin)} />
        <DetailLine label="Кто закрыл" value={row.closedBy ?? '—'} />
      </div>
      <div className="grid gap-y-1.5">
        <DetailLine label="Связанные заказы" value={`${row.ordersCount}`} />
        <DetailLine label="Оборот за смену" value={money(row.turnover)} />
        {row.orders.length > 0 && (
          <div className="mt-1 max-h-28 max-w-xl overflow-y-auto rounded-lg border border-border bg-white">
            <div className="grid grid-cols-2">
              {row.orders.slice(0, 12).map((o, i) => (
                <div
                  key={o.id}
                  className={`flex items-center justify-between gap-3 px-2 py-1.5 ${
                    i % 2 === 0 ? 'border-r border-border' : ''
                  } border-b border-border`}
                >
                  <span className="text-text-secondary">{displayOrderNumber(o.orderNumber)}</span>
                  <span className="font-medium text-text-primary">{money(o.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text-secondary">{value}</span>
    </div>
  );
}

function ShiftEditModal({ row, onClose }: { row: ShiftHistoryRow; onClose: () => void }) {
  const actions = useShiftHistoryActions();
  const push = useNotifications((s) => s.push);
  const [startedAt, setStartedAt] = useState(toDateTimeLocal(row.startedAt));
  const [endedAt, setEndedAt] = useState(toDateTimeLocal(row.endedAt));
  const [startedAtValid, setStartedAtValid] = useState(true);
  const [endedAtValid, setEndedAtValid] = useState(true);
  const [openShift, setOpenShift] = useState(!row.endedAt);
  const [error, setError] = useState('');
  const datesValid = startedAtValid && !!startedAt && (openShift || (endedAtValid && !!endedAt));

  async function submit() {
    if (!datesValid || actions.update.isPending) return;
    setError('');
    try {
      await actions.update.mutateAsync({
        id: row.id,
        startedAt: fromDateTimeLocal(startedAt) ?? undefined,
        endedAt: openShift ? null : fromDateTimeLocal(endedAt),
      });
      push({ message: 'Смена обновлена', type: 'success', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Редактировать время смены"
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" disabled={actions.update.isPending || !datesValid} onClick={submit}>
          {actions.update.isPending ? <Spinner /> : 'Сохранить'}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">{row.employeeName} · {ROLE_LABEL[row.role]}</p>
        <Field label="Начало смены">
          <DateTimePicker
            className="input"
            value={startedAt}
            onChange={(value) => setStartedAt(value)}
            onValidityChange={setStartedAtValid}
            required
          />
        </Field>
        <label className="flex items-center gap-2.5 text-sm text-text-secondary">
          <input type="checkbox" checked={openShift} onChange={(e) => setOpenShift(e.target.checked)} />
          Смена еще открыта
        </label>
        {!openShift && (
          <Field label="Окончание смены">
            <DateTimePicker
              className="input"
              value={endedAt}
              onChange={(value) => setEndedAt(value)}
              onValidityChange={setEndedAtValid}
              required
            />
          </Field>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function CashHandedCell({ row, date }: { row: ShiftReportRow; date: string }) {
  const setCash = useSetCashHanded();
  const [val, setVal] = useState(row.cashHanded ? String(row.cashHanded) : '');
  useEffect(() => {
    setVal(row.cashHanded ? String(row.cashHanded) : '');
  }, [row.cashHanded]);

  function commit() {
    const num = Number(val.replace(/\s/g, '').replace(',', '.')) || 0;
    if (num === row.cashHanded) return;
    setCash.mutate({ waiterId: row.waiterId, date, cashHanded: num });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        inputMode="decimal"
        className="w-20 rounded-lg border border-border bg-white px-2 py-1 text-right text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        value={val}
        placeholder="0"
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="text-xs text-text-muted">с</span>
    </span>
  );
}

function ShiftDetails({ row, onEdit }: { row: ShiftReportRow; onEdit?: () => void }) {
  const tr = useT();
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Левая колонка: товарная разбивка */}
      <div className="min-w-0">
        <div className="mb-2 text-sm font-medium text-text-primary">{tr('Товарная разбивка:')}</div>
        {row.categories.length === 0 ? (
          <p className="text-sm text-text-muted">{tr('Продаж нет')}</p>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {row.categories.map((cat) => (
              <CategoryRow key={cat.categoryId} cat={cat} />
            ))}
          </div>
        )}
        {onEdit && <button
          onClick={onEdit}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          {tr('Редактировать профиль')}
        </button>}
      </div>

      {/* Правая колонка: отменённые чеки */}
      <div className="min-w-0 lg:border-l lg:border-border lg:pl-6">
        <div className="mb-2 text-sm font-medium text-text-primary">
          {tr('Отмененные чеки')} ({row.cancellations.length}):
        </div>
        {row.cancellations.length === 0 ? (
          <p className="text-sm text-text-muted">{tr('Отмен нет')}</p>
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {row.cancellations.map((c, i) => (
              <div key={i} className="text-sm text-text-secondary">
                <span className="text-text-muted">{timeHM(c.time)}</span> — {c.name}{' '}
                <span className="text-text-primary">({money(c.amount)})</span>
                <span className="text-text-muted"> — {tr('Причина')}: {c.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryRow({ cat }: { cat: ShiftReportCategory }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-background"
      >
        <Chevron open={open} />
        <span className="text-text-primary">{cat.name}</span>
        <span className="ml-auto whitespace-nowrap text-text-secondary">
          {cat.qty} шт. <span className="text-text-muted">({money(cat.amount)})</span>
        </span>
      </button>
      {open && (
        <div className="space-y-0.5 py-0.5 pl-7">
          {cat.items.map((it, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <span className="truncate">{it.name}</span>
                <span className="ml-auto whitespace-nowrap">
                  {it.qty} шт. <span className="text-text-muted">({money(it.amount)})</span>
                </span>
              </div>
              {/* Состав сета — показываем, что внутри (на счёт категорий не влияет). */}
              {it.components && it.components.length > 0 && (
                <div className="mt-0.5 space-y-0.5 border-l border-border pl-3">
                  {it.components.map((c, j) => (
                    <div key={j} className="flex items-center gap-2 text-xs text-text-muted">
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto whitespace-nowrap">{c.qty} шт.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeePageButton({ label, glyph, disabled, onClick }: {
  label: string; glyph: string; disabled: boolean; onClick: () => void;
}) {
  return <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
    className="grid h-7 w-7 place-items-center rounded text-lg leading-none text-primary hover:bg-background disabled:text-text-muted disabled:opacity-50">
    {glyph}
  </button>;
}

function StaffEditor({
  member,
  onClose,
  onManagePermissions,
}: {
  member: StaffMember | null;
  onClose: () => void;
  onManagePermissions?: () => void;
}) {
  const isEdit = !!member;
  const { create, update } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(member?.name ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const initialAssignment = member?.prepStation ?? member?.role ?? 'WAITER';
  const [assignment, setAssignment] = useState(initialAssignment);
  const [positionId, setPositionId] = useState(member?.positionId ?? '');
  const currentUser = useAuth((state) => state.user);
  const { isOwner } = usePermissions();
  const canChangeRole = !member || member.id !== currentUser?.id;
  const canAssignPosition = isOwner && canChangeRole && member?.role !== 'OWNER';
  const positions = useStaffPositions(canAssignPosition);
  const stations = usePreparationStations().data ?? [];
  const roles = isOwner ? (['WAITER', 'ADMIN', 'OWNER'] as const) : (['WAITER'] as const);
  const stationOptions = stations
    .map((station) => ({
      value: station.id === 'kitchen' ? 'KITCHEN' : station.id === 'bar' ? 'BAR' : station.id,
      label: station.name,
      isActive: station.isActive,
    }))
    .filter((station) => station.isActive || station.value === assignment);
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(member?.isActive ?? true);
  const [error, setError] = useState('');
  const formId = useId();
  const saving = useRef(false);
  const dirty = name !== (member?.name ?? '') || phone !== (member?.phone ?? '') || assignment !== initialAssignment ||
    positionId !== (member?.positionId ?? '') || !!password || isActive !== (member?.isActive ?? true);
  const { markSaved } = useEditorDirty(dirty);

  const pending = create.isPending || update.isPending;
  const systemRole = (value: string) => value === 'KITCHEN' || value === 'BAR' ? value : roles.find((role) => role === value);
  const stationRole = member?.role === 'BAR' ? 'BAR' : 'KITCHEN';
  const selectedRole = systemRole(assignment);
  const role = selectedRole ?? stationRole;
  const matchingPositions = (positions.data ?? []).filter((position) => position.role === role);
  const positionPatch = canAssignPosition && positionId !== (member?.positionId ?? '')
    ? { positionId: positionId || null }
    : {};

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    if (!isEdit && !password) {
      setError('Укажите пароль');
      return;
    }
    saving.current = true;
    setError('');
    const prepStation = selectedRole ? null : assignment;
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: member!.id,
          name,
          phone,
          role,
          prepStation,
          isActive,
          ...positionPatch,
          ...(password ? { password } : {}),
        });
        push({ message: 'Сотрудник обновлён', at: new Date().toISOString() });
      } else {
        await create.mutateAsync({ name, phone, role, password, prepStation, ...positionPatch });
        push({ message: 'Сотрудник добавлен', at: new Date().toISOString() });
      }
      markSaved();
      onClose();
    } catch (err) {
      setError(apiError(err));
    } finally {
      saving.current = false;
    }
  }

  return (
    <EditorPage
      onClose={() => { if (!saving.current) onClose(); }}
      title={isEdit ? 'Редактирование карточки сотрудника' : 'Добавление карточки сотрудника'}
      footer={
        <button type="submit" form={formId} className="btn-primary btn-md" disabled={pending}>
          {pending ? <Spinner /> : 'Сохранить'}
        </button>
      }
    >
      <form id={formId} onSubmit={onSubmit}
        className="px-4 py-4 sm:px-6 sm:[&_.document-field]:grid-cols-[minmax(180px,230px)_minmax(0,470px)]">
        <fieldset disabled={pending} className="space-y-3.5">
        <DocumentField label="Имя и фамилия сотрудника">
          <input className="input h-9 w-full !rounded-md text-sm" value={name} required onChange={(e) => setName(e.target.value)} />
        </DocumentField>
        <DocumentField label="Номер телефона">
          <input className="input h-9 w-full !rounded-md text-sm" type="tel" value={phone} placeholder="+996" required onChange={(e) => setPhone(e.target.value)} />
        </DocumentField>
        <DocumentField label="Роль или станция">
          <Select
            ariaLabel="Роль или станция"
            className="h-9 w-full !rounded-md !text-sm"
            value={assignment}
            disabled={!canChangeRole}
            onChange={(value) => {
              setAssignment(value);
              if ((systemRole(value) ?? stationRole) !== role) setPositionId('');
            }}
            options={[{ value: 'WAITER', label: ROLE_LABEL.WAITER }, ...stationOptions, ...roles.slice(1).map((value) => ({ value, label: ROLE_LABEL[value] }))]}
          />
        </DocumentField>
        {canAssignPosition && (matchingPositions.length > 0 || positionId) && <DocumentField label="Должность">
          <Select ariaLabel="Должность" className="h-9 w-full !rounded-md !text-sm" value={positionId} onChange={setPositionId}
            options={[{ value: '', label: 'Стандартные права роли' }, ...matchingPositions.map(({ id, name }) => ({ value: id, label: name }))]} />
        </DocumentField>}
        </fieldset>
        <h2 className="mb-4 mt-6 border-b border-border pb-2 text-base font-medium text-text-primary">Доступ к EDU POS</h2>
        <fieldset disabled={pending} className="space-y-3.5">
        <DocumentField label={isEdit ? 'Новый пароль' : 'Пароль для входа'}>
          <input
            className="input h-9 w-full !rounded-md text-sm"
            type="password"
            autoComplete="new-password"
            required={!isEdit}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? 'Оставьте пустым' : 'Пароль для входа'}
          />
        </DocumentField>
        {isEdit && (
          <DocumentField label="Статус">
            <label className="flex items-center gap-2.5 pt-2.5 text-sm text-text-secondary">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Может входить в систему
            </label>
          </DocumentField>
        )}
        {onManagePermissions && (
          <button
            type="button"
            onClick={onManagePermissions}
            className="mt-1 inline-flex items-center justify-between gap-4 rounded-lg border border-border bg-white px-3 py-2.5 text-left text-sm font-medium text-text-primary transition-colors hover:border-primary/40 hover:bg-background"
          >
            <span className="flex items-center gap-2.5">
              <IconKey className="h-[18px] w-[18px] text-text-muted" />
              Права доступа
            </span>
            <svg className="h-4 w-4 text-text-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        )}
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      </form>
    </EditorPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`rounded-lg p-1.5 transition-colors ${
        danger ? 'text-text-muted hover:bg-danger/10 hover:text-danger' : 'text-text-muted hover:bg-background hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}
