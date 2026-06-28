import { useEffect, useMemo, useState } from 'react';
import type { Role } from '@/types';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { displayOrderNumber, money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { IconPlus, IconEdit, IconTrash } from '../components/icons';
import { EmployeePermissionsModal } from '../components/EmployeePermissionsModal';
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
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [date, setDate] = useState(todayYmd());
  const [historyFilters, setHistoryFilters] = useState<ShiftHistoryFilters>({ period: 'today' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftHistoryRow | null>(null);
  const [closingShift, setClosingShift] = useState<ShiftHistoryRow | null>(null);
  const [editing, setEditing] = useState<StaffMember | null | 'new'>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<StaffMember | null>(null);

  const reportQ = useShiftReport(date);
  const historyQ = useShiftHistory(historyFilters);
  const shiftActions = useShiftHistoryActions();
  const staffQ = useStaff('', '');
  const { remove } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const tr = useT();
  const currentUser = useAuth((s) => s.user);
  const { isOwner, canAction } = usePermissions();
  // Кнопку «Права доступа» видит владелец, либо админ с правом editPermissions/manageStaff.
  const canManagePermissions = isOwner || canAction('editPermissions') || canAction('manageStaff');

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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">{tr('Персонал и отчет по сменам')}</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {tab === 'current' && (
            <>
              <span className="text-sm text-text-secondary">{tr('Дата смены:')}</span>
              <input
                type="date"
                className="h-9 rounded-lg border border-border bg-white px-2.5 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                value={date}
                onChange={(e) => setDate(e.target.value)}
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
          <button
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            onClick={() => setEditing('new')}
          >
            <IconPlus className="h-4 w-4" /> {tr('Добавить сотрудника')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-5 border-b border-border">
        <TabButton active={tab === 'current'} onClick={() => setTab('current')}>
          Текущая смена
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
          История смен
        </TabButton>
      </div>

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

      {tab === 'current' ? (
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
                  const openEdit = () => {
                    if (member) setEditing(member);
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
                          <div className="text-xs text-text-muted">{tr(ROLE_LABEL[row.role])}</div>
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
                          <div className="flex items-center justify-end gap-1">
                            <IconBtn title={tr('Изменить')} onClick={openEdit}>
                              <IconEdit className="h-4 w-4" />
                            </IconBtn>
                            <IconBtn title={tr('Удалить')} danger onClick={() => setPendingDelete({ id: row.waiterId, name: row.name })}>
                              <IconTrash className="h-4 w-4" />
                            </IconBtn>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border bg-background/30">
                          <td colSpan={8} className="px-3 py-3">
                            <ShiftDetails row={row} onEdit={openEdit} />
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
      ) : (
        <ShiftHistoryTable
          data={historyQ.data}
          isLoading={historyQ.isLoading}
          expanded={historyExpanded}
          setExpanded={setHistoryExpanded}
          onEdit={setEditingShift}
          onClose={setClosingShift}
        />
      )}

      {editing !== null && (
        <StaffModal
          member={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onManagePermissions={
            editing !== 'new' && editing && canManagePermissions && editing.role === 'ADMIN' && editing.id !== currentUser?.id
              ? () => {
                  setPermissionsFor(editing);
                  setEditing(null);
                }
              : undefined
          }
        />
      )}
      {permissionsFor && (
        <EmployeePermissionsModal member={permissionsFor} onClose={() => setPermissionsFor(null)} />
      )}
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
      className={`relative -mb-px h-9 px-0.5 text-sm font-medium transition-colors ${
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
            <input
              type="date"
              className="h-10 rounded-lg border border-border bg-white px-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              value={filters.from ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-muted">по</span>
            <input
              type="date"
              className="h-10 rounded-lg border border-border bg-white px-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
              value={filters.to ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
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
  const [openShift, setOpenShift] = useState(!row.endedAt);
  const [error, setError] = useState('');

  async function submit() {
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
        <button className="btn-primary btn-lg w-full font-semibold" disabled={actions.update.isPending} onClick={submit}>
          {actions.update.isPending ? <Spinner /> : 'Сохранить'}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">{row.employeeName} · {ROLE_LABEL[row.role]}</p>
        <Field label="Начало смены">
          <input
            type="datetime-local"
            className="input"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2.5 text-sm text-text-secondary">
          <input type="checkbox" checked={openShift} onChange={(e) => setOpenShift(e.target.checked)} />
          Смена еще открыта
        </label>
        {!openShift && (
          <Field label="Окончание смены">
            <input
              type="datetime-local"
              className="input"
              value={endedAt}
              onChange={(e) => setEndedAt(e.target.value)}
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

function ShiftDetails({ row, onEdit }: { row: ShiftReportRow; onEdit: () => void }) {
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
        <button
          onClick={onEdit}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          {tr('Редактировать профиль')}
        </button>
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

function StaffModal({
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
  const [role, setRole] = useState<Role>(member?.role ?? 'WAITER');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(member?.isActive ?? true);
  const [error, setError] = useState('');

  const pending = create.isPending || update.isPending;

  async function onSubmit() {
    setError('');
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: member!.id,
          name,
          phone,
          role,
          isActive,
          ...(password ? { password } : {}),
        });
        push({ message: 'Сотрудник обновлён', at: new Date().toISOString() });
      } else {
        if (!password) {
          setError('Укажите пароль');
          return;
        }
        await create.mutateAsync({ name, phone, role, password });
        push({ message: 'Сотрудник добавлен', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Изменить сотрудника' : 'Новый сотрудник'}
      footer={
        <button className="btn-primary btn-lg w-full font-semibold" disabled={pending} onClick={onSubmit}>
          {pending ? <Spinner /> : isEdit ? 'Сохранить' : 'Добавить'}
        </button>
      }
    >
      <div className="space-y-3">
        <Field label="Имя">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Телефон">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Роль">
          <Select
            className="h-11 w-full"
            value={role}
            onChange={(v) => setRole(v as Role)}
            options={[
              { value: 'WAITER', label: 'Официант' },
              { value: 'KITCHEN', label: 'Кухня' },
              { value: 'BAR', label: 'Бар' },
              { value: 'ADMIN', label: 'Администратор' },
              { value: 'OWNER', label: 'Владелец' },
            ]}
          />
        </Field>
        <Field label={isEdit ? 'Новый пароль (если менять)' : 'Пароль'}>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? 'Оставьте пустым' : 'Пароль для входа'}
          />
        </Field>
        {isEdit && (
          <label className="flex items-center gap-2.5 pt-1 text-sm text-text-secondary">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Активен (может входить в систему)
          </label>
        )}
        {onManagePermissions && (
          <button
            type="button"
            onClick={onManagePermissions}
            className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2.5 text-left text-sm font-medium text-text-primary transition-colors hover:border-primary/40 hover:bg-background"
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
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
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
