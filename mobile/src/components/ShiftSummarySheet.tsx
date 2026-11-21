import React from 'react';
import { StyleSheet, useWindowDimensions, type ViewStyle } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { colors, fontSize, radius, spacing } from '@/theme';
import type { WaiterShift } from '@/types';
import { money } from '@/utils/format';

export function FinishShiftButton({ startedAt, loading, onPress, style }: {
  startedAt: string; loading: boolean; onPress: () => void; style?: ViewStyle;
}) {
  const [now, setNow] = React.useState(Date.now);
  const t = useT();
  React.useEffect(() => {
    if (loading) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [loading, startedAt]);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) || 0;
  const clock = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60]
    .map((value) => String(value).padStart(2, '0')).join(':');
  return <Button title={`${t('Закончить смену')} · ${clock}`} loading={loading} onPress={onPress} style={style} />;
}

export function ShiftSummarySheet({
  shift,
  visible,
  onClose,
}: {
  shift: WaiterShift | null;
  visible: boolean;
  onClose: () => void;
}) {
  const wide = useWindowDimensions().width >= 768;
  if (!shift) return null;
  const rows = [
    { label: 'Начало смены', value: dateTime(shift.startedAt) },
    { label: 'Конец смены', value: shift.endedAt ? dateTime(shift.endedAt) : '—' },
    { label: 'Отработано', value: shift.endedAt ? duration(shift.startedAt, shift.endedAt) : '—' },
    { label: 'Закрыто заказов', value: String(shift.stats?.ordersCount ?? 0) },
    { label: 'Сумма', value: money(shift.stats?.totalAmount ?? 0) },
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Смена завершена"
      presentation={wide ? 'dialog' : 'bottom'}
      hideHandle={wide}
      bodyStyle={styles.shiftSummaryBody}
      footer={<Button title="Готово" onPress={onClose} />}
    >
      <View style={styles.shiftSummaryHero}>
        <View style={styles.shiftSummaryIcon}>
          <PwaIcon name="check" size={34} color={colors.success} strokeWidth={2.6} />
        </View>
        <Text style={styles.shiftSummaryText} translate>Спасибо за работу!</Text>
      </View>

      <View style={styles.shiftSummaryRows}>
        {rows.map((row) => (
          <View key={row.label} style={styles.shiftSummaryRow}>
            <Text style={styles.shiftSummaryLabel} translate>{row.label}</Text>
            <Text style={styles.shiftSummaryValue} numberOfLines={1}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

function dateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function duration(startIso: string, endIso: string): string {
  const ms = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m} мин`;
}

const styles = StyleSheet.create({
  shiftSummaryBody: { gap: spacing.lg },
  shiftSummaryHero: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  shiftSummaryIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successSoft,
  },
  shiftSummaryText: { marginTop: spacing.md, fontSize: fontSize.sm, color: colors.textMuted },
  shiftSummaryRows: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  shiftSummaryRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  shiftSummaryLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textMuted },
  shiftSummaryValue: { maxWidth: '54%', fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },
});
