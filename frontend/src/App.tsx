import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { ProtectedRoute, homeForRole } from '@/routes/ProtectedRoute';
import { Toaster } from '@/components/Toaster';
import { LoginPage } from '@/features/auth/LoginPage';
import { WaiterApp } from '@/features/waiter/WaiterApp';
import { KitchenApp } from '@/features/kitchen/KitchenApp';
import { ComingSoon } from '@/features/common/ComingSoon';

export function App() {
  const user = useAuth((s) => s.user);

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to={homeForRole(user.role)} replace /> : <LoginPage />}
        />

        <Route
          path="/waiter/*"
          element={
            <ProtectedRoute roles={['WAITER']}>
              <WaiterApp />
            </ProtectedRoute>
          }
        />

        <Route
          path="/kitchen/*"
          element={
            <ProtectedRoute roles={['KITCHEN', 'ADMIN', 'OWNER']}>
              <KitchenApp />
            </ProtectedRoute>
          }
        />

        {/* Этапы 6–7 — заглушки */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute roles={['ADMIN', 'OWNER']}>
              <ComingSoon title="Администрирование" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/owner/*"
          element={
            <ProtectedRoute roles={['OWNER']}>
              <ComingSoon title="Панель владельца" />
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={<Navigate to={user ? homeForRole(user.role) : '/login'} replace />}
        />
      </Routes>
      <Toaster />
    </>
  );
}
