import React from 'react';
import { StyleSheet } from 'react-native';
import { View } from '@/components/themed';
import { DateField } from '@/components/DateField';
import { FastPressable } from '@/components/FastPressable';
import { Text } from '@/components/typography';
import { Field } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { parseIsoDate } from '@/utils/calendarDate';
import { warehouseLocalTime, warehouseTimingError, type WarehouseLocalTime, type WarehouseTiming } from '@/utils/warehouseTiming';

export function WarehouseDateTimeField({ label, value, onChange, disabled, limitToToday = false }: {
  label: string;
  value: WarehouseLocalTime;
  onChange: (value: WarehouseLocalTime) => void;
  disabled?: boolean;
  limitToToday?: boolean;
}) {
  const maximumDate = limitToToday ? parseIsoDate(warehouseLocalTime().date) ?? undefined : undefined;
  return <View style={styles.group}>
    <Text translate style={styles.label}>{label}</Text>
    <View style={styles.dateTime}>
      <DateField containerStyle={{ flex: 2 }} value={value.date} maximumDate={maximumDate} editable={!disabled}
        style={styles.input} onChangeText={(date) => onChange({ ...value, date })} accessibilityLabel={`${label}: дата`} />
      <Field containerStyle={{ flex: 1 }} style={styles.input} value={value.time} editable={!disabled}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '').slice(0, 4);
          const time = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
          onChange({ ...value, time });
        }}
        placeholder="ЧЧ:ММ" keyboardType="number-pad" maxLength={5} accessibilityLabel={`${label}: время`} />
    </View>
  </View>;
}

const times = [
  { mode: 'current', title: 'На момент проведения' },
  { mode: 'past', title: 'На указанную дату' },
] as const;

export function WarehouseTimingField({ label, value, onChange, disabled, inventory = false }: {
  label: string;
  value: WarehouseTiming;
  onChange: (value: WarehouseTiming) => void;
  disabled?: boolean;
  inventory?: boolean;
}) {
  const error = warehouseTimingError(value);
  return <View style={styles.group}>
    <Text translate style={styles.label}>{label}</Text>
    <View style={styles.segment}>
      {times.map(({ mode, title }, index) => {
        const selected = value.mode === mode;
        return <FastPressable key={mode} accessibilityRole="button" accessibilityState={{ selected, disabled }}
          style={[styles.segmentOption, index > 0 && styles.segmentDivider, selected && styles.segmentActive]}
          disabled={disabled} onPress={() => onChange({ ...value, mode })}>
          <Text style={[styles.segmentText, selected && styles.segmentTextActive]} translate>{title}</Text>
        </FastPressable>;
      })}
    </View>
    {value.mode === 'past' && <>
      <WarehouseDateTimeField label={inventory ? 'Дата и время подсчёта' : 'Дата и время операции'} value={value} limitToToday disabled={disabled}
        onChange={(dateTime) => onChange({ ...value, ...dateTime })} />
      <Text translate style={styles.hint}>{inventory
        ? 'Время Бишкека. Укажите момент, на который посчитали продукты.'
        : 'Время Бишкека. Документ изменит остатки и себестоимость с выбранного момента.'}</Text>
      {error ? <Text translate style={[styles.hint, styles.error]}>{error}</Text> : null}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  label: { color: colors.textSecondary, fontWeight: '500', fontSize: 14 },
  dateTime: { flexDirection: 'row', gap: spacing.sm, maxWidth: 340 },
  input: { height: 36, paddingVertical: 0, borderRadius: radius.sm },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden' },
  segmentOption: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 8 },
  segmentDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  segmentActive: { backgroundColor: colors.primarySoft },
  segmentText: { color: colors.textSecondary, textAlign: 'center', fontSize: 13 },
  segmentTextActive: { color: colors.primary, fontWeight: '500' },
  hint: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger },
});
