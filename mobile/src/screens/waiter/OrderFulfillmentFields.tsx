import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { apiError } from '@/lib/api';
import { Button } from '@/components/ui';
import { Select } from '@/components/Select';
import type { Order } from '@/types';
import { useHalls, useUpdateOrderFulfillment } from '@/services/api/waiter';
import { colors, radius, spacing } from '@/theme';
import { TERMINAL_ORDER_TYPES, orderTypeLabel, type TerminalOrderType } from './orderRules';

export function OrderTypeSelect({ value, disabled, onChange }: { value: TerminalOrderType; disabled?: boolean; onChange: (value: TerminalOrderType) => void }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={{ gap: spacing.xs }}>
    <FastPressable accessibilityRole="button" accessibilityLabel="Тип заказа" accessibilityState={{ expanded, disabled }}
      disabled={disabled} onPress={() => setExpanded(!expanded)} style={styles.choice}>
      <PwaIcon name={value === 'dine_in' ? 'grid' : 'transfer'} size={15} color={colors.textSecondary} />
      <Text style={styles.label} translate>{orderTypeLabel(value)}</Text>
      <PwaIcon name="chevronDown" size={14} color={colors.textMuted} />
    </FastPressable>
    {expanded && TERMINAL_ORDER_TYPES.map(({ value: option, label }) =>
      <FastPressable key={option} accessibilityRole="button" accessibilityState={{ selected: value === option }}
        style={styles.choice} onPress={() => { setExpanded(false); onChange(option); }}>
        <Text style={styles.label} translate>{label}</Text>
      </FastPressable>)}
  </View>;
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, minHeight: 32,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  fields: { gap: spacing.xs, marginVertical: spacing.sm },
  label: { color: colors.textSecondary, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
});

export function EditOrderFulfillment({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TerminalOrderType>(() => order.source === 'delivery' ? 'delivery' : 'dine_in');
  const [tableId, setTableId] = useState(order.source !== 'delivery' ? order.table.id : '');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(order.updatedAt);
  const halls = useHalls();
  const save = useUpdateOrderFulfillment();
  const tables = (halls.data ?? []).flatMap((hall) => hall.tables
    .filter((table) => table.id === order.table.id || table.status === 'free')
    .map((table) => ({ value: table.id, label: String(table.number) + ' · ' + hall.name })));

  function submit() {
    if (!version) return;
    const problem = type === 'dine_in' && !tableId ? 'Выберите стол' : '';
    setError(problem);
    if (!problem) save.mutate({ orderId: order.id, expectedUpdatedAt: version,
      ...(type === 'dine_in' ? { tableId } : { delivery: { type } }),
    }, { onSuccess: () => setOpen(false), onError: (reason) => setError(apiError(reason)) });
  }

  return <View style={styles.fields}>
    <Button title={open ? 'Отмена' : 'Изменить тип заказа'} variant="secondary" size="md" onPress={() => {
      if (!open) setVersion(order.updatedAt);
      setOpen(!open);
      setError('');
    }} disabled={save.isPending} />
    {open ? <>
      <OrderTypeSelect value={type} disabled={save.isPending} onChange={setType} />
      {type === 'dine_in'
        ? <Select title="Стол" value={tableId} onChange={setTableId} options={[{ value: '', label: 'Выберите стол' }, ...tables]} />
        : null}
      {error ? <Text accessibilityRole="alert" style={styles.error} translate>{error}</Text> : null}
      <Button title="Сохранить" size="md" onPress={submit} loading={save.isPending} />
    </> : null}
  </View>;
}
