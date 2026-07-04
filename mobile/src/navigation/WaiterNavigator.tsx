import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, fontSize, waiterLayout } from '@/theme';
import { WaiterHeader } from '@/components/WaiterHeader';
import { OfflineBanner } from '@/components/ConnectionStatus';
import { ShiftRequiredScreen } from '@/components/ShiftRequiredScreen';
import { FastPressable } from '@/components/FastPressable';
import { Loading } from '@/components/ui';
import { PwaIcon, type PwaIconName } from '@/components/PwaIcon';
import { TablesScreen } from '@/screens/waiter/TablesScreen';
import { MenuScreen } from '@/screens/waiter/MenuScreen';
import { OrdersNavigator } from './OrdersNavigator';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';
import { useActiveOrders, useCurrentShift } from '@/services/api/waiter';
import { useRadioVisibility } from '@/features/ptt/radioVisibility';
import type { WaiterTabParamList } from './types';

const Tab = createBottomTabNavigator<WaiterTabParamList>();

const ICONS: Record<keyof WaiterTabParamList, PwaIconName> = {
  Tables: 'grid',
  Menu: 'menu',
  Orders: 'list',
  Profile: 'user',
};

export function WaiterNavigator() {
  const insets = useSafeAreaInsets();
  const orders = useActiveOrders();
  const shiftQ = useCurrentShift();
  const ordersCount = (orders.data ?? []).filter(
    (order) => order.requiresWaiterDecision || order.status === 'ready' || order.status === 'rejected',
  ).length;

  const shiftActive = shiftQ.data?.status === 'active';
  const shiftResolved = shiftQ.isFetched || shiftQ.data !== undefined;
  // Пока идёт запуск смены, экран удерживается, даже когда смена уже активна.
  const [busy, setBusy] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<keyof WaiterTabParamList>('Tables');
  const setShiftGateOpen = useRadioVisibility((s) => s.setShiftGateOpen);
  const showShiftLoading = !shiftResolved;
  const showGate = busy || (shiftResolved && !shiftActive);
  const showGateOverlay = showGate && activeTab !== 'Profile';
  const tabBarHeight = waiterLayout.navBarHeight + insets.bottom;

  React.useEffect(() => {
    setShiftGateOpen(showGateOverlay);
    return () => setShiftGateOpen(false);
  }, [setShiftGateOpen, showGateOverlay]);

  // Первичная проверка смены — белый экран с лоадером (без шапки/навигации).
  if (showShiftLoading) {
    return (
      <SafeAreaView style={styles.plainSafe} edges={['top', 'bottom']}>
        <Loading />
      </SafeAreaView>
    );
  }

  // Обычный рабочий интерфейс. Если смена не начата, PWA показывает gate как
  // overlay поверх рабочих вкладок, но нижняя навигация и профиль остаются доступны.
  return (
    <SafeAreaView style={styles.workSafe} edges={['top']}>
      <OfflineBanner />
      <WaiterHeader />
      <View style={styles.tabsHost}>
        <Tab.Navigator
          tabBar={(props) => (
            <WaiterTabBar
              {...props}
              ordersCount={ordersCount}
              onActiveRouteChange={setActiveTab}
            />
          )}
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarStyle: { height: tabBarHeight },
            tabBarLabelStyle: { fontSize: fontSize.xs, marginTop: 2 },
            tabBarIcon: ({ color }) => (
              <View style={styles.iconWrap}>
                <PwaIcon name={ICONS[route.name]} size={22} color={color} />
                {route.name === 'Orders' && ordersCount > 0 ? (
                  <View style={styles.ordersBadge}>
                    <Text style={styles.ordersBadgeText}>{ordersCount > 99 ? '99+' : ordersCount}</Text>
                  </View>
                ) : null}
              </View>
            ),
          })}
        >
          <Tab.Screen name="Tables" component={TablesScreen} options={{ title: 'Столы' }} />
          <Tab.Screen name="Menu" component={MenuScreen} options={{ title: 'Меню' }} />
          <Tab.Screen name="Orders" component={OrdersNavigator} options={{ title: 'Заказы' }} />
          <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Профиль' }} />
        </Tab.Navigator>
        {showGateOverlay ? (
          <View style={[styles.shiftGateOverlay, { bottom: tabBarHeight }]}>
            <ShiftRequiredScreen onBusyChange={setBusy} bottomSafe={false} />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function WaiterTabBar({
  state,
  descriptors,
  navigation,
  ordersCount,
  onActiveRouteChange,
}: BottomTabBarProps & {
  ordersCount: number;
  onActiveRouteChange: (route: keyof WaiterTabParamList) => void;
}) {
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index]?.name as keyof WaiterTabParamList | undefined;

  React.useEffect(() => {
    if (activeRoute) onActiveRouteChange(activeRoute);
  }, [activeRoute, onActiveRouteChange]);

  return (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom }]}>
      <View style={styles.tabBarRow}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key]?.options;
          const label =
            typeof options?.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options?.title ?? route.name;
          const color = focused ? colors.primary : colors.textMuted;
          const badge = route.name === 'Orders' ? ordersCount : 0;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <FastPressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : undefined}
              accessibilityLabel={options?.tabBarAccessibilityLabel}
              testID={options?.tabBarButtonTestID}
              onPress={onPress}
              style={styles.tabButton}
            >
              <View style={styles.iconWrap}>
                <PwaIcon name={ICONS[route.name as keyof WaiterTabParamList]} size={22} color={color} />
                {badge > 0 ? (
                  <View style={styles.ordersBadge}>
                    <Text style={styles.ordersBadgeText}>{badge > 99 ? '99+' : badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
                {label}
              </Text>
            </FastPressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plainSafe: { flex: 1, backgroundColor: colors.white },
  workSafe: { flex: 1, backgroundColor: colors.primary },
  tabsHost: { flex: 1, position: 'relative' },
  shiftGateOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 40,
    backgroundColor: colors.white,
  },
  tabBar: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
  tabBarRow: {
    height: waiterLayout.navBarHeight,
    flexDirection: 'row',
  },
  tabButton: {
    flex: 1,
    height: waiterLayout.navBarHeight,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingTop: 9,
    paddingBottom: 9,
    gap: 4,
  },
  tabLabel: {
    fontSize: fontSize.xs,
    lineHeight: 14,
    fontWeight: '400',
  },
  iconWrap: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ordersBadge: {
    position: 'absolute',
    top: -6,
    right: -7,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  ordersBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 12,
  },
});
