import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import * as ScreenOrientation from 'expo-screen-orientation';
import { queryClient } from '@/lib/queryClient';
import { RootNavigator } from '@/navigation/RootNavigator';
import { colors } from '@/theme';

export default function App() {
  // Приложение по умолчанию портретное. Кухонный экран сам временно разлочивает
  // ориентацию (сенсор/альбом) и возвращает портрет при выходе.
  React.useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle="light-content" backgroundColor={colors.primary} translucent={false} />
          <RootNavigator />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
