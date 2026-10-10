import React from 'react';
import { Modal, Platform, View, type TextInputProps, type ViewStyle } from 'react-native';
import { Text } from '@/components/typography';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Field, Button } from './ui';
import { FastPressable } from './FastPressable';
import { colors, spacing } from '@/theme';

type Props = Omit<TextInputProps, 'value' | 'onChangeText'> & { value: string; onChangeText: (value: string) => void; label?: string; error?: string; minimumDate?: Date; maximumDate?: Date; containerStyle?: ViewStyle };
function dateValue(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
export function DateField({ value, onChangeText, minimumDate, maximumDate, ...props }: Props) {
  const [open, setOpen] = React.useState(false);
  const parsed = new Date(`${value}T12:00:00`);
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const show = () => {
    if (props.editable === false) return;
    if (Platform.OS === 'android') DateTimePickerAndroid.open({ value: date, mode: 'date', minimumDate, maximumDate, onChange: (event, selected) => { if (event.type === 'set' && selected) onChangeText(dateValue(selected)); } });
    else setOpen(true);
  };
  return <>
    <Field {...props} value={value} onChangeText={onChangeText} placeholder={props.placeholder ?? 'YYYY-MM-DD'} autoCapitalize="none" rightSlot={<FastPressable accessibilityRole="button" accessibilityLabel={props.label ? `Выбрать дату: ${props.label}` : 'Выбрать дату'} onPress={show} hitSlop={10}><Text style={{ color: colors.primary, fontSize: 22 }}>▦</Text></FastPressable>} />
    {Platform.OS !== 'android' ? <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: 'rgba(0,0,0,0.4)' }}><View style={{ backgroundColor: colors.white, borderRadius: 16, padding: spacing.lg }}><DateTimePicker value={date} mode="date" display="inline" minimumDate={minimumDate} maximumDate={maximumDate} onChange={(_event, selected) => { if (selected) onChangeText(dateValue(selected)); }} /><Button title="Готово" onPress={() => setOpen(false)} /></View></View></Modal> : null}
  </>;
}
