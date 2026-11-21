export const FINANCE_NAV = [
  { key: 'transactions', label: 'Транзакции' },
  { key: 'cashFlow', label: 'Движение денег' },
  { key: 'cashShifts', label: 'Кассовые смены' },
  { key: 'cashHandover', label: 'Сдача наличных' },
  { key: 'payroll', label: 'Зарплата' },
  { key: 'accounts', label: 'Счета' },
  { key: 'categories', label: 'Категории' },
] as const;

export const PERSONNEL_NAV = [
  { key: 'employees', label: 'Сотрудники' },
  { key: 'positions', label: 'Должности' },
  { key: 'stations', label: 'Станции' },
] as const;

export type FinanceView = typeof FINANCE_NAV[number]['key'];
