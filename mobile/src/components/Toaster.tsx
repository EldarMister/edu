import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/typography';
import Animated, { FadeInRight, FadeOutRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FastPressable } from '@/components/FastPressable';
import { colors, fontSize, radius, spacing } from '@/theme';
import { type AppNotification, useNotifications } from '@/store/notifications';

const toastEnter = FadeInRight.duration(180);
const toastExit = FadeOutRight.duration(140);

export function Toaster() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const maxWidth = width >= 640 ? 384 : width - 24;
  const toasts = useNotifications((s) => s.toasts);
  return (
    <View collapsable={false} pointerEvents="box-none" style={[styles.host, { top: insets.top + 12, maxWidth }]}>
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} maxWidth={maxWidth} />
      ))}
    </View>
  );
}

function Toast({ toast, maxWidth }: { toast: AppNotification; maxWidth: number }) {
  const dismiss = useNotifications((s) => s.dismiss);

  React.useEffect(() => {
    const ms = toast.durationMs ?? (toast.type === 'error' ? 4000 : 2800);
    const timer = setTimeout(() => dismiss(toast.id), ms);
    return () => clearTimeout(timer);
  }, [dismiss, toast.durationMs, toast.id, toast.type]);

  return (
    <Animated.View entering={toastEnter} exiting={toastExit} style={styles.toastShell}>
      <FastPressable onPress={() => dismiss(toast.id)} style={[styles.toast, { maxWidth }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text numberOfLines={1} style={styles.toastText}>
          {toast.message}
        </Text>
      </FastPressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 1000,
    alignItems: 'flex-end',
  },
  toastShell: {
    marginBottom: spacing.sm,
  },
  toast: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  toastText: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
});
