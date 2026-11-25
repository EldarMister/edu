import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '@/components/BottomSheet';
import { DateField } from '@/components/DateField';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, Field, Loading, Toggle } from '@/components/ui';
import { financeDay, parseMoney } from '@/features/finance/format';
import { api, apiError } from '@/lib/api';
import type { PositionSalary } from '@/services/api/positions';
import { colors, spacing } from '@/theme';

interface Rate { effectiveDay: string; usePosition: boolean; salary: PositionSalary }
interface Settings { current: Rate | null; scheduled: Rate[]; positionSalary: PositionSalary }
const labels: Record<keyof PositionSalary, string> = {
  hourly: 'За час, с', perShift: 'За смену, с', monthly: 'За месяц, с',
  personalPercent: 'Процент от личных продаж', shiftPercent: 'Процент от продаж за смену',
};
const fields = Object.keys(labels) as (keyof PositionSalary)[];
const inputs = (salary: PositionSalary) => Object.fromEntries(fields.map((key) => [key, String(salary[key])])) as Record<keyof PositionSalary, string>;
const showDay = (day: string) => day.split('-').reverse().join('.');

export function EmployeeSalarySheet({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const url = `/admin/staff/${id}/salary`;
  const query = useQuery({ queryKey: ['admin', 'staff', 'salary', id], queryFn: async () => (await api.get<Settings>(url)).data });
  if (query.data) return <Rates title={name} url={url} settings={query.data} onClose={onClose} />;
  return <BottomSheet visible title="Личные ставки" onClose={onClose}>
    {query.isPending ? <Loading /> : <View style={{ gap: spacing.sm }}>
      <Text accessibilityRole="alert">{apiError(query.error)}</Text>
      <Button title="Повторить" variant="secondary" onPress={() => void query.refetch()} />
    </View>}
  </BottomSheet>;
}

function Rates({ title, url, settings, onClose }: { title: string; url: string; settings: Settings; onClose: () => void }) {
  const qc = useQueryClient();
  const tomorrow = financeDay(new Date(Date.now() + 86_400_000));
  const [year, month, day] = tomorrow.split('-').map(Number);
  const scheduled = settings.scheduled.at(-1);
  const selected = scheduled ?? settings.current;
  const [usePosition, setUsePosition] = React.useState(selected?.usePosition ?? true);
  const [effectiveDay, setEffectiveDay] = React.useState(scheduled?.effectiveDay ?? tomorrow);
  const [amounts, setAmounts] = React.useState(() => inputs(selected && !selected.usePosition ? selected.salary : settings.positionSalary));
  const save = useMutation({
    mutationFn: (rate: Rate) => api.patch(url, rate),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['admin', 'staff', 'salary'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'finance'] })]);
      onClose();
    },
  });
  const salary = Object.fromEntries(fields.map((key) => [key, amounts[key].trim() ? parseMoney(amounts[key]) : 0])) as Record<keyof PositionSalary, number | null>;
  const valid = effectiveDay >= tomorrow && (usePosition || fields.every((key) =>
    salary[key] !== null && salary[key]! >= 0 && salary[key]! <= (key.endsWith('Percent') ? 100 : 9_999_999_999.99)));
  return <BottomSheet visible title={`Личные ставки · ${title}`} onClose={() => { if (!save.isPending) onClose(); }}
    footer={<Button title="Сохранить" disabled={!valid} loading={save.isPending}
      onPress={() => save.mutate({ effectiveDay, usePosition, salary: usePosition ? settings.positionSalary : salary as PositionSalary })} />}>
    <View style={{ gap: spacing.md }}>
      <Text style={{ color: colors.textMuted }}>Сейчас действуют {settings.current?.usePosition === false ? 'личные ставки' : 'ставки должности'}.</Text>
      {settings.scheduled.map((rate) => <Button key={rate.effectiveDay} size="md" variant="secondary" disabled={save.isPending}
        title={`${showDay(rate.effectiveDay)} · ${rate.usePosition ? 'ставки должности' : 'личные ставки'}`} onPress={() => {
          setEffectiveDay(rate.effectiveDay);
          setUsePosition(rate.usePosition);
          setAmounts(inputs(rate.usePosition ? settings.positionSalary : rate.salary));
        }} />)}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text>Использовать личные ставки</Text><Toggle checked={!usePosition} onChange={(value) => setUsePosition(!value)} />
      </View>
      {!usePosition && fields.map((key) => <Field key={key} label={labels[key]} accessibilityLabel={labels[key]} keyboardType="decimal-pad"
        editable={!save.isPending} value={amounts[key]} onChangeText={(value) => setAmounts({ ...amounts, [key]: value })} />)}
      <DateField label="Начало действия" value={effectiveDay} onChangeText={setEffectiveDay} editable={!save.isPending}
        minimumDate={new Date(year, month - 1, day)} />
      {save.error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{apiError(save.error)}</Text>}
    </View>
  </BottomSheet>;
}
