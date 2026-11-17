import { ConflictException } from '@nestjs/common';
import { OrderStatus, Prisma, Role, WaiterShiftStatus } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ACTION_KEYS, resolvePermissions } from '../common/permissions';

type PositionAccess = { role: Role; permissions: unknown };

export function losesOperationalAccess(before: PositionAccess, after: PositionAccess) {
  const old = resolvePermissions(before.role, before.permissions);
  const next = resolvePermissions(after.role, after.permissions);
  return (old.terminalAccess && !next.terminalAccess)
    || (old.adminAccess && !next.adminAccess && !next.terminalAccess && after.role !== Role.KITCHEN && after.role !== Role.BAR);
}

export function disablesWorkTracking(before: PositionAccess, after: PositionAccess) {
  return resolvePermissions(before.role, before.permissions).workShiftRequired !== false
    && resolvePermissions(after.role, after.permissions).workShiftRequired === false;
}

export async function assertNoActiveWorkShifts(db: Prisma.TransactionClient, userIds: string[]) {
  if (!userIds.length) return;
  const shift = await db.waiterShift.findFirst({
    where: { waiterId: { in: userIds }, status: WaiterShiftStatus.active },
    select: { id: true },
  });
  if (shift) throw new ConflictException('Перед отключением учёта завершите открытые рабочие смены.');
}

/** Managers may assign only workspaces below management and permissions they hold themselves. */
export function canManagePosition(actor: AuthUser, position: PositionAccess): boolean {
  if (actor.role === Role.OWNER) return true;
  const actorPermissions = actor.permissions ?? resolvePermissions(actor.role as Role, null);
  if (actor.role !== Role.ADMIN || !actorPermissions.sections.staff || !actorPermissions.actions.manageStaff || actorPermissions.readOnlySections?.includes('staff')
    || position.role === Role.OWNER) return false;
  const permissions = resolvePermissions(position.role, position.permissions);
  if (permissions.adminAccess) return false;
  const production = position.role === Role.KITCHEN || position.role === Role.BAR;
  // Terminal menu/orders are operational defaults, not grants to the administration panel.
  return (!production || !permissions.sections.warehouse || (actorPermissions.sections.warehouse
      && (!actorPermissions.readOnlySections?.includes('warehouse') || permissions.readOnlySections?.includes('warehouse') === true)))
    && ACTION_KEYS.filter((key) => key === 'financeCashShifts' || key === 'closeShift' || (production && key.startsWith('warehouse')))
      .every((key) => !permissions.actions[key] || actorPermissions.actions[key]);
}

/** Changing the work interface must not strand an employee's current shift or orders. */
export async function assertStaffWorkspaceChange(
  db: Prisma.TransactionClient, cafeId: string | null, userIds: string[], operation = 'сменой рабочего места',
) {
  if (!userIds.length) return;
  const scope = cafeId ? { cafeId } : {};
  const [shift, cashShift, order] = await Promise.all([
    db.waiterShift.findFirst({ where: { ...scope, waiterId: { in: userIds }, status: WaiterShiftStatus.active }, select: { id: true } }),
    db.cashShift.findFirst({ where: { ...scope, openedById: { in: userIds }, closedAt: null }, select: { id: true } }),
    db.order.findFirst({ where: { ...scope, waiterId: { in: userIds }, status: { notIn: [OrderStatus.paid, OrderStatus.cancelled, OrderStatus.rejected] } }, select: { id: true } }),
  ]);
  if (shift || cashShift || order) {
    throw new ConflictException(`Перед ${operation} закройте смены и незакрытые заказы сотрудника`);
  }
}
