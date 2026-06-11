import { useEffect, useState } from 'react';
import type { Role } from '@/types';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { money, timeHM } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { IconPlus } from '../components/icons';
import {
  useShiftReport,
  useSetCashHanded,
  useStaff,
  useStaffMutations,
  type ShiftReportCategory,
  type ShiftReportRow,
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

function durationLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} ч. ${String(m).padStart(2, '0')} мин.`;
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

export function StaffPage() {
  const [date, setDate] = useState(todayYmd());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffMember | null | 'new'>(null);

  const reportQ = useShiftReport(date);
  const staffQ = useStaff('', '');
  const tr = useT();

  const rows = reportQ.data ?? [];
  const memberById = new Map((staffQ.data ?? []).map((m) => [m.id, m]));

  function exportCsv() {
    const head = ['Сотрудник', 'Роль', 'Смена', 'Оборот', 'Касса (должен)', 'Касса (сдал)', 'Разница'];
    const lines = rows.map((r) =>
      [r.name, tr(ROLE_LABEL[r.role]), shiftLabel(r), r.turnover, r.cashDue, r.cashHanded, r.difference]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(';'),
    );
    const csv = '﻿' + [head.join(';'), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift-report-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* Шапка: заголовок + управление в одну строку */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">{tr('Персонал и отчет по сменам')}</h2>
        <div className="flex flex-wrap items-center gap-2">
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
          <button
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            onClick={() => setEditing('new')}
          >
            <IconPlus className="h-4 w-4" /> {tr('Добавить сотрудника')}
          </button>
        </div>
      </div>

      {/* Основная таблица сотрудников по смене */}
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
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const open = expanded === row.waiterId;
                  const diffCls =
                    Math.round(row.difference) === 0
                      ? 'text-text-secondary'
                      : row.difference > 0
                        ? 'text-success'
                        : 'text-danger';
                  return (
                    <FragmentRow key={row.waiterId}>
                      <tr
                        className="cursor-pointer border-b border-border hover:bg-background/50"
                        onClick={() => setExpanded(open ? null : row.waiterId)}
                      >
                        <td className="px-2 py-2.5 align-middle">
                          <Chevron open={open} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-text-primary">{row.name}</div>
                          <div className="text-xs text-text-muted">{tr(ROLE_LABEL[row.role])}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-text-secondary">{shiftLabel(row)}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-text-primary">{money(row.turnover)}</td>
                        <td className="px-3 py-2.5 text-right text-text-secondary">{money(row.cashDue)}</td>
                        <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <CashHandedCell row={row} date={date} />
                        </td>
                        <td className={`px-3 py-2.5 text-right font-medium ${diffCls}`}>{signedMoney(row.difference)}</td>
                      </tr>
                      {open && (
                        <tr className="border-b border-border bg-background/30">
                          <td colSpan={7} className="px-3 py-3">
                            <ShiftDetails
                              row={row}
                              onEdit={() => {
                                const m = memberById.get(row.waiterId);
                                if (m) setEditing(m);
                              }}
                            />
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

      {editing !== null && (
        <StaffModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Обёртка, чтобы вернуть две <tr> из map без лишнего DOM-узла. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
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
            <div key={i} className="flex items-center gap-2 text-sm text-text-secondary">
              <span className="truncate">{it.name}</span>
              <span className="ml-auto whitespace-nowrap">
                {it.qty} шт. <span className="text-text-muted">({money(it.amount)})</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StaffModal({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
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
