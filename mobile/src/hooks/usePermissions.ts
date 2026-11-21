import { useMemo } from 'react';
import { useAuth } from '@/store/auth';
import { hasPermission } from '@/lib/permissions';
import { workspacePermissions, workspaceRole } from '@/lib/workspaces';
import type { ActionKey, EmployeePermissions, OwnerOperations, SectionKey } from '@/types';

/**
 * Итоговые права текущего пользователя + хелперы проверки.
 * Если permissions ещё не пришли (старая сессия) — берём дефолты по роли.
 */
export function usePermissions() {
  const user = useAuth((s) => s.user);
  const workspace = useAuth((s) => s.workspace);

  return useMemo(() => {
    const perms: EmployeePermissions | null = user && workspace
      ? workspacePermissions(user, workspace)
      : null;
    const effectiveRole = user && workspace ? workspaceRole(user, workspace) : null;
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
      canOwnerOperation: (key: keyof OwnerOperations) => user?.role !== 'OWNER' || user.permissions?.ownerOperations?.[key] !== false,
      /** Универсальная проверка по строке "sections.warehouse" / "actions.editMenu". */
      can: (path: string) => isOwner || (!!perms && hasPermission(perms, path)),
    };
  }, [user, workspace]);
}
