import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ActionKey, EmployeePermissions, hasPermission, resolvePermissions } from '../common/permissions';

type WarehouseActor = { role: string; permissions?: EmployeePermissions };

export function assertWarehousePermission(actor: WarehouseActor, action: ActionKey) {
  const permissions = resolvePermissions(actor.role as Role, actor.permissions);
  if (actor.role !== 'OWNER' && (!hasPermission(permissions, 'sections.warehouse') || !hasPermission(permissions, `actions.${action}`))) {
    throw new ForbiddenException('У вас нет разрешения на это действие со складом');
  }
}
