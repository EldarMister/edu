import React, { useRef } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Loading } from './ui';
import { apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { useCurrentShift, useEndShift, useStartShift } from '@/services/api/waiter';
import { disconnectSocket } from '@/services/socket';
import { unregisterPushDevice } from '@/services/push';
import { colors, fontSize, spacing } from '@/theme';

export function useWorkShiftRequired() {
  return useAuth((state) => !!state.user && state.user.role !== 'OWNER' && state.user.permissions?.workShiftRequired !== false);
}

export function WorkShiftGate({ children }: { children: React.ReactNode }) {
  const required = useWorkShiftRequired();
  const shift = useCurrentShift(required);
  const start = useStartShift();
  const logout = useAuth((state) => state.logout);
  const starting = useRef(false);

  if (!required || shift.data?.status === 'active') return <>{children}</>;
  return <SafeAreaView style={styles.gate}>
    {shift.isPending ? <Loading text="Проверяем рабочую смену…" /> : <>
      <Text style={styles.title}>Рабочая смена</Text>
      {shift.error && shift.data === undefined ? <>
        <Text accessibilityRole="alert" style={styles.label}>{apiError(shift.error)}</Text>
        <Button title="Повторить" onPress={() => void shift.refetch()} />
      </> : <>
        <Text style={styles.label}>Начните рабочую смену, чтобы приступить к работе.</Text>
        <Button title="Начать рабочую смену" loading={start.isPending} onPress={() => {
          if (starting.current) return;
          starting.current = true;
          start.mutate(undefined, {
            onError: (error) => Alert.alert('Ошибка', apiError(error)),
            onSettled: () => { starting.current = false; },
          });
        }} />
      </>}
      <Button title="Выйти" variant="secondary" disabled={start.isPending} onPress={() => {
        void unregisterPushDevice();
        disconnectSocket();
        logout();
      }} />
    </>}
  </SafeAreaView>;
}

export function EndWorkShiftControl({ compact = false }: { compact?: boolean }) {
  const required = useWorkShiftRequired();
  const shift = useCurrentShift(required);
  const end = useEndShift();
  const ending = useRef(false);
  if (!required || shift.data?.status !== 'active') return null;
  const started = new Date(shift.data.startedAt).toLocaleTimeString('ru-RU', {
    timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit',
  });
  return <View style={styles.control}>
    <Text style={styles.label}>Рабочая смена с {started}</Text>
    <Button title="Закончить рабочую смену" variant="secondary" size={compact ? 'md' : 'lg'} loading={end.isPending}
      onPress={() => Alert.alert('Закончить рабочую смену?', undefined, [
        { text: 'Отмена', style: 'cancel' }, { text: 'Закончить', onPress: () => {
          if (ending.current) return;
          ending.current = true;
          end.mutate(undefined, {
            onError: (error) => Alert.alert('Ошибка', apiError(error)),
            onSettled: () => { ending.current = false; },
          });
        } },
      ])} />
  </View>;
}

const styles = StyleSheet.create({
  gate: { flex: 1, justifyContent: 'center', gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  title: { textAlign: 'center', fontSize: fontSize.xxl, color: colors.textPrimary, fontWeight: '700' },
  label: { color: colors.textSecondary, fontSize: fontSize.sm },
  control: { gap: spacing.sm },
});
