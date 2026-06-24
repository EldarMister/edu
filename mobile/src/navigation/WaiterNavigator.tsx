import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize } from '@/theme';
import { WaiterHeader } from '@/components/WaiterHeader';
import { OfflineBanner } from '@/components/ConnectionStatus';
import { TablesScreen } from '@/screens/waiter/TablesScreen';
import { MenuScreen } from '@/screens/waiter/MenuScreen';
import { OrdersNavigator } from './OrdersNavigator';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';
import { useActiveOrders } from '@/services/api/waiter';
import type { WaiterTabParamList } from './types';

const Tab = createBottomTabNavigator<WaiterTabParamList>();

const ICONS: Record<keyof WaiterTabParamList, keyof typeof Ionicons.glyphMap> = {
  Tables: 'grid-outline',
  Menu: 'reorder-three-outline',
  Orders: 'receipt-outline',
  Profile: 'person-outline',
};

export function WaiterNavigator() {
  const orders = useActiveOrders();
  const attention = (orders.data ?? []).filter(
    (o) => o.requiresWaiterDecision || ['ready', 'rejected'].includes(o.status),
  ).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }} edges={['top']}>
      <OfflineBanner />
      <WaiterHeader />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { borderTopColor: colors.border, backgroundColor: colors.white },
          tabBarLabelStyle: { fontSize: fontSize.xs },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={ICONS[route.name]} size={size ?? 22} color={color} />
          ),
        })}
      >
        <Tab.Screen name="Tables" component={TablesScreen} options={{ title: 'Столы' }} />
        <Tab.Screen name="Menu" component={MenuScreen} options={{ title: 'Меню' }} />
        <Tab.Screen
          name="Orders"
          component={OrdersNavigator}
          options={{
            title: 'Заказы',
            tabBarBadge: attention > 0 ? attention : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.primary },
          }}
        />
        <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Профиль' }} />
      </Tab.Navigator>
    </SafeAreaView>
  );
}
