import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from './decorators/current-user.decorator';
import { ActionKey, resolvePermissions, SectionKey } from './permissions';

/** Operational roles keep their workplace access; managers follow their position's section permissions. */
export function assertAdminSectionAccess(
  user: Pick<AuthUser, 'role' | 'permissions'>,
  section: SectionKey,
  write = false,
  action?: ActionKey,
) {
  if (user.role !== Role.ADMIN) return;
  const permissions = resolvePermissions(Role.ADMIN, user.permissions);
  if (!permissions.sections[section] || (action && !permissions.actions[action])) {
    throw new ForbiddenException('У вас нет доступа к этому разделу');
  }
  if (write && permissions.readOnlySections?.includes(section)) {
    throw new ForbiddenException('Для этого раздела разрешён только просмотр');
  }
}
