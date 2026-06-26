import React from 'react';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Loading } from '@/components/ui';
import { Toaster } from '@/components/Toaster';
import { colors } from '@/theme';
import { useAuth } from '@/store/auth';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { registerForPushNotifications } from '@/services/push';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { WaiterNavigator } from './WaiterNavigator';
import { KitchenNavigator, BarNavigator } from './KitchenNavigator';
import { StaffScreen } from '@/screens/staff/StaffScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Подключает глобальную realtime-синхронизацию в авторизованной зоне. */
function AuthedArea({ children }: { children: React.ReactNode }) {
  useRealtimeSync();
  React.useEffect(() => {
    void registerForPushNotifications();
  }, []);
  return (
    <View style={{ flex: 1 }}>
      {children}
      <Toaster />
    </View>
  );
}

export function RootNavigator() {
  const hydrated = useAuth((s) => s.hydrated);
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.accessToken);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <Loading text="Загрузка…" />
      </View>
    );
  }

  const isAuthed = !!user && !!token;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
        ) : (
          <Stack.Screen name="Staff">
            {() => (
              <AuthedArea>
                <StaffScreen />
              </AuthedArea>
            )}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
