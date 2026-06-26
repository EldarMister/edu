import React from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, radius, spacing } from '@/theme';
import { type AppNotification, useNotifications } from '@/store/notifications';

const TOAST_EXIT_MS = 260;

type RenderedToast = AppNotification & { exiting?: boolean };

export function Toaster() {
  const insets = useSafeAreaInsets();
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
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 12 }]}>
      {rendered.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </View>
  );
}

function Toast({ toast }: { toast: RenderedToast }) {
  const dismiss = useNotifications((s) => s.dismiss);
  const progress = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: toast.exiting ? 0 : 1,
      duration: toast.exiting ? TOAST_EXIT_MS : 180,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    }).start();
  }, [progress, toast.exiting]);

  React.useEffect(() => {
    if (toast.exiting) return;
    const ms = toast.durationMs ?? (toast.type === 'error' ? 4000 : 2800);
    const timer = setTimeout(() => dismiss(toast.id), ms);
    return () => clearTimeout(timer);
  }, [dismiss, toast.durationMs, toast.exiting, toast.id, toast.type]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [toast.exiting ? 0 : 18, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [toast.exiting ? -18 : 8, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] });

  return (
    <Animated.View
      style={[
        styles.toastShell,
        {
          opacity: progress,
          transform: [{ translateX }, { translateY }, { scale }],
        },
      ]}
    >
      <Pressable onPress={() => dismiss(toast.id)} style={styles.toast}>
        <Text numberOfLines={1} style={styles.toastText}>
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    right: spacing.md,
    zIndex: 1000,
    maxWidth: '92%',
    alignItems: 'flex-end',
  },
  toastShell: {
    marginBottom: spacing.sm,
  },
  toast: {
    maxWidth: 360,
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
