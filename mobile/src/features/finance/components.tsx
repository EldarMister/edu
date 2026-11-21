import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { DateField } from '@/components/DateField';
import { financeDay } from './format';
import { Select, type SelectOption } from '@/components/Select';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, Field, Toggle } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { colors, fontSize, radius, spacing } from '@/theme';

export function FinanceForm({ title, children, onClose, onComplete, submit, submitLabel = 'Сохранить', disabled, danger }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onComplete?: () => void;
  submit: () => Promise<unknown>;
  submitLabel?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const push = useNotifications((state) => state.push);

  async function save() {
    if (submitting.current || disabled) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await submit();
      push({ message: 'Изменения сохранены', type: 'success', at: new Date().toISOString() });
      (onComplete ?? onClose)();
    } catch (error) {
      setError(apiError(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible title={title} onClose={() => { if (!submitting.current) onClose(); }} draggable={!busy} maxHeight="92%"
      footer={<Button title={submitLabel} loading={busy} disabled={disabled} variant={danger ? 'danger' : 'primary'} onPress={() => void save()} />}>
      <SheetScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={financeStyles.body}>
        <View pointerEvents={busy ? 'none' : 'auto'} style={financeStyles.stack}>
          {children}
        </View>
        {error ? <Text accessibilityRole="alert" style={financeStyles.error}>{error}</Text> : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={financeStyles.group}>
      <Text style={financeStyles.label} translate>{label}</Text>
      <Select title={label} value={value} options={options} onChange={onChange} disabled={disabled} searchable={options.length > 8} />
    </View>
  );
}

export function SwitchField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <View style={financeStyles.row}>
      <Text style={[financeStyles.label, financeStyles.grow]} translate>{label}</Text>
      <Toggle checked={checked} onChange={onChange} accessibilityLabel={label} disabled={disabled} />
    </View>
  );
}

export function MoneyField({ label = 'Сумма', value, onChange, editable = true }: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  editable?: boolean;
}) {
  return <Field label={label} value={value} editable={editable} onChangeText={onChange}
    keyboardType="decimal-pad" placeholder="0,00" maxLength={14} />;
}

export function FinanceLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={financeStyles.row}>
      <Text style={[financeStyles.muted, financeStyles.grow]} translate>{label}</Text>
      <Text style={financeStyles.label} translate>{value}</Text>
    </View>
  );
}

export function FinanceQueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <View style={financeStyles.card}>
      <Text accessibilityRole="alert" style={financeStyles.error}>{apiError(error)}</Text>
      <Button title="Повторить" variant="secondary" size="md" onPress={retry} />
    </View>
  );
}

export function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (next: string) => void; onTo: (next: string) => void }) {
  const today = new Date(financeDay() + 'T12:00:00');
  const toDate = to ? new Date(to + 'T12:00:00') : today;
  const fromDate = from ? new Date(from + 'T12:00:00') : undefined;
  return (
    <View style={financeStyles.row}>
      <DateField label="С даты" value={from} onChangeText={onFrom} containerStyle={financeStyles.grow} maximumDate={toDate} />
      <DateField label="По дату" value={to} onChangeText={onTo} containerStyle={financeStyles.grow}
        minimumDate={fromDate} maximumDate={today} />
    </View>
  );
}

export const financeStyles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  body: { paddingBottom: spacing.lg, gap: spacing.md },
  stack: { gap: spacing.md },
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  label: { color: colors.textPrimary, fontWeight: '600' },
  heading: { color: colors.textPrimary, fontWeight: '600', fontSize: fontSize.lg },
  muted: { color: colors.textSecondary, fontSize: fontSize.sm },
  error: { color: colors.danger, fontSize: fontSize.sm },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
});
