import React from 'react';
import {
  Animated,
  Easing,
  Modal as RNModal,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontSize, spacing, waiterLayout } from '@/theme';
import { PwaIcon } from './PwaIcon';
import { FastPressable } from './FastPressable';

const CLOSE_DRAG_DISTANCE = 110;
// Паритет с PWA: панель чисто «выдвигается» на всю свою высоту (translateY 100%→0)
// за 240ms с cubic-bezier(0.4,0,0.2,1), без затухания самой панели — только фон.
const SHEET_ENTER_MS = 240;
const SHEET_EXIT_MS = 220;
const SHEET_FALLBACK_H = 900;
const SHEET_EASE = Easing.bezier(0.4, 0, 0.2, 1);

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
  // translateY анимируется напрямую (не через progress-интерполяцию), чтобы
  // выезжать ровно на измеренную высоту листа — как PWA translateY(100%).
  const translateY = React.useRef(new Animated.Value(SHEET_FALLBACK_H)).current;
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;
  const dragY = React.useRef(new Animated.Value(0)).current;
  const sheetHeightRef = React.useRef(SHEET_FALLBACK_H);
  const pendingEnterRef = React.useRef(false);
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
    translateY.stopAnimation();
    backdropOpacity.stopAnimation();
    if (visible) {
      // Держим лист скрытым до onLayout, где узнаем точную высоту и запустим въезд.
      translateY.setValue(sheetHeightRef.current);
      backdropOpacity.setValue(0);
      dragY.setValue(0);
      pendingEnterRef.current = true;
      setRender(true);
      return;
    }
    pendingEnterRef.current = false;
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: sheetHeightRef.current,
        duration: SHEET_EXIT_MS,
        easing: SHEET_EASE,
        isInteraction: false,
        useNativeDriver: true,
      }),
      Animated.timing(dragY, {
        toValue: 0,
        duration: SHEET_EXIT_MS,
        easing: SHEET_EASE,
        isInteraction: false,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: SHEET_EXIT_MS,
        easing: SHEET_EASE,
        isInteraction: false,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setRender(false);
    });
  }, [backdropOpacity, dragY, translateY, visible]);

  const handleSheetLayout = React.useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = e.nativeEvent.layout.height;
      if (h > 0) sheetHeightRef.current = h;
      if (pendingEnterRef.current && h > 0) {
        pendingEnterRef.current = false;
        translateY.setValue(h);
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: 0,
            duration: SHEET_ENTER_MS,
            easing: SHEET_EASE,
            isInteraction: false,
            useNativeDriver: true,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: SHEET_ENTER_MS,
            easing: SHEET_EASE,
            isInteraction: false,
            useNativeDriver: true,
          }),
        ]).start();
      }
    },
    [backdropOpacity, translateY],
  );

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
          style={[styles.backdropFill, bottomInset != null && { bottom: bottomInset }, { opacity: backdropOpacity }]}
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
            { transform: [{ translateY }, { translateY: dragY }] },
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
