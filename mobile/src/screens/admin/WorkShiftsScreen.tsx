import React from 'react';
import { Alert } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, Card, EmptyState, Loading } from '@/components/ui';
import { api, apiError } from '@/lib/api';
import { useSocketEvent } from '@/services/socket';
import { useNotifications } from '@/store/notifications';
import { useAuth } from '@/store/auth';
import { colors, spacing } from '@/theme';
import { timeHM } from '@/utils/format';

interface Employee {
  id: string;
  name: string;
  position: string | null;
  active: { id: string; startedAt: string } | null;
  request: { id: string; requestedAt: string } | null;
}
const actions = { approve: 'Подтвердить начало', reject: 'Отклонить запрос', start: 'Начать смену', close: 'Завершить смену' };
type Action = keyof typeof actions;
const key = ['admin', 'staff', 'work-shifts'];

export function WorkShiftsScreen() {
  const cache = useQueryClient();
  const ownId = useAuth((state) => state.user?.id);
  const toast = useNotifications((state) => state.push);
  const query = useQuery({ queryKey: key, refetchInterval: 15_000,
    queryFn: async () => (await api.get<Employee[]>('/admin/work-shifts')).data });
  const refresh = () => void cache.invalidateQueries({ queryKey: key });
  useSocketEvent('staff:shift_request_updated', refresh, [cache]);
  useSocketEvent('waiter:shift_started', refresh, [cache]);
  useSocketEvent('waiter:shift_ended', refresh, [cache]);
  useSocketEvent('waiter:shift_updated', refresh, [cache]);
  const update = useMutation({
    mutationFn: ({ employee, action }: { employee: Employee; action: Action }) => {
      if (action === 'close') return api.post(`/admin/staff/shift-history/${employee.active!.id}/close`);
      const url = `/admin/work-shifts/${employee.id}`;
      if (action === 'reject') return api.post(`${url}/requests/${employee.request!.id}/reject`);
      return api.post(`${url}/start`, { requestId: action === 'approve' ? employee.request!.id : undefined });
    },
    onSuccess: async () => {
      await Promise.all([cache.invalidateQueries({ queryKey: ['admin', 'staff'] }),
        cache.invalidateQueries({ queryKey: ['admin', 'finance'] })]);
    },
    onError: (error) => toast({ type: 'error', message: apiError(error), at: new Date().toISOString() }),
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <View style={{ padding: spacing.lg, gap: spacing.sm }}>
    <Text accessibilityRole="alert">{apiError(query.error)}</Text>
    <Button title="Повторить" variant="secondary" onPress={() => void query.refetch()} />
  </View>;
  const rows = [...query.data].sort((a, b) => Number(!!b.request) - Number(!!a.request));
  if (!rows.length) return <EmptyState text="Сотрудники с учётом смен пока не добавлены" />;
  return <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}>
    {rows.map((employee) => {
      const { active, request } = employee;
      const choices: Action[] = active ? ['close'] : employee.id === ownId ? [] : request ? ['approve', 'reject'] : ['start'];
      return <Card key={employee.id} style={{ gap: spacing.sm }}>
        <View>
          <Text style={{ fontWeight: '600' }}>{employee.name}</Text>
          {!!employee.position && <Text style={{ color: colors.textMuted }}>{employee.position}</Text>}
        </View>
        <Text style={{ color: active ? colors.success : colors.textMuted }}>
          {active ? `Активна с ${timeHM(active.startedAt)}` : request
            ? `Ожидает подтверждения · ${timeHM(request.requestedAt)}` : 'Смена не начата'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {choices.map((action) => <Button key={action} size="md" title={actions[action]} disabled={update.isPending}
            variant={action === 'approve' ? 'primary' : 'secondary'} onPress={() => Alert.alert(actions[action], employee.name, [
              { text: 'Отмена', style: 'cancel' }, { text: actions[action], onPress: () => update.mutate({ employee, action }) },
            ])} />)}
        </View>
      </Card>;
    })}
  </ScrollView>;
}
