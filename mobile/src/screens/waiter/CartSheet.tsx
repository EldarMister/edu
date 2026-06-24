import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, RoundBtn } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { colors, fontSize, spacing } from '@/theme';
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
  const { lines, setQuantity, setTakeaway, clear, total } = useCart();
  const hasLines = lines.length > 0;
  const allTakeaway = hasLines && lines.every((l) => l.takeaway);

  const footer = (
    <View style={{ gap: spacing.sm, paddingBottom: spacing.sm }}>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Итого</Text>
        <Text style={styles.totalValue}>{money(total())}</Text>
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
    <BottomSheet visible={visible} onClose={onClose} sheet footer={footer} bodyStyle={{ paddingVertical: 0 }}>
      <View style={styles.headRow}>
        <Text style={styles.title}>Корзина</Text>
        {hasLines ? (
          <View style={styles.takeawayRow}>
            <Text style={styles.takeawayLabel}>С собой</Text>
            <Switch
              value={allTakeaway}
              onValueChange={(v) => lines.forEach((_, i) => setTakeaway(i, v))}
              trackColor={{ true: colors.primary, false: colors.slate300 }}
              thumbColor={colors.white}
            />
          </View>
        ) : null}
      </View>

      <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
        {!hasLines ? (
          <Text style={styles.empty}>Корзина пуста</Text>
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
                  <Pressable onPress={() => setTakeaway(i, false)} style={styles.takeawayChip}>
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
  takeawayLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: fontSize.sm, paddingVertical: spacing.xxl },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  lineBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  lineName: { fontSize: fontSize.base, color: colors.textPrimary },
  lineSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  takeawayChip: {
    alignSelf: 'flex-start',
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  takeawayChipText: { fontSize: fontSize.xs, color: colors.textSecondary },
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
});
