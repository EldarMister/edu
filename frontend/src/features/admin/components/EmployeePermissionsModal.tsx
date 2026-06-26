import { useState } from 'react';
import type { ActionKey, Role, SectionKey } from '@/types';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { ACTION_KEYS, ACTION_LABELS, SECTION_KEYS, SECTION_LABELS } from '@/lib/permissions';
import { useUpdatePermissions, type StaffMember } from '../api';
import {
  IconStats,
  IconOrders,
  IconTables,
  IconMenu,
  IconWarehouse,
  IconStaff,
  IconJournal,
  IconReconcile,
  IconCard,
  IconSettings,
  IconEdit,
  IconClock,
} from './icons';

type IconCmp = (p: { className?: string }) => JSX.Element;

const SECTION_ICONS: Record<SectionKey, IconCmp> = {
  statistics: IconStats,
  orders: IconOrders,
  tables: IconTables,
  menu: IconMenu,
  warehouse: IconWarehouse,
  staff: IconStaff,
  journal: IconJournal,
  paymentReconciliation: IconReconcile,
  checks: IconCard,
  settings: IconSettings,
};

function IconDownload(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <path d="M12 3v12m0 0l4-4m-4 4l-4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
function IconLock(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function IconKey(p: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M10 13l8-8m-2 0h3v3" />
    </svg>
  );
}

const ACTION_ICONS: Record<ActionKey, IconCmp> = {
  editMenu: IconEdit,
  refundChecks: IconClock,
  exportReports: IconDownload,
  closeShift: IconLock,
  manageStaff: IconStaff,
  editPermissions: IconKey,
};

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
};

/** Чекбокс-строка раздела/действия — как в референсе. */
function PermissionCheckboxItem({
  label,
  icon: Icon,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  icon: IconCmp;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        checked ? 'border-border bg-white' : 'border-border bg-background/40'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/40'}`}
    >
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
          checked ? 'border-primary bg-primary text-white' : 'border-border bg-white text-transparent'
        }`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 6" />
        </svg>
      </span>
      <Icon className={`h-[18px] w-[18px] shrink-0 ${checked ? 'text-text-secondary' : 'text-text-light'}`} />
      <span className={`truncate text-sm ${checked ? 'text-text-primary' : 'text-text-muted'}`}>{label}</span>
    </button>
  );
}

/** Блок с заголовком — «Доступ к разделам» / «Дополнительные права». */
function PermissionSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-text-primary">{title}</h4>
      {children}
    </div>
  );
}

export function EmployeePermissionsModal({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const isOwnerTarget = member.role === 'OWNER';
  const update = useUpdatePermissions();
  const push = useNotifications((s) => s.push);
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({ ...member.permissions.sections });
  const [actions, setActions] = useState<Record<ActionKey, boolean>>({ ...member.permissions.actions });

  async function save() {
    try {
      await update.mutateAsync({ id: member.id, sections, actions });
      push({ message: 'Права доступа сохранены', type: 'success', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      push({ message: apiError(err) || 'Не удалось сохранить права доступа', type: 'error', at: new Date().toISOString() });
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Изменить права сотрудника"
      panelClassName="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <button className="btn-secondary btn-lg px-6" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn-primary btn-lg px-6 font-semibold"
            disabled={update.isPending || isOwnerTarget}
            onClick={save}
          >
            {update.isPending ? <Spinner /> : 'Сохранить'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Шапка: аватар + имя + роль */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 px-4 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
            {member.name.trim().charAt(0).toUpperCase() || '—'}
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold text-text-primary">{member.name}</div>
            <div className="text-sm text-text-muted">Роль: {ROLE_LABEL[member.role]}</div>
          </div>
        </div>

        {isOwnerTarget && (
          <p className="rounded-lg bg-background px-3 py-2 text-sm text-text-muted">
            Владелец всегда имеет полный доступ — права изменить нельзя.
          </p>
        )}

        {/* Доступ к разделам — 2 колонки */}
        <PermissionSection title="Доступ к разделам">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SECTION_KEYS.map((key) => (
              <PermissionCheckboxItem
                key={key}
                label={SECTION_LABELS[key]}
                icon={SECTION_ICONS[key]}
                checked={isOwnerTarget ? true : sections[key]}
                disabled={isOwnerTarget}
                onToggle={() => setSections((s) => ({ ...s, [key]: !s[key] }))}
              />
            ))}
          </div>
        </PermissionSection>

        {/* Дополнительные права — одна колонка */}
        <PermissionSection title="Дополнительные права">
          <div className="grid grid-cols-1 gap-2">
            {ACTION_KEYS.map((key) => (
              <PermissionCheckboxItem
                key={key}
                label={ACTION_LABELS[key]}
                icon={ACTION_ICONS[key]}
                checked={isOwnerTarget ? true : actions[key]}
                disabled={isOwnerTarget}
                onToggle={() => setActions((a) => ({ ...a, [key]: !a[key] }))}
              />
            ))}
          </div>
        </PermissionSection>
      </div>
    </Modal>
  );
}
