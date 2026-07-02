import React from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, RoundBtn } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { NumberTicker } from '@/components/NumberTicker';
import { colors, fontSize, radius, spacing, waiterLayout } from '@/theme';
import { cartLineName, linePrice, useCart } from '@/store/cart';
import { setChanged } from '@/utils/set';
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
  const { lines, comment, commentOpen, setQuantity, setTakeaway, setAllTakeaway, setOrderComment, setCommentOpen, clear, total } =
    useCart();
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
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
        <View style={styles.actionsRow}>
          <FastPressable onPress={() => clear()} style={styles.clearBtn}>
            <Text style={styles.clearText}>Очистить</Text>
          </FastPressable>
          <FastPressable onPress={() => setCommentOpen(!commentOpen)} style={styles.clearBtn}>
            <Text style={[styles.clearText, commentOpen && styles.commentToggleActive]}>
              {commentOpen ? 'Скрыть комментарий' : 'Комментарий'}
            </Text>
          </FastPressable>
        </View>
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
              onChange={setAllTakeaway}
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
          lines.map((l, i) => {
            const key = l.lineId ?? `${l.dish.id}-${l.variant?.id ?? ''}-${i}`;
            const isSet = !!l.set;
            const open = !!expanded[key];
            return (
            <View
              key={key}
              style={[styles.line, i > 0 && styles.lineBorder]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <FastPressable disabled={!isSet} onPress={() => setExpanded((current) => ({ ...current, [key]: !open }))}>
                  <Text style={styles.lineName} numberOfLines={1}>{cartLineName(l)}</Text>
                </FastPressable>
                {l.set ? (
                  <Text style={styles.lineSub}>
                    {setChanged(l) ? 'Состав изменён' : `${l.set.components.length} блюд`} · {open ? 'скрыть' : 'состав'}
                  </Text>
                ) : null}
                {l.takeaway ? (
                  <FastPressable onPress={() => setTakeaway(i, false)} style={styles.takeawayChip} hitSlop={6}>
                    <PwaIcon name="bag" size={12} color={colors.textSecondary} strokeWidth={2} />
                    <Text style={styles.takeawayChipText}>С собой</Text>
                  </FastPressable>
                ) : null}
              </View>
              <View style={styles.stepper}>
                <RoundBtn kind="dec" onPress={() => setQuantity(i, l.quantity - 1)} />
                <Text style={styles.qty}>{l.quantity}</Text>
                <RoundBtn kind="inc" onPress={() => setQuantity(i, l.quantity + 1)} />
              </View>
              <Text style={styles.linePrice}>{money(linePrice(l))}</Text>
              {isSet && open ? (
                <View style={styles.setComponents}>
                  {l.set!.components.map((component) => (
                    <Text key={component.componentId} style={styles.setComponentText} numberOfLines={1}>
                      {component.action === 'removed'
                        ? `− ${component.originalName}`
                        : component.action === 'replaced'
                          ? `${component.originalName} → ${component.finalName}`
                          : component.originalName}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
            );
          })
        )}
      </ScrollView>
      {hasLines && commentOpen ? (
        <TextInput
          value={comment}
          onChangeText={setOrderComment}
          placeholder="Комментарий к заказу"
          placeholderTextColor={colors.textLight}
          style={styles.commentInput}
          autoFocus
        />
      ) : null}
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
      useNativeDriver: true,
    }).start();
  }, [on, progress]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [2, 18] });
  return (
    <FastPressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={() => onChange(!on)}
      style={styles.switchPress}
      hitSlop={8}
    >
      <View style={[styles.switchTrack, { backgroundColor: on ? colors.primary : colors.slate300 }]}>
        <Animated.View style={[styles.switchThumb, { transform: [{ translateX }] }]} />
      </View>
    </FastPressable>
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
  line: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.md, paddingVertical: spacing.sm },
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
  setComponents: { width: '100%', gap: 2, paddingLeft: 2, marginTop: -2 },
  setComponentText: { fontSize: fontSize.xs, color: colors.textMuted },
  commentInput: {
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
  },
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
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clearBtn: { height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  clearText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '500' },
  commentToggleActive: { color: colors.textSecondary },
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
