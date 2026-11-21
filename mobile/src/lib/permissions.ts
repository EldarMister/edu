import type { ActionKey, EmployeePermissions, Role, SectionKey } from '@/types';

export const SECTION_KEYS: SectionKey[] = [
  'statistics',
  'finance',
  'orders',
  'tables',
  'menu',
  'warehouse',
  'staff',
  'journal',
  'paymentReconciliation',
  'checks',
  'settings',
];

export const ACTION_KEYS: ActionKey[] = [
  'editMenu',
  'refundChecks',
  'exportReports',
  'closeShift',
  'financeCashShifts',
  'acceptOrderPayments', 'printReceipts', 'requestReceiptPrints',
  'createDeliveryOrders',
  'manageStaff',
  'editPermissions',
  'warehouseReceive', 'warehouseTransfer', 'warehouseWriteoff', 'warehouseCount', 'warehouseApprove',
  'warehouseRecipes', 'warehouseProduce', 'warehouseCosts', 'warehouseReports', 'warehouseSettings',
];

export const READ_ONLY_SECTION_KEYS: SectionKey[] = ['finance', 'orders', 'tables', 'menu', 'warehouse', 'staff', 'checks', 'settings'];
export const SECTION_WRITE_ACTIONS: Partial<Record<SectionKey, ActionKey[]>> = {
  menu: ['editMenu'], staff: ['manageStaff'], checks: ['refundChecks'],
  warehouse: ['warehouseReceive', 'warehouseTransfer', 'warehouseWriteoff', 'warehouseCount', 'warehouseApprove',
    'warehouseRecipes', 'warehouseProduce', 'warehouseSettings'],
};

/** Подписи разделов — как в референсе. */
export const SECTION_LABELS: Record<SectionKey, string> = {
  statistics: 'Статистика',
  finance: 'Финансы',
  orders: 'Заказы',
  tables: 'Столы',
  menu: 'Меню',
  warehouse: 'Склад',
  staff: 'Персонал',
  journal: 'Журнал',
  paymentReconciliation: 'Сверка оплат',
  checks: 'Чеки / Оплата',
  settings: 'Настройки',
};

/** Подписи дополнительных прав — как в референсе. */
export const ACTION_LABELS: Record<ActionKey, string> = {
  editMenu: 'Редактировать меню',
  refundChecks: 'Возврат / отмена чеков',
  exportReports: 'Экспорт отчётов',
  closeShift: 'Закрывать рабочие смены сотрудников',
  financeCashShifts: 'Кассовые смены: открытие и закрытие',
  acceptOrderPayments: 'Принимать оплату',
  printReceipts: 'Печатать свои чеки и чеки по заявкам',
  requestReceiptPrints: 'Отправлять заявки на печать',
  createDeliveryOrders: 'Оформлять доставку',
  manageStaff: 'Управление сотрудниками',
  editPermissions: 'Редактирование прав доступа',
  warehouseReceive: 'Склад: приход и возврат поставщику',
  warehouseTransfer: 'Склад: перемещения',
  warehouseWriteoff: 'Склад: списания',
  warehouseCount: 'Склад: подсчёт остатков',
  warehouseApprove: 'Склад: проведение и сторнирование документов',
  warehouseRecipes: 'Склад: редактирование техкарт',
  warehouseProduce: 'Склад: производство заготовок',
  warehouseCosts: 'Склад: просмотр себестоимости',
  warehouseReports: 'Склад: отчёты',
  warehouseSettings: 'Склад: настройки и справочник',
};

const allSections = (v: boolean): Record<SectionKey, boolean> =>
  SECTION_KEYS.reduce((a, k) => ((a[k] = v), a), {} as Record<SectionKey, boolean>);
const allActions = (v: boolean): Record<ActionKey, boolean> =>
  ACTION_KEYS.reduce((a, k) => ((a[k] = v), a), {} as Record<ActionKey, boolean>);

const terminalDefaults = { acceptOrderPayments: true, printReceipts: false, requestReceiptPrints: true };

/** Дефолты по роли (зеркало бэкенда) — на случай, если permissions ещё не пришли. */
export function getDefaultPermissionsByRole(role: Role): EmployeePermissions {
  switch (role) {
    case 'OWNER':
      return { sections: allSections(true), actions: allActions(true), terminalAccess: true, adminAccess: true };
    case 'ADMIN':
      return {
        terminalAccess: false, adminAccess: true,
        sections: {
          statistics: false,
          finance: false,
          orders: true,
          tables: true,
          menu: true,
          warehouse: true,
          staff: true,
          journal: false,
          paymentReconciliation: false,
          checks: true,
          settings: false,
        },
        actions: {
          editMenu: true,
          refundChecks: true,
          exportReports: true,
          closeShift: true,
          financeCashShifts: false,
          ...terminalDefaults,
          createDeliveryOrders: false,
          manageStaff: false,
          editPermissions: false,
          warehouseReceive: true, warehouseTransfer: true, warehouseWriteoff: true, warehouseCount: true,
          warehouseApprove: false, warehouseRecipes: true, warehouseProduce: true, warehouseCosts: true,
          warehouseReports: true, warehouseSettings: false,
        },
      };
    case 'WAITER':
      return { sections: { ...allSections(false), tables: true, menu: true, orders: true }, actions: { ...allActions(false), ...terminalDefaults }, terminalAccess: true, adminAccess: false };
    case 'KITCHEN':
    case 'BAR':
      return { sections: { ...allSections(false), orders: true }, actions: { ...allActions(false), ...terminalDefaults }, terminalAccess: false, adminAccess: false };
    default:
      return { sections: allSections(false), actions: allActions(false) };
  }
}

function pick<T extends string>(keys: T[], src: unknown, fallback: Record<T, boolean>): Record<T, boolean> {
  const out = { ...fallback };
  if (src && typeof src === 'object') {
    for (const k of keys) {
      const v = (src as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

/** Итоговые права: дефолты по роли + сохранённое. Владелец — всегда полный доступ. */
export function resolvePermissions(role: Role, stored: unknown): EmployeePermissions {
  const def = getDefaultPermissionsByRole(role);
  if (role === 'OWNER') return def;
  if (!stored || typeof stored !== 'object') return def;
  const s = stored as { sections?: unknown; actions?: unknown; readOnlySections?: unknown; terminalAccess?: unknown; adminAccess?: unknown; workShiftRequired?: unknown };
  const permissions: EmployeePermissions = {
    terminalAccess: typeof s.terminalAccess === 'boolean' ? s.terminalAccess : def.terminalAccess,
    adminAccess: typeof s.adminAccess === 'boolean' ? s.adminAccess : def.adminAccess,
    sections: pick(SECTION_KEYS, s.sections, def.sections),
    actions: pick(ACTION_KEYS, s.actions, def.actions),
  };
  if (typeof s.workShiftRequired === 'boolean') permissions.workShiftRequired = s.workShiftRequired;
  if (Array.isArray(s.readOnlySections)) {
    const selected = s.readOnlySections;
    permissions.readOnlySections = READ_ONLY_SECTION_KEYS.filter((key) => permissions.sections[key] && selected.includes(key));
    for (const section of permissions.readOnlySections) {
      for (const action of SECTION_WRITE_ACTIONS[section] ?? []) permissions.actions[action] = false;
    }
  }
  return permissions;
}

/** Проверка одного права: "sections.warehouse" / "actions.editMenu". */
export function hasPermission(perms: EmployeePermissions, path: string): boolean {
  const [group, key] = path.split('.') as ['sections' | 'actions', string];
  const bag = perms[group] as Record<string, boolean> | undefined;
  return !!bag && bag[key] === true;
}
