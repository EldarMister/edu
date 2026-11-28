import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from './decorators/current-user.decorator';
import { EmployeePermissions, getDefaultPermissionsByRole } from './permissions';

export type Workspace = 'terminal' | 'admin' | 'production';
export interface WorkspaceAccess { terminal: boolean; admin: boolean; production: 'kitchen' | 'bar' | null }

export function workspaceAccess(role: string, permissions: EmployeePermissions): WorkspaceAccess {
  return { terminal: role === Role.OWNER || permissions.terminalAccess === true,
    admin: role === Role.OWNER || permissions.adminAccess === true,
    production: role === Role.KITCHEN ? 'kitchen' : role === Role.BAR ? 'bar' : null };
}

/** Workspace is a validated operational context, never a role change in storage. */
export function projectWorkspaceUser(user: AuthUser, requested?: unknown): AuthUser {
  const identityRole = user.identityRole ?? user.role;
  const access = workspaceAccess(identityRole, user.permissions);
  const workspace = requested === undefined || requested === ''
    ? identityRole === Role.WAITER ? 'terminal' : access.production ? 'production' : 'admin'
    : requested;
  if (!['terminal', 'admin', 'production'].includes(workspace as string)) {
    throw new ForbiddenException('Неизвестное рабочее пространство');
  }
  if ((workspace === 'terminal' && !access.terminal) || (workspace === 'admin' && !access.admin)
    || (workspace === 'production' && !access.production)) {
    throw new ForbiddenException('Ваша должность не имеет доступа к этому рабочему пространству');
  }
  let role: string = identityRole;
  let permissions = user.permissions;
  if (workspace === 'terminal') {
    role = Role.WAITER;
    permissions = getDefaultPermissionsByRole(Role.WAITER);
    permissions.actions.financeCashShifts = user.permissions.actions.financeCashShifts;
    permissions.actions.acceptOrderPayments = user.permissions.actions.acceptOrderPayments;
    permissions.actions.printReceipts = user.permissions.actions.printReceipts;
    permissions.actions.requestReceiptPrints = user.permissions.actions.requestReceiptPrints && user.permissions.ownerOperations?.printRequests !== false;
    permissions.ownerOperations = user.permissions.ownerOperations;
    permissions.actions.createDeliveryOrders = user.permissions.actions.createDeliveryOrders;
    permissions.actions.viewAllOrders = user.permissions.actions.viewAllOrders;
    permissions.actions.closeShift = user.permissions.actions.closeShift;
  } else if (workspace === 'admin') {
    role = identityRole === Role.OWNER ? Role.OWNER : Role.ADMIN;
  } else {
    permissions = getDefaultPermissionsByRole(identityRole as Role);
    if (access.admin && user.permissions.sections.warehouse) {
      permissions.sections.warehouse = true;
      permissions.readOnlySections = user.permissions.readOnlySections?.filter((section) => section === 'warehouse');
      for (const action of Object.keys(permissions.actions) as (keyof typeof permissions.actions)[]) {
        if (action.startsWith('warehouse')) permissions.actions[action] = user.permissions.actions[action];
      }
    }
  }
  return { ...user, role, identityRole, workspace: workspace as Workspace, access, permissions };
}
