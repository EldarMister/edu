import { View } from '@/components/themed';
import { PanelScreenBoundary } from '@/components/bottom-panel/context';
import React from 'react';
import { AppState, StatusBar } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, DarkTheme, DefaultTheme, type LinkingOptions } from '@react-navigation/native';
import * as SystemUI from 'expo-system-ui';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StaffShiftGate } from '@/components/StaffShiftGate';
import { Loading } from '@/components/ui';
import { Toaster } from '@/components/Toaster';
import { ReceiptPrintSheet } from '@/components/ReceiptPrintSheet';
import { colors, ThemeScope } from '@/theme';
import { useTheme } from '@/store/theme';
import { darkPalette } from '@/theme/palette';
import { useAuth } from '@/store/auth';
import { accessForUser, canOpenWorkspace, workspaceRole } from '@/lib/workspaces';
import { useRefundRealtime } from '@/features/refunds/useRefundRealtime';
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
  const accessToken = useAuth((state) => state.accessToken);
  useSocketLifecycle();
  useRealtimeSync();
  const workspace = useAuth((state) => state.workspace);
  useRefundRealtime(workspace === 'production' ? null : workspace);
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
  }, [accessToken]);
  return null;
}

export function RootNavigator() {
  const hydrated = useAuth((s) => s.hydrated);
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.accessToken);
  const workspace = useAuth((s) => s.workspace);
  const production = user ? accessForUser(user).production : null;
  const role = user && workspace ? workspaceRole(user, workspace) : undefined;
  const canOpenProduction = !!user && workspace === 'admin' && canOpenWorkspace(user, 'kitchen');
  const [navigationReady, setNavigationReady] = React.useState(false);
  const [navigationState, setNavigationState] = React.useState<unknown>();
  const [activeRoot, setActiveRoot] = React.useState('');
  const selectedTheme = useTheme((state) => state.theme);
  const dark = selectedTheme === 'dark' && !['PublicHome', 'QrMenu', 'Queue'].includes(activeRoot);
  const navigationTheme = React.useMemo(() => dark ? {
    ...DarkTheme, colors: { ...DarkTheme.colors, primary: darkPalette.primary, background: darkPalette.background, card: darkPalette.card, text: darkPalette.textPrimary, border: darkPalette.border, notification: darkPalette.danger },
  } : { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.background, card: colors.card, text: colors.textPrimary, border: colors.border, notification: colors.danger } }, [dark]);
  React.useEffect(() => {
    void SystemUI.setBackgroundColorAsync(navigationTheme.colors.background).catch(() => undefined);
  }, [navigationTheme.colors.background]);
  usePushNotificationLifecycle();
  const onNotification = React.useCallback((target: NotificationTarget) => {
    if (!navigationRef.isReady()) return;
    if (target.kind === 'waiter-order') navigationRef.navigate('Waiter', {
      screen: 'Orders',
      params: target.orderId
        ? { screen: 'OrderDetail', params: { orderId: target.orderId }, initial: false }
        : { screen: 'OrdersList' },
    });
    else if (target.kind === 'kitchen' || target.kind === 'bar') {
      if (target.kind === 'kitchen') navigationRef.navigate('Kitchen', { screen: 'Board' });
      else navigationRef.navigate('Bar', { screen: 'Board' });
    }
    else navigationRef.navigate('Admin', { section: target.kind === 'admin-receipts' ? 'receipts' : 'orders', orderId: target.orderId });
  }, []);
  useNotificationNavigation({ ready: hydrated && !!user && !!token && navigationReady, userId: user?.id, role, onNavigate: onNotification });

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Loading text="Загрузка…" />
      </View>
    );
  }

  const isAuthed = !!user && !!token;

  return (
    <ThemeScope mode={dark ? 'dark' : 'light'}><NavigationContainer theme={navigationTheme} ref={navigationRef} linking={linking} onReady={() => { setNavigationReady(true); const state = navigationRef.getRootState(); if (state) { setNavigationState(state); setActiveRoot(state.routes[state.index].name); } }} onStateChange={state => { if (state) { setNavigationState(state); setActiveRoot(state.routes[state.index].name); } }}>
      <View style={{ flex: 1 }}>
      <StatusBar animated barStyle={dark || activeRoot === 'Waiter' ? 'light-content' : 'dark-content'} backgroundColor={dark ? darkPalette.background : activeRoot === 'Waiter' ? colors.primary : colors.white} />
      {isAuthed ? <AuthRuntime key={user.id} /> : null}
      <PanelScreenBoundary style={{ flex: 1 }}><Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
        <Stack.Group navigationKey={isAuthed ? `${user.id}:${workspace ?? 'none'}` : 'guest'}>
        {!isAuthed ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : workspace === 'terminal' ? (
          <Stack.Screen name="Waiter" component={WaiterNavigator} />
        ) : workspace === 'production' && production === 'kitchen' ? (
          <Stack.Screen name="Kitchen" component={KitchenNavigator} />
        ) : workspace === 'production' && production === 'bar' ? (
          <Stack.Screen name="Bar" component={BarNavigator} />
        ) : workspace === 'admin' ? (
          <Stack.Screen name="Admin">{() => <StaffShiftGate><AdminNavigator /></StaffShiftGate>}</Stack.Screen>
        ) : (
          <Stack.Screen name="Staff" component={StaffScreen} />
        )}
        {canOpenProduction ? <>
          <Stack.Screen name="Kitchen" component={KitchenNavigator} />
          <Stack.Screen name="Bar" component={BarNavigator} />
        </> : null}
        </Stack.Group>
        <Stack.Screen name="PublicHome" component={PublicHomeScreen} />
        <Stack.Screen name="QrMenu" component={QrMenuScreen} />
        <Stack.Screen name="Queue" component={QueueScreen} />
        <Stack.Screen name="Platform" component={PlatformScreen} />
      </Stack.Navigator></PanelScreenBoundary>
      {isAuthed && (!activeRoot || ['Waiter', 'Kitchen', 'Bar', 'Admin', 'Staff'].includes(activeRoot)) ? <><PttOverlay navigationState={navigationState} /><ReceiptPrintSheet /><Toaster /></> : null}
      </View>
    </NavigationContainer></ThemeScope>
  );
}
