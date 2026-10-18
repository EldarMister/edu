import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/typography';
import Animated, {
  interpolate,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FastPressable } from '@/components/FastPressable';
import { colors, fontSize, radius, spacing, softShadow } from '@/theme';
import { popTiming } from '@/components/motion';
import { type AppNotification, useNotifications } from '@/store/notifications';

const TOAST_EXIT_MS = 260;

type RenderedToast = AppNotification & { exiting?: boolean };

export function Toaster() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const maxWidth = width >= 640 ? 384 : width - 24;
  const toasts = useNotifications((s) => s.toasts);
  const [rendered, setRendered] = React.useState<RenderedToast[]>([]);

  React.useEffect(() => {
    setRendered((prev) => {
      const nextById = new Map(toasts.map((t) => [t.id, t]));
      const prevIds = new Set(prev.map((t) => t.id));
      const next: RenderedToast[] = [];

      for (const item of prev) {
        const active = nextById.get(item.id);
        if (active) next.push({ ...active, exiting: false });
        else next.push({ ...item, exiting: true });
      }

      for (const item of toasts) {
        if (!prevIds.has(item.id)) next.push({ ...item, exiting: false });
      }

      return next;
    });
  }, [toasts]);

  React.useEffect(() => {
    if (!rendered.some((t) => t.exiting)) return;
    const timer = setTimeout(() => {
      setRendered((items) => items.filter((t) => !t.exiting));
    }, TOAST_EXIT_MS);
    return () => clearTimeout(timer);
  }, [rendered]);

  if (rendered.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 12, maxWidth }]}>
      {rendered.map((t) => (
        <Toast key={t.id} toast={t} maxWidth={maxWidth} />
      ))}
    </View>
  );
}

function Toast({ toast, maxWidth }: { toast: RenderedToast; maxWidth: number }) {
  const dismiss = useNotifications((s) => s.dismiss);
  const progress = useSharedValue(0);
  const collapse = useSharedValue(1);
  const exitOpacity = useSharedValue(1);

  React.useEffect(() => {
    progress.value = withTiming(1, {
      duration: 180,
      easing: popTiming.easing,
    });
  }, [progress]);

  React.useEffect(() => {
    collapse.value = withTiming(toast.exiting ? 0 : 1, { duration: TOAST_EXIT_MS, easing: popTiming.easing });
    exitOpacity.value = withTiming(toast.exiting ? 0 : 1, { duration: 200, easing: Easing.bezier(0.25, 0.1, 0.25, 1) });
  }, [collapse, exitOpacity, toast.exiting]);

  React.useEffect(() => {
    if (toast.exiting) return;
    const ms = toast.durationMs ?? (toast.type === 'error' ? 4000 : 2800);
    const timer = setTimeout(() => dismiss(toast.id), ms);
    return () => clearTimeout(timer);
  }, [dismiss, toast.durationMs, toast.exiting, toast.id, toast.type]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value * exitOpacity.value,
    maxHeight: 72 * collapse.value,
    marginBottom: spacing.sm * collapse.value,
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [18, 0]) },
      { translateY: (1 - progress.value) * 8 - (1 - collapse.value) * 18 },
      { scale: interpolate(progress.value, [0, 1], [0.98, 1]) },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.toastShell,
        animatedStyle,
      ]}
      pointerEvents={toast.exiting ? 'none' : 'auto'}
      accessibilityElementsHidden={toast.exiting}
      importantForAccessibility={toast.exiting ? 'no-hide-descendants' : 'auto'}
    >
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
    maxHeight: 72,
  },
  toast: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    ...softShadow,
  },
  toastText: {
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
});
