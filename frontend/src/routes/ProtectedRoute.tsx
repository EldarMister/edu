import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@/types';
import { useAuth } from '@/store/auth';

/** Пускает только аутентифицированных; при указании roles — только нужные роли. */
export function ProtectedRoute({
  roles,
  children,
}: {
  roles?: Role[];
  children: React.ReactNode;
}) {
  const { user, accessToken } = useAuth();
  const location = useLocation();

  if (!user || !accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** Перенаправление с корня в интерфейс по роли (ТЗ этап 2). */
export function homeForRole(role: Role): string {
  switch (role) {
    case 'WAITER':
      return '/waiter';
    case 'KITCHEN':
      return '/kitchen';
    case 'ADMIN':
      return '/admin';
    case 'OWNER':
      return '/owner';
    default:
      return '/login';
  }
}
