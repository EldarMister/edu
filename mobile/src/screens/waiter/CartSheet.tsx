import React from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/typography';
import { useIsFocused } from '@react-navigation/native';
import { Button, RoundBtn } from '@/components/ui';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { NumberTicker } from '@/components/NumberTicker';
import { colors, fontSize, radius, spacing } from '@/theme';
import { cartLineName, linePrice, useCart } from '@/store/cart';
import { setChanged } from '@/utils/set';

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
  const focused = useIsFocused();
  const {
    lines,
    comment,
    commentOpen,
    setQuantity,
    setTakeaway,
    setAllTakeaway,
    setOrderComment,
    setCommentOpen,
    clear,
    total,
  } =
    useCart();
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const hasLines = lines.length > 0;
  const allTakeaway = hasLines && lines.every((l) => l.takeaway);

  const footer = (
    <View style={styles.footerContent}>
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
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel} translate>Итого</Text>
        <NumberTicker value={total()} style={styles.totalValue} digitHeight={22} />
      </View>
      <Button
        title={submitLabel}
        onPress={onSubmit}
        loading={submitting}
        disabled={!hasLines}
        style={styles.submitButton}
      />
      {hasLines ? (
        <View style={styles.actionsRow}>
          <FastPressable onPress={() => { clear(); onClose(); }} style={styles.clearBtn}>
            <Text style={styles.clearText} translate>Очистить</Text>
          </FastPressable>
          <FastPressable onPress={() => setCommentOpen(!commentOpen)} style={styles.clearBtn}>
            <Text style={[styles.clearText, commentOpen && styles.commentToggleActive]} translate>
              {commentOpen ? 'Скрыть комментарий' : 'Комментарий'}
            </Text>
          </FastPressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <BottomSheet
      visible={visible && focused}
      onClose={onClose}
      inline
      sheet
      animationPreset="cart"
      footer={footer}
      footerStyle={styles.footer}
      bodyStyle={{ paddingVertical: 0 }}
      maxHeight="78%"
      headerContent={<View style={styles.header}>
      <View style={styles.handle} />
      <View style={styles.headRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1} translate>
            Корзина
          </Text>
        </View>
        <View style={styles.headActions}>
          {hasLines ? (
            <View style={styles.takeawayRow}>
              <Text style={styles.takeawayLabel} translate>С собой</Text>
              <TakeawaySwitch
                on={allTakeaway}
                onChange={setAllTakeaway}
              />
            </View>
          ) : null}
        </View>
      </View>
      </View>}
    >
      <SheetScrollView style={styles.lines} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {!hasLines ? (
          <View style={styles.emptyBox}>
            <Text style={styles.empty} translate>Корзина пуста</Text>
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
              <View style={styles.lineMain}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <FastPressable disabled={!isSet} onPress={() => setExpanded((current) => ({ ...current, [key]: !open }))}>
                  <Text style={styles.lineName} numberOfLines={1}>{cartLineName(l)}</Text>
                </FastPressable>
                {l.set ? (
                  <Text style={styles.lineSub} translate>
                    {setChanged(l) ? 'Состав изменён' : `${l.set.components.length} блюд`}
                    <Text style={styles.setToggle}>{open ? ' ▴' : ' ▾'}</Text>
                  </Text>
                ) : null}
                {l.takeaway ? (
                  <FastPressable onPress={() => setTakeaway(i, false)} style={styles.takeawayChip} hitSlop={6}>
                    <PwaIcon name="bag" size={12} color={colors.textSecondary} strokeWidth={2} />
                    <Text style={styles.takeawayChipText} translate>С собой</Text>
                  </FastPressable>
                ) : null}
              </View>
              <View style={styles.stepper}>
                <RoundBtn kind="dec" onPress={() => setQuantity(i, l.quantity - 1)} />
                <Text style={styles.qty}>{l.quantity}</Text>
                <RoundBtn kind="inc" onPress={() => setQuantity(i, l.quantity + 1)} />
              </View>
              <View style={styles.linePrice}>
                <NumberTicker value={linePrice(l)} style={styles.linePriceText} digitHeight={21} />
              </View>
              </View>
              {isSet && open ? (
                <View style={styles.setComponents}>
                  {l.set!.components.map((component) => (
                    <Text key={component.componentId} style={styles.setComponentText} numberOfLines={1}>
                      {component.action === 'removed' ? (
                        <Text style={styles.removedComponent}>{component.originalName}</Text>
                      ) : component.action === 'replaced' ? (
                        <><Text style={styles.removedComponent}>{component.originalName}</Text><Text style={styles.setToggle}> → {component.finalName}</Text></>
                      ) : component.originalName}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
            );
          })
        )}
      </SheetScrollView>
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
  header: { paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: spacing.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.slate300, marginBottom: 10 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  headActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  takeawayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  takeawayLabel: { fontSize: 14, color: colors.textSecondary },
  emptyBox: {
    paddingVertical: 48,
  },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: fontSize.sm },
  line: { paddingVertical: spacing.sm },
  lineMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  lineBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  lineName: { fontSize: fontSize.base, color: colors.textPrimary },
  lineSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  setToggle: { color: colors.primary },
  removedComponent: { color: colors.textLight, textDecorationLine: 'line-through' },
  lines: { flexShrink: 1, minHeight: 0 },
  footer: { borderTopWidth: 0, paddingTop: spacing.md },
  footerContent: { gap: 0 },
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
  takeawayChipText: { fontSize: 11, color: colors.textSecondary, lineHeight: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qty: { width: 20, textAlign: 'center', fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  linePrice: { width: 68, alignItems: 'flex-end' },
  linePriceText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  setComponents: { width: '100%', gap: 2, paddingLeft: 4, marginTop: 6 },
  setComponentText: { fontSize: 13, color: colors.textSecondary },
  submitButton: { borderRadius: radius.sm, marginTop: spacing.md },
  commentInput: {
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    fontSize: 14,
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
  actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  clearBtn: { height: 36, alignItems: 'center', justifyContent: 'center' },
  clearText: { color: colors.primary, fontSize: 14, fontWeight: '500' },
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
