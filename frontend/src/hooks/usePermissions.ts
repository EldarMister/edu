import { useMemo } from 'react';
import { useAuth } from '@/store/auth';
import { hasPermission, resolvePermissions } from '@/lib/permissions';
import type { ActionKey, EmployeePermissions, SectionKey } from '@/types';

/**
 * Итоговые права текущего пользователя + хелперы проверки.
 * Если permissions ещё не пришли (старая сессия) — берём дефолты по роли.
 */
export function usePermissions() {
  const user = useAuth((s) => s.user);

  return useMemo(() => {
    const perms: EmployeePermissions | null = user
      ? user.permissions ?? resolvePermissions(user.role, null)
      : null;
    const isOwner = user?.role === 'OWNER';

    return {
      permissions: perms,
      isOwner,
      /** Доступен ли раздел (владельцу — всегда). */
      canSection: (key: SectionKey) => isOwner || (!!perms && perms.sections[key] === true),
      /** Разрешено ли действие (владельцу — всегда). */
      canAction: (key: ActionKey) => isOwner || (!!perms && perms.actions[key] === true),
      /** Универсальная проверка по строке "sections.warehouse" / "actions.editMenu". */
      can: (path: string) => isOwner || (!!perms && hasPermission(perms, path)),
    };
  }, [user]);
}
