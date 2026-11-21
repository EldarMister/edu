import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, Field } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSplitOrder } from '@/services/api/splitOrder';
import { colors, radius, spacing } from '@/theme';
import { displayOrderNumber, money, orderItemDisplayName } from '@/utils/format';
import type { Order } from '@/types';
import { canSplitOrder, splitItemCanChangeQuantity, splitOrderItems, splitOrderLines } from './splitOrderPlan';

export function SplitOrderSheet({ order, onClose, onSplit }: {
  order: Order;
  onClose: () => void;
  onSplit: (source: Order, next: Order) => void;
}) {
  const { width } = useWindowDimensions();
  const t = useT();
  const mutation = useSplitOrder();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const request = useRef<{ payload: string; key: string }>();
  const submitting = useRef(false);
  const mounted = useRef(true);
  const items = splitOrderItems(order);
  const { lines, keepsSource } = splitOrderLines(items, selected);
  const valid = canSplitOrder(order) && lines.length > 0 && keepsSource;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function change(id: string, value?: string) {
    mutation.reset();
    setSelected((current) => {
      if (value !== undefined) return { ...current, [id]: value };
      const remaining = { ...current };
      delete remaining[id];
      return remaining;
    });
  }

  async function submit() {
    if (!valid || submitting.current || !order.updatedAt) return;
    const payload = JSON.stringify({ items: lines, updatedAt: order.updatedAt });
    if (request.current?.payload !== payload) request.current = { payload, key: randomUUID() };
    submitting.current = true;
    try {
      const result = await mutation.mutateAsync({
        orderId: order.id, items: lines, expectedUpdatedAt: order.updatedAt, idempotencyKey: request.current.key,
      });
      if (mounted.current) onSplit(result.sourceOrder, result.newOrder);
    } catch {
      // Keep the selection and request key for retry.
    } finally {
      submitting.current = false;
    }
  }

  const close = () => { if (!submitting.current) onClose(); };
  return <BottomSheet visible title="Разделить по позициям" presentation={width >= 768 ? 'dialog' : 'bottom'}
    onClose={close} dismissible={!mutation.isPending} footer={<View style={styles.actions}>
      <Button title="Отмена" variant="secondary" disabled={mutation.isPending} onPress={close} />
      <Button title="Создать отдельный чек" loading={mutation.isPending} disabled={!valid} onPress={() => void submit()} />
    </View>}>
    <SheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>{displayOrderNumber(order.orderNumber)}. {t('Отметьте позиции и количество для нового чека.')}</Text>
      {items.map((item) => {
        const name = orderItemDisplayName(item);
        const value = selected[item.id];
        const checked = value !== undefined;
        return <View key={item.id} style={styles.row}>
          <FastPressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: mutation.isPending }}
            accessibilityLabel={name} style={styles.selection} disabled={mutation.isPending}
            onPress={() => change(item.id, checked ? undefined : String(item.quantity))}>
            <View style={[styles.checkBox, checked && styles.checked]}>
              {checked && <PwaIcon name="check" size={14} color={colors.white} />}
            </View>
            <View style={styles.item}>
              <Text style={styles.itemName}>{name}</Text>
              <Text style={styles.muted}>×{item.quantity} · {money(item.finalPrice)}</Text>
            </View>
          </FastPressable>
          {checked && splitItemCanChangeQuantity(item) ? <Field label="Перенести" value={value} keyboardType="number-pad"
            accessibilityLabel={`Количество · ${name}`} editable={!mutation.isPending}
            onChangeText={(quantity) => change(item.id, quantity)} containerStyle={styles.quantity} /> : null}
        </View>;
      })}
      {!keepsSource && <Text style={styles.error} translate>Оставьте хотя бы одну позицию в исходном чеке.</Text>}
      {mutation.isError && <Text accessibilityRole="alert" style={styles.error}>{apiError(mutation.error)}</Text>}
    </SheetScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', padding: spacing.sm,
    gap: spacing.sm, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, minHeight: 54 },
  selection: { flex: 1, minWidth: 150, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  item: { flex: 1, minWidth: 0 },
  itemName: { fontWeight: '600' },
  muted: { color: colors.textMuted },
  checkBox: { width: 22, height: 22, borderRadius: 5, borderColor: colors.border, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
  quantity: { minWidth: 88 },
  error: { color: colors.danger },
});
