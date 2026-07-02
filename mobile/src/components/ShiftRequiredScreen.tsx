import React from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FastPressable } from '@/components/FastPressable';
import { ShiftStartAnimation, type ShiftAnimState } from './ShiftStartAnimation';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useStartShift } from '@/services/api/waiter';
import { useNotifications } from '@/store/notifications';

const TEXT: Record<ShiftAnimState, { title: string; subtitle: string }> = {
  idle: { title: 'Смена не начата', subtitle: 'Чтобы принимать заказы, начните смену' },
  loading: { title: 'Проверяем данные…', subtitle: 'Это займёт несколько секунд' },
  success: { title: 'Смена начата', subtitle: '' },
};

const MIN_LOADING_MS = 1450;
const SUCCESS_HOLD_MS = 680;
const FADE_MS = 260;

/**
 * Полноэкранный экран «Смена не начата» (строго по референсу designe/Смена не начата):
 * белый фон, без шапки и нижней навигации. Логотип EP с мягким свечением выше центра,
 * текстовый блок под ним, крупная синяя кнопка «Начать смену» внизу.
 *
 * onBusyChange(true) — запуск пошёл: родитель удерживает экран до конца анимации успеха;
 * onBusyChange(false) — можно показать рабочие вкладки (после анимации либо при ошибке).
 */
export function ShiftRequiredScreen({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [phase, setPhase] = React.useState<ShiftAnimState>('idle');
  const startShift = useStartShift();
  const pushToast = useNotifications((s) => s.push);

  const fade = React.useRef(new Animated.Value(1)).current;
  const btnScale = React.useRef(new Animated.Value(1)).current;
  const successTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    },
    [],
  );

  // Успех: выдержать паузу и плавно убрать экран (родитель покажет выбранный раздел).
  React.useEffect(() => {
    if (phase !== 'success') return;
    const timer = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() =>
        onBusyChange(false),
      );
    }, SUCCESS_HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase, fade, onBusyChange]);

  const beginLoading = () => {
    onBusyChange(true);
    setPhase('loading');
    const startedAt = Date.now();
    startShift.mutate(undefined, {
      onSuccess: () => {
        const remaining = Math.max(MIN_LOADING_MS - (Date.now() - startedAt), 0);
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null;
          setPhase('success');
        }, remaining);
      },
      onError: () => {
        if (successTimerRef.current) {
          clearTimeout(successTimerRef.current);
          successTimerRef.current = null;
        }
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
    Animated.timing(btnScale, { toValue: 0.97, duration: 90, useNativeDriver: true }).start(() => {
      Animated.timing(btnScale, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      beginLoading();
    });
  };

  const { title, subtitle } = TEXT[phase];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Animated.View style={[styles.root, { opacity: fade }]}>
        {/* Верхний блок: логотип со свечением + текст, чуть выше центра */}
        <View style={styles.topSpacer} />
        <View style={styles.center}>
          <ShiftStartAnimation state={phase} />
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.bottomSpacer} />

        {/* Кнопка в нижней части экрана */}
        <View style={styles.footer}>
          {phase === 'idle' ? (
            <Animated.View style={{ transform: [{ scale: btnScale }] }}>
              <FastPressable style={styles.button} onPress={onStart}>
                <Text style={styles.buttonText}>Начать смену</Text>
              </FastPressable>
            </Animated.View>
          ) : phase === 'loading' ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  root: { flex: 1 },
  // Группа «логотип + текст» сидит чуть выше середины экрана.
  topSpacer: { flex: 0.82 },
  bottomSpacer: { flex: 1.18 },
  center: { alignItems: 'center', paddingHorizontal: spacing.xl },
  title: {
    marginTop: spacing.xl,
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: spacing.sm,
    fontSize: fontSize.md,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    minHeight: 54 + spacing.lg,
    justifyContent: 'flex-end',
  },
  footerLoading: { height: 54, alignItems: 'center', justifyContent: 'center' },
  button: {
    height: 54,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: fontSize.md },
});
