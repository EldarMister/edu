import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { hasPermission } from '@/lib/permissions';
import { workspaceForPath, workspacePermissions, workspaceRole } from '@/lib/workspaces';
import type { ActionKey, EmployeePermissions, SectionKey } from '@/types';

/**
 * Итоговые права текущего пользователя + хелперы проверки.
 * Если permissions ещё не пришли (старая сессия) — берём дефолты по роли.
 */
export function usePermissions() {
  const user = useAuth((s) => s.user);
  const { pathname } = useLocation();

  return useMemo(() => {
    const perms: EmployeePermissions | null = user
      ? workspacePermissions(user, workspaceForPath(pathname, user))
      : null;
    const effectiveRole = user ? workspaceRole(user, workspaceForPath(pathname, user)) : null;
    const isOwner = effectiveRole === 'OWNER';

    return {
      permissions: perms,
      isOwner,
      effectiveRole,
      /** Доступен ли раздел (владельцу — всегда). */
      canSection: (key: SectionKey) => isOwner || (!!perms && perms.sections[key] === true),
      canEditSection: (key: SectionKey) => isOwner || (!!perms && perms.sections[key] === true && !perms.readOnlySections?.includes(key)),
      /** Разрешено ли действие (владельцу — всегда). */
      canAction: (key: ActionKey) => isOwner || (!!perms && perms.actions[key] === true),
      /** Универсальная проверка по строке "sections.warehouse" / "actions.editMenu". */
      can: (path: string) => isOwner || (!!perms && hasPermission(perms, path)),
    };
  }, [user, pathname]);
}
