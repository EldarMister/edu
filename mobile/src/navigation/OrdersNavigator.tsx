import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OrdersScreen } from '@/screens/waiter/OrdersScreen';
import { OrderDetailScreen } from '@/screens/waiter/OrderDetailScreen';

const Stack = createNativeStackNavigator();

/** Вкладка «Заказы»: список → подробная страница заказа. */
export function OrdersNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OrdersList" component={OrdersScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
    </Stack.Navigator>
  );
}
