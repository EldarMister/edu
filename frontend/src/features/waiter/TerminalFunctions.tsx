import { useEffect, useRef } from 'react';
import { Modal } from '@/components/Modal';
import { IconCash, IconCart, IconJournal, IconLogout, IconOrders, IconPrinter, IconStaff, IconWarehouse } from '@/features/admin/components/icons';
import { WAREHOUSE_NAV, warehouseViewAllowed } from '@/features/admin/pages/warehouse/navigation';
import { useCashShiftAccess, useCashShiftState, type CashShiftEditor } from '@/features/settings/CashShiftControls';
import { useT } from '@/lib/i18n';
import { hasPermission } from '@/lib/permissions';
import { disconnectSocket } from '@/lib/socket';
import { canOpenWorkspace, workspacePermissions } from '@/lib/workspaces';
import { useAuth } from '@/store/auth';

export function TerminalFunctionsButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t('Функции')}
      title={t('Функции')}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="btn-secondary btn-md shrink-0 px-2.5"
      onClick={onOpen}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

type FunctionAction = {
  label: string;
  icon: typeof IconPrinter;
  disabled?: boolean;
} & ({ onClick: () => void } | { href: string });

export function TerminalFunctions({ onClose, onArchive, onAllOrders, onPrintQueue, canWork, onCashShift, onDelivery, onProfile }: {
  onClose: () => void;
  onArchive?: () => void;
  onAllOrders?: () => void;
  onPrintQueue?: () => void;
  canWork: boolean;
  onCashShift: (editor: CashShiftEditor) => void;
  onDelivery?: () => void;
  onProfile: () => void;
}) {
  const t = useT();
  const { user, logout } = useAuth();
  const { canManage } = useCashShiftAccess();
  const { data: cashShift } = useCashShiftState(canManage);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    menu.current?.querySelector<HTMLElement>('button:not([disabled]), a')?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const receipts: FunctionAction[] = [];
  if (onAllOrders) receipts.push({ label: 'Все заказы', icon: IconOrders, onClick: onAllOrders });
  if (onArchive) receipts.push({ label: 'Архив заказов', icon: IconJournal, onClick: onArchive });
  if (onPrintQueue) receipts.push({ label: 'Печать чека', icon: IconPrinter, onClick: onPrintQueue, disabled: !canWork });

  const cash: FunctionAction[] = [];
  if (canManage && cashShift?.enabled) {
    const current = cashShift.current;
    cash.push({
      label: current ? 'Закрыть кассовую смену' : 'Открыть кассовую смену',
      icon: IconCash,
      onClick: () => onCashShift(current ? 'close' : 'open'),
    });
    if (current) cash.push({ label: 'Операция с наличными', icon: IconCash, onClick: () => onCashShift('operation') });
  }

  const warehouse: FunctionAction[] = [];
  if (user && canOpenWorkspace(user, 'admin')) {
    const admin = workspacePermissions(user, 'admin');
    const owner = user.role === 'OWNER';
    if (owner || admin.sections.warehouse) {
      const views = WAREHOUSE_NAV.filter(({ key }) => key === 'inventory' || key === 'supplies');
      for (const view of views.filter((view) => warehouseViewAllowed(view, {
        canSection: (key) => owner || admin.sections[key],
        canEditSection: (key) => owner || (admin.sections[key] && !admin.readOnlySections?.includes(key)),
        canAction: (key) => owner || admin.actions[key],
        can: (key) => owner || hasPermission(admin, key),
      }))) {
        warehouse.push({
          label: view.label,
          icon: IconWarehouse,
          href: (owner ? '/owner' : '/admin') + '?section=warehouse&view=' + view.key,
        });
      }
    }
  }

  const workspace: FunctionAction[] = [];
  if (onDelivery) workspace.push({ label: 'Новая доставка', icon: IconCart, onClick: onDelivery, disabled: !canWork });
  workspace.push(
    { label: 'Профиль', icon: IconStaff, onClick: onProfile },
    { label: 'Выйти', icon: IconLogout, onClick: () => { disconnectSocket(); logout(); } },
  );

  const groups = [
    { label: 'Чеки', actions: receipts },
    { label: 'Касса', actions: cash },
    { label: 'Склад', actions: warehouse },
    { label: 'Рабочее место', actions: workspace },
  ].filter(({ actions }) => actions.length > 0);

  return (
    <Modal open title={t('Функции')} onClose={onClose} panelClassName="max-w-3xl">
      <div ref={menu} className="space-y-5 py-2">
        {groups.map(({ label, actions }) => (
          <section key={label} className="space-y-2.5">
            <h4 className="px-1 text-sm font-semibold text-text-secondary">{t(label)}</h4>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {actions.map(({ label, icon: Icon, disabled, ...action }) => {
                const style = 'flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-background p-2.5 text-left text-sm font-medium hover:border-primary/30 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50';
                const content = <>
                  <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-link">
                    <Icon />
                  </span>
                  <span>{t(label)}</span>
                </>;
                return <li key={label}>
                  {'href' in action
                    ? <a href={action.href} target="_blank" rel="noopener" className={style} onClick={onClose}>{content}</a>
                    : <button type="button" disabled={disabled} className={style} onClick={() => { onClose(); action.onClick(); }}>{content}</button>}
                </li>;
              })}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
