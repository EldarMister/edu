import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/store/auth';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { disconnectSocket, useSocketEvent } from '@/lib/socket';
import {
  IconStats,
  IconOrders,
  IconTables,
  IconMenu,
  IconStaff,
  IconLogout,
} from './components/icons';
import { StatisticsPage } from './pages/StatisticsPage';
import { OrdersPage } from './pages/OrdersPage';
import { TablesPage } from './pages/TablesPage';
import { MenuPage } from './pages/MenuPage';
import { StaffPage } from './pages/StaffPage';

type Section = 'stats' | 'orders' | 'tables' | 'menu' | 'staff';

const SECTIONS: { key: Section; label: string; icon: typeof IconStats; ownerOnly?: boolean }[] = [
  { key: 'stats', label: 'Статистика', icon: IconStats, ownerOnly: true },
  { key: 'orders', label: 'Заказы', icon: IconOrders },
  { key: 'tables', label: 'Столы', icon: IconTables },
  { key: 'menu', label: 'Меню', icon: IconMenu },
  { key: 'staff', label: 'Персонал', icon: IconStaff },
];

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
};

export function AdminApp() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const isOwner = user?.role === 'OWNER';

  const sections = SECTIONS.filter((s) => !s.ownerOnly || isOwner);
  const [section, setSection] = useState<Section>(isOwner ? 'stats' : 'orders');
  const [mobileNav, setMobileNav] = useState(false);

  // Живое обновление: при изменении статуса заказа обновляем admin-данные.
  useSocketEvent('order:status_changed', () => {
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
  });
  useSocketEvent('table:status_changed', () => {
    qc.invalidateQueries({ queryKey: ['admin', 'halls'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
  });

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
        <span className="text-[15px] font-semibold text-text-primary">
          Вкусно <span className="text-primary">•</span> POS
        </span>
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
              {s.label}
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
          Выйти
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-[100dvh] bg-background">
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
            <h1 className="text-xl font-semibold text-text-primary lg:text-2xl">{current.label}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionStatus />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-text-primary">{user?.name}</p>
              <p className="text-xs text-text-muted">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {user?.name?.[0] ?? '?'}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {section === 'stats' && isOwner && <StatisticsPage />}
          {section === 'orders' && <OrdersPage />}
          {section === 'tables' && <TablesPage />}
          {section === 'menu' && <MenuPage />}
          {section === 'staff' && <StaffPage />}
        </main>
      </div>
    </div>
  );
}
