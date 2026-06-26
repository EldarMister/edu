import { Role } from '@prisma/client';

/**
 * Права доступа сотрудника: к разделам (sections) и к действиям (actions).
 * Хранятся в User.permissions (Json?). Пусто/невалидно — берём дефолты по роли.
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
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const ACTION_KEYS = [
  'editMenu',
  'refundChecks',
  'exportReports',
  'closeShift',
  'manageStaff',
  'editPermissions',
] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export interface EmployeePermissions {
  sections: Record<SectionKey, boolean>;
  actions: Record<ActionKey, boolean>;
}

const allSections = (value: boolean): Record<SectionKey, boolean> =>
  SECTION_KEYS.reduce((acc, k) => ((acc[k] = value), acc), {} as Record<SectionKey, boolean>);
const allActions = (value: boolean): Record<ActionKey, boolean> =>
  ACTION_KEYS.reduce((acc, k) => ((acc[k] = value), acc), {} as Record<ActionKey, boolean>);

/**
 * Дефолтные права по роли. Подобраны так, чтобы НЕ менять текущее поведение:
 * админ по умолчанию видит ровно те разделы, что и раньше (owner-only скрыты),
 * владелец — всё. Владелец может расширить права админа вручную через модалку.
 */
export function getDefaultPermissionsByRole(role: Role): EmployeePermissions {
  switch (role) {
    case Role.OWNER:
      return { sections: allSections(true), actions: allActions(true) };
    case Role.ADMIN:
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
    case Role.WAITER:
      return {
        sections: { ...allSections(false), tables: true, menu: true, orders: true },
        actions: allActions(false),
      };
    case Role.KITCHEN:
      return {
        sections: { ...allSections(false), orders: true },
        actions: allActions(false),
      };
    case Role.BAR:
      return {
        sections: { ...allSections(false), orders: true },
        actions: allActions(false),
      };
    default:
      return { sections: allSections(false), actions: allActions(false) };
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
  const s = stored as { sections?: unknown; actions?: unknown };
  return {
    sections: pick(SECTION_KEYS, s.sections, def.sections),
    actions: pick(ACTION_KEYS, s.actions, def.actions),
  };
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
