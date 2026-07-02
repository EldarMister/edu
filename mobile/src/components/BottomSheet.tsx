import React from 'react';
import {
  Modal as RNModal,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontSize, spacing, waiterLayout } from '@/theme';
import { PwaIcon } from './PwaIcon';
import { FastPressable } from './FastPressable';
import { sheetTiming } from './motion';

const CLOSE_DRAG_DISTANCE = 110;
const SHEET_FALLBACK_H = 900;

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
  const translateY = useSharedValue(SHEET_FALLBACK_H);
  const backdropOpacity = useSharedValue(0);
  const dragY = useSharedValue(0);
  const sheetHeightRef = React.useRef(SHEET_FALLBACK_H);
  const pendingEnterRef = React.useRef(false);
  const closeFromGesture = React.useCallback(() => {
    onClose();
  }, [onClose]);
  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(sheet)
        .activeOffsetY([8, 9999])
        .failOffsetX([-16, 16])
        .onBegin(() => {
          dragY.value = 0;
        })
        .onUpdate((event) => {
          dragY.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          if (event.translationY > CLOSE_DRAG_DISTANCE || event.velocityY > 900) {
            runOnJS(closeFromGesture)();
            return;
          }
          dragY.value = withTiming(0, {
            duration: sheetTiming.exitMs,
            easing: sheetTiming.easing,
          });
        })
        .onFinalize(() => {
          if (dragY.value > 0 && dragY.value < CLOSE_DRAG_DISTANCE) {
            dragY.value = withTiming(0, {
              duration: sheetTiming.exitMs,
              easing: sheetTiming.easing,
            });
          }
        }),
    [closeFromGesture, dragY, sheet],
  );

  React.useEffect(() => {
    if (visible) {
      // Держим лист скрытым до onLayout, где узнаем точную высоту и запустим въезд.
      translateY.value = sheetHeightRef.current;
      backdropOpacity.value = 0;
      dragY.value = 0;
      pendingEnterRef.current = true;
      setRender(true);
      return;
    }
    pendingEnterRef.current = false;
    dragY.value = withTiming(0, {
      duration: sheetTiming.exitMs,
      easing: sheetTiming.easing,
    });
    backdropOpacity.value = withTiming(0, {
      duration: sheetTiming.exitMs,
      easing: sheetTiming.easing,
    });
    translateY.value = withTiming(
      sheetHeightRef.current,
      {
        duration: sheetTiming.exitMs,
        easing: sheetTiming.easing,
      },
      (finished) => {
        if (finished) runOnJS(setRender)(false);
      },
    );
  }, [backdropOpacity, dragY, translateY, visible]);

  const handleSheetLayout = React.useCallback(
    (e: LayoutChangeEvent) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) sheetHeightRef.current = h;
      if (pendingEnterRef.current && h > 0) {
        pendingEnterRef.current = false;
        translateY.value = h;
        translateY.value = withTiming(0, {
          duration: sheetTiming.enterMs,
          easing: sheetTiming.easing,
        });
        backdropOpacity.value = withTiming(1, {
          duration: sheetTiming.enterMs,
          easing: sheetTiming.easing,
        });
      }
    },
    [backdropOpacity, translateY],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value + dragY.value }],
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
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.backdropFill,
            bottomInset != null && { bottom: bottomInset },
            backdropStyle,
          ]}
          pointerEvents="box-none"
        >
          <FastPressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
          />
        </Animated.View>
        <Animated.View
          onLayout={handleSheetLayout}
          style={[
            styles.sheet,
            maxHeight != null && { maxHeight },
            bottomInset != null && { marginBottom: bottomInset },
            sheetStyle,
          ]}
        >
        <SafeAreaView
          style={styles.sheetSafe}
          edges={['bottom']}
        >
          {sheet ? (
            <GestureDetector gesture={panGesture}>
              <View style={styles.handleWrap}>
                <View style={styles.handle} />
                {title ? <Text style={styles.sheetTitle}>{title}</Text> : null}
              </View>
            </GestureDetector>
          ) : title ? (
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <FastPressable
                onPress={onClose}
                hitSlop={12}
              >
                <PwaIcon name="close" size={22} color={colors.textLight} />
              </FastPressable>
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
  backdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
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
