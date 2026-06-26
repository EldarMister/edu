import React from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, RoundBtn } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { NumberTicker } from '@/components/NumberTicker';
import { colors, fontSize, radius, spacing, waiterLayout } from '@/theme';
import { useCart, linePrice } from '@/store/cart';
import { money } from '@/utils/format';

/** Корзина как нижний лист поверх меню — повторяет PWA CartSheet. */
export function CartSheet({
  visible,
  onClose,
  onSubmit,
  submitting,
  submitLabel,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const insets = useSafeAreaInsets();
  const { lines, setQuantity, setTakeaway, clear, total } = useCart();
  const hasLines = lines.length > 0;
  const allTakeaway = hasLines && lines.every((l) => l.takeaway);

  const footer = (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Итого</Text>
        <NumberTicker value={total()} style={styles.totalValue} digitHeight={22} />
      </View>
      <Button title={submitLabel} onPress={onSubmit} loading={submitting} disabled={!hasLines} />
      {hasLines ? (
        <Pressable onPress={() => clear()} style={styles.clearBtn}>
          <Text style={styles.clearText}>Очистить</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      sheet
      footer={footer}
      bodyStyle={{ paddingVertical: 0 }}
      maxHeight="78%"
      bottomInset={waiterLayout.navBarHeight + insets.bottom}
    >
      <View style={styles.headRow}>
        <Text style={styles.title}>Корзина</Text>
        {hasLines ? (
          <View style={styles.takeawayRow}>
            <Text style={styles.takeawayLabel}>С собой</Text>
            <TakeawaySwitch
              on={allTakeaway}
              onChange={(v) => lines.forEach((_, i) => setTakeaway(i, v))}
            />
          </View>
        ) : null}
      </View>

      <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
        {!hasLines ? (
          <View style={styles.emptyBox}>
            <Text style={styles.empty}>Корзина пуста</Text>
          </View>
        ) : (
          lines.map((l, i) => (
            <View
              key={l.lineId ?? `${l.dish.id}-${l.variant?.id ?? ''}-${i}`}
              style={[styles.line, i > 0 && styles.lineBorder]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.lineName} numberOfLines={1}>
                  {l.dish.name}
                  {l.variant ? ` · ${l.variant.name}` : ''}
                </Text>
                {l.set ? (
                  <Text style={styles.lineSub}>
                    {l.set.components.filter((c) => c.action !== 'removed').length} блюд
                  </Text>
                ) : null}
                {l.takeaway ? (
                  <Pressable onPress={() => setTakeaway(i, false)} style={styles.takeawayChip} hitSlop={6}>
                    <PwaIcon name="bag" size={12} color={colors.textSecondary} strokeWidth={2} />
                    <Text style={styles.takeawayChipText}>С собой</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.stepper}>
                <RoundBtn kind="dec" onPress={() => setQuantity(i, l.quantity - 1)} />
                <Text style={styles.qty}>{l.quantity}</Text>
                <RoundBtn kind="inc" onPress={() => setQuantity(i, l.quantity + 1)} />
              </View>
              <Text style={styles.linePrice}>{money(linePrice(l))}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </BottomSheet>
  );
}

function TakeawaySwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const progress = React.useRef(new Animated.Value(on ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: on ? 1 : 0,
      duration: 180,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [on, progress]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [2, 18] });
  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.slate300, colors.primary],
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={() => onChange(!on)}
      style={styles.switchPress}
      hitSlop={8}
    >
      <Animated.View style={[styles.switchTrack, { backgroundColor }]}>
        <Animated.View style={[styles.switchThumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  takeawayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  takeawayLabel: { fontSize: fontSize.base, color: colors.textSecondary },
  emptyBox: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingVertical: spacing.xxl,
  },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: fontSize.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  lineBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  lineName: { fontSize: fontSize.base, color: colors.textPrimary },
  lineSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  takeawayChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.white,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  takeawayChipText: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qty: { width: 20, textAlign: 'center', fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  linePrice: { width: 70, textAlign: 'right', fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  totalLabel: { fontSize: fontSize.base, color: colors.textSecondary, fontWeight: '500' },
  totalValue: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  clearBtn: { height: 36, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '500' },
  switchPress: {
    width: 36,
    height: 20,
  },
  switchTrack: {
    width: 36,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
  },
  switchThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
});
