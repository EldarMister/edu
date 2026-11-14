export type WarehouseView =
  | 'balances'
  | 'supplies'
  | 'processing'
  | 'transfers'
  | 'writeoffs'
  | 'movement'
  | 'inventory'
  | 'suppliers'
  | 'locations'
  | 'packages'
  | 'production';
export type MenuView = 'goods' | 'recipes' | 'preparations' | 'ingredients' | 'categories' | 'ingredientCategories' | 'stations';
export const WAREHOUSE_NAV: { key: WarehouseView; label: string; permission?: string; costs?: boolean }[] = [
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
export const MENU_NAV: { key: MenuView; label: string }[] = [
  { key: 'goods', label: 'Товары' },
  { key: 'recipes', label: 'Техкарты' },
  { key: 'preparations', label: 'Полуфабрикаты' },
  { key: 'ingredients', label: 'Ингредиенты' },
  { key: 'categories', label: 'Категории товаров и техкарт' },
  { key: 'ingredientCategories', label: 'Категории ингредиентов' },
  { key: 'stations', label: 'Цехи' },
];

export function warehouseViewInUse(view: WarehouseView, warehouseCount: number, policy?: {
  warehouseProductionEnabled: boolean; warehouseProcessingEnabled: boolean;
  productionInUse: boolean; processingInUse: boolean;
}) {
  if (view === 'transfers') return warehouseCount > 1;
  if (view === 'production') return !!(policy?.warehouseProductionEnabled || policy?.productionInUse);
  if (view === 'processing') return !!(policy?.warehouseProcessingEnabled || policy?.processingInUse);
  return true;
}
