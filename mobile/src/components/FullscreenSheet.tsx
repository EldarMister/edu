import React from 'react';
import { Modal as RNModal, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
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
  const [render, setRender] = React.useState(visible);
  const translateY = useSharedValue(height || 900);

  React.useEffect(() => {
    const offscreen = height || 900;
    if (visible) {
      setRender(true);
      translateY.value = offscreen;
      translateY.value = withTiming(0, {
        duration: sheetTiming.enterMs,
        easing: sheetTiming.easing,
      });
      return;
    }

    translateY.value = withTiming(
      offscreen,
      {
        duration: sheetTiming.exitMs,
        easing: sheetTiming.easing,
      },
      (finished) => {
        if (finished) {
          runOnJS(setRender)(false);
          if (onDismiss) runOnJS(onDismiss)();
        }
      },
    );
  }, [height, onDismiss, translateY, visible]);

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
    >
      <View style={styles.root}>
        <Animated.View style={[styles.screen, style, animatedStyle]}>{children}</Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  screen: { flex: 1 },
});
