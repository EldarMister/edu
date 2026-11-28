import { Role } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';

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
  'acceptOrderPayments',
  'printReceipts',
  'requestReceiptPrints',
  'createDeliveryOrders',
  'viewAllOrders',
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
  ownerOperations?: OwnerOperations;
}

export const OWNER_OPERATION_KEYS = ['refunds', 'cancelOrders', 'cancelItems', 'printRequests'] as const;
export type OwnerOperation = (typeof OWNER_OPERATION_KEYS)[number];
export type OwnerOperations = Record<OwnerOperation, boolean>;
const defaultOwnerOperations: OwnerOperations = { refunds: true, cancelOrders: true, cancelItems: true, printRequests: true };

export function assertOwnerOperation(actor: { role?: string | null; identityRole?: string | null; permissions?: EmployeePermissions }, operation: OwnerOperation) {
  if ((actor.identityRole ?? actor.role) === Role.OWNER && actor.permissions?.ownerOperations?.[operation] === false) {
    throw new ForbiddenException('Действие отключено в настройках прав владельца');
  }
}

export type FixedWorkspace = 'admin' | 'terminal' | 'production';

export function fixedPositionWorkspace(role: Role, stored: unknown, isStarter = false): FixedWorkspace | null {
  if (role === Role.ADMIN && isStarter) return 'admin';
  if (!stored || typeof stored !== 'object' || !('fixedWorkspace' in stored)) return null;
  if (stored.fixedWorkspace === 'admin' && role === Role.ADMIN) return 'admin';
  if (stored.fixedWorkspace === 'terminal' && role === Role.WAITER) return 'terminal';
  if (stored.fixedWorkspace === 'production' && (role === Role.KITCHEN || role === Role.BAR)) return 'production';
  return null;
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

const terminalDefaults = { acceptOrderPayments: true, printReceipts: false, requestReceiptPrints: true };

/**
 * Дефолтные права по роли. Подобраны так, чтобы НЕ менять текущее поведение:
 * админ по умолчанию видит рабочие разделы, владелец — все разделы.
 */
export function getDefaultPermissionsByRole(role: Role): EmployeePermissions {
  switch (role) {
    case Role.OWNER:
      return { sections: allSections(true), actions: allActions(true), terminalAccess: true, adminAccess: true,
        ownerOperations: { ...defaultOwnerOperations } };
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
          ...terminalDefaults,
          createDeliveryOrders: false,
          viewAllOrders: false,
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
        actions: { ...allActions(false), ...terminalDefaults },
      };
    case Role.KITCHEN:
      return {
        terminalAccess: false, adminAccess: false,
        sections: { ...allSections(false), orders: true },
        actions: { ...allActions(false), ...terminalDefaults },
      };
    case Role.BAR:
      return {
        terminalAccess: false, adminAccess: false,
        sections: { ...allSections(false), orders: true },
        actions: { ...allActions(false), ...terminalDefaults },
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
 * Итоговые права: известные ключи накладываются на дефолты роли или текущие
 * настройки при частичном обновлении. Владелец всегда получает полный доступ.
 */
export function resolvePermissions(role: Role, stored: unknown, def = getDefaultPermissionsByRole(role)): EmployeePermissions {
  if (role === Role.OWNER) {
    const allowed = stored && typeof stored === 'object' && 'ownerOperations' in stored ? stored.ownerOperations : null;
    return { ...getDefaultPermissionsByRole(role), ownerOperations: pick(OWNER_OPERATION_KEYS, allowed, defaultOwnerOperations) };
  }
  if (!stored || typeof stored !== 'object') return def;
  const s = stored as { sections?: unknown; actions?: unknown; readOnlySections?: unknown; terminalAccess?: unknown; adminAccess?: unknown; workShiftRequired?: unknown };
  const permissions: EmployeePermissions = {
    sections: pick(SECTION_KEYS, s.sections, def.sections),
    actions: pick(ACTION_KEYS, s.actions, def.actions),
    terminalAccess: typeof s.terminalAccess === 'boolean' ? s.terminalAccess : def.terminalAccess,
    adminAccess: typeof s.adminAccess === 'boolean' ? s.adminAccess : def.adminAccess,
  };
  const fixedWorkspace = fixedPositionWorkspace(role, stored);
  if (fixedWorkspace) permissions.adminAccess = fixedWorkspace === 'admin';
  if (fixedWorkspace === 'production' || fixedWorkspace === 'admin') permissions.terminalAccess = false;
  const workShiftRequired = typeof s.workShiftRequired === 'boolean' ? s.workShiftRequired : def.workShiftRequired;
  if (workShiftRequired !== undefined) permissions.workShiftRequired = workShiftRequired;
  const selected = Array.isArray(s.readOnlySections) ? s.readOnlySections : def.readOnlySections;
  if (selected) {
    permissions.readOnlySections = READ_ONLY_SECTION_KEYS.filter((key) => permissions.sections[key] && selected.includes(key));
    for (const section of permissions.readOnlySections) {
      for (const action of SECTION_WRITE_ACTIONS[section] ?? []) permissions.actions[action] = false;
    }
  }
  return permissions;
}

/** Resolve the assigned position once; raw employee overrides are only a legacy fallback. */
export function resolvePositionPermissions(position: { role: Role | string; permissions?: unknown; isStarter?: boolean }): EmployeePermissions {
  const role = position.role as Role;
  const fixed = fixedPositionWorkspace(role, position.permissions, position.isStarter);
  const stored = position.permissions && typeof position.permissions === 'object' ? position.permissions : {};
  return resolvePermissions(role, fixed ? { ...stored, fixedWorkspace: fixed } : position.permissions);
}

export function resolveUserPermissions(user: {
  role: Role | string; permissions?: unknown;
  position?: { role: Role | string; permissions: unknown; isStarter?: boolean } | null;
}): EmployeePermissions {
  return user.position?.role === user.role ? resolvePositionPermissions(user.position) : resolvePermissions(user.role as Role, user.permissions);
}

/** Нормализовать входные данные перед сохранением (whitelist ключей, только boolean). */
export function sanitizePermissionsInput(role: Role, input: unknown, fallback?: EmployeePermissions): EmployeePermissions {
  return resolvePermissions(role, input, fallback);
}

/** Проверка одного права по строке вида "sections.warehouse" / "actions.editMenu". */
export function hasPermission(perms: EmployeePermissions, path: string): boolean {
  const [group, key] = path.split('.') as ['sections' | 'actions', string];
  const bag = perms[group] as Record<string, boolean> | undefined;
  return !!bag && bag[key] === true;
}
