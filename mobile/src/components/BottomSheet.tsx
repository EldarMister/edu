import React from 'react';
import {
  Animated,
  Easing,
  Modal as RNModal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontSize, spacing, waiterLayout } from '@/theme';
import { PwaIcon } from './PwaIcon';

const CLOSE_DRAG_DISTANCE = 110;

/**
 * Нижний лист / модалка — повторяет PWA Modal на мобильном (items-end):
 * затемнение фона rgba(0,0,0,0.4), белый лист со скруглением сверху,
 * шапка с заголовком и крестиком (border-b), футер (border-t).
 * `drag handle` показывается для «листового» режима (sheet).
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  footer,
  sheet = false,
  bodyStyle,
  maxHeight,
  bottomInset,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** true — стиль «нижний лист» с хваталкой вместо шапки-крестика. */
  sheet?: boolean;
  bodyStyle?: ViewStyle;
  maxHeight?: ViewStyle['maxHeight'];
  bottomInset?: number;
}) {
  const [render, setRender] = React.useState(visible);
  const progress = React.useRef(new Animated.Value(0)).current;
  const dragY = React.useRef(new Animated.Value(0)).current;
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          sheet && gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          dragY.stopAnimation();
          dragY.setValue(0);
        },
        onPanResponderMove: (_, gesture) => {
          dragY.setValue(Math.max(0, gesture.dy));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > CLOSE_DRAG_DISTANCE) {
            onClose();
            return;
          }
          Animated.spring(dragY, {
            toValue: 0,
            speed: 24,
            bounciness: 0,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            speed: 24,
            bounciness: 0,
            useNativeDriver: true,
          }).start();
        },
      }),
    [dragY, onClose, sheet],
  );

  React.useEffect(() => {
    let frame: ReturnType<typeof requestAnimationFrame> | null = null;
    progress.stopAnimation();
    if (visible) {
      setRender(true);
      progress.setValue(0);
      dragY.setValue(0);
      frame = requestAnimationFrame(() => {
        Animated.timing(progress, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          isInteraction: false,
          useNativeDriver: true,
        }).start();
      });
      return () => {
        if (frame) cancelAnimationFrame(frame);
      };
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: 240,
      easing: Easing.in(Easing.cubic),
      isInteraction: false,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setRender(false);
        dragY.setValue(0);
      }
    });
  }, [dragY, progress, visible]);

  if (!render) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [96, 0],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <RNModal
      visible={render}
      animationType="none"
      transparent
      statusBarTranslucent={false}
      hardwareAccelerated
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[styles.backdropFill, bottomInset != null && { bottom: bottomInset }, { opacity }]}
          pointerEvents="box-none"
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            maxHeight != null && { maxHeight },
            bottomInset != null && { marginBottom: bottomInset },
            { opacity, transform: [{ translateY }, { translateY: dragY }] },
          ]}
        >
        <SafeAreaView
          style={styles.sheetSafe}
          edges={['bottom']}
        >
          {sheet ? (
            <View style={styles.handleWrap} {...panResponder.panHandlers}>
              <View style={styles.handle} />
              {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
            </View>
          ) : title ? (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12}>
                <PwaIcon name="close" size={22} color={colors.textLight} />
              </Pressable>
            </View>
          ) : null}

          <View style={[styles.body, bodyStyle]}>{children}</View>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </SafeAreaView>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.34)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: waiterLayout.sheetRadius,
    borderTopRightRadius: waiterLayout.sheetRadius,
    maxHeight: '92%',
    overflow: 'hidden',
  },
  sheetSafe: { backgroundColor: colors.card },
  handleWrap: { paddingTop: 10, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.slate300 },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: spacing.md,
  },
  title: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
  body: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
});
