import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { ShiftStartAnimation, type ShiftAnimState } from './ShiftStartAnimation';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useStartShift } from '@/services/api/waiter';
import { useNotifications } from '@/store/notifications';

const TEXT: Record<ShiftAnimState, { title: string; subtitle: string }> = {
  idle: { title: 'Смена не начата', subtitle: 'Начните смену, чтобы принимать заказы.' },
  loading: { title: 'Запускаем смену…', subtitle: 'Это займёт несколько секунд' },
  success: { title: 'Смена начата', subtitle: '' },
};

/**
 * Экран «Смена не начата» (строго по референсу /designe).
 * Показывается поверх контента выбранной вкладки, пока смена не активна.
 * onBusyChange(true) — запуск пошёл: родитель удерживает оверлей, даже когда
 * смена уже стала активной, пока не доиграет анимация успеха;
 * onBusyChange(false) — можно убрать оверлей (после анимации либо при ошибке).
 */
export function ShiftRequiredScreen({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [phase, setPhase] = React.useState<ShiftAnimState>('idle');
  const startShift = useStartShift();
  const pushToast = useNotifications((s) => s.push);

  const fade = React.useRef(new Animated.Value(1)).current;
  const btnScale = React.useRef(new Animated.Value(1)).current;

  // Успех: показать галочку, выдержать паузу и плавно убрать экран.
  React.useEffect(() => {
    if (phase !== 'success') return;
    const timer = setTimeout(() => {
      Animated.timing(fade, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start(() => onBusyChange(false));
    }, 420);
    return () => clearTimeout(timer);
  }, [phase, fade, onBusyChange]);

  const beginLoading = () => {
    // Удерживаем оверлей на всё время запуска (loading → success → fade).
    onBusyChange(true);
    setPhase('loading');
    startShift.mutate(undefined, {
      onSuccess: () => setPhase('success'),
      onError: () => {
        setPhase('idle');
        onBusyChange(false);
        pushToast({
          message: 'Не удалось начать смену. Попробуйте ещё раз.',
          type: 'error',
          at: new Date().toISOString(),
        });
      },
    });
  };

  const onStart = () => {
    if (phase !== 'idle') return;
    // Сначала лёгкое нажатие кнопки (scale 0.97), затем состояние загрузки.
    Animated.timing(btnScale, { toValue: 0.97, duration: 90, useNativeDriver: true }).start(() => {
      Animated.timing(btnScale, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      beginLoading();
    });
  };

  const { title, subtitle } = TEXT[phase];

  return (
    <Animated.View style={[styles.root, { opacity: fade }]}>
      <View style={styles.center}>
        <ShiftStartAnimation state={phase} />
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <View style={styles.footer}>
        {phase === 'idle' ? (
          <Animated.View style={{ transform: [{ scale: btnScale }] }}>
            <Pressable style={styles.button} onPress={onStart}>
              <Text style={styles.buttonText}>Начать смену</Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  title: {
    marginTop: spacing.xxl,
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: fontSize.base,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, minHeight: 48 + spacing.xl },
  button: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.white, fontWeight: '600', fontSize: fontSize.base },
});
