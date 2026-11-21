export const STATISTICS_NAV = [
  { key: 'overview', label: 'Обзор' },
  { key: 'sales', label: 'Продажи' },
  { key: 'products', label: 'Товары' },
  { key: 'staff', label: 'Сотрудники' },
  { key: 'categories', label: 'Категории' },
  { key: 'payments', label: 'Оплаты' },
  { key: 'taxes', label: 'Налоги' },
] as const;

export type StatisticsView = typeof STATISTICS_NAV[number]['key'];

export function statisticsView(value: string | null): StatisticsView {
  return STATISTICS_NAV.find(({ key }) => key === value)?.key ?? 'overview';
}
