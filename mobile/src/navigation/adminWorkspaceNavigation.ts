import type { ActionKey } from '@/types';

export type AdminSection = 'stats' | 'orders' | 'requests' | 'receipts' | 'tables' | 'menu' | 'warehouse' | 'staff' | 'audit' | 'finance' | 'settings' | 'profile';
export type WarehouseView =
  | 'balances' | 'supplies' | 'processing' | 'transfers' | 'writeoffs' | 'movement'
  | 'inventory' | 'suppliers' | 'locations' | 'packages' | 'production';

export type MenuView = 'goods' | 'recipes' | 'preparations' | 'ingredients' | 'categories' | 'ingredientCategories';
export type StatisticsView = 'overview' | 'sales' | 'products' | 'staff' | 'categories' | 'payments' | 'taxes';

export type RequestView = 'refunds' | 'cancellations';

export type StaffView = 'employees' | 'shifts' | 'positions' | 'stations';

export type FinanceView = 'transactions' | 'cashFlow' | 'cashShifts' | 'cashHandover' | 'payroll' | 'accounts' | 'categories';

export interface CashHandoverFilter {
  date: string;
  employeeId: string;
}
export type SettingsView = 'general' | 'receipt' | 'fiscal' | 'taxes';

export type WorkspaceEntry =
  | { section: 'finance'; key: FinanceView; label: string }
  | { section: 'requests'; key: RequestView; label: string }
  | { section: 'settings'; key: SettingsView; label: string }
  | { section: 'warehouse'; key: WarehouseView; label: string }
  | { section: 'menu'; key: MenuView; label: string }
  | { section: 'stats'; key: StatisticsView; label: string }
  | { section: 'staff'; key: StaffView; label: string };

export const statisticsNavigation: Array<Extract<WorkspaceEntry, { section: 'stats' }>> = [
  { section: 'stats', key: 'overview', label: 'Обзор' },
  { section: 'stats', key: 'sales', label: 'Продажи' },
  { section: 'stats', key: 'products', label: 'Товары' },
  { section: 'stats', key: 'staff', label: 'Сотрудники' },
  { section: 'stats', key: 'categories', label: 'Категории' },
  { section: 'stats', key: 'payments', label: 'Оплаты' },
  { section: 'stats', key: 'taxes', label: 'Налоги' },
];

type WarehousePolicy = {
  warehouseProductionEnabled: boolean;
  warehouseProcessingEnabled: boolean;
  productionInUse: boolean;
  processingInUse: boolean;
};

const warehouseEntries: Array<{ key: WarehouseView; label: string; permission?: ActionKey; costs?: boolean }> = [
  { key: 'balances', label: 'Остатки' },
  { key: 'supplies', label: 'Поставки', permission: 'warehouseReceive', costs: true },
  { key: 'processing', label: 'Переработки', permission: 'warehouseProduce', costs: true },
  { key: 'transfers', label: 'Перемещения', permission: 'warehouseTransfer' },
  { key: 'writeoffs', label: 'Списания', permission: 'warehouseWriteoff' },
  { key: 'movement', label: 'Отчёт по движению', permission: 'warehouseReports', costs: true },
  { key: 'inventory', label: 'Инвентаризации', permission: 'warehouseCount' },
  { key: 'suppliers', label: 'Поставщики', permission: 'warehouseSettings' },
  { key: 'locations', label: 'Склады', permission: 'warehouseSettings' },
  { key: 'packages', label: 'Фасовки', permission: 'warehouseSettings' },
  { key: 'production', label: 'Производство', permission: 'warehouseProduce' },
];
export const requestsNavigation: Array<Extract<WorkspaceEntry, { section: 'requests' }>> = [
  { section: 'requests', key: 'refunds', label: 'Заявки на возврат' },
  { section: 'requests', key: 'cancellations', label: 'Отмена блюд' },
];
export const financeNavigation: Array<Extract<WorkspaceEntry, { section: 'finance' }>> = [
  { section: 'finance', key: 'transactions', label: 'Транзакции' },
  { section: 'finance', key: 'cashFlow', label: 'Движение денег' },
  { section: 'finance', key: 'cashShifts', label: 'Кассовые смены' },
  { section: 'finance', key: 'cashHandover', label: 'Сдача наличных' },
  { section: 'finance', key: 'payroll', label: 'Зарплата' },
  { section: 'finance', key: 'accounts', label: 'Счета' },
  { section: 'finance', key: 'categories', label: 'Категории' },
];
export const settingsNavigation: Array<Extract<WorkspaceEntry, { section: 'settings' }>> = [
  { section: 'settings', key: 'general', label: 'Общие' },
  { section: 'settings', key: 'receipt', label: 'Чек' },
  { section: 'settings', key: 'fiscal', label: 'ККМ' },
  { section: 'settings', key: 'taxes', label: 'Налоги' },
];

const staffEntries: Array<Extract<WorkspaceEntry, { section: 'staff' }>> = [
  { section: 'staff', key: 'employees', label: 'Сотрудники' },
  { section: 'staff', key: 'shifts', label: 'Смены' },
  { section: 'staff', key: 'positions', label: 'Должности' },
  { section: 'staff', key: 'stations', label: 'Станции' },
];

export function staffNavigation(isOwner: boolean, mayManageShifts = false) {
  return staffEntries.filter(({ key }) => (key !== 'positions' || isOwner) && (key !== 'shifts' || mayManageShifts));
}

export function resolveAdminSection(section: AdminSection | undefined, view: string | undefined): AdminSection | undefined {
  return section === 'menu' && view === 'stations' ? 'staff' : section;
}

const menuEntries: Array<{ key: MenuView; label: string; requiresWarehouse?: boolean }> = [
  { key: 'goods', label: 'Товары' },
  { key: 'recipes', label: 'Техкарты' },
  { key: 'preparations', label: 'Полуфабрикаты', requiresWarehouse: true },
  { key: 'ingredients', label: 'Ингредиенты', requiresWarehouse: true },
  { key: 'categories', label: 'Категории товаров и блюд' },
  { key: 'ingredientCategories', label: 'Категории ингредиентов', requiresWarehouse: true },
];

export function warehouseNavigation(canAction: (action: ActionKey) => boolean, warehouseCount: number, policy?: WarehousePolicy) {
  return warehouseEntries.filter(({ key, permission, costs }) => {
    if ((permission && !canAction(permission)) || (costs && !canAction('warehouseCosts'))) return false;
    if (key === 'transfers') return warehouseCount > 1;
    if (key === 'processing') return !!(policy?.warehouseProcessingEnabled || policy?.processingInUse);
    if (key === 'production') return !!(policy?.warehouseProductionEnabled || policy?.productionInUse);
    return true;
  }).map(({ key, label }) => ({ section: 'warehouse' as const, key, label }));
}

export function menuNavigation(canUseWarehouse: boolean) {
  return menuEntries.filter(({ requiresWarehouse }) => canUseWarehouse || !requiresWarehouse)
    .map(({ key, label }) => ({ section: 'menu' as const, key, label }));
}
