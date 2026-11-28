import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { apiError } from '@/lib/api';
import { Button } from '@/components/ui';
import { Select } from '@/components/Select';
import type { Order } from '@/types';
import { useHalls, useUpdateOrderFulfillment } from '@/services/api/waiter';
import { colors, radius, spacing } from '@/theme';
import { ORDER_TYPES, orderType, orderTypeLabel, type OrderType } from './orderRules';

export const EMPTY_CUSTOMER = { customerName: '', customerPhone: '', deliveryAddress: '', deliveryFee: '', pickupTime: '' };
export const feeValue = (value: string) => Number(value.trim().replace(',', '.'));

export function OrderTypeSelect({ value, disabled, onChange }: { value: OrderType; disabled?: boolean; onChange: (value: OrderType) => void }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={{ gap: spacing.xs }}>
    <FastPressable accessibilityRole="button" accessibilityLabel="Тип заказа" accessibilityState={{ expanded, disabled }}
      disabled={disabled} onPress={() => setExpanded(!expanded)} style={styles.choice}>
      <PwaIcon name={value === 'dine_in' ? 'grid' : value === 'pickup' ? 'bag' : 'transfer'} size={15} color={colors.textSecondary} />
      <Text style={styles.label} translate>{orderTypeLabel(value)}</Text>
      <PwaIcon name="chevronDown" size={14} color={colors.textMuted} />
    </FastPressable>
    {expanded && ORDER_TYPES.map(({ value: option, label }) =>
      <FastPressable key={option} accessibilityRole="button" accessibilityState={{ selected: value === option }}
        style={styles.choice} onPress={() => { setExpanded(false); onChange(option); }}>
        <Text style={styles.label} translate>{label}</Text>
      </FastPressable>)}
  </View>;
}

export function OrderFulfillmentFields({ type, value, onChange, comment, onComment, error, disabled }: {
  type: 'delivery' | 'pickup'; value: typeof EMPTY_CUSTOMER; onChange: (value: typeof EMPTY_CUSTOMER) => void;
  comment: string; onComment: (value: string) => void; error: string; disabled: boolean;
}) {
  const change = (key: keyof typeof EMPTY_CUSTOMER) => (text: string) => onChange({ ...value, [key]: text });
  return <View style={styles.fields}>
    <TextInput style={styles.input} accessibilityLabel="Телефон клиента" placeholder="Телефон клиента" keyboardType="phone-pad"
      maxLength={40} editable={!disabled} value={value.customerPhone} onChangeText={change('customerPhone')} />
    <TextInput style={styles.input} accessibilityLabel="Имя клиента" placeholder="Имя клиента" maxLength={120}
      editable={!disabled} value={value.customerName} onChangeText={change('customerName')} />
    {type === 'delivery' ? <>
      <TextInput style={styles.input} accessibilityLabel="Адрес доставки" placeholder="Адрес доставки" maxLength={300}
        editable={!disabled} value={value.deliveryAddress} onChangeText={change('deliveryAddress')} />
      <TextInput style={styles.input} accessibilityLabel="Стоимость доставки" placeholder="Стоимость доставки" keyboardType="decimal-pad"
        editable={!disabled} maxLength={10} value={value.deliveryFee} onChangeText={change('deliveryFee')} />
    </> : <TextInput style={styles.input} accessibilityLabel="Время самовывоза" placeholder="Время самовывоза (ЧЧ:ММ)"
      editable={!disabled} maxLength={5} value={value.pickupTime} onChangeText={change('pickupTime')} />}
    <TextInput style={styles.input} accessibilityLabel="Комментарий к заказу" placeholder="Комментарий к заказу" maxLength={500}
      editable={!disabled} value={comment} onChangeText={onComment} />
    {error ? <Text accessibilityRole="alert" style={styles.error} translate>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, minHeight: 32,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  fields: { gap: spacing.xs, marginVertical: spacing.sm },
  input: { minHeight: 37, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, color: colors.textPrimary },
  label: { color: colors.textSecondary, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
});

export function customerOrderError(type: 'delivery' | 'pickup', fields: typeof EMPTY_CUSTOMER) {
  if (!/^\+?(?:[ ()-]*\d){6,15}[ ()-]*$/.test(fields.customerPhone.trim())) return 'Укажите корректный телефон клиента';
  if (type === 'delivery' && !fields.deliveryAddress.trim()) return 'Укажите адрес доставки';
  if (type === 'delivery' && (!/^\d{0,7}(?:[.,]\d{0,2})?$/.test(fields.deliveryFee.trim())
    || !Number.isFinite(feeValue(fields.deliveryFee)) || feeValue(fields.deliveryFee) > 9_999_999)) return 'Укажите корректную стоимость доставки';
  if (type === 'pickup' && fields.pickupTime && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(fields.pickupTime)) return 'Укажите время самовывоза в формате ЧЧ:ММ';
  return '';
}

export function customerOrderPayload(type: 'delivery' | 'pickup', fields: typeof EMPTY_CUSTOMER) {
  return { type, customerName: fields.customerName.trim(), customerPhone: fields.customerPhone.trim(),
    ...(type === 'delivery' ? { deliveryAddress: fields.deliveryAddress.trim(), deliveryFee: feeValue(fields.deliveryFee) }
      : { pickupTime: fields.pickupTime || undefined }),
  };
}

export function EditOrderFulfillment({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(() => orderType(order.source));
  const [tableId, setTableId] = useState(orderType(order.source) === 'dine_in' ? order.table.id : '');
  const [fields, setFields] = useState({
    customerName: order.deliveryCustomerName ?? '', customerPhone: order.deliveryCustomerPhone ?? '',
    deliveryAddress: order.deliveryAddress ?? '', deliveryFee: order.deliveryFee ?? '', pickupTime: order.pickupTime ?? '',
  });
  const [comment, setComment] = useState(order.comment ?? '');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(order.updatedAt);
  const halls = useHalls();
  const save = useUpdateOrderFulfillment();
  const tables = (halls.data ?? []).flatMap((hall) => hall.tables
    .filter((table) => table.id === order.table.id || table.status === 'free')
    .map((table) => ({ value: table.id, label: String(table.number) + ' · ' + hall.name })));

  function submit() {
    if (!version) return;
    const problem = type === 'dine_in' ? (tableId ? '' : 'Выберите стол') : customerOrderError(type, fields);
    setError(problem);
    if (!problem) save.mutate({ orderId: order.id, expectedUpdatedAt: version, comment,
      ...(type === 'dine_in' ? { tableId } : { delivery: customerOrderPayload(type, fields) }),
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
        : <OrderFulfillmentFields type={type} value={fields} onChange={setFields} comment={comment}
            onComment={setComment} error="" disabled={save.isPending} />}
      {error ? <Text accessibilityRole="alert" style={styles.error} translate>{error}</Text> : null}
      <Button title="Сохранить" size="md" onPress={submit} loading={save.isPending} />
    </> : null}
  </View>;
}
