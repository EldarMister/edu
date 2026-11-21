import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '../common/decorators/current-user.decorator';

export function canViewFinance(user: AuthUser) {
  return !!user.cafeId && (user.role === Role.OWNER
    || user.role === Role.ADMIN && user.permissions?.sections.finance === true);
}

export function canManageFinance(user: AuthUser) {
  return canViewFinance(user) && (user.role === Role.OWNER || !user.permissions?.readOnlySections?.includes('finance'));
}

export function financeTenant(user: AuthUser, write = true) {
  if (!(write ? canManageFinance(user) : canViewFinance(user))) {
    throw new ForbiddenException(write ? 'Нет права изменять финансы' : 'Нет доступа к финансовым отчётам');
  }
  return user.cafeId!;
}

export function assertFinanceTransactionWrite(user: AuthUser) {
  if (!user.cafeId || (user.role !== Role.OWNER && user.role !== Role.ADMIN)
    || canViewFinance(user) && !canManageFinance(user)) throw new ForbiddenException('Нет права изменять финансы');
}

export function canEditFinancePermissions(user: AuthUser) {
  return user.role === Role.OWNER || canManageFinance(user) && user.permissions?.actions.editPermissions === true;
}
