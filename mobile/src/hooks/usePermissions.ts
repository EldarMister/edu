import { useMemo } from 'react';
import { hasPermission, resolvePermissions } from '@/lib/permissions';
import { useAuth } from '@/store/auth';
import type { ActionKey, EmployeePermissions, SectionKey } from '@/types';

/**
 * Итоговые права текущего пользователя + хелперы проверки.
 * Если permissions ещё не пришли (старая сессия) — берём дефолты по роли.
 */
export function usePermissions() {
  const user = useAuth((state) => state.user);

  return useMemo(() => {
    const permissions: EmployeePermissions | null = user
      ? (user.permissions ?? resolvePermissions(user.role, null))
      : null;
    const isOwner = user?.role === 'OWNER';

    return {
      permissions,
      isOwner,
      canSection: (key: SectionKey) => isOwner || (!!permissions && permissions.sections[key] === true),
      canAction: (key: ActionKey) => isOwner || (!!permissions && permissions.actions[key] === true),
      can: (path: string) => isOwner || (!!permissions && hasPermission(permissions, path)),
    };
  }, [user]);
}
