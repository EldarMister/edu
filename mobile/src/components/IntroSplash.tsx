import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Audio, ResizeMode, Video, type AVPlaybackStatus } from 'expo-av';
import { colors } from '@/theme';

/**
 * Полноэкранная видео-заставка (mp4). Без кнопки пропуска: проигрывается
 * целиком, по завершении вызывает onDone. При ошибке загрузки видео тоже
 * вызывает onDone — чтобы не блокировать вход в приложение.
 */
export function IntroSplash({
  source,
  onDone,
}: {
  source: number; // require('../../assets/intro.mp4')
  onDone: () => void;
}) {
  const finishedRef = React.useRef(false);
  const finish = React.useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onDone();
  }, [onDone]);

  // Звук на мобилке обязателен: разрешаем воспроизведение даже в «беззвучном»
  // режиме iOS и не приглушаем другие звуки на Android.
  React.useEffect(() => {
    void Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }, []);

  const onStatus = React.useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) {
        if (status.error) finish();
        return;
      }
      if (status.didJustFinish) finish();
    },
    [finish],
  );

  return (
    <View style={styles.root}>
      <Video
        source={source}
        style={StyleSheet.absoluteFill}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping={false}
        isMuted={false}
        volume={1}
        onPlaybackStatusUpdate={onStatus}
        onError={finish}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.primary,
    zIndex: 100,
  },
});
