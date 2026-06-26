import type { ActionKey, EmployeePermissions, Role, SectionKey } from '@/types';

export const SECTION_KEYS: SectionKey[] = [
  'statistics',
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
  'manageStaff',
  'editPermissions',
];

/** Подписи разделов — как в референсе. */
export const SECTION_LABELS: Record<SectionKey, string> = {
  statistics: 'Статистика',
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
  closeShift: 'Закрытие смены',
  manageStaff: 'Управление сотрудниками',
  editPermissions: 'Редактирование прав доступа',
};

const allSections = (v: boolean): Record<SectionKey, boolean> =>
  SECTION_KEYS.reduce((a, k) => ((a[k] = v), a), {} as Record<SectionKey, boolean>);
const allActions = (v: boolean): Record<ActionKey, boolean> =>
  ACTION_KEYS.reduce((a, k) => ((a[k] = v), a), {} as Record<ActionKey, boolean>);

/** Дефолты по роли (зеркало бэкенда) — на случай, если permissions ещё не пришли. */
export function getDefaultPermissionsByRole(role: Role): EmployeePermissions {
  switch (role) {
    case 'OWNER':
      return { sections: allSections(true), actions: allActions(true) };
    case 'ADMIN':
      return {
        sections: {
          statistics: false,
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
          manageStaff: false,
          editPermissions: false,
        },
      };
    case 'WAITER':
      return { sections: { ...allSections(false), tables: true, menu: true, orders: true }, actions: allActions(false) };
    case 'KITCHEN':
    case 'BAR':
      return { sections: { ...allSections(false), orders: true }, actions: allActions(false) };
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
  const s = stored as { sections?: unknown; actions?: unknown };
  return {
    sections: pick(SECTION_KEYS, s.sections, def.sections),
    actions: pick(ACTION_KEYS, s.actions, def.actions),
  };
}

/** Проверка одного права: "sections.warehouse" / "actions.editMenu". */
export function hasPermission(perms: EmployeePermissions, path: string): boolean {
  const [group, key] = path.split('.') as ['sections' | 'actions', string];
  const bag = perms[group] as Record<string, boolean> | undefined;
  return !!bag && bag[key] === true;
}
