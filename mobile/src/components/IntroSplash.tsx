import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
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
  const [videoReady, setVideoReady] = React.useState(false);
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
      {/* PWA-brand frame is visible from the first native paint. Video stays
          transparent until the decoder has produced its first frame, so there
          is no blue/white/black flash while expo-av is initialising. */}
      <Image source={require('../../assets/app-icon.png')} resizeMode="contain" style={styles.brandFrame} />
      <Video
        source={source}
        style={[StyleSheet.absoluteFill, !videoReady && styles.videoHidden]}
        resizeMode={ResizeMode.COVER}
        shouldPlay
        isLooping={false}
        isMuted={false}
        volume={1}
        onLoad={() => setVideoReady(true)}
        onPlaybackStatusUpdate={onStatus}
        onError={finish}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    zIndex: 100,
  },
  brandFrame: { width: '78%', height: '34%' },
  videoHidden: { opacity: 0 },
});
