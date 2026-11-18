import { Role } from '@prisma/client';

/**
 * Права доступа сотрудника: к разделам (sections) и к действиям (actions).
 * Хранятся в StaffPosition.permissions. Пусто/невалидно — берём дефолты по роли.
 */
export const SECTION_KEYS = [
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
  'finance',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const ACTION_KEYS = [
  'editMenu',
  'refundChecks',
  'exportReports',
  'closeShift',
  'financeCashShifts',
  'manageStaff',
  'editPermissions',
  'warehouseReceive',
  'warehouseTransfer',
  'warehouseWriteoff',
  'warehouseCount',
  'warehouseApprove',
  'warehouseRecipes',
  'warehouseProduce',
  'warehouseCosts',
  'warehouseReports',
  'warehouseSettings',
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export interface EmployeePermissions {
  sections: Record<SectionKey, boolean>;
  actions: Record<ActionKey, boolean>;
  readOnlySections?: SectionKey[];
  terminalAccess?: boolean;
  adminAccess?: boolean;
  workShiftRequired?: boolean;
}

export const READ_ONLY_SECTION_KEYS: SectionKey[] = ['orders', 'tables', 'menu', 'warehouse', 'staff', 'checks', 'settings', 'finance'];
export const SECTION_WRITE_ACTIONS: Partial<Record<SectionKey, ActionKey[]>> = {
  menu: ['editMenu'], staff: ['manageStaff'], checks: ['refundChecks'],
  warehouse: ['warehouseReceive', 'warehouseTransfer', 'warehouseWriteoff', 'warehouseCount', 'warehouseApprove',
    'warehouseRecipes', 'warehouseProduce', 'warehouseSettings'],
};

const allSections = (value: boolean): Record<SectionKey, boolean> =>
  SECTION_KEYS.reduce((acc, k) => ((acc[k] = value), acc), {} as Record<SectionKey, boolean>);
const allActions = (value: boolean): Record<ActionKey, boolean> =>
  ACTION_KEYS.reduce((acc, k) => ((acc[k] = value), acc), {} as Record<ActionKey, boolean>);

/**
 * Дефолтные права по роли. Подобраны так, чтобы НЕ менять текущее поведение:
 * админ по умолчанию видит рабочие разделы, владелец — все разделы.
 */
export function getDefaultPermissionsByRole(role: Role): EmployeePermissions {
  switch (role) {
    case Role.OWNER:
      return { sections: allSections(true), actions: allActions(true), terminalAccess: true, adminAccess: true };
    case Role.ADMIN:
      return {
        terminalAccess: false, adminAccess: true,
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
          finance: false,
        },
        actions: {
          editMenu: true,
          refundChecks: true,
          exportReports: true,
          closeShift: true,
          financeCashShifts: false,
          manageStaff: false,
          editPermissions: false,
          warehouseReceive: true,
          warehouseTransfer: true,
          warehouseWriteoff: true,
          warehouseCount: true,
          warehouseApprove: false,
          warehouseRecipes: true,
          warehouseProduce: true,
          warehouseCosts: true,
          warehouseReports: true,
          warehouseSettings: false,
        },
      };
    case Role.WAITER:
      return {
        terminalAccess: true, adminAccess: false,
        sections: { ...allSections(false), tables: true, menu: true, orders: true },
        actions: allActions(false),
      };
    case Role.KITCHEN:
      return {
        terminalAccess: false, adminAccess: false,
        sections: { ...allSections(false), orders: true },
        actions: allActions(false),
      };
    case Role.BAR:
      return {
        terminalAccess: false, adminAccess: false,
        sections: { ...allSections(false), orders: true },
        actions: allActions(false),
      };
    default:
      return { sections: allSections(false), actions: allActions(false), terminalAccess: false, adminAccess: false };
  }
}

/** Достать только известные boolean-ключи из произвольного объекта. */
function pick<T extends string>(keys: readonly T[], src: unknown, fallback: Record<T, boolean>): Record<T, boolean> {
  const out = { ...fallback };
  if (src && typeof src === 'object') {
    for (const k of keys) {
      const v = (src as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

/**
 * Итоговые права: дефолты по роли, поверх которых накладывается сохранённое
 * (только известные ключи). Владелец всегда получает полный доступ.
 */
export function resolvePermissions(role: Role, stored: unknown): EmployeePermissions {
  const def = getDefaultPermissionsByRole(role);
  if (role === Role.OWNER) return def;
  if (!stored || typeof stored !== 'object') return def;
  const s = stored as { sections?: unknown; actions?: unknown; readOnlySections?: unknown; terminalAccess?: unknown; adminAccess?: unknown; workShiftRequired?: unknown };
  const permissions: EmployeePermissions = {
    sections: pick(SECTION_KEYS, s.sections, def.sections),
    actions: pick(ACTION_KEYS, s.actions, def.actions),
    terminalAccess: typeof s.terminalAccess === 'boolean' ? s.terminalAccess : def.terminalAccess,
    adminAccess: typeof s.adminAccess === 'boolean' ? s.adminAccess : def.adminAccess,
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

/** Resolve the assigned position once; raw employee overrides are only a legacy fallback. */
export function resolveUserPermissions(user: {
  role: Role | string; permissions?: unknown;
  position?: { role: Role | string; permissions: unknown } | null;
}): EmployeePermissions {
  return resolvePermissions(user.role as Role, user.position?.role === user.role ? user.position.permissions : user.permissions);
}

/** Нормализовать входные данные перед сохранением (whitelist ключей, только boolean). */
export function sanitizePermissionsInput(role: Role, input: unknown): EmployeePermissions {
  return resolvePermissions(role, input);
}

/** Проверка одного права по строке вида "sections.warehouse" / "actions.editMenu". */
export function hasPermission(perms: EmployeePermissions, path: string): boolean {
  const [group, key] = path.split('.') as ['sections' | 'actions', string];
  const bag = perms[group] as Record<string, boolean> | undefined;
  return !!bag && bag[key] === true;
}
