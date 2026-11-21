import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { AppHeader } from '@/components/AppHeader';
import { BrandLogo } from '@/components/BrandLogo';
import { Button, Card, Loading } from '@/components/ui';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { api, apiError } from '@/lib/api';
import { unregisterPushDevice } from '@/services/push';
import { disconnectSocket, useSocketEvent } from '@/services/socket';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { colors, spacing } from '@/theme';
import { timeHM } from '@/utils/format';

type WorkShift = { id: string; startedAt: string; endedAt: string | null };
const key = ['staff', 'work-shift'];

function useStaffWorkShift() {
  const user = useAuth((state) => state.user);
  const enabled = !!user && user.role !== 'OWNER' && user.permissions?.workShiftRequired !== false;
  const queryKey = [...key, user?.id];
  const client = useQueryClient();
  const toast = useNotifications((state) => state.push);
  const query = useQuery({
    queryKey, enabled, retry: false, staleTime: 15_000, refetchInterval: 30_000,
    queryFn: async ({ signal }) => (await api.get<WorkShift | null>('/staff/shifts/current', { signal })).data || null,
  });
  const mutate = useMutation({
    mutationFn: async (action: 'start' | 'end') => (await api.post<WorkShift>(`/staff/shifts/${action}`)).data,
    onSuccess: async (shift, action) => {
      await client.cancelQueries({ queryKey, exact: true });
      client.setQueryData(queryKey, action === 'start' ? shift : null);
      void client.invalidateQueries({ queryKey: ['admin', 'staff'] });
      void client.invalidateQueries({ queryKey: ['admin', 'finance'] });
      if (action === 'end') toast({ message: 'Смена завершена', type: 'success', at: new Date().toISOString() });
    },
    onError: (error) => toast({ message: apiError(error), type: 'error', at: new Date().toISOString() }),
  });
  return { enabled, query, mutate, active: !!query.data && !query.data.endedAt };
}

export function StaffShiftGate({ children }: React.PropsWithChildren) {
  const { active, enabled, query, mutate } = useStaffWorkShift();
  const client = useQueryClient();
  const refresh = () => { if (enabled) void client.invalidateQueries({ queryKey: key }); };
  useSocketEvent('waiter:shift_started', refresh, [client, enabled]);
  useSocketEvent('waiter:shift_ended', refresh, [client, enabled]);

  if (!enabled || active) return <>{children}</>;

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
            : <Button title="Начать смену" loading={mutate.isPending} onPress={() => mutate.mutate('start')} />}
          <WorkspaceSwitcher />
        </Card>}
      </View>
    </SafeAreaView>
  );
}

export function StaffShiftCard() {
  const { active, enabled, query, mutate } = useStaffWorkShift();
  if (!enabled || !active || !query.data) return null;
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
      <View>
        <Text style={{ fontWeight: '600' }} translate>Смена активна</Text>
        <Text style={{ color: colors.textMuted }}>{timeHM(query.data.startedAt)}</Text>
      </View>
      <Button title="Закончить смену" variant="secondary" size="md" loading={mutate.isPending} onPress={() => mutate.mutate('end')} />
    </Card>
  );
}
