import React from 'react';
import { Modal as RNModal, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  useReducedMotion,
  withTiming,
} from 'react-native-reanimated';
import { sheetTiming } from './motion';

export function FullscreenSheet({
  visible,
  onClose,
  onDismiss,
  children,
  style,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [render, setRender] = React.useState(visible);
  const translateY = useSharedValue(height || 900);
  const transitionSeqRef = React.useRef(0);
  const ready = React.useRef(false);
  const onDismissRef = React.useRef(onDismiss);
  const visibleRef = React.useRef(visible);
  onDismissRef.current = onDismiss;
  visibleRef.current = visible;
  const enter = React.useCallback(() => {
    if (!visibleRef.current) return;
    translateY.value = withTiming(0, { duration: reduceMotion ? 0 : sheetTiming.enterMs, easing: sheetTiming.easing });
  }, [reduceMotion, translateY]);
  const finishClose = React.useCallback(
    (seq: number) => {
      if (transitionSeqRef.current !== seq || visibleRef.current) return;
      ready.current = false;
      setRender(false);
      onDismissRef.current?.();
    },
    [],
  );

  React.useEffect(() => {
    const seq = ++transitionSeqRef.current;
    const offscreen = height || 900;
    cancelAnimation(translateY);
    if (visible) {
      setRender(true);
      if (ready.current) enter();
      else translateY.value = offscreen;
      return;
    }

    translateY.value = withTiming(
      offscreen,
      {
        duration: reduceMotion ? 0 : sheetTiming.exitMs,
        easing: sheetTiming.easing,
      },
      (finished) => {
        if (finished) runOnJS(finishClose)(seq);
      },
    );
  }, [finishClose, height, translateY, visible, enter, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!render) return null;

  return (
    <RNModal
      visible={render}
      animationType="none"
      transparent
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
      onShow={() => { ready.current = true; enter(); }}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.screen, style, animatedStyle]}>{children}</Animated.View>
      </GestureHandlerRootView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  screen: { flex: 1 },
});
