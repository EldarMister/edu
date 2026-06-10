import { useState } from 'react';
import type { Role } from '@/types';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { IconStaff, IconClock, IconEdit, IconTrash, IconPlus } from '../components/icons';
import {
  useStaff,
  useStaffOverview,
  useStaffMutations,
  useWaiterReport,
  type StaffMember,
} from '../api';
import { money } from '@/lib/format';

function IconRefresh(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function SummaryItem({ label, value, icon, tone }: { label: string; value: React.ReactNode; icon: React.ReactNode; tone: 'primary' | 'success' | 'warning' | 'danger' | 'muted' }) {
  const iconColors = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    muted: 'bg-slate-100 text-slate-500',
  };
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-full ${iconColors[tone]}`}>
          {icon}
        </div>
        <span className="text-[15px] font-medium text-text-secondary">{label}</span>
      </div>
      <span className="text-lg font-bold text-text-primary">{value}</span>
    </div>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
};
const ROLE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Все роли' },
  { value: 'WAITER', label: 'Официанты' },
  { value: 'KITCHEN', label: 'Кухня' },
  { value: 'BAR', label: 'Бар' },
  { value: 'ADMIN', label: 'Администраторы' },
  { value: 'OWNER', label: 'Владельцы' },
];

export function StaffPage() {
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffMember | null | 'new'>(null);

  const overview = useStaffOverview();
  const staffQ = useStaff(role, search);
  const [reportPeriod, setReportPeriod] = useState<'today' | 'week' | 'month'>('today');
  const reportQ = useWaiterReport(reportPeriod);
  const { remove } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const tr = useT();
  const o = overview.data;

  async function onDelete(m: StaffMember) {
    if (!confirm(`Удалить сотрудника «${m.name}»?`)) return;
    try {
      await remove.mutateAsync(m.id);
      push({ message: 'Сотрудник удалён', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), at: new Date().toISOString() });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left: Summary */}
        <div className="w-full shrink-0 lg:w-72">
          <h2 className="mb-3 text-lg font-semibold text-text-primary">{tr('Сводка по персоналу')}</h2>
          <div className="flex flex-col gap-2">
            <SummaryItem label={tr('Всего сотрудников')} value={o?.totalStaff ?? '—'} icon={<IconStaff />} tone="primary" />
            <SummaryItem label={tr('На смене')} value={o?.onShiftCount ?? '—'} icon={<IconClock />} tone="success" />
            <SummaryItem label={tr('Администраторов')} value={o?.adminsCount ?? '—'} icon={<IconStaff />} tone="warning" />
            <SummaryItem label={tr('Официантов')} value={o?.waitersCount ?? '—'} icon={<IconStaff />} tone="muted" />
          </div>
        </div>

        {/* Right: Waiter Report */}
        <div className="min-w-0 flex-1">
          <h2 className="mb-3 text-lg font-semibold text-text-primary">{tr('Отчет по официантам')}</h2>
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-4">
              <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-1">
                {(['today', 'week', 'month'] as const).map((p) => (
                  <button
                    key={p}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      reportPeriod === p ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                    }`}
                    onClick={() => setReportPeriod(p)}
                  >
                    {tr(p === 'today' ? 'День' : p === 'week' ? 'Неделя' : 'Месяц')}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                {reportQ.data && (
                  <span className="text-xs text-text-muted">
                    {tr('Обновлено:')} {new Date().toLocaleTimeString().slice(0, 5)}
                  </span>
                )}
                <button
                  onClick={() => reportQ.refetch()}
                  disabled={reportQ.isFetching}
                  className="rounded-lg p-1.5 text-text-secondary hover:bg-slate-100"
                >
                  <IconRefresh className={`h-5 w-5 ${reportQ.isFetching ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              {reportQ.isLoading ? (
                <div className="flex justify-center py-12 text-primary">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : reportQ.data?.length === 0 ? (
                <div className="py-12 text-center text-sm text-text-muted">
                  {tr('За выбранный период данных нет')}
                </div>
              ) : (
                <table className="w-full min-w-[500px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-text-muted bg-slate-50">
                      <th className="px-4 py-3 font-medium">{tr('Официант')}</th>
                      <th className="px-4 py-3 text-right font-medium">{tr('Выручка')}</th>
                      <th className="px-4 py-3 text-center font-medium">{tr('Закрыто заказов')}</th>
                      <th className="px-4 py-3 text-center font-medium">{tr('Отмененные')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportQ.data?.map(r => (
                      <tr key={r.id} className="border-b border-border last:border-0 hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-text-primary">{r.name}</td>
                        <td className="px-4 py-3 text-right font-semibold text-text-primary">{money(r.revenue)}</td>
                        <td className="px-4 py-3 text-center text-text-secondary">{r.closedOrders}</td>
                        <td className="px-4 py-3 text-center text-text-secondary">{r.cancelledOrders}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-medium">
                      <td className="px-4 py-3 text-text-primary">{tr('Итого')}</td>
                      <td className="px-4 py-3 text-right text-text-primary">
                        {money(reportQ.data?.reduce((s, r) => s + r.revenue, 0) ?? 0)}
                      </td>
                      <td className="px-4 py-3 text-center text-text-primary">
                        {reportQ.data?.reduce((s, r) => s + r.closedOrders, 0) ?? 0}
                      </td>
                      <td className="px-4 py-3 text-center text-text-primary">
                        {reportQ.data?.reduce((s, r) => s + r.cancelledOrders, 0) ?? 0}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-text-primary">{tr('Сотрудники')}</h2>
        <div className="card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 gap-2">
            <input
              className="input h-10 sm:max-w-xs"
              placeholder={tr('Поиск сотрудника')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              className="h-10 w-full sm:w-48"
              value={role}
              onChange={setRole}
              options={ROLE_FILTERS.map((r) => ({ value: r.value, label: tr(r.label) }))}
            />
          </div>
          <button className="btn-primary btn-md font-medium" onClick={() => setEditing('new')}>
            <IconPlus className="h-4 w-4" /> {tr('Добавить сотрудника')}
          </button>
        </div>

        {staffQ.isLoading ? (
          <div className="flex justify-center py-12 text-primary">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="px-4 py-3 font-medium">{tr('Имя')}</th>
                  <th className="px-4 py-3 font-medium">{tr('Роль')}</th>
                  <th className="px-4 py-3 font-medium">{tr('Телефон')}</th>
                  <th className="px-4 py-3 font-medium">{tr('Статус')}</th>
                  <th className="px-4 py-3 text-right font-medium">{tr('Действия')}</th>
                </tr>
              </thead>
              <tbody>
                {staffQ.data?.map((m) => (
                  <tr key={m.id} className="border-b border-border last:border-0 hover:bg-background/60">
                    <td className="px-4 py-3 font-medium text-text-primary">{m.name}</td>
                    <td className="px-4 py-3 text-text-secondary">{tr(ROLE_LABEL[m.role])}</td>
                    <td className="px-4 py-3 text-text-secondary">{m.phone}</td>
                    <td className="px-4 py-3">
                      {!m.isActive ? (
                        <Badge tone="muted">{tr('Отключён')}</Badge>
                      ) : m.onShift ? (
                        <Badge tone="success">{tr('На смене')}</Badge>
                      ) : (
                        <Badge tone="muted">{tr('Не на смене')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn onClick={() => setEditing(m)} title="Изменить">
                          <IconEdit className="h-4 w-4" />
                        </IconBtn>
                        <IconBtn onClick={() => onDelete(m)} title="Удалить" danger>
                          <IconTrash className="h-4 w-4" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))}
                {staffQ.data?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-text-muted">
                      {tr('Сотрудники не найдены')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>

      {editing !== null && (
        <StaffModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
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
function Badge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'muted' }) {
  const cls = tone === 'success' ? 'bg-success/10 text-success' : 'bg-slate-100 text-text-muted';
  return <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-medium ${cls}`}>{children}</span>;
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
      className={`rounded-lg p-2 transition-colors hover:bg-background ${
        danger ? 'text-danger hover:bg-danger/5' : 'text-text-light hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}
