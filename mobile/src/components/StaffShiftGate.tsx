import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { AppHeader } from '@/components/AppHeader';
import { BrandLogo } from '@/components/BrandLogo';
import { Button, Card, Loading } from '@/components/ui';
import { FinishShiftButton, ShiftSummarySheet } from '@/components/ShiftSummarySheet';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { api, apiError } from '@/lib/api';
import { unregisterPushDevice } from '@/services/push';
import { disconnectSocket, useSocketEvent } from '@/services/socket';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { colors, spacing } from '@/theme';
import type { WaiterShift } from '@/types';
import { timeHM } from '@/utils/format';

const key = ['staff', 'work-shift'];
const StaffShiftContext = React.createContext<{
  startedAt: string;
  ending: boolean;
  end: () => void;
} | null>(null);

export function StaffShiftGate({ children }: React.PropsWithChildren) {
  const user = useAuth((state) => state.user);
  const workspace = useAuth((state) => state.workspace);
  const [summary, setSummary] = React.useState<WaiterShift | null>(null);
  const submitting = React.useRef(false);
  const enabled = !!user && user.role !== 'OWNER' && user.permissions?.workShiftRequired !== false;
  const queryKey = [...key, user?.id];
  const client = useQueryClient();
  const toast = useNotifications((state) => state.push);
  const query = useQuery({
    queryKey, enabled, retry: false, staleTime: 15_000, refetchInterval: 30_000,
    queryFn: async ({ signal }) => (await api.get<WaiterShift | null>('/staff/shifts/current', { signal })).data || null,
  });
  const ownsShift = () => {
    const auth = useAuth.getState();
    return auth.user?.id === user?.id && auth.workspace === workspace;
  };
  const mutate = useMutation({
    mutationFn: async (action: 'start' | 'end') => (await api.post<WaiterShift>(`/staff/shifts/${action}`)).data,
    onSuccess: async (shift, action) => {
      if (!ownsShift()) return;
      await client.cancelQueries({ queryKey, exact: true });
      if (!ownsShift()) return;
      if (action === 'end') setSummary(shift);
      client.setQueryData(queryKey, action === 'start' ? shift : null);
      void client.invalidateQueries({ queryKey: ['admin', 'staff'] });
      void client.invalidateQueries({ queryKey: ['admin', 'finance'] });
    },
    onError: (error) => {
      if (!ownsShift()) return;
      toast({ message: apiError(error), type: 'error', at: new Date().toISOString() });
      void client.invalidateQueries({ queryKey });
    },
    onSettled: () => { submitting.current = false; },
  });
  const changeShift = (action: 'start' | 'end') => {
    if (submitting.current) return;
    submitting.current = true;
    mutate.mutate(action);
  };
  const refresh = () => { if (enabled) void client.invalidateQueries({ queryKey: key }); };
  useSocketEvent('waiter:shift_started', refresh, [client, enabled]);
  useSocketEvent('waiter:shift_ended', refresh, [client, enabled]);

  if (!enabled) return <>{children}</>;
  const shift = query.data?.endedAt ? null : query.data;
  const startedAt = shift?.startedAt ?? summary?.startedAt;
  const ending = mutate.isPending && mutate.variables === 'end';
  if (shift || ending || summary) return (
    <StaffShiftContext.Provider value={startedAt ? {
      startedAt, ending: ending || !!summary, end: () => changeShift('end'),
    } : null}>
      {children}
      <ShiftSummarySheet shift={summary} visible={!!summary} onClose={() => setSummary(null)} />
    </StaffShiftContext.Provider>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
      <AppHeader left={<BrandLogo />} right={<Button title="Выйти" size="md" variant="secondary" onPress={() => {
        void unregisterPushDevice();
        disconnectSocket();
        useAuth.getState().logout();
      }} />} />
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
        {query.isPending ? <Loading /> : <Card style={{ gap: spacing.md }}>
          <Text style={{ fontSize: 20, fontWeight: '600' }} translate>Смена не начата</Text>
          {query.error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{apiError(query.error)}</Text> : null}
          {query.error
            ? <Button title="Повторить" variant="secondary" onPress={() => void query.refetch()} />
            : <Button title="Начать смену" loading={mutate.isPending} onPress={() => changeShift('start')} />}
          <WorkspaceSwitcher />
        </Card>}
      </View>
    </SafeAreaView>
  );
}

export function StaffShiftCard() {
  const shift = React.useContext(StaffShiftContext);
  if (!shift) return null;
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
        <Text style={{ fontWeight: '600' }} translate>Смена активна</Text>
        <Text style={{ color: colors.textMuted }}>{timeHM(shift.startedAt)}</Text>
      </View>
      <FinishShiftButton startedAt={shift.startedAt} loading={shift.ending} onPress={shift.end} />
    </Card>
  );
}
