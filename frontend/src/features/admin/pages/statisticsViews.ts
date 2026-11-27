export const STATISTICS_LABELS = {
  overview: 'Обзор',
  sales: 'Продажи',
  products: 'Товары',
  staff: 'Сотрудники',
  categories: 'Категории',
  payments: 'Оплаты',
  taxes: 'Налоги',
} as const;

export type StatisticsView = keyof typeof STATISTICS_LABELS;

export const STATISTICS_NAV = [
  { key: 'overview', label: 'Обзор', reports: [] },
  { key: 'sales', label: 'Продажи', reports: ['sales', 'payments', 'taxes'] },
  { key: 'products', label: 'Ассортимент', reports: ['products', 'categories'] },
  { key: 'staff', label: 'Сотрудники', reports: [] },
] as const satisfies readonly { key: StatisticsView; label: string; reports: readonly StatisticsView[] }[];

export function statisticsView(value: string | null): StatisticsView {
  return Object.keys(STATISTICS_LABELS).find((key): key is StatisticsView => key === value) ?? 'overview';
}

export function statisticsGroup(view: StatisticsView) {
  return STATISTICS_NAV.find(({ key, reports }) => key === view || reports.some((report) => report === view))
    ?? STATISTICS_NAV[0];
}
