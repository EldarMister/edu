import type { ActionKey, Role, SectionKey } from '@/types';
import { resolvePermissions, SECTION_KEYS, SECTION_LABELS } from '@/lib/permissions';

export const SECTION_ACTIONS: Partial<Record<SectionKey, ActionKey[]>> = {
  menu: ['editMenu'],
  warehouse: ['warehouseReceive', 'warehouseTransfer', 'warehouseWriteoff', 'warehouseCount', 'warehouseApprove',
    'warehouseRecipes', 'warehouseProduce', 'warehouseCosts', 'warehouseReports', 'warehouseSettings'],
  staff: ['manageStaff'],
  checks: ['refundChecks'],
};

export const SECTION_HELP: Partial<Record<SectionKey, string>> = {
  statistics: 'Отчёты о продажах и работе заведения.',
  finance: 'Счета, движение денег, кассовые смены и зарплата.',
  orders: 'Заказы и работа с ними в панели управления.',
  tables: 'План зала, столы и управление посадкой.',
  menu: 'Просмотр каталога. Изменения разрешаются отдельно.',
  warehouse: 'Остатки и документы. Действия и просмотр себестоимости разрешаются отдельно.',
  staff: 'Список сотрудников и смены. Управление разрешается отдельно.',
  journal: 'История действий сотрудников.',
  checks: 'Работа с оплатой и чеками.',
  settings: 'Просмотр и изменение настроек заведения.',
};

export function positionAccessSummary(role: Role, stored?: unknown) {
  const permissions = resolvePermissions(role, stored);
  if (role === 'OWNER') return 'Полный доступ';
  const parts = permissions.terminalAccess ? ['Касса'] : [];
  if (role === 'KITCHEN' || role === 'BAR') parts.push(role === 'KITCHEN' ? 'Экран кухни' : 'Экран бара');
  if (permissions.adminAccess) parts.push(...SECTION_KEYS.filter((key) => permissions.sections[key]).map((key) => SECTION_LABELS[key]
    + (permissions.readOnlySections?.includes(key) ? ' (просмотр)' : '')));
  else if ((role === 'KITCHEN' || role === 'BAR') && permissions.sections.warehouse) parts.push('Техкарты и остатки');
  return parts.join(', ') || 'Доступ не назначен';
}
