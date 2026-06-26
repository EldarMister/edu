import React from 'react';
import {
  Animated,
  Easing,
  Modal as RNModal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontSize, spacing, waiterLayout } from '@/theme';
import { PwaIcon } from './PwaIcon';

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

  React.useEffect(() => {
    if (visible) {
      setRender(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 440,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: 260,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setRender(false);
    });
  }, [progress, visible]);

  if (!render) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [520, 0],
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
            { transform: [{ translateY }] },
          ]}
        >
        <SafeAreaView
          style={styles.sheetSafe}
          edges={['bottom']}
        >
          {sheet ? (
            <View style={styles.handleWrap}>
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
