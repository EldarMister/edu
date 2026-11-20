import { useEffect, useLayoutEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/store/theme';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import type { AuthUser } from '@/types';
import { ProtectedRoute } from '@/routes/ProtectedRoute';
import { homeForUser, workspaceForPath } from '@/lib/workspaces';
import { getSocket } from '@/lib/socket';
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
import { WorkShiftGate } from '@/features/settings/WorkShiftBanner';

export function App() {
  const user = useAuth((s) => s.user);
  const accessToken = useAuth((s) => s.accessToken);
  const updateUser = useAuth((s) => s.updateUser);
  const location = useLocation();
  const theme = useTheme((state) => state.theme);
  const publicPage = /^\/(menu|queue|q)(\/|$)/.test(location.pathname);
  const waiterButtonVisible = useRadioVisibility((s) => s.waiterButtonVisible);
  const onWaiter = location.pathname.startsWith('/waiter');
  const showPtt =
    !!user &&
    ['/waiter', '/kitchen', '/bar', '/admin', '/owner', '/warehouse'].some((prefix) =>
      location.pathname.startsWith(prefix),
    );

  useLayoutEffect(() => {
    const dark = theme === 'dark' && !publicPage;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101010' : '#005BFF');
  }, [theme, publicPage]);

  // Обновляем должность и права также в открытой сессии, когда владелец меняет доступ.
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const userId = useAuth.getState().user?.id;
    let pending = false;
    const refreshUser = () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      void api.get<AuthUser>('/auth/me')
      .then(({ data }) => {
        const session = useAuth.getState();
        if (cancelled || session.user?.id !== userId) return;
        if (data?.id === userId) {
          const previous = session.user;
          const accessChanged = previous?.role !== data.role || previous?.positionId !== data.positionId
            || previous?.prepStation !== data.prepStation
            || JSON.stringify(previous?.permissions) !== JSON.stringify(data.permissions);
          updateUser(data);
          if (accessChanged) {
            getSocket().disconnect().connect();
            void queryClient.resetQueries();
          }
        }
        else if (session.accessToken === accessToken) session.logout();
      })
      .catch(() => {})
      .finally(() => { pending = false; });
    };
    refreshUser();
    const timer = window.setInterval(refreshUser, 30_000);
    window.addEventListener('focus', refreshUser);
    document.addEventListener('visibilitychange', refreshUser);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshUser);
      document.removeEventListener('visibilitychange', refreshUser);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  return (
    <>
      {showPtt && <AudioUnlockButton />}
      <Routes key={workspaceForPath(location.pathname, user)}>
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
          element={user ? <Navigate to={homeForUser(user)} replace /> : <LoginPage />}
        />

        <Route
          path="/waiter/*"
          element={
            <ProtectedRoute workspace="terminal">
              <WaiterApp />
            </ProtectedRoute>
          }
        />

        <Route
          path="/kitchen/*"
          element={
            <ProtectedRoute workspace="kitchen">
              <WorkShiftGate><KitchenApp /></WorkShiftGate>
            </ProtectedRoute>
          }
        />

        <Route
          path="/bar/*"
          element={
            <ProtectedRoute workspace="bar">
              <WorkShiftGate><BarApp /></WorkShiftGate>
            </ProtectedRoute>
          }
        />

        <Route path="/warehouse/*" element={<ProtectedRoute workspace="warehouse"><WorkShiftGate><WarehouseStaffApp /></WorkShiftGate></ProtectedRoute>}/>

        {/* Этап 6 — администратор, Этап 7 — владелец (одна панель, нав зависит от роли) */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute workspace="admin">
              <WorkShiftGate adminWorkspace><AdminApp /></WorkShiftGate>
            </ProtectedRoute>
          }
        />
        <Route
          path="/owner/*"
          element={
            <ProtectedRoute roles={['OWNER']} workspace="admin">
              <WorkShiftGate adminWorkspace><AdminApp /></WorkShiftGate>
            </ProtectedRoute>
          }
        />

        <Route path="/access-denied" element={user ? <div className="grid h-full place-content-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">Доступ не назначен</h1>
          <p>Владелец должен назначить должность с доступом к кассе или админ-панели.</p>
          <button className="btn-secondary btn-md" onClick={() => useAuth.getState().logout()}>Выйти</button>
        </div> : <Navigate to="/login" replace />} />
        <Route
          path="*"
          element={<Navigate to={user ? homeForUser(user) : '/login'} replace />}
        />
      </Routes>
      {showPtt && <PttOverlay waiterMode={onWaiter} buttonHidden={onWaiter && !waiterButtonVisible} />}
      <Toaster />
      <UpdateModal />
    </>
  );
}
