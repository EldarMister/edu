import React from 'react';
import { AppState, StatusBar, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Loading } from '@/components/ui';
import { Toaster } from '@/components/Toaster';
import { ReceiptPrintSheet } from '@/components/ReceiptPrintSheet';
import { colors } from '@/theme';
import { useAuth } from '@/store/auth';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { usePushNotificationLifecycle, useNotificationNavigation, type NotificationTarget } from '@/services/push';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { WEB_URL } from '@/config/env';
import type { AuthUser } from '@/types';
import { useSocketLifecycle } from '@/services/socket';
import { PttOverlay } from '@/features/ptt/PttOverlay';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { WaiterNavigator } from './WaiterNavigator';
import { KitchenNavigator, BarNavigator } from './KitchenNavigator';
import { AdminNavigator } from './AdminNavigator';
import { StaffScreen } from '@/screens/staff/StaffScreen';
import { PublicHomeScreen } from '@/screens/public/PublicHomeScreen';
import { QrMenuScreen } from '@/screens/public/QrMenuScreen';
import { QueueScreen } from '@/screens/public/QueueScreen';
import { PlatformScreen } from '@/screens/public/PlatformScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['edupos://', WEB_URL],
  config: { screens: { Login: 'login', PublicHome: 'public', QrMenu: 'menu/:tableToken', Queue: { path: 'q/:code?', alias: ['queue'] }, Platform: { path: 'platform' }, Waiter: { path: 'waiter', screens: { Tables: 'tables', Menu: 'menu', Orders: { path: 'orders', screens: { OrdersList: '', OrderDetail: ':orderId' } }, Profile: 'profile' } }, Kitchen: { path: 'kitchen', screens: { Board: '', Profile: 'profile' } }, Bar: { path: 'bar', screens: { Board: '', Profile: 'profile' } }, Admin: { path: 'admin', alias: ['owner'] } } },
};

/** Подключает глобальную realtime-синхронизацию в авторизованной зоне. */
function AuthRuntime() {
  useSocketLifecycle();
  useRealtimeSync();
  React.useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const userId = useAuth.getState().user?.id;
      if (!userId) return;
      try {
        const { data } = await api.get<AuthUser>('/auth/me');
        if (!cancelled && useAuth.getState().user?.id === userId) useAuth.getState().updateUser(data);
      } catch { /* Existing screens retain the last known permissions while offline. */ }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') { void refresh(); void queryClient.invalidateQueries(); }
    });
    return () => { cancelled = true; subscription.remove(); };
  }, []);
  return null;
}
function AuthedArea({ children }: { children: React.ReactNode }) { return <>{children}</>; }

export function RootNavigator() {
  const hydrated = useAuth((s) => s.hydrated);
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.accessToken);
  const [navigationReady, setNavigationReady] = React.useState(false);
  const [navigationState, setNavigationState] = React.useState<unknown>();
  const [activeRoot, setActiveRoot] = React.useState('');
  usePushNotificationLifecycle();
  const onNotification = React.useCallback((target: NotificationTarget) => {
    if (!navigationRef.isReady()) return;
    if (target.kind === 'waiter-order') navigationRef.navigate('Waiter', {
      screen: 'Orders',
      params: target.orderId
        ? { screen: 'OrderDetail', params: { orderId: target.orderId }, initial: false }
        : { screen: 'OrdersList' },
    });
    else if (target.kind === 'kitchen') navigationRef.navigate('Kitchen', { screen: 'Board' });
    else if (target.kind === 'bar') navigationRef.navigate('Bar', { screen: 'Board' });
    else navigationRef.navigate('Admin', { section: target.kind === 'admin-receipts' ? 'receipts' : 'orders', orderId: target.orderId });
  }, []);
  useNotificationNavigation({ ready: hydrated && !!user && !!token && navigationReady, userId: user?.id, role: user?.role, onNavigate: onNotification });

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Loading text="Загрузка…" />
      </View>
    );
  }

  const isAuthed = !!user && !!token;

  return (
    <NavigationContainer ref={navigationRef} linking={linking} onReady={() => { setNavigationReady(true); const state = navigationRef.getRootState(); if (state) { setNavigationState(state); setActiveRoot(state.routes[state.index].name); } }} onStateChange={state => { if (state) { setNavigationState(state); setActiveRoot(state.routes[state.index].name); } }}>
      <View style={{ flex: 1 }}>
      <StatusBar animated barStyle={activeRoot === 'Waiter' ? 'light-content' : 'dark-content'} backgroundColor={activeRoot === 'Waiter' ? colors.primary : colors.white} />
      {isAuthed ? <AuthRuntime key={user.id} /> : null}
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Group navigationKey={isAuthed ? user.id : 'guest'}>
        {!isAuthed ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : user.role === 'WAITER' ? (
          <Stack.Screen name="Waiter">
            {() => (
              <AuthedArea>
                <WaiterNavigator />
              </AuthedArea>
            )}
          </Stack.Screen>
        ) : user.role === 'KITCHEN' ? (
          <Stack.Screen name="Kitchen">
            {() => (
              <AuthedArea>
                <KitchenNavigator />
              </AuthedArea>
            )}
          </Stack.Screen>
        ) : user.role === 'BAR' ? (
          <Stack.Screen name="Bar">
            {() => (
              <AuthedArea>
                <BarNavigator />
              </AuthedArea>
            )}
          </Stack.Screen>
        ) : user.role === 'ADMIN' || user.role === 'OWNER' ? (
          <Stack.Screen name="Admin">
            {() => (
              <AuthedArea>
                <AdminNavigator />
              </AuthedArea>
            )}
          </Stack.Screen>
        ) : (
          <Stack.Screen name="Staff">
            {() => (
              <AuthedArea>
                <StaffScreen />
              </AuthedArea>
            )}
          </Stack.Screen>
        )}
        {isAuthed && (user.role === 'ADMIN' || user.role === 'OWNER') ? <>
          <Stack.Screen name="Kitchen" component={KitchenNavigator} />
          <Stack.Screen name="Bar" component={BarNavigator} />
        </> : null}
        </Stack.Group>
        <Stack.Screen name="PublicHome" component={PublicHomeScreen} />
        <Stack.Screen name="QrMenu" component={QrMenuScreen} />
        <Stack.Screen name="Queue" component={QueueScreen} />
        <Stack.Screen name="Platform" component={PlatformScreen} />
      </Stack.Navigator>
      {isAuthed && (!activeRoot || ['Waiter', 'Kitchen', 'Bar', 'Admin', 'Staff'].includes(activeRoot)) ? <><PttOverlay navigationState={navigationState} /><ReceiptPrintSheet /><Toaster /></> : null}
      </View>
    </NavigationContainer>
  );
}
