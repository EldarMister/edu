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

const allSections = (value: boolean): Record<SectionKey, boolean> =>
  SECTION_KEYS.reduce((acc, key) => {
    acc[key] = value;
    return acc;
  }, {} as Record<SectionKey, boolean>);

const allActions = (value: boolean): Record<ActionKey, boolean> =>
  ACTION_KEYS.reduce((acc, key) => {
    acc[key] = value;
    return acc;
  }, {} as Record<ActionKey, boolean>);

/** Дефолты по роли (зеркало PWA/бэкенда) — если permissions ещё не пришли. */
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
    for (const key of keys) {
      const value = (src as Record<string, unknown>)[key];
      if (typeof value === 'boolean') out[key] = value;
    }
  }
  return out;
}

/** Итоговые права: дефолты по роли + сохранённое. Владелец — всегда полный доступ. */
export function resolvePermissions(role: Role, stored: unknown): EmployeePermissions {
  const defaults = getDefaultPermissionsByRole(role);
  if (role === 'OWNER') return defaults;
  if (!stored || typeof stored !== 'object') return defaults;
  const saved = stored as { sections?: unknown; actions?: unknown };
  return {
    sections: pick(SECTION_KEYS, saved.sections, defaults.sections),
    actions: pick(ACTION_KEYS, saved.actions, defaults.actions),
  };
}

/** Проверка одного права: "sections.warehouse" / "actions.editMenu". */
export function hasPermission(perms: EmployeePermissions, path: string): boolean {
  const [group, key] = path.split('.') as ['sections' | 'actions', string];
  const bag = perms[group] as Record<string, boolean> | undefined;
  return !!bag && bag[key] === true;
}
