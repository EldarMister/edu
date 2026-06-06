import { useState } from 'react';
import type { Role } from '@/types';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/store/notifications';
import { StatCard, StatCardsRow } from '../components/StatCard';
import { IconStaff, IconClock, IconEdit, IconTrash, IconPlus } from '../components/icons';
import {
  useStaff,
  useStaffOverview,
  useStaffMutations,
  type StaffMember,
} from '../api';

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
};
const ROLE_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'Все роли' },
  { value: 'WAITER', label: 'Официанты' },
  { value: 'KITCHEN', label: 'Кухня' },
  { value: 'ADMIN', label: 'Администраторы' },
  { value: 'OWNER', label: 'Владельцы' },
];

export function StaffPage() {
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffMember | null | 'new'>(null);

  const overview = useStaffOverview();
  const staffQ = useStaff(role, search);
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
    <div className="space-y-4">
      <StatCardsRow>
        <StatCard label={tr('Всего сотрудников')} value={o?.totalStaff ?? '—'} icon={<IconStaff />} tone="primary" />
        <StatCard label={tr('На смене')} value={o?.onShiftCount ?? '—'} icon={<IconClock />} tone="success" />
        <StatCard label={tr('Администраторов')} value={o?.adminsCount ?? '—'} icon={<IconStaff />} tone="warning" />
        <StatCard label={tr('Официантов')} value={o?.waitersCount ?? '—'} icon={<IconStaff />} tone="muted" />
      </StatCardsRow>

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
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7..." />
        </Field>
        <Field label="Роль">
          <Select
            className="h-11 w-full"
            value={role}
            onChange={(v) => setRole(v as Role)}
            options={[
              { value: 'WAITER', label: 'Официант' },
              { value: 'KITCHEN', label: 'Кухня' },
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
        danger ? 'text-text-light hover:text-danger' : 'text-text-light hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}
