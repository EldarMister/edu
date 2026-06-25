import 'react-native-gesture-handler';
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { colors } from '@/theme';
import { RootNavigator } from '@/navigation/RootNavigator';

export default function App() {
  // Грузим шрифт иконок в рантайме — иначе в собранном APK глифы Ionicons
  // не отрисовываются (видны только подписи), что ломало вид всех экранов.
  const [fontsLoaded] = useFonts(Ionicons.font);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          {/* Синяя строка состояния со светлыми иконками — как в PWA (theme-color #005BFF). */}
          <StatusBar style="light" backgroundColor={colors.primary} />
          <RootNavigator />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
