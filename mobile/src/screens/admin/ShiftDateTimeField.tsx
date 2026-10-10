import React from 'react';
import { Modal, Platform, View } from 'react-native';
import { Text } from '@/components/typography';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { DateField } from '@/components/DateField';
import { FastPressable } from '@/components/FastPressable';
import { Button, Field } from '@/components/ui';
import { colors, spacing } from '@/theme';

export function ShiftDateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const today = new Date();
  const fallbackDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [date = '', time = ''] = value.split('T');
  const parsed = new Date(value);
  const selectedDate = Number.isNaN(parsed.getTime()) ? today : parsed;
  const chooseTime = (selected: Date) => onChange(`${date || fallbackDate}T${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`);
  const showTime = () => {
    if (Platform.OS === 'android') DateTimePickerAndroid.open({ value: selectedDate, mode: 'time', is24Hour: true, onChange: (event, selected) => { if (event.type === 'set' && selected) chooseTime(selected); } });
    else setOpen(true);
  };
  return <View style={{ gap: spacing.sm }}>
    <Text style={{ color: colors.textSecondary, fontWeight: '500' }} translate>{label}</Text>
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <DateField containerStyle={{ flex: 2 }} value={date} onChangeText={(next) => onChange(`${next}T${time || '00:00'}`)} accessibilityLabel={`${label}: дата`} />
      <Field containerStyle={{ flex: 1 }} value={time} onChangeText={(next) => onChange(`${date || fallbackDate}T${next}`)} placeholder="HH:mm" keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={`${label}: время`} rightSlot={<FastPressable onPress={showTime} accessibilityRole="button" accessibilityLabel="Выбрать время" hitSlop={10}><Text style={{ color: colors.primary, fontSize: 22 }}>◷</Text></FastPressable>} />
    </View>
    {Platform.OS !== 'android' ? <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(0,0,0,0.4)' }}><View style={{ backgroundColor: colors.white, borderRadius: 16, padding: spacing.lg }}><DateTimePicker value={selectedDate} mode="time" display="spinner" is24Hour onChange={(_event, selected) => { if (selected) chooseTime(selected); }} /><Button title="Готово" onPress={() => setOpen(false)} /></View></View></Modal> : null}
  </View>;
}
