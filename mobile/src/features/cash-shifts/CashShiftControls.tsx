import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, Card, Toggle } from '@/components/ui';
import { CashOperationForm, CashShiftForm } from '@/features/finance/CashShifts';
import { cashShiftKey } from '@/features/finance/api';
import { usePermissions } from '@/hooks/usePermissions';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { colors, spacing } from '@/theme';
import { money } from '@/utils/format';

type CashShift = { id: string; openingAmount: number; expectedAmount: number };
type CashShiftState = { enabled: boolean; current: CashShift | null };
const endpoint = '/cash-shifts';

export function useCashShift(enabled = true) {
  const userId = useAuth((state) => state.user?.id);
  const workspace = useAuth((state) => state.workspace);
  return useQuery({
    queryKey: [...cashShiftKey, 'state', userId, workspace], enabled: enabled && !!userId, retry: false, refetchInterval: 15_000,
    queryFn: async () => (await api.get<CashShiftState>(endpoint)).data,
  });
}

export function CashShiftSettings() {
  const query = useCashShift();
  const qc = useQueryClient();
  const change = useMutation({
    mutationFn: async (enabled: boolean) => (await api.patch(endpoint + '/setting', { enabled })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: cashShiftKey }),
  });
  if (isAxiosError(query.error) && query.error.response?.status === 404) return null;
  return <Card style={styles.card}>
    <View style={styles.settingRow}>
      <Text style={styles.settingTitle} translate>Использовать кассовые смены</Text>
      <Toggle accessibilityLabel="Использовать кассовые смены" checked={query.data?.enabled ?? false}
        disabled={!query.data || change.isPending} onChange={(enabled) => change.mutate(enabled)} />
    </View>
    <Text style={styles.hint} translate>Кассир вводит размен при открытии и пересчитывает наличные при закрытии.</Text>
    {(change.error || query.error) && <Text accessibilityRole="alert" style={styles.error}>{apiError(change.error ?? query.error)}</Text>}
  </Card>;
}

export function CashShiftBanner() {
  const { canAction, canSection, canEditSection } = usePermissions();
  const workspace = useAuth((state) => state.workspace);
  const finance = workspace === 'admin' && canSection('finance');
  const allowed = finance || canAction('financeCashShifts');
  const canManage = finance ? canEditSection('finance') : canAction('financeCashShifts');
  const query = useCashShift(allowed);
  const [editor, setEditor] = useState<'open' | 'close' | 'operation' | null>(null);
  if (!allowed || !query.data?.enabled) return null;
  const current = query.data.current;
  const close = () => setEditor(null);
  return <>
    <View style={styles.banner}>
      {current ? <Text style={styles.hint}><Text translate>В кассе по расчёту</Text> {money(current.expectedAmount)}</Text>
        : <Text style={styles.hint} translate>Кассовая смена ещё не открыта</Text>}
      {canManage ? <View style={styles.actions}>
        {current ? <Button title="Операция с наличными" variant="secondary" size="md" onPress={() => setEditor('operation')} /> : null}
        <Button title={current ? 'Закрыть кассовую смену' : 'Открыть кассовую смену'} variant="secondary" size="md"
          onPress={() => setEditor(current ? 'close' : 'open')} />
      </View> : null}
    </View>
    {canManage && editor === 'open' && !current ? <CashShiftForm current={null} endpoint={endpoint} onClose={close} /> : null}
    {canManage && editor === 'close' && current ? <CashShiftForm key={current.id} current={current} endpoint={endpoint} onClose={close} /> : null}
    {canManage && editor === 'operation' && current ? (
      <CashOperationForm endpoint={endpoint + '/' + current.id} cashier={workspace === 'terminal'} onClose={close} />
    ) : null}
  </>;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  settingTitle: { flex: 1, fontWeight: '600', color: colors.textPrimary },
  hint: { color: colors.textSecondary, fontSize: 13 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
    gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.card,
  },
  error: { color: colors.danger, fontSize: 13 },
});
