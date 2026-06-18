import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/store/auth';
import { useT } from '@/lib/i18n';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { AppVersion } from '@/components/AppVersion';
import { disconnectSocket, useSocketEvent } from '@/lib/socket';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import { beep } from '@/lib/sound';
import { adminVoice } from '@/services/adminVoice';
import type { Order, ReceiptPrintRequest } from '@/types';
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
  IconWarehouse,
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
import { WarehouseSection } from './pages/warehouse/WarehouseSection';

const UNITS = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1000) return String(n);
  if (n === 0) return UNITS[0];
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const u = rest % 10;
    if (t) parts.push(TENS[t]);
    if (u) parts.push(UNITS[u]);
  }
  return parts.join(' ');
}

function receiptRequestVoice(request: ReceiptPrintRequest): string {
  const documentName = request.type === 'preliminary' ? 'счёта' : 'чека';
  const tableNumber = Number.isInteger(request.tableNumber) ? numberToWords(request.tableNumber) : String(request.tableNumber);
  return request.voice?.text ?? `Официант ${request.waiterName} отправил заявку на печать ${documentName}. Стол номер ${tableNumber}.`;
}
import { SettingsPage } from '../settings/SettingsPage';

type Section =
  | 'stats'
  | 'orders'
  | 'receipts'
  | 'tables'
  | 'menu'
  | 'warehouse'
  | 'staff'
  | 'audit'
  | 'reconcile'
  | 'settings';

const SECTIONS: { key: Section; label: string; icon: typeof IconStats; ownerOnly?: boolean; adminOnly?: boolean }[] = [
  { key: 'stats', label: 'Статистика', icon: IconStats, ownerOnly: true },
  { key: 'orders', label: 'Заказы', icon: IconOrders },
  { key: 'receipts', label: 'Печать чека', icon: IconPrinter, adminOnly: true },
  { key: 'tables', label: 'Столы', icon: IconTables },
  { key: 'menu', label: 'Меню', icon: IconMenu },
  { key: 'warehouse', label: 'Склад', icon: IconWarehouse },
  { key: 'staff', label: 'Персонал', icon: IconStaff },
  { key: 'audit', label: 'Журнал', icon: IconJournal, ownerOnly: true },
  { key: 'reconcile', label: 'Сверка оплат', icon: IconReconcile, ownerOnly: true },
  { key: 'settings', label: 'Настройки', icon: IconSettings, ownerOnly: true },
];


export function AdminApp() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const t = useT();
  const isOwner = user?.role === 'OWNER';
  const isAdmin = user?.role === 'ADMIN';

  const sections = SECTIONS.filter((s) => (!s.ownerOnly || isOwner) && (!s.adminOnly || isAdmin));
  const [section, setSection] = useState<Section>(isOwner ? 'stats' : 'orders');
  const [mobileNav, setMobileNav] = useState(false);
  const invalidateReceipts = () =>
    qc.invalidateQueries({ queryKey: ['admin', 'receipt-prints'] });

  // Живое обновление: при изменении статуса заказа обновляем admin-данные.
  useSocketEvent<Order>('order:status_changed', (order) => {
    applyOrderStatusToCache(qc, order);
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
    invalidateReceipts();
  });
  useSocketEvent('table:status_changed', () => {
    qc.invalidateQueries({ queryKey: ['admin', 'halls'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
  });
  useSocketEvent('tables:updated', () => {
    qc.invalidateQueries({ queryKey: ['admin', 'halls'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
    qc.invalidateQueries({ queryKey: ['audit'] });
  });
  useSocketEvent('menu:updated', () => {
    qc.invalidateQueries({ queryKey: ['admin', 'menu'] });
    qc.invalidateQueries({ queryKey: ['admin', 'categories'] });
    qc.invalidateQueries({ queryKey: ['admin', 'dishes'] });
    qc.invalidateQueries({ queryKey: ['admin', 'sets'] });
    qc.invalidateQueries({ queryKey: ['admin', 'warehouse'] });
    qc.invalidateQueries({ queryKey: ['audit'] });
  });
  useSocketEvent('settings:updated', () => {
    qc.invalidateQueries({ queryKey: ['settings'] });
    qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    qc.invalidateQueries({ queryKey: ['audit'] });
  });
  // Печать чека: новая заявка / решение по ней — обновляем список без перезагрузки.
  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_created', (request) => {
    invalidateReceipts();
    beep('notify');
    adminVoice.enqueue(receiptRequestVoice(request));
  });
  useSocketEvent('receipt_print_request_approved', invalidateReceipts);
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
        <AppVersion className="mt-2" />
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
          </div>
        </header>

        <main className={`app-scrollbar-subtle flex-1 overflow-y-auto overflow-x-hidden p-4 lg:p-6 ${['receipts', 'tables', 'menu', 'staff'].includes(section) ? 'pt-2 lg:pt-3' : ''}`}>

          {section === 'stats' && isOwner && <StatisticsPage />}
          {section === 'orders' && <OrdersPage />}
          {section === 'receipts' && isAdmin && <ReceiptPrintsPage />}
          {section === 'tables' && <TablesPage />}
          { section === 'menu' && <MenuPage /> }
          { section === 'warehouse' && <WarehouseSection /> }
          { section === 'staff' && <StaffPage /> }
          { section === 'audit' && isOwner && <AuditPage /> }
          { section === 'reconcile' && isOwner && <ReconciliationPage /> }
          {section === 'settings' && isOwner && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
