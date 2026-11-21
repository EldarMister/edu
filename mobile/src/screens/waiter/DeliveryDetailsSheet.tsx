import React from 'react';
import { StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { Button } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { DeliveryDetails } from '@/services/api/waiter';

type Props = {
  visible: boolean;
  details: DeliveryDetails;
  error: string;
  pending: boolean;
  onChange: (details: DeliveryDetails) => void;
  onClose: () => void;
  onSubmit: (details: DeliveryDetails) => void;
};

export function DeliveryDetailsSheet({ visible, details, error, pending, onChange, onClose, onSubmit }: Props) {
  const focused = useIsFocused();
  const close = () => { if (!pending) onClose(); };
  const submit = () => onSubmit({
    customerName: details.customerName.trim(),
    customerPhone: details.customerPhone.trim(),
    deliveryAddress: details.deliveryAddress.trim(),
  });

  return (
    <BottomSheet
      visible={visible && focused}
      onClose={close}
      title="Данные доставки"
      presentation="center"
      maxHeight="88%"
      panelStyle={styles.panel}
      draggable={!pending}
      footer={(
        <View style={styles.footer}>
          <Button title="Назад" variant="secondary" style={styles.action} disabled={pending} onPress={close} />
          <Button
            title="Оформить доставку"
            style={styles.action}
            loading={pending}
            disabled={!details.customerPhone.trim() || !details.deliveryAddress.trim()}
            onPress={submit}
          />
        </View>
      )}
    >
      <SheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.fields}>
        <View style={styles.field}>
          <Text style={styles.label} translate>Имя клиента</Text>
          <TextInput
            accessibilityLabel="Имя клиента"
            autoComplete="name"
            value={details.customerName}
            onChangeText={customerName => onChange({ ...details, customerName })}
            editable={!pending}
            maxLength={120}
            style={styles.input}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label} translate>Телефон клиента</Text>
          <TextInput
            accessibilityLabel="Телефон клиента"
            autoComplete="tel"
            keyboardType="phone-pad"
            value={details.customerPhone}
            onChangeText={customerPhone => onChange({ ...details, customerPhone })}
            editable={!pending}
            maxLength={40}
            style={styles.input}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label} translate>Адрес доставки</Text>
          <TextInput
            accessibilityLabel="Адрес доставки"
            value={details.deliveryAddress}
            onChangeText={deliveryAddress => onChange({ ...details, deliveryAddress })}
            editable={!pending}
            maxLength={300}
            multiline
            style={[styles.input, styles.address]}
          />
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error} translate>{error}</Text> : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  panel: { width: '94%', maxWidth: 520 },
  fields: { gap: spacing.md },
  field: { gap: spacing.xs },
  label: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: '500' },
  input: {
    minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.textPrimary, fontSize: fontSize.base,
  },
  address: { minHeight: 86, textAlignVertical: 'top' },
  footer: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  error: { color: colors.danger, fontSize: fontSize.sm },
});
