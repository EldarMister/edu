import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { ProtectedRoute, homeForRole } from '@/routes/ProtectedRoute';
import { Toaster } from '@/components/Toaster';
import { OrientationLock } from '@/components/OrientationLock';
import { LoginPage } from '@/features/auth/LoginPage';
import { WaiterApp } from '@/features/waiter/WaiterApp';
import { KitchenApp } from '@/features/kitchen/KitchenApp';
import { AdminApp } from '@/features/admin/AdminApp';

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
              <OrientationLock className="waiter-orientation-lock" lock="portrait">
                <WaiterApp />
              </OrientationLock>
            </ProtectedRoute>
          }
        />

        <Route
          path="/kitchen/*"
          element={
            <ProtectedRoute roles={['KITCHEN', 'ADMIN', 'OWNER']}>
              <OrientationLock className="kitchen-orientation-lock" lock="landscape">
                <KitchenApp />
              </OrientationLock>
            </ProtectedRoute>
          }
        />

        {/* Этап 6 — администратор, Этап 7 — владелец (одна панель, нав зависит от роли) */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute roles={['ADMIN', 'OWNER']}>
              <AdminApp />
            </ProtectedRoute>
          }
        />
        <Route
          path="/owner/*"
          element={
            <ProtectedRoute roles={['OWNER']}>
              <AdminApp />
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
