import { DatePicker, DateTimePicker } from '@/components/DatePicker';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Role } from '@/types';
import { useAssignableStaffPositions } from './positions-api';
import { positionAccessSummary } from './position-permissions';
import { parseMoney } from './finance/finance-format';
import { Modal } from '@/components/Modal';
import { DeleteNameField } from '../components/DeleteNameField';
import { useEditorDirty } from '@/components/EditorNavigationGuard';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { WorkspacePending } from '../components/WorkspacePending';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { usePreparationStations, usePreparationStationUpdates } from '@/features/kitchen/stations';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { IconPlus, IconEdit, IconTrash, IconEye, IconEyeOff } from '../components/icons';
import { WaiterOrdersReport } from './WaiterOrdersReport';
import { WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';
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

function IconRefresh(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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

export function StaffPage({ initialTab = 'current' }: { initialTab?: 'current' | 'history' | 'waiter-orders' }) {
  const stations = usePreparationStations().data ?? [];
  usePreparationStationUpdates();
  const stationNames = new Map(stations.map(({ id, name }) => [id, name]));
  const [tab, setTab] = useState<'current' | 'history' | 'waiter-orders'>(initialTab);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeePosition, setEmployeePosition] = useState('');
  const [employeeStatus, setEmployeeStatus] = useState('');
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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; confirmation: string } | null>(null);
  const deleteConfirmed = !!pendingDelete && pendingDelete.confirmation.trim() === pendingDelete.name.trim();

  const reportQ = useShiftReport(date, tab === 'current');
  const historyQ = useShiftHistory(historyFilters, tab === 'history');
  const shiftActions = useShiftHistoryActions();
  const staffQ = useStaff('', '');
  const currentShiftLoading = reportQ.isFetching || staffQ.isFetching;
  const { remove } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const tr = useT();
  const currentUser = useAuth((s) => s.user);
  const { isOwner, canAction, canEditSection } = usePermissions();
  const canManageStaff = isOwner || canAction('manageStaff');
  const canEditMember = (member: StaffMember) => canManageStaff && (member.canManage ?? isOwner);
  const positionKey = (member: StaffMember) => member.positionId ?? member.role;
  const positionLabel = (member: StaffMember) => member.positionName ?? tr(ROLE_LABEL[member.role]);
  const positionChoices = new Map((staffQ.data ?? []).map((member) => [positionKey(member), positionLabel(member)]));
  const employeeTerm = employeeSearch.trim().toLocaleLowerCase('ru');
  const employeePhone = employeeTerm.replace(/[^\d]/g, '');
  const looksLikePhone = !!employeePhone && /^[+\d ()-]+$/.test(employeeTerm);
  const reportRows = reportQ.data ?? [];
  const memberById = new Map((staffQ.data ?? []).map((member) => [member.id, member]));
  const reportById = new Map(reportRows.map((row) => [row.waiterId, row]));
  const rows = (staffQ.data?.map(({ id, name, role }) => ({ id, name, role }))
    ?? reportRows.map(({ waiterId, name, role }) => ({ id: waiterId, name, role })))
    .filter(({ id, name }) => {
      const member = memberById.get(id);
      return (!employeePosition || (member && positionKey(member) === employeePosition))
        && (!employeeStatus || member?.isActive === (employeeStatus === 'active'))
        && (!employeeTerm || name.toLocaleLowerCase('ru').includes(employeeTerm)
          || (looksLikePhone && (member?.phone ?? '').replace(/[^\d]/g, '').includes(employeePhone)));
    })
    .sort((a, b) => Number(b.role === 'WAITER') - Number(a.role === 'WAITER') || a.name.localeCompare(b.name, 'ru'));
  const editorMember = staffEditor?.id ? memberById.get(staffEditor.id) : undefined;

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
    if (!pendingDelete || !deleteConfirmed || remove.isPending) return;
    try {
      const result = await remove.mutateAsync(pendingDelete.id);
      push({ message: result?.isActive === false ? 'Сотрудник отключён. История работы и расчётов сохранена.' : 'Сотрудник удалён', at: new Date().toISOString() });
      setPendingDelete(null);
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  function exportCsv() {
    const head = ['Сотрудник', 'Должность', 'Смена', 'Оборот', 'Касса (должен)', 'Касса (сдал)', 'Разница'];
    const lines = rows.map(({ id, name, role }) => {
      const row = reportById.get(id);
      const fin = row?.isWaiter
        ? [shiftLabel(row), row.turnover, row.cashDue, row.cashHanded, row.difference]
        : ['—', '—', '—', '—', '—'];
      return [name, memberById.get(id) ? positionLabel(memberById.get(id)!) : tr(ROLE_LABEL[role]), ...fin]
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

  function renderStaffEditor() {
    if (!staffEditor) return null;
    if (!canManageStaff || (editorMember && !canEditMember(editorMember))) {
      return <Modal open title="Карточка сотрудника" onClose={closeEditor}><p role="alert">Недостаточно прав для редактирования.</p></Modal>;
    }
    if (staffEditor.id && !editorMember) {
      return <Modal open title="Карточка сотрудника" onClose={closeEditor}>
        {staffQ.isPending ? <Spinner /> : <p role="alert">{staffQ.isError ? apiError(staffQ.error) : 'Сотрудник не найден.'}</p>}
      </Modal>;
    }
    return <StaffEditor key={staffEditor.id ?? 'new'} member={editorMember ?? null} onClose={closeEditor} />;
  }

  return (
    <div className="space-y-3">
      {tab !== 'waiter-orders' && <div className="flex flex-wrap items-start justify-between gap-3">
        {tab === 'current' && <>
          <WorkspaceHeaderCount count={staffQ.data || reportQ.data ? rows.length : undefined} />
          <div className="flex flex-wrap items-center gap-2">
            <WorkspaceSearch label="Поиск сотрудников" placeholder="Поиск сотрудников" value={employeeSearch}
              onChange={setEmployeeSearch} />
            <Select ariaLabel="Должность" placeholder="Должность" className="h-9" value={employeePosition}
              onChange={setEmployeePosition} options={[
                { value: '', label: 'Все должности' }, ...Array.from(positionChoices, ([value, label]) => ({ value, label })),
              ]} />
            <Select ariaLabel="Статус сотрудника" placeholder="Статус" className="h-9" value={employeeStatus}
              onChange={setEmployeeStatus} options={[
                { value: '', label: 'Все сотрудники' }, { value: 'active', label: 'Активные' }, { value: 'inactive', label: 'Неактивные' },
              ]} />
          </div>
        </>}
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {tab === 'current' && (
            <>
              <span className="text-sm text-text-secondary">{tr('Дата смены:')}</span>
              <DatePicker
                aria-label={tr('Дата смены')}
                className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm text-text-primary"
                value={date}
                onChange={(value) => setDate(value)}
              />
              <button
                onClick={() => Promise.all([reportQ.refetch(), staffQ.refetch()])}
                disabled={currentShiftLoading}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:bg-background"
              >
                <IconRefresh className={`h-4 w-4 ${currentShiftLoading ? 'animate-spin' : ''}`} />
                {tr('Обновить')}
              </button>
              <button
                onClick={exportCsv}
                disabled={!reportQ.data || !rows.length}
                className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-text-secondary transition-colors hover:bg-background disabled:opacity-50"
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

      <div className="no-scrollbar flex items-center gap-5 overflow-x-auto border-b border-border">
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
      </div>

      {tab === 'waiter-orders' ? (
        <WaiterOrdersReport staff={staffQ.data ?? []} staffLoading={staffQ.isLoading} />
      ) : tab === 'current' ? (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
        {staffQ.isError && <p role="alert" className="px-4 py-2.5 text-sm text-danger">Список сотрудников не обновился. {apiError(staffQ.error)}</p>}
        {reportQ.isError && <p role="alert" className="px-4 py-2.5 text-sm text-danger">Отчёт по смене не загрузился. {apiError(reportQ.error)}</p>}
        {!staffQ.data && !reportQ.data && (staffQ.isLoading || reportQ.isLoading) ? (
          <WorkspacePending />
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-text-muted">Сотрудники не найдены</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border bg-background/40 text-left text-xs text-text-muted">
                  <th className="w-9 px-2 py-2.5" />
                  <th className="px-3 py-2.5 font-medium">Сотрудник / Должность</th>
                  <th className="px-3 py-2.5 font-medium">{tr('Смена')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Оборот')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Касса (должен)')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Касса (сдал)')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Разница')}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tr('Действия')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ id, name, role }) => {
                  const row = reportById.get(id);
                  const waiterReport = row?.isWaiter ? row : undefined;
                  const open = expanded === id;
                  const difference = row?.difference ?? 0;
                  const diffCls =
                    Math.round(difference) === 0
                      ? 'text-text-secondary'
                      : difference > 0
                        ? 'text-success'
                        : 'text-danger';
                  const member = memberById.get(id);
                  const canEdit = !!member && canEditMember(member);
                  const openEdit = () => {
                    if (member) openEditor({ type: 'employee', id: member.id });
                  };
                  return (
                    <FragmentRow key={id}>
                      <tr
                        className={`border-b border-border ${waiterReport ? 'cursor-pointer hover:bg-background/50' : ''}`}
                        onClick={waiterReport ? () => setExpanded(open ? null : id) : undefined}
                      >
                        <td className="px-2 py-2.5 align-middle">
                          {waiterReport && <Chevron open={open} />}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-text-primary">{name}</div>
                          <div className="text-xs text-text-muted">
                            {member?.positionName ?? stationNames.get(member?.prepStation ?? (role === 'KITCHEN' ? 'kitchen' : role === 'BAR' ? 'bar' : '')) ?? tr(ROLE_LABEL[role])}
                            {member?.isActive === false && ' · Неактивен'}
                          </div>
                        </td>
                        {waiterReport ? (
                          <>
                            <td className="whitespace-nowrap px-3 py-2.5 text-text-secondary">{shiftLabel(waiterReport)}</td>
                            <td className="px-3 py-2.5 text-right font-medium text-text-primary">{money(waiterReport.turnover)}</td>
                            <td className="px-3 py-2.5 text-right text-text-secondary">{money(waiterReport.cashDue)}</td>
                            <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <CashHandedCell row={waiterReport} date={date} />
                            </td>
                            <td className={`px-3 py-2.5 text-right font-medium ${diffCls}`}>{signedMoney(difference)}</td>
                          </>
                        ) : (
                          <>
                            <td className="whitespace-nowrap px-3 py-2.5 text-text-secondary">{row ? shiftLabel(row) : '—'}</td>
                            <td className="px-3 py-2.5 text-center text-text-light" colSpan={4}>—</td>
                          </>
                        )}
                        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                          {canEdit && <div className="flex items-center justify-end gap-1">
                            <IconBtn title={tr('Изменить')} onClick={openEdit}>
                              <IconEdit className="h-4 w-4" />
                            </IconBtn>
                            {id !== currentUser?.id && <IconBtn title={tr('Удалить')} danger onClick={() => setPendingDelete({ id, name, confirmation: '' })}>
                              <IconTrash className="h-4 w-4" />
                            </IconBtn>}
                          </div>}
                        </td>
                      </tr>
                      {open && waiterReport && (
                        <tr className="border-b border-border bg-background/30">
                          <td colSpan={8} className="px-3 py-3">
                            <ShiftDetails row={waiterReport} onEdit={canEdit ? openEdit : undefined} />
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
          onEdit={canManageStaff ? setEditingShift : undefined}
          onClose={canEditSection('staff') && canAction('closeShift') ? setClosingShift : undefined}
        />
      ) : null}

      {renderStaffEditor()}
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
                disabled={remove.isPending || !deleteConfirmed}
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
          <p className="mt-2 text-sm text-text-muted">Если у сотрудника есть история работы или расчётов, доступ будет отключён, а данные сохранятся. Открытые смены и заказы нужно предварительно закрыть.</p>
          <div className="mt-3">
            <DeleteNameField label="Введите имя сотрудника для подтверждения"
              value={pendingDelete.confirmation} disabled={remove.isPending}
              onChange={(confirmation) => setPendingDelete({ ...pendingDelete, confirmation })} />
          </div>
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
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Фильтры истории смен">
      <div className="w-full sm:w-44">
        <Select
          ariaLabel="Период истории смен"
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
              aria-label="Начало периода"
              className="h-10 rounded-lg border border-border bg-white px-2.5 text-sm"
              value={filters.from ?? ''}
              onChange={(value) => setFilters((f) => ({ ...f, from: value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">по</span>
            <DatePicker
              aria-label="Конец периода"
              className="h-10 rounded-lg border border-border bg-white px-2.5 text-sm"
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
  onEdit?: (row: ShiftHistoryRow) => void;
  onClose?: (row: ShiftHistoryRow) => void;
}) {
  const rows = data?.items ?? [];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white">
      {isLoading ? (
        <WorkspacePending />
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
                            {onEdit && <IconBtn title="Редактировать время смены" onClick={() => onEdit(row)}>
                              <IconEdit className="h-4 w-4" />
                            </IconBtn>}
                            {row.status !== 'closed' && onClose && (
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
  const { canAction, canEditSection } = usePermissions();
  const setCash = useSetCashHanded();
  const [val, setVal] = useState(row.cashHanded ? String(row.cashHanded) : '');
  const [validationError, setValidationError] = useState('');
  useEffect(() => {
    setVal(row.cashHanded ? String(row.cashHanded) : '');
  }, [row.cashHanded]);

  function commit() {
    const num = val.trim() ? parseMoney(val) : 0;
    if (num === null || num < 0) { setValidationError('Введите сумму от 0'); return; }
    setValidationError('');
    if (num === row.cashHanded) return;
    setCash.mutate({ waiterId: row.waiterId, date, cashHanded: num });
  }

  if (!canEditSection('staff') || !canAction('closeShift')) return <span>{money(row.cashHanded)}</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      <input
        inputMode="decimal"
        aria-label={`Сдано наличных · ${row.name}`}
        aria-invalid={!!validationError || setCash.isError}
        disabled={setCash.isPending}
        className="w-20 rounded-lg border border-border bg-white px-2 py-1 text-right text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        value={val}
        placeholder="0"
        onChange={(e) => { setVal(e.target.value); setValidationError(''); setCash.reset(); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="text-xs text-text-muted">с</span>
      {(validationError || setCash.isError) && <span role="alert" className="w-full max-w-40 text-xs text-danger">{validationError || apiError(setCash.error)}</span>}
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

function StaffEditor({
  member,
  onClose,
}: {
  member: StaffMember | null;
  onClose: () => void;
}) {
  const isEdit = !!member;
  const { create, update } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(member?.name ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [prepStation, setPrepStation] = useState(member?.prepStation ?? '');
  const [positionId, setPositionId] = useState(member?.positionId ?? '');
  const currentUser = useAuth((state) => state.user);
  const { isOwner } = usePermissions();
  const canAssignPosition = member?.role !== 'OWNER' && (!member || member.id !== currentUser?.id);
  const positions = useAssignableStaffPositions(canAssignPosition);
  const stations = usePreparationStations().data ?? [];
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isActive, setIsActive] = useState(member?.isActive ?? true);
  const [error, setError] = useState('');
  const formId = useId();
  const saving = useRef(false);
  const dirty = name !== (member?.name ?? '') || phone !== (member?.phone ?? '') || prepStation !== (member?.prepStation ?? '') ||
    positionId !== (member?.positionId ?? '') || !!password || isActive !== (member?.isActive ?? true);
  const { markSaved } = useEditorDirty(dirty);

  const pending = create.isPending || update.isPending;
  const close = () => { if (!saving.current) onClose(); };
  const assignedPosition = positions.data?.find((position) => position.id === positionId);
  const role = assignedPosition?.role ?? member?.role;
  const hasStation = role === 'KITCHEN' || role === 'BAR';
  const positionOptions = (positions.data ?? []).map(({ id, name }) => ({ value: id, label: name }));
  if (member?.positionId && !positionOptions.some(({ value }) => value === member.positionId)) {
    positionOptions.push({ value: member.positionId, label: member.positionName ?? ROLE_LABEL[member.role] });
  }
  const validAssignment = !canAssignPosition || (!!assignedPosition && positions.isSuccess);
  const stationOptions = [
    { value: '', label: role === 'BAR' ? 'Бар (по умолчанию)' : 'Кухня (по умолчанию)' },
    ...stations.filter((station) => (station.isActive || station.id === prepStation)
      && station.id !== (role === 'BAR' ? 'kitchen' : 'bar'))
      .map(({ id, name, isActive }) => ({ value: id, label: name + (isActive ? '' : ' · неактивна') })),
  ];
  if (prepStation && !stationOptions.some(({ value }) => value === prepStation)) {
    stationOptions.push({ value: prepStation, label: 'Текущая станция · недоступна' });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || !validAssignment) return;
    if (!isEdit && !password) {
      setError('Укажите пароль');
      return;
    }
    saving.current = true;
    setError('');
    const assignmentPatch = canAssignPosition ? { positionId } : {};
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: member!.id,
          name,
          phone,
          ...(hasStation ? { prepStation: prepStation || null } : {}),
          isActive,
          ...assignmentPatch,
          ...(password ? { password } : {}),
        });
        push({ message: 'Сотрудник обновлён', at: new Date().toISOString() });
      } else {
        await create.mutateAsync({ name, phone, password, positionId, ...(hasStation ? { prepStation: prepStation || null } : {}) });
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
    <Modal
      open
      onClose={close}
      title={isEdit ? 'Карточка сотрудника' : 'Добавление сотрудника'}
      panelClassName="max-w-3xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary btn-md" disabled={pending} onClick={close}>Отмена</button>
          <button type="submit" form={formId} className="btn-primary btn-md" disabled={pending || !validAssignment}>
            {pending ? <Spinner /> : 'Сохранить'}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={onSubmit}
        className="py-2 sm:px-2 sm:[&_.document-field]:grid-cols-[minmax(0,210px)_minmax(0,1fr)]">
        <fieldset disabled={pending} className="space-y-3">
          <DocumentField label="Имя и фамилия сотрудника">
            <input className="input h-9 w-full !rounded-md text-sm" value={name} autoFocus required onChange={(e) => setName(e.target.value)} />
          </DocumentField>
          <DocumentField label="Номер телефона">
            <input className="input h-9 w-full !rounded-md text-sm" type="tel" value={phone} placeholder="+996" required onChange={(e) => setPhone(e.target.value)} />
          </DocumentField>
          <DocumentField label="Должность">
            <Select
              ariaLabel="Должность"
              className="h-9 w-full !rounded-md !text-sm"
              value={member?.role === 'OWNER' ? 'owner' : positionId}
              placeholder={positions.isPending && canAssignPosition ? 'Загрузка должностей…' : 'Выберите должность'}
              disabled={!canAssignPosition || positions.isPending || positions.isError}
              onChange={(value) => {
                const nextPosition = positions.data?.find(({ id }) => id === value);
                if (!nextPosition) return;
                setPositionId(value);
                if (nextPosition.role !== role) setPrepStation('');
              }}
              options={member?.role === 'OWNER' ? [{ value: 'owner', label: 'Владелец' }] : positionOptions}
            />
            <p className="mt-2 text-xs text-text-muted">Права доступа и ставки зарплаты задаются в должности и применяются ко всем её сотрудникам.</p>
            {assignedPosition && <div className="mt-2 rounded-lg bg-background p-3 text-xs">
              <p className="font-medium">Доступ по должности</p>
              <p className="mt-1 text-text-secondary">{positionAccessSummary(assignedPosition.role, assignedPosition.permissions)}</p>
            </div>}
            {canAssignPosition && positions.isError && <p role="alert" className="mt-2 text-xs text-danger">
              Не удалось загрузить должности. <button type="button" className="underline" onClick={() => positions.refetch()}>Повторить</button>
            </p>}
            {canAssignPosition && positions.isSuccess && !positions.data.length && <p role="status" className="mt-2 text-xs text-text-muted">
              {isOwner ? 'Сначала создайте должность в разделе «Персонал → Должности».' : 'Нет доступных должностей. Владелец должен настроить права и должности.'}
            </p>}
          </DocumentField>
          {hasStation && <DocumentField label="Станция приготовления">
            <Select ariaLabel="Станция приготовления" className="h-9 w-full !rounded-md !text-sm" value={prepStation} onChange={setPrepStation}
              disabled={!canAssignPosition} options={stationOptions} />
            <p className="mt-2 text-xs text-text-muted">Определяет, заказы какого цеха видит сотрудник.</p>
          </DocumentField>}
          <DocumentField label={isEdit ? 'Новый пароль' : 'Пароль для входа'}>
            <div className="relative">
              <input
                className="input h-9 w-full !rounded-md !pr-11 text-sm"
                aria-label={isEdit ? 'Новый пароль' : 'Пароль для входа'}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required={!isEdit}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? 'Оставьте пустым' : 'Пароль для входа'}
              />
              <button type="button" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-text-muted hover:text-text-primary"
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setShowPassword((visible) => !visible)}>
                {showPassword ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </button>
            </div>
          </DocumentField>
          {isEdit && (
            <DocumentField label="Статус">
              <label className="flex items-center gap-2.5 pt-2.5 text-sm text-text-secondary">
                <input type="checkbox" checked={isActive} disabled={member?.id === currentUser?.id} onChange={(e) => setIsActive(e.target.checked)} />
                Может входить в систему
              </label>
            </DocumentField>
          )}
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      </form>
    </Modal>
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
