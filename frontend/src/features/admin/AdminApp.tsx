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
import { SidebarProfile } from './components/SidebarProfile';
import { AdminProfilePage } from './pages/AdminProfilePage';
import { SidebarFlyout } from './components/SidebarFlyout';
import { disconnectSocket, useSocketEvent } from '@/lib/socket';
import { applyOrderStatusToCache } from '@/lib/order-cache';
import { beep } from '@/lib/sound';
import { adminVoice } from '@/services/adminVoice';
import { useNotifications } from '@/store/notifications';
import type { AdministratorCall, Order, ReceiptPrintRequest } from '@/types';
import { useCanManageOrderRefunds, useRefundUpdates } from '@/features/refunds/api';
import { RefundQueuePage } from '@/features/refunds/OrderRefunds';
import { ItemCancellationQueuePage } from '@/features/requests/ItemCancellationQueuePage';
import { useItemCancellationUpdates } from '@/features/requests/item-cancellations';
import {
  IconStats,
  IconOrders,
  IconTables,
  IconMenu,
  IconStaff,
  IconSettings,
  IconJournal,
  IconPrinter,
  IconWarehouse,
  IconMoney,
} from './components/icons';
import { StatisticsPage } from './pages/StatisticsPage';
import { STATISTICS_NAV, statisticsView, type StatisticsView } from './pages/statisticsViews';
import { OrdersPage } from './pages/OrdersPage';
import { TablesPage } from './pages/TablesPage';
import { MenuPage } from './pages/MenuPage';
import { MenuCategoryWorkspace } from './pages/MenuCategoryWorkspace';
import { StaffPage } from './pages/StaffPage';
import { WorkShiftsPage } from './pages/WorkShiftsPage';
import { WorkspaceLinks } from '@/components/WorkspaceLinks';
import { PositionsPage } from './pages/PositionsPage';
import { FinancePage } from './pages/finance/FinancePage';
import { cashShiftKey, financeKey, useFinanceAccess } from './pages/finance/api';
import { FINANCE_NAV, PERSONNEL_NAV } from './pages/finance/navigation';
import { AuditPage } from './pages/AuditPage';
import { ReceiptPrintsPage } from './pages/ReceiptPrintsPage';
import { WarehouseSection } from './pages/warehouse/WarehouseSection';
import { WAREHOUSE_NAV, MENU_NAV, warehouseViewAllowed, warehouseViewInUse, type WarehouseView, type MenuView } from './pages/warehouse/navigation';
import { useWarehousePolicy } from './pages/warehouse/settings-api';
import { useWarehouseLocations } from './pages/warehouse/api';
import { useWorkspaceScroll } from './pages/warehouse/workspace-route';
import { StationsPage } from './pages/StationsPage';
import { WorkspaceHeaderProvider, WorkspaceTitleSlot, WorkspaceActionsSlot } from './pages/WorkspaceHeader';
import { SettingsPage } from '../settings/SettingsPage';
import { ReceiptSettingsPage } from '../settings/ReceiptSettingsPage';
import { FiscalSettingsPage } from '../settings/FiscalSettingsPage';
import { TaxesPage, TaxReportPage } from '../settings/TaxPages';
import { taxReportKey } from '../settings/taxes-api';
import './pages/warehouse/poster-workspace.css';
import './components/sidebar.css';
import './components/workspace-motion.css';

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
  const delivery = request.orderSource === 'delivery';
  const place = delivery ? 'Доставка' : `Стол номер ${tableNumber}`;
  return (
    request.voice?.text ??
    `${delivery ? '' : 'Официант '}${request.waiterName} отправил заявку на печать ${documentName}. ${place}.`
  );
}
const SETTINGS_NAV = [
  { key: 'general', label: 'Общие' },
  { key: 'receipt', label: 'Чек' },
  { key: 'fiscal', label: 'ККМ' },
  { key: 'taxes', label: 'Налоги' },
];

type Section =
  | 'stats'
  | 'orders'
  | 'requests'
  | 'receipts'
  | 'tables'
  | 'menu'
  | 'warehouse'
  | 'finance'
  | 'staff'
  | 'audit'
  | 'settings';

const NEXT_SIDEBAR_MODE = { expanded: 'compact', compact: 'hidden', hidden: 'expanded' } as const;
type SidebarMode = keyof typeof NEXT_SIDEBAR_MODE;
const SIDEBAR_TOGGLE_LABELS: Record<SidebarMode, string> = {
  expanded: 'Свернуть боковую панель до иконок',
  compact: 'Скрыть боковую панель',
  hidden: 'Развернуть боковую панель',
};

// perm — ключ доступа к разделу.
const SECTIONS: {
  key: Section;
  label: string;
  icon: typeof IconStats;
  perm?: SectionKey;
}[] = [
  { key: 'stats', label: 'Статистика', icon: IconStats, perm: 'statistics' },
  { key: 'orders', label: 'Заказы', icon: IconOrders, perm: 'orders' },
  { key: 'requests', label: 'Заявки', icon: IconJournal },
  { key: 'receipts', label: 'Печать чека', icon: IconPrinter, perm: 'checks' },
  { key: 'tables', label: 'Столы', icon: IconTables, perm: 'tables' },
  { key: 'menu', label: 'Меню', icon: IconMenu, perm: 'menu' },
  { key: 'warehouse', label: 'Склад', icon: IconWarehouse, perm: 'warehouse' },
  { key: 'staff', label: 'Персонал', icon: IconStaff, perm: 'staff' },
  { key: 'finance', label: 'Финансы', icon: IconMoney },
  { key: 'audit', label: 'Журнал', icon: IconJournal, perm: 'journal' },
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
  const canHandlePrintRequests = canSection('checks') && permissions.canOwnerOperation('printRequests');
  const canManageRefunds = useCanManageOrderRefunds();
  const canManageCancellations = (isAdmin || isOwner) && permissions.canEditSection('orders')
    && permissions.canOwnerOperation('cancelItems');
  const requestsNav = [
    ...(canManageRefunds ? [{ key: 'refunds', label: 'Заявки на возврат' }] : []),
    ...(canManageCancellations ? [{ key: 'cancellations', label: 'Отмены блюд' }] : []),
  ];
  useRefundUpdates('admin', canManageRefunds);
  useItemCancellationUpdates('admin', canManageCancellations);
  const financeAccess = useFinanceAccess(isAdmin);
  const mayPostFinances = isOwner || financeAccess.data?.allowed === true;
  const mayViewFinances = isOwner || financeAccess.data?.canViewAll === true;
  const mayUseCashShifts = can('actions.financeCashShifts') || mayViewFinances;
  const financeNav = FINANCE_NAV.filter(({ key }) => key === 'cashShifts' ? mayUseCashShifts
    : key === 'profitLoss' ? mayViewFinances && canSection('warehouse') && can('actions.warehouseCosts')
    : key === 'transactions' ? mayPostFinances : mayViewFinances);
  const personnelNav = PERSONNEL_NAV.filter(({ key }) =>
    (key !== 'positions' || isOwner) && (key !== 'shifts' || can('actions.closeShift')));

  const sections = SECTIONS.filter((s) => {
    if (s.key === 'receipts') return canHandlePrintRequests;
    if (s.key === 'finance') return financeNav.length > 0;
    if (s.key === 'requests') return requestsNav.length > 0;
    return !!s.perm && canSection(s.perm);
  });
  const [route, setRoute] = useSearchParams();
  const profileOpen = route.get('section') === 'profile';
  useWorkspaceScroll();
  const legacyStations = route.get('section') === 'menu' && route.get('view') === 'stations';
  const section = (legacyStations ? 'staff' : route.get('section') || (isOwner ? 'stats' : 'orders')) as Section;
  const requestsView = requestsNav.find(({ key }) => key === route.get('view')) ?? requestsNav[0];
  const warehousePolicy = useWarehousePolicy(canSection('warehouse'));
  const warehouseLocations = useWarehouseLocations(canSection('warehouse'));
  function setSection(next: Section) {
    const defaults: Partial<Record<Section, string>> = {
      stats: 'overview', menu: 'goods', warehouse: 'balances', finance: financeNav[0]?.key, staff: 'employees', settings: 'general',
      requests: requestsNav[0]?.key,
    };
    const view = defaults[next];
    setRoute(view ? { section: next, view } : { section: next });
  }
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('expanded');
  const [sidebarFlyout, setSidebarFlyout] = useState<{ section: Section; anchor: HTMLButtonElement; pinned: boolean } | null>(null);
  const flyoutTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(flyoutTimer.current), []);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const restoreSidebarFocus = useRef(false);
  useEffect(() => {
    if (!restoreSidebarFocus.current) return;
    restoreSidebarFocus.current = false;
    sidebarToggleRef.current?.focus();
  }, [sidebarMode]);

  function scheduleFlyoutClose(section: Section) {
    clearTimeout(flyoutTimer.current);
    flyoutTimer.current = setTimeout(() => {
      setSidebarFlyout((current) => current?.section === section && !current.pinned ? null : current);
    }, 220);
  }
  const [collapsedSection, setCollapsedSection] = useState<Section | null>(null);
  const statsView = statisticsView(route.get('view'));
  const warehouseView = (WAREHOUSE_NAV.some((item) => item.key === route.get('view')) ? route.get('view') : 'balances') as WarehouseView;
  const requestedMenuView = route.get('view') === 'ingredientCategories' ? 'categories' : route.get('view');
  const menuView = MENU_NAV.find((item) => item.key === requestedMenuView)?.key ?? 'goods';
  const financeView = financeNav.find(({ key }) => key === route.get('view'))?.key ?? financeNav[0]?.key;
  const staffView = personnelNav.find(({ key }) => key === route.get('view'))?.key ?? 'employees';
  const staffTab = route.get('view') === 'waiter-report' ? 'waiter-orders' : 'employees';
  const settingsTab = SETTINGS_NAV.find(({ key }) => key === route.get('view')) ?? SETTINGS_NAV[0];
  const settingsView = settingsTab.key;
  const posterWorkspace = ['menu', 'warehouse', 'finance', 'staff'].includes(section) || (section === 'settings' && settingsView === 'taxes');
  function setStatsView(view: StatisticsView) {
    const next = new URLSearchParams({ section: 'stats', view });
    if (section === 'stats') {
      for (const key of ['statsPeriod', 'statsFrom', 'statsTo']) {
        const value = route.get(key);
        if (value) next.set(key, value);
      }
    }
    setRoute(next);
  }
  function setWarehouseView(view: WarehouseView) { setRoute({ section: 'warehouse', view }); }
  function setMenuView(view: MenuView) { setRoute({ section: 'menu', view }); }
  const edgeSwipe = useRef<{ x: number; y: number } | null>(null);
  const drawerPull = useRef<{ x: number; y: number } | null>(null);

  // Если текущий раздел стал недоступен (право отозвали) — уходим на первый доступный.
  useEffect(() => {
    if (profileOpen) return;
    if (section === 'finance' && isAdmin && financeAccess.isPending) return;
    if (sections.length > 0 && !sections.some((s) => s.key === section)) {
      setSection(sections[0].key);
    } else if (legacyStations) {
      const next = new URLSearchParams(route);
      next.set('section', 'staff');
      setRoute(next, { replace: true });
    }
  }, [sections, section, isAdmin, financeAccess.isPending, legacyStations, profileOpen, route, setRoute]);

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
    void qc.invalidateQueries({ queryKey: taxReportKey });
    if (order.status === 'paid' || order.status === 'cancelled') {
      void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'staff', 'shift-report'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'staff', 'waiter-report'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'staff', 'waiter-orders-report'] });
    }
    applyOrderStatusToCache(qc, order);
    qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    qc.invalidateQueries({ queryKey: ['admin', 'tables'] });
    invalidateReceipts();
  });
  useSocketEvent('fiscal_receipt_updated', () => {
    void qc.invalidateQueries({ queryKey: taxReportKey });
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
    qc.invalidateQueries({ queryKey: ['admin', 'category-trash'] });
    qc.invalidateQueries({ queryKey: ['admin', 'recipe-trash'] });
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
    if (!canHandlePrintRequests) return;
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

  function openProfile() {
    if (!profileOpen) setRoute({ section: 'profile' });
    setMobileNav(false);
  }

  function go(s: Section) {
    setCollapsedSection(null);
    if (s !== section || route.has('editor')) setSection(s);
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
    ? statsView === 'sales' ? 'Статистика продаж' : STATISTICS_NAV.find((item) => item.key === statsView)?.label
    : section === 'warehouse'
      ? WAREHOUSE_NAV.find((item) => item.key === warehouseView)?.label
      : section === 'menu' ? MENU_NAV.find((item) => item.key === menuView)?.label
        : section === 'finance' ? financeNav.find(({ key }) => key === financeView)?.label
          : section === 'staff' ? personnelNav.find(({ key }) => key === staffView)?.label
            : section === 'requests' ? requestsView?.label
            : section === 'tables' && route.get('view') === 'map' ? 'Карта зала'
              : section === 'settings' ? settingsView === 'general' ? 'Общие настройки' : settingsTab.label : undefined;
  const pageTitle = profileOpen ? t('Личный кабинет') : current ? t(currentViewLabel ?? current.label) : '';
  const scrollOrdersHeader = !profileOpen && section === 'orders' && canSection('orders');
  useEffect(() => {
    const previous = document.title;
    document.title = pageTitle ? `${pageTitle} · EDU POS` : 'EDU POS';
    return () => { document.title = previous; };
  }, [pageTitle]);

  const sidebarToggleLabel = SIDEBAR_TOGGLE_LABELS[sidebarMode];
  const sidebarToggle = (
    <button
      ref={sidebarToggleRef}
      type="button"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-background hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      aria-label={sidebarToggleLabel}
      title={sidebarToggleLabel}
      aria-controls="desktop-sidebar"
      aria-expanded={sidebarMode !== 'hidden'}
      onClick={() => {
        restoreSidebarFocus.current = true;
        setSidebarFlyout(null);
        setSidebarMode((mode) => NEXT_SIDEBAR_MODE[mode]);
      }}
    >
      <svg key={sidebarMode} className="workspace-sidebar-toggle-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="3" y="4.5" width="18" height="15" rx="3" />
        {sidebarMode !== 'hidden' && <path d={sidebarMode === 'compact' ? 'M7 5v14' : 'M10 5v14'} />}
      </svg>
    </button>
  );

  const renderSidebar = (variant: 'desktop' | 'mobile') => {
    const compact = variant === 'desktop' && sidebarMode !== 'expanded';
    return <aside className={`workspace-sidebar flex h-full shrink-0 flex-col border-r border-border bg-white ${variant === 'desktop' ? 'w-full' : 'w-52'}`}>
      <div className={`workspace-brand workspace-enter flex h-16 shrink-0 items-center gap-2 ${compact ? 'justify-center' : 'justify-between px-5'}`}>
        {!compact && <BrandLogo />}
        {variant === 'desktop' && sidebarMode !== 'hidden' && sidebarToggle}
      </div>
      <nav aria-label={t('Разделы')} className={`workspace-nav workspace-stagger min-h-0 flex-1 space-y-1 overflow-y-auto py-2 ${compact ? 'no-scrollbar px-2' : 'app-scrollbar-subtle px-3'}`}>
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
                ? MENU_NAV.filter((item) => item.key === 'foodCost'
                  ? canSection('warehouse') && can('actions.warehouseCosts')
                  : !['preparations', 'ingredients'].includes(item.key) || canSection('warehouse'))
                : s.key === 'stats' ? STATISTICS_NAV
                  : s.key === 'finance' ? financeNav : s.key === 'staff' ? personnelNav
                    : s.key === 'requests' ? requestsNav : s.key === 'settings' ? SETTINGS_NAV : [];
          const currentView = s.key === 'warehouse' ? warehouseView
            : s.key === 'menu' ? menuView : s.key === 'stats' ? statsView
              : s.key === 'finance' ? financeView : s.key === 'settings' ? settingsView : s.key === 'requests' ? requestsView?.key : staffView;
          const hasChildren = children.length > 0;
          const expanded = hasChildren && active && collapsedSection !== s.key;
          const selectedSection = active && !hasChildren;
          const childrenId = `workspace-${variant}-${s.key}-children`;
          const flyout = compact && sidebarFlyout?.section === s.key ? sidebarFlyout : null;
          function openView(view: string) {
            if (!active || view !== currentView || route.has('editor')) {
              if (s.key === 'warehouse') setWarehouseView(view as WarehouseView);
              else if (s.key === 'menu') setMenuView(view as MenuView);
              else if (s.key === 'stats') setStatsView(view as StatisticsView);
              else setRoute({ section: s.key, view });
            }
            setMobileNav(false);
            setSidebarFlyout(null);
            flyout?.anchor.focus();
          }
          if (compact) return (
            <div key={s.key}>
              <button type="button" aria-label={t(s.label)} title={t(s.label)}
                aria-expanded={hasChildren ? !!flyout : undefined}
                aria-controls={flyout ? childrenId : undefined}
                aria-current={active ? 'page' : undefined}
                className={`workspace-nav-section grid h-10 w-full place-items-center rounded-xl transition-colors ${active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background hover:text-text-primary'}`}
                onPointerEnter={(event) => {
                  if (!hasChildren || event.pointerType !== 'mouse') return;
                  clearTimeout(flyoutTimer.current);
                  const anchor = event.currentTarget;
                  setSidebarFlyout((current) => current?.section === s.key ? current : { section: s.key, anchor, pinned: false });
                }}
                onPointerLeave={(event) => {
                  if (event.pointerType === 'mouse' && flyout && !flyout.pinned) scheduleFlyoutClose(s.key);
                }}
                onClick={(event) => {
                  clearTimeout(flyoutTimer.current);
                  if (hasChildren) setSidebarFlyout(flyout?.pinned ? null : { section: s.key, anchor: event.currentTarget, pinned: true });
                  else go(s.key);
                }}>
                <span className="workspace-nav-label"><Icon /></span>
              </button>
              {flyout && <SidebarFlyout id={childrenId} label={t(s.label)} anchor={flyout.anchor}
                focusOnOpen={flyout.pinned} onClose={() => setSidebarFlyout(null)}
                onPointerEnter={() => clearTimeout(flyoutTimer.current)}
                onPointerLeave={() => { if (!flyout.pinned) scheduleFlyoutClose(s.key); }}>
                {children.map((item) => {
                  const selected = active && currentView === item.key;
                  return <button key={item.key} type="button" aria-current={selected ? 'page' : undefined}
                    className={`workspace-nav-child block w-full rounded-lg px-3 py-2.5 text-left text-sm leading-5 ${selected ? 'bg-primary/10 font-medium text-primary' : 'text-text-secondary hover:bg-background hover:text-text-primary'}`}
                    onClick={() => openView(item.key)}>
                    <span className="workspace-nav-label">{t(item.label)}</span>
                  </button>;
                })}
              </SidebarFlyout>}
            </div>
          );
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
                className={`workspace-nav-section flex w-full items-center rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors ${selectedSection ? 'bg-primary text-white' : 'text-text-secondary hover:bg-background hover:text-text-primary'}`}
              >
                <span className="workspace-nav-label items-center gap-3">
                  <Icon />
                  {t(s.label)}
                </span>
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
                            onClick={() => openView(item.key)}
                            className={`workspace-nav-child block w-full rounded-lg py-2 pl-[34px] pr-2 text-left text-sm leading-[21px] transition-colors ${selected ? 'bg-primary font-medium text-white' : 'text-text-secondary hover:bg-background hover:text-text-primary'}`}
                          >
                            <span className="workspace-nav-label">{t(item.label)}</span>
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
      {!compact && <WorkspaceLinks current="admin" />}
      <SidebarProfile key={variant === 'desktop' ? sidebarMode : 'mobile'} name={user?.name}
        onOpenProfile={openProfile} onLogout={onLogout} compact={compact} />
    </aside>;
  };

  const workspaceHeader = (
    <header className={`workspace-header flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 sm:flex-nowrap border-b border-border bg-white px-4 py-3 lg:px-6 ${scrollOrdersHeader ? 'sticky left-0' : ''}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          className="-ml-1 shrink-0 rounded-lg p-1.5 text-text-secondary hover:bg-background lg:hidden"
          onClick={() => setMobileNav(true)}
          aria-label="Меню"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {sidebarMode === 'hidden' && <div className="hidden shrink-0 items-center gap-2 border-r border-border pr-3 lg:flex">
          <BrandLogo />
          {sidebarToggle}
        </div>}
        <WorkspaceTitleSlot><h1 key={pageTitle} className="workspace-enter text-xl font-semibold text-text-primary lg:text-2xl">
          {pageTitle}
        </h1></WorkspaceTitleSlot>
      </div>
      <div className="contents sm:flex sm:items-center sm:gap-3">
        <WorkspaceActionsSlot className="order-last basis-full empty:hidden sm:order-none sm:basis-auto" />
        <ConnectionStatus />
      </div>
    </header>
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
      <div id="desktop-sidebar" data-mode={sidebarMode} aria-hidden={sidebarMode === 'hidden' || undefined}
        ref={(element) => { if (element) element.inert = sidebarMode === 'hidden'; }}
        className="workspace-desktop-sidebar hidden shrink-0 lg:block">
        {renderSidebar('desktop')}
      </div>

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
        {!scrollOrdersHeader && workspaceHeader}
        <main
          className={`workspace-main app-scrollbar-subtle flex-1 ${scrollOrdersHeader ? 'orders-workspace overflow-auto' : 'overflow-y-auto overflow-x-hidden p-4 lg:p-6'} ${posterWorkspace ? 'poster-workspace' : ''} ${['receipts', 'tables', 'menu', 'staff'].includes(section) ? 'pt-2 lg:pt-3' : ''}`}
        >
          {scrollOrdersHeader && workspaceHeader}
          {profileOpen ? <AdminProfilePage /> : !current ? (
            <NoAccessScreen />
          ) : (
            <>
              {section === 'stats' && canSection('statistics') && (statsView === 'taxes' ? <TaxReportPage /> : <StatisticsPage view={statsView} />)}
              {section === 'orders' && canSection('orders') && <OrdersPage />}
              {section === 'requests' && (requestsView?.key === 'refunds' ? <RefundQueuePage />
                : requestsView?.key === 'cancellations' ? <ItemCancellationQueuePage /> : <NoAccessScreen />)}
              {section === 'receipts' && canHandlePrintRequests && <ReceiptPrintsPage />}
              {section === 'tables' && canSection('tables') && <TablesPage />}
              {section === 'menu' && canSection('menu') && <>
                {menuView === 'categories' ? <MenuCategoryWorkspace /> : <MenuPage view={menuView} />}
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
                {staffView === 'shifts' && <WorkShiftsPage />}
              </>}
              {section === 'audit' && canSection('journal') && <AuditPage />}
              {section === 'settings' && canSection('settings') && <>
                {settingsView === 'general' && <SettingsPage />}
                {settingsView === 'receipt' && <ReceiptSettingsPage />}
                {settingsView === 'fiscal' && <FiscalSettingsPage />}
                {settingsView === 'taxes' && <TaxesPage />}
              </>}
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
