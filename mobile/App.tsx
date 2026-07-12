import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import * as ScreenOrientation from 'expo-screen-orientation';
import { queryClient } from '@/lib/queryClient';
import { RootNavigator } from '@/navigation/RootNavigator';
import { IntroSplash } from '@/components/IntroSplash';
import { useIntroSplash } from '@/hooks/useIntroSplash';
import { colors } from '@/theme';

const INTRO_VIDEO = require('./assets/intro.mp4');

export default function App() {
  const intro = useIntroSplash();
  // Приложение по умолчанию портретное. Кухонный экран сам временно разлочивает
  // ориентацию (сенсор/альбом) и возвращает портрет при выходе.
  React.useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.primary} translucent={false} />
        {intro.status === 'checking' ? (
          <View style={{ flex: 1, backgroundColor: colors.primary }} />
        ) : intro.status === 'show' ? (
          <IntroSplash source={INTRO_VIDEO} onDone={intro.finish} />
        ) : (
          <QueryClientProvider client={queryClient}>
            <RootNavigator />
          </QueryClientProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
