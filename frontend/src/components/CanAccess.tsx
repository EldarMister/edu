import type { ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';

/**
 * Показывает children только если у пользователя есть указанное право.
 * permission — строка вида "sections.warehouse" / "actions.editMenu".
 */
export function CanAccess({
  permission,
  fallback = null,
  children,
}: {
  permission: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const { can } = usePermissions();
  return <>{can(permission) ? children : fallback}</>;
}
