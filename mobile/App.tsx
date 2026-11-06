import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { restoreAppOrientation } from '@/lib/orientation';
import { useFonts } from 'expo-font';
import { queryClient } from '@/lib/queryClient';
import { RootNavigator } from '@/navigation/RootNavigator';
import { IntroSplash } from '@/components/IntroSplash';
import { useAuth } from '@/store/auth';
import { colors } from '@/theme';

export default function App() {
  const hydrated = useAuth((state) => state.hydrated);
  const [fontsLoaded, fontError] = useFonts({ Inter: require('./assets/fonts/Inter-Regular.ttf'), 'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'), 'Inter-SemiBold': require('./assets/fonts/Inter-SemiBold.ttf'), 'Inter-Bold': require('@expo-google-fonts/inter/Inter_700Bold.ttf') });
  // Приложение по умолчанию портретное. Кухонный экран сам временно разлочивает
  // ориентацию (сенсор/альбом) и возвращает портрет при выходе.
  React.useEffect(() => {
    restoreAppOrientation().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={colors.white} translucent={false} />
        {!hydrated || (!fontsLoaded && !fontError) ? (
          <IntroSplash />
        ) : (
          <QueryClientProvider client={queryClient}>
            <RootNavigator />
          </QueryClientProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
