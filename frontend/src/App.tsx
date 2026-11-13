import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { api } from '@/lib/api';
import type { AuthUser } from '@/types';
import { ProtectedRoute, homeForRole } from '@/routes/ProtectedRoute';
import { Toaster } from '@/components/Toaster';
import { AudioUnlockButton } from '@/components/AudioUnlockButton';
import { UpdateModal } from '@/components/UpdateModal';
import { PttOverlay } from '@/features/ptt/PttOverlay';
import { useRadioVisibility } from '@/features/ptt/radioVisibility';
import { LoginPage } from '@/features/auth/LoginPage';
import { WaiterApp } from '@/features/waiter/WaiterApp';
import { KitchenApp } from '@/features/kitchen/KitchenApp';
import { BarApp } from '@/features/bar/BarApp';
import { WarehouseStaffApp } from '@/features/admin/pages/warehouse/WarehouseStaffApp';
import { AdminApp } from '@/features/admin/AdminApp';
import { QrMenuApp } from '@/features/qr/QrMenuApp';
import { QueueApp } from '@/features/queue/QueueApp';
import { PlatformApp } from '@/features/platform/PlatformApp';

export function App() {
  const user = useAuth((s) => s.user);
  const accessToken = useAuth((s) => s.accessToken);
  const updateUser = useAuth((s) => s.updateUser);
  const location = useLocation();
  const waiterButtonVisible = useRadioVisibility((s) => s.waiterButtonVisible);
  const onWaiter = location.pathname.startsWith('/waiter');
  const showPtt =
    !!user &&
    ['/waiter', '/kitchen', '/bar', '/admin', '/owner', '/warehouse'].some((prefix) =>
      location.pathname.startsWith(prefix),
    );

  // Подтягиваем актуальные права доступа при загрузке (старые сессии могли войти
  // до появления permissions; владелец мог изменить права сотрудника).
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const userId = useAuth.getState().user?.id;
    api
      .get<AuthUser>('/auth/me')
      .then(({ data }) => {
        const session = useAuth.getState();
        if (cancelled || session.user?.id !== userId) return;
        if (data?.id === userId) updateUser(data);
        else if (session.accessToken === accessToken) session.logout();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  return (
    <>
      {showPtt && <AudioUnlockButton />}
      <Routes>
        {/* Публичное QR-меню стола (EDU MENU) — без авторизации. */}
        <Route path="/menu/:tableToken" element={<QrMenuApp />} />

        {/* Публичное табло очереди заказов (монитор в зале) — без авторизации.
            /q/:code — короткая ссылка для ввода на ТВ. */}
        <Route path="/queue" element={<QueueApp />} />
        <Route path="/q/:code" element={<QueueApp />} />

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

        <Route path="/warehouse/*" element={<ProtectedRoute roles={['OWNER','ADMIN','KITCHEN','BAR']}><WarehouseStaffApp/></ProtectedRoute>}/>

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
      {showPtt && <PttOverlay waiterMode={onWaiter} buttonHidden={onWaiter && !waiterButtonVisible} />}
      <Toaster />
      <UpdateModal />
    </>
  );
}
