import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/store/auth';
import { useT } from '@/lib/i18n';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { disconnectSocket, useSocketEvent } from '@/lib/socket';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import type { Order } from '@/types';
import {
  IconStats,
  IconOrders,
  IconTables,
  IconMenu,
  IconStaff,
  IconSettings,
  IconJournal,
  IconReconcile,
  IconPrinter,
  IconLogout,
} from './components/icons';
import { StatisticsPage } from './pages/StatisticsPage';
import { OrdersPage } from './pages/OrdersPage';
import { TablesPage } from './pages/TablesPage';
import { MenuPage } from './pages/MenuPage';
import { StaffPage } from './pages/StaffPage';
import { AuditPage } from './pages/AuditPage';
import { ReconciliationPage } from './pages/ReconciliationPage';
import { ReceiptPrintsPage } from './pages/ReceiptPrintsPage';
import { SettingsPage } from '../settings/SettingsPage';

type Section =
  | 'stats'
  | 'orders'
  | 'receipts'
  | 'tables'
  | 'menu'
  | 'staff'
  | 'audit'
  | 'reconcile'
  | 'settings';

const SECTIONS: { key: Section; label: string; icon: typeof IconStats; ownerOnly?: boolean }[] = [
  { key: 'stats', label: 'Статистика', icon: IconStats, ownerOnly: true },
  { key: 'orders', label: 'Заказы', icon: IconOrders },
  { key: 'receipts', label: 'Печать чека', icon: IconPrinter },
  { key: 'tables', label: 'Столы', icon: IconTables },
  { key: 'menu', label: 'Меню', icon: IconMenu },
  { key: 'staff', label: 'Персонал', icon: IconStaff },
  { key: 'audit', label: 'Журнал', icon: IconJournal, ownerOnly: true },
  { key: 'reconcile', label: 'Сверка оплат', icon: IconReconcile, ownerOnly: true },
  { key: 'settings', label: 'Настройки', icon: IconSettings, ownerOnly: true },
];

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
};

export function AdminApp() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const t = useT();
  const isOwner = user?.role === 'OWNER';

  const sections = SECTIONS.filter((s) => !s.ownerOnly || isOwner);
  const [section, setSection] = useState<Section>(isOwner ? 'stats' : 'orders');
  const [mobileNav, setMobileNav] = useState(false);

  // Живое обновление: при изменении статуса заказа обновляем admin-данные.
  useSocketEvent<Order>('order:status_changed', (order) => {
    applyOrderStatusToCache(qc, order);
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
  });
  useSocketEvent('table:status_changed', () => {
    qc.invalidateQueries({ queryKey: ['admin', 'halls'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
  });
  // Печать чека: новая заявка / решение по ней — обновляем список без перезагрузки.
  const invalidateReceipts = () =>
    qc.invalidateQueries({ queryKey: ['admin', 'receipt-prints'] });
  useSocketEvent('receipt_print_request_created', invalidateReceipts);
  useSocketEvent('receipt_print_request_printed', invalidateReceipts);
  useSocketEvent('receipt_print_request_rejected', invalidateReceipts);

  function onLogout() {
    disconnectSocket();
    logout();
  }

  function go(s: Section) {
    setSection(s);
    setMobileNav(false);
  }

  const current = sections.find((s) => s.key === section) ?? sections[0];

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-white">
      <div className="flex h-16 items-center px-5">
        <BrandLogo />
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = s.key === section;
          return (
            <button
              key={s.key}
              onClick={() => go(s.key)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${
                active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background'
              }`}
            >
              <Icon />
              {t(s.label)}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-text-secondary hover:bg-background"
        >
          <IconLogout />
          {t('Выйти')}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebar}</div>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNav(false)} />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-white px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              className="-ml-1 rounded-lg p-1.5 text-text-secondary hover:bg-background lg:hidden"
              onClick={() => setMobileNav(true)}
              aria-label="Меню"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold text-text-primary lg:text-2xl">{t(current.label)}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionStatus />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-text-primary">{user?.name}</p>
              <p className="text-xs text-text-muted">
                {t(ROLE_LABEL[user?.role ?? ''] ?? user?.role ?? '')}
              </p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {user?.name?.[0] ?? '?'}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {section === 'stats' && isOwner && <StatisticsPage />}
          {section === 'orders' && <OrdersPage />}
          {section === 'receipts' && <ReceiptPrintsPage />}
          {section === 'tables' && <TablesPage />}
          {section === 'menu' && <MenuPage />}
          {section === 'staff' && <StaffPage />}
          {section === 'audit' && isOwner && <AuditPage />}
          {section === 'reconcile' && isOwner && <ReconciliationPage />}
          {section === 'settings' && isOwner && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
