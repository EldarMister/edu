import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors, fontSize, waiterLayout } from '@/theme';
import { WaiterHeader } from '@/components/WaiterHeader';
import { OfflineBanner } from '@/components/ConnectionStatus';
import { ShiftRequiredScreen } from '@/components/ShiftRequiredScreen';
import { PwaIcon, type PwaIconName } from '@/components/PwaIcon';
import { TablesScreen } from '@/screens/waiter/TablesScreen';
import { MenuScreen } from '@/screens/waiter/MenuScreen';
import { OrdersNavigator } from './OrdersNavigator';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';
import { useActiveOrders, useCurrentShift } from '@/services/api/waiter';
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
  const ordersCount = orders.data?.length ?? 0;

  const shiftActive = shiftQ.data?.status === 'active';
  const shiftResolved = shiftQ.isFetched || shiftQ.data !== undefined;
  // Пока идёт запуск смены, оверлей удерживается, даже когда смена уже активна.
  const [busy, setBusy] = React.useState(false);
  const showGate = busy || (shiftResolved && !shiftActive);
  // Высота нижней навигации — оверлей не перекрывает её, вкладки остаются доступны.
  const tabBarHeight = waiterLayout.navBarHeight + Math.max(insets.bottom, 4);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }} edges={['top']}>
      <OfflineBanner />
      <WaiterHeader />
      <View style={{ flex: 1 }}>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.textMuted,
            tabBarStyle: {
              height: tabBarHeight,
              borderTopColor: colors.border,
              backgroundColor: colors.white,
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 4),
            },
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
          <Tab.Screen
            name="Orders"
            component={OrdersNavigator}
            options={{ title: 'Заказы' }}
          />
          <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Профиль' }} />
        </Tab.Navigator>

        {/* Смена не начата: оверлей поверх контента вкладки, нижняя навигация остаётся видимой. */}
        {showGate ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: tabBarHeight }}>
            <ShiftRequiredScreen onBusyChange={setBusy} />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
