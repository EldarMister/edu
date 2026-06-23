import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { ProtectedRoute, homeForRole } from '@/routes/ProtectedRoute';
import { Toaster } from '@/components/Toaster';
import { UpdateModal } from '@/components/UpdateModal';
import { LoginPage } from '@/features/auth/LoginPage';
import { WaiterApp } from '@/features/waiter/WaiterApp';
import { KitchenApp } from '@/features/kitchen/KitchenApp';
import { BarApp } from '@/features/bar/BarApp';
import { AdminApp } from '@/features/admin/AdminApp';
import { QrMenuApp } from '@/features/qr/QrMenuApp';
import { QueueApp } from '@/features/queue/QueueApp';
import { PlatformApp } from '@/features/platform/PlatformApp';

export function App() {
  const user = useAuth((s) => s.user);

  return (
    <>
      <Routes>
        {/* Публичное QR-меню стола (EDU MENU) — без авторизации. */}
        <Route path="/menu/:tableToken" element={<QrMenuApp />} />

        {/* Публичное табло очереди заказов (монитор в зале) — без авторизации. */}
        <Route path="/queue" element={<QueueApp />} />

        {/* Платформенная панель супер-админа — своя авторизация (вне ролей персонала). */}
        <Route path="/platform/*" element={<PlatformApp />} />

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

        <Route
          path="/bar/*"
          element={
            <ProtectedRoute roles={['BAR', 'ADMIN', 'OWNER']}>
              <BarApp />
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
      <UpdateModal />
    </>
  );
}
