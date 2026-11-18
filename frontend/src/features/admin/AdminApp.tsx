import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TouchEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import type { SectionKey } from '@/types';
import { useT } from '@/lib/i18n';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { WorkShiftBanner } from '@/features/settings/WorkShiftBanner';
import { SidebarProfile } from './components/SidebarProfile';
import { disconnectSocket, useSocketEvent } from '@/lib/socket';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import { beep } from '@/lib/sound';
import { adminVoice } from '@/services/adminVoice';
import { useNotifications } from '@/store/notifications';
import type { AdministratorCall, Order, ReceiptPrintRequest } from '@/types';
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
  IconMoney,
} from './components/icons';
import { StatisticsPage } from './pages/StatisticsPage';
import { STATISTICS_NAV, statisticsView, type StatisticsView } from './pages/statisticsViews';
import { OrdersPage } from './pages/OrdersPage';
import { TablesPage } from './pages/TablesPage';
import { MenuCategoriesPage, MenuPage } from './pages/MenuPage';
import { StaffPage } from './pages/StaffPage';
import { WorkspaceLinks } from '@/components/WorkspaceLinks';
import { PositionsPage } from './pages/PositionsPage';
import { FinancePage } from './pages/finance/FinancePage';
import { cashShiftKey, financeKey, useFinanceAccess } from './pages/finance/api';
import { FINANCE_NAV, PERSONNEL_NAV } from './pages/finance/navigation';
import { AuditPage } from './pages/AuditPage';
import { ReconciliationPage } from './pages/ReconciliationPage';
import { ReceiptPrintsPage } from './pages/ReceiptPrintsPage';
import { WarehouseSection } from './pages/warehouse/WarehouseSection';
import { WAREHOUSE_NAV, MENU_NAV, warehouseViewAllowed, warehouseViewInUse, type WarehouseView, type MenuView } from './pages/warehouse/navigation';
import { useWarehousePolicy } from './pages/warehouse/settings-api';
import { useWarehouseLocations } from './pages/warehouse/api';
import { useWorkspaceScroll } from './pages/warehouse/workspace-route';
import { StationsPage } from './pages/StationsPage';
import { IngredientCategoriesPage } from './pages/IngredientCategoriesPage';
import { WorkspaceHeaderProvider, WorkspaceTitleSlot, WorkspaceActionsSlot } from './pages/WorkspaceHeader';
import './pages/warehouse/poster-workspace.css';

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
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

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
  const tableNumber = Number.isInteger(request.tableNumber)
    ? numberToWords(request.tableNumber)
    : String(request.tableNumber);
  return (
    request.voice?.text ??
    `Официант ${request.waiterName} отправил заявку на печать ${documentName}. Стол номер ${tableNumber}.`
  );
}
import { SettingsPage } from '../settings/SettingsPage';

type Section =
  | 'stats'
  | 'orders'
  | 'receipts'
  | 'tables'
  | 'menu'
  | 'warehouse'
  | 'finance'
  | 'staff'
  | 'audit'
  | 'reconcile'
  | 'settings';

// perm — ключ доступа к разделу.
// adminOnly — раздел структурно только для админа (владельцу не показываем).
const SECTIONS: {
  key: Section;
  label: string;
  icon: typeof IconStats;
  perm?: SectionKey;
  adminOnly?: boolean;
}[] = [
  { key: 'stats', label: 'Статистика', icon: IconStats, perm: 'statistics' },
  { key: 'finance', label: 'Финансы', icon: IconMoney },
  { key: 'orders', label: 'Заказы', icon: IconOrders, perm: 'orders' },
  { key: 'receipts', label: 'Печать чека', icon: IconPrinter, perm: 'checks', adminOnly: true },
  { key: 'tables', label: 'Столы', icon: IconTables, perm: 'tables' },
  { key: 'menu', label: 'Меню', icon: IconMenu, perm: 'menu' },
  { key: 'warehouse', label: 'Склад', icon: IconWarehouse, perm: 'warehouse' },
  { key: 'staff', label: 'Персонал', icon: IconStaff, perm: 'staff' },
  { key: 'audit', label: 'Журнал', icon: IconJournal, perm: 'journal' },
  { key: 'reconcile', label: 'Сверка оплат', icon: IconReconcile, perm: 'paymentReconciliation' },
  { key: 'settings', label: 'Настройки', icon: IconSettings, perm: 'settings' },
];

const MOBILE_NAV_EDGE_ZONE = 68;
const MOBILE_NAV_OPEN_DISTANCE = 72;
const MOBILE_NAV_CLOSE_DISTANCE = 40;
const MOBILE_NAV_VERTICAL_TOLERANCE = 48;

export function AdminApp() {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const pushNotification = useNotifications((state) => state.push);
  const t = useT();
  const permissions = usePermissions();
  const { canSection, can } = permissions;
  const isOwner = permissions.isOwner;
  const isAdmin = permissions.effectiveRole === 'ADMIN';
  const financeAccess = useFinanceAccess(isAdmin);
  const mayPostFinances = isOwner || financeAccess.data?.allowed === true;
  const mayViewFinances = isOwner || financeAccess.data?.canViewAll === true;
  const mayUseCashShifts = can('actions.financeCashShifts') || mayViewFinances;
  const financeNav = FINANCE_NAV.filter(({ key }) => key === 'cashShifts' ? mayUseCashShifts
    : key === 'transactions' ? mayPostFinances : mayViewFinances);
  const personnelNav = PERSONNEL_NAV.filter(({ key }) => key !== 'positions' || isOwner);

  // Раздел в меню: структурное ограничение (adminOnly) + право доступа к разделу.
  const sections = SECTIONS.filter((s) => {
    if (s.adminOnly && !isAdmin) return false;
    if (s.key === 'finance') return financeNav.length > 0;
    return !!s.perm && canSection(s.perm);
  });
  const [route, setRoute] = useSearchParams();
  useWorkspaceScroll();
  const legacyStations = route.get('section') === 'menu' && route.get('view') === 'stations';
  const section = (legacyStations ? 'staff' : route.get('section') || (isOwner ? 'stats' : 'orders')) as Section;
  const warehousePolicy = useWarehousePolicy(canSection('warehouse'));
  const warehouseLocations = useWarehouseLocations(canSection('warehouse'));
  function setSection(next: Section) {
    const defaults: Partial<Record<Section, string>> = {
      stats: 'overview', menu: 'goods', warehouse: 'balances', finance: financeNav[0]?.key, staff: 'employees',
    };
    const view = defaults[next];
    setRoute(view ? { section: next, view } : { section: next });
  }
  const [mobileNav, setMobileNav] = useState(false);
  const [collapsedSection, setCollapsedSection] = useState<Section | null>(null);
  const statsView = statisticsView(route.get('view'));
  const warehouseView = (WAREHOUSE_NAV.some((item) => item.key === route.get('view')) ? route.get('view') : 'balances') as WarehouseView;
  const menuView = (MENU_NAV.some((item) => item.key === route.get('view')) ? route.get('view') : 'goods') as MenuView;
  const financeView = financeNav.find(({ key }) => key === route.get('view'))?.key ?? financeNav[0]?.key;
  const staffView = personnelNav.find(({ key }) => key === route.get('view'))?.key ?? 'employees';
  const staffTab = route.get('view') === 'waiter-report' ? 'waiter-orders' : 'current';
  const posterWorkspace = ['menu', 'warehouse', 'finance', 'staff'].includes(section);
  function setStatsView(view: StatisticsView) { setRoute({ section: 'stats', view }); }
  function setWarehouseView(view: WarehouseView) { setRoute({ section: 'warehouse', view }); }
  function setMenuView(view: MenuView) { setRoute({ section: 'menu', view }); }
  const edgeSwipe = useRef<{ x: number; y: number } | null>(null);
  const drawerPull = useRef<{ x: number; y: number } | null>(null);

  // Если текущий раздел стал недоступен (право отозвали) — уходим на первый доступный.
  useEffect(() => {
    if (section === 'finance' && isAdmin && financeAccess.isPending) return;
    if (sections.length > 0 && !sections.some((s) => s.key === section)) {
      setSection(sections[0].key);
    } else if (legacyStations) {
      const next = new URLSearchParams(route);
      next.set('section', 'staff');
      setRoute(next, { replace: true });
    }
  }, [sections, section, isAdmin, financeAccess.isPending, legacyStations, route, setRoute]);

  useEffect(() => {
    if (!mobileNav) {
      drawerPull.current = null;
    }
  }, [mobileNav]);
  const invalidateReceipts = () => qc.invalidateQueries({ queryKey: ['admin', 'receipt-prints'] });

  // Живое обновление: при изменении статуса заказа обновляем admin-данные.
  useSocketEvent<Order>('order:status_changed', (order) => {
    void qc.invalidateQueries({ queryKey: financeKey });
    void qc.invalidateQueries({ queryKey: cashShiftKey });
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
  useSocketEvent('warehouse:updated', () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'warehouse'] });
  });
  useSocketEvent('settings:updated', () => {
    void invalidateReceipts();
    void qc.invalidateQueries({ queryKey: cashShiftKey });
    qc.invalidateQueries({ queryKey: ['settings'] });
    qc.invalidateQueries({ queryKey: ['admin', 'warehouse', 'locations'] });
    qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
    qc.invalidateQueries({ queryKey: ['audit'] });
  });
  // Печать чека: новая заявка / решение по ней — обновляем список без перезагрузки.
  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_created', (request) => {
    invalidateReceipts();
    beep('notify');
    adminVoice.enqueue(receiptRequestVoice(request));
  });
  useSocketEvent<AdministratorCall>('administrator:called', (call) => {
    beep('notify');
    pushNotification({
      message: call.message,
      type: 'info',
      orderId: call.orderId,
      orderNumber: call.orderNumber,
      at: call.createdAt,
      durationMs: 12_000,
    });
    adminVoice.enqueue(call.voice?.text);
  });
  useSocketEvent('receipt_print_request_approved', invalidateReceipts);
  useSocketEvent('receipt_print_request_printed', invalidateReceipts);
  useSocketEvent('receipt_print_request_rejected', invalidateReceipts);

  function onLogout() {
    disconnectSocket();
    logout();
  }

  function go(s: Section) {
    setCollapsedSection(null);
    setSection(s);
    setMobileNav(false);
  }

  function handleAppTouchStart(event: TouchEvent<HTMLDivElement>) {
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
    if (mobileNav || isDesktop || (!isAdmin && !isOwner)) return;
    const touch = event.touches[0];
    if (!touch || touch.clientX > MOBILE_NAV_EDGE_ZONE) {
      edgeSwipe.current = null;
      return;
    }
    edgeSwipe.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleAppTouchMove(event: TouchEvent<HTMLDivElement>) {
    const start = edgeSwipe.current;
    if (!start || mobileNav) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dy) > MOBILE_NAV_VERTICAL_TOLERANCE && Math.abs(dy) > dx) {
      edgeSwipe.current = null;
      return;
    }
    if (dx > MOBILE_NAV_OPEN_DISTANCE && Math.abs(dy) < MOBILE_NAV_VERTICAL_TOLERANCE) {
      event.preventDefault();
      edgeSwipe.current = null;
      setMobileNav(true);
    }
  }

  function handleAppTouchEnd() {
    edgeSwipe.current = null;
  }

  function handleDrawerTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (!touch) return;
    drawerPull.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleDrawerTouchMove(event: TouchEvent<HTMLDivElement>) {
    const start = drawerPull.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx < -MOBILE_NAV_CLOSE_DISTANCE && Math.abs(dx) > Math.abs(dy)) {
      drawerPull.current = null;
      setMobileNav(false);
    } else if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      drawerPull.current = null;
    }
  }

  function handleDrawerTouchEnd() {
    drawerPull.current = null;
  }

  const current = sections.find((s) => s.key === section) ?? sections[0];
  const currentViewLabel = section === 'stats'
    ? STATISTICS_NAV.find((item) => item.key === statsView)?.label
    : section === 'warehouse'
      ? WAREHOUSE_NAV.find((item) => item.key === warehouseView)?.label
      : section === 'menu' ? MENU_NAV.find((item) => item.key === menuView)?.label
        : section === 'finance' ? financeNav.find(({ key }) => key === financeView)?.label
          : section === 'staff' ? personnelNav.find(({ key }) => key === staffView)?.label : undefined;

  const renderSidebar = (variant: 'desktop' | 'mobile') => (
    <aside className="workspace-sidebar flex h-full w-52 shrink-0 flex-col border-r border-border bg-white">
      <div className="workspace-brand flex h-16 items-center px-5">
        <BrandLogo />
      </div>
      <nav className="workspace-nav app-scrollbar-subtle min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {sections.map((s) => {
          const Icon = s.icon;
          const active = s.key === section;
          const children =
            s.key === 'warehouse'
              ? WAREHOUSE_NAV.filter(
                  (item) =>
                    warehouseViewAllowed(item, permissions) &&
                    warehouseViewInUse(item.key, warehouseLocations.data?.locations.length ?? 0, warehousePolicy.data),
                )
              : s.key === 'menu'
                ? MENU_NAV.filter((item) => !['preparations', 'ingredients', 'ingredientCategories'].includes(item.key) || canSection('warehouse'))
                : s.key === 'stats' ? STATISTICS_NAV
                  : s.key === 'finance' ? financeNav : s.key === 'staff' ? personnelNav : [];
          const currentView = s.key === 'warehouse' ? warehouseView
            : s.key === 'menu' ? menuView : s.key === 'stats' ? statsView
              : s.key === 'finance' ? financeView : staffView;
          const hasChildren = children.length > 0;
          const expanded = hasChildren && active && collapsedSection !== s.key;
          const selectedSection = active && !hasChildren;
          const childrenId = `workspace-${variant}-${s.key}-children`;
          return (
            <div key={s.key}>
              <button
                type="button"
                onClick={() => {
                  if (!hasChildren) {
                    go(s.key);
                  } else if (!active) {
                    setCollapsedSection(null);
                    setSection(s.key);
                  } else {
                    setCollapsedSection(expanded ? s.key : null);
                  }
                }}
                aria-expanded={hasChildren ? expanded : undefined}
                aria-controls={hasChildren ? childrenId : undefined}
                aria-current={selectedSection ? 'page' : undefined}
                className={`workspace-nav-section flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${selectedSection ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background hover:text-text-primary'}`}
              >
                <Icon />
                {t(s.label)}
              </button>
              {hasChildren && (
                <div
                  id={childrenId}
                  className="workspace-nav-collapse"
                  data-expanded={expanded}
                  aria-hidden={!expanded}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="workspace-nav-children mb-2 mt-1.5 space-y-0.5">
                      {children.map((item) => {
                        const selected = active && currentView === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            tabIndex={expanded ? undefined : -1}
                            aria-current={selected ? 'page' : undefined}
                            onClick={() => {
                              if (s.key === 'warehouse') setWarehouseView(item.key as WarehouseView);
                              else if (s.key === 'menu') setMenuView(item.key as MenuView);
                              else if (s.key === 'stats') setStatsView(item.key as StatisticsView);
                              else setRoute({ section: s.key, view: item.key });
                              setMobileNav(false);
                            }}
                            className={`workspace-nav-child block w-full rounded-lg py-2 pl-[34px] pr-2 text-left text-sm leading-[21px] transition-colors ${selected ? 'bg-primary font-medium text-white' : 'text-text-secondary hover:bg-background hover:text-text-primary'}`}
                          >
                            {t(item.label)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <WorkspaceLinks current="admin" />
      <SidebarProfile name={user?.name} onLogout={onLogout} />
    </aside>
  );

  return (
    <WorkspaceHeaderProvider>
    <div
      className={`flex h-full ${isOwner ? 'owner-workspace' : 'bg-background'}`}
      onTouchStart={handleAppTouchStart}
      onTouchMove={handleAppTouchMove}
      onTouchEnd={handleAppTouchEnd}
      onTouchCancel={handleAppTouchEnd}
    >
      {/* Desktop sidebar */}
      <div className="hidden lg:block">{renderSidebar('desktop')}</div>

      {/* Mobile drawer */}
      {mobileNav && (
        <div data-radio-blocking className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileNav(false)}
            onTouchMove={(event) => event.preventDefault()}
          />
          <div
            className="absolute inset-y-0 left-0 touch-pan-y"
            onTouchStart={handleDrawerTouchStart}
            onTouchMove={handleDrawerTouchMove}
            onTouchEnd={handleDrawerTouchEnd}
            onTouchCancel={handleDrawerTouchEnd}
          >
            {renderSidebar('mobile')}
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <header className="workspace-header flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 sm:flex-nowrap border-b border-border bg-white px-4 py-3 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              className="-ml-1 shrink-0 rounded-lg p-1.5 text-text-secondary hover:bg-background lg:hidden"
              onClick={() => setMobileNav(true)}
              aria-label="Меню"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <WorkspaceTitleSlot><h1 className="text-xl font-semibold text-text-primary lg:text-2xl">
              {current ? t(currentViewLabel ?? current.label) : ''}
            </h1></WorkspaceTitleSlot>
          </div>
          <div className="contents sm:flex sm:items-center sm:gap-3">
            <WorkspaceActionsSlot className="order-last basis-full empty:hidden sm:order-none sm:basis-auto" />
            <ConnectionStatus />
          </div>
        </header>
        <WorkShiftBanner />
        <main
          className={`workspace-main app-scrollbar-subtle flex-1 overflow-y-auto overflow-x-hidden p-4 lg:p-6 ${posterWorkspace ? 'poster-workspace' : ''} ${['receipts', 'tables', 'menu', 'staff'].includes(section) ? 'pt-2 lg:pt-3' : ''}`}
        >
          {!current ? (
            <NoAccessScreen />
          ) : (
            <>
              {section === 'stats' && canSection('statistics') && <StatisticsPage view={statsView} />}
              {section === 'orders' && canSection('orders') && <OrdersPage />}
              {section === 'receipts' && isAdmin && canSection('checks') && <ReceiptPrintsPage />}
              {section === 'tables' && canSection('tables') && <TablesPage />}
              {section === 'menu' && canSection('menu') && <>
                {menuView === 'categories' && <MenuCategoriesPage />}
                {menuView === 'ingredientCategories' && canSection('warehouse') && <IngredientCategoriesPage />}
                {menuView !== 'categories' && menuView !== 'ingredientCategories' && <MenuPage view={menuView} />}
              </>}
              {section === 'warehouse' && canSection('warehouse') && (
                <WarehouseSection
                  view={warehouseView}
                  onView={setWarehouseView}
                  onMenu={(view) => {
                    setMenuView(view);
                  }}
                />
              )}
              {section === 'finance' && financeView && <FinancePage key={financeView} view={financeView} />}
              {section === 'staff' && canSection('staff') && <>
                {staffView === 'stations' && <StationsPage />}
                {staffView === 'positions' && <PositionsPage />}
                {staffView === 'employees' && <StaffPage key={staffTab} initialTab={staffTab} />}
              </>}
              {section === 'audit' && canSection('journal') && <AuditPage />}
              {section === 'reconcile' && canSection('paymentReconciliation') && <ReconciliationPage />}
              {section === 'settings' && canSection('settings') && <SettingsPage />}
            </>
          )}
        </main>
      </div>
    </div>
    </WorkspaceHeaderProvider>
  );
}

/** Пустое состояние при отсутствии доступа к разделу. */
function NoAccessScreen() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background text-text-light">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </div>
      <p className="text-base font-medium text-text-primary">У вас нет доступа к этому разделу</p>
      <p className="max-w-xs text-sm text-text-muted">
        Обратитесь к владельцу или администратору, чтобы открыть доступ.
      </p>
    </div>
  );
}
