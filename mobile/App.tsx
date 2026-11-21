import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { queryClient } from '@/lib/queryClient';
import { RootNavigator } from '@/navigation/RootNavigator';
import { IntroSplash } from '@/components/IntroSplash';
import { useAuth } from '@/store/auth';
import { useThemeColors } from '@/theme';
import { useTheme } from '@/store/theme';

export default function App() {
  const hydrated = useAuth((state) => state.hydrated);
  const themeHydrated = useTheme((state) => state.hydrated);
  const theme = useTheme((state) => state.theme);
  const palette = useThemeColors();
  const [fontsLoaded, fontError] = useFonts({ Inter: require('./assets/fonts/Inter-Regular.ttf'), 'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'), 'Inter-SemiBold': require('./assets/fonts/Inter-SemiBold.ttf'), 'Inter-Bold': require('@expo-google-fonts/inter/Inter_700Bold.ttf') });
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.background }}>
      <SafeAreaProvider>
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={palette.background} translucent={false} />
        {!hydrated || !themeHydrated || (!fontsLoaded && !fontError) ? (
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
