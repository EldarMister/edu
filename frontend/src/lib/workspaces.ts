import type { AuthUser, Role } from '@/types';
import { getDefaultPermissionsByRole, resolvePermissions } from './permissions';

export type Workspace = 'terminal' | 'admin' | 'production';
export type WorkspaceDestination = 'terminal' | 'admin' | 'kitchen' | 'bar' | 'warehouse';

export function accessForUser(user: AuthUser) {
  const permissions = resolvePermissions(user.role, user.permissions);
  return user.access ?? {
    terminal: permissions.terminalAccess === true, admin: permissions.adminAccess === true,
    production: user.role === 'KITCHEN' ? 'kitchen' as const : user.role === 'BAR' ? 'bar' as const : null,
  };
}

export function canOpenWorkspace(user: AuthUser, target: WorkspaceDestination) {
  const access = accessForUser(user);
  const permissions = resolvePermissions(user.role, user.permissions);
  if (target === 'terminal') return access.terminal;
  if (target === 'admin') return access.admin;
  if (target === 'warehouse') return permissions.sections.warehouse && access.admin;
  return access.production === target || (access.admin && permissions.sections.orders);
}

export function homeForUser(user: AuthUser): string {
  const access = accessForUser(user);
  if (user.role === 'WAITER' && access.terminal) return '/waiter';
  if (access.production) return '/' + access.production;
  if (access.admin) return user.role === 'OWNER' ? '/owner' : '/admin';
  if (access.terminal) return '/waiter';
  return '/access-denied';
}

export function workspaceForPath(path: string, user?: AuthUser | null): Workspace {
  if (path.startsWith('/waiter')) return 'terminal';
  if (user && ['/kitchen', '/bar', '/warehouse'].some((prefix) => path.startsWith(prefix)) && accessForUser(user).production) return 'production';
  return 'admin';
}

export function workspacePermissions(user: AuthUser, workspace: Workspace) {
  const base = resolvePermissions(user.role, user.permissions);
  if (workspace === 'admin') return base;
  if (workspace === 'terminal') {
    const permissions = getDefaultPermissionsByRole('WAITER');
    permissions.actions.financeCashShifts = base.actions.financeCashShifts;
    permissions.actions.acceptOrderPayments = base.actions.acceptOrderPayments;
    permissions.actions.printReceipts = base.actions.printReceipts;
    permissions.actions.requestReceiptPrints = base.actions.requestReceiptPrints
      && (user.role !== 'OWNER' || user.permissions?.ownerOperations?.printRequests !== false);
    permissions.actions.createDeliveryOrders = base.actions.createDeliveryOrders;
    permissions.actions.closeShift = base.actions.closeShift;
    return permissions;
  }
  const permissions = getDefaultPermissionsByRole(user.role);
  if (!base.adminAccess || !base.sections.warehouse) return permissions;
  permissions.sections.warehouse = base.sections.warehouse;
  permissions.readOnlySections = base.readOnlySections?.filter((section) => section === 'warehouse');
  for (const action of Object.keys(permissions.actions) as (keyof typeof permissions.actions)[]) {
    if (action.startsWith('warehouse')) permissions.actions[action] = base.actions[action];
  }
  return permissions;
}

export function workspaceRole(user: AuthUser, workspace: Workspace): Role {
  return workspace === 'terminal' ? 'WAITER' : workspace === 'admin' ? user.role === 'OWNER' ? 'OWNER' : 'ADMIN' : user.role;
}
