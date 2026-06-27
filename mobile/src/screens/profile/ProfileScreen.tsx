import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Button, Card } from '@/components/ui';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import { beep } from '@/lib/sound';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { useCurrentShift, useEndShift } from '@/services/api/waiter';
import { disconnectSocket } from '@/services/socket';
import { unregisterPushDevice } from '@/services/push';
import { timeHM } from '@/utils/format';

const ROLE_LABEL: Record<string, string> = {
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
  ADMIN: 'Администратор',
  OWNER: 'Владелец',
};

export function ProfileScreen() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const isWaiter = user?.role === 'WAITER';
  const shiftQuery = useCurrentShift(isWaiter);
  const endShift = useEndShift();
  const push = useNotifications((s) => s.push);
  const [checkingSound, setCheckingSound] = React.useState(false);
  const shift = isWaiter ? shiftQuery.data : null;
  const shiftActive = shift?.status === 'active';

  const onLogout = () => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
  };

  const onCheckSound = async () => {
    if (checkingSound) return;
    setCheckingSound(true);
    const ok = await beep('notify');
    push({
      type: ok ? 'success' : 'error',
      message: ok ? 'Тестовый звук воспроизведён' : 'Не удалось воспроизвести звук уведомления',
      at: new Date().toISOString(),
    });
    setCheckingSound(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.panelTitle}>Профиль</Text>

        {/* Карточка пользователя */}
        <Card style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.name?.[0] ?? '?'}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {user?.name}
            </Text>
            <Text style={styles.userMeta} numberOfLines={1}>
              {ROLE_LABEL[user?.role ?? ''] ?? user?.role} · {user?.phone}
            </Text>
          </View>
          <PwaIcon name="chevronRight" size={20} color={colors.textLight} />
        </Card>

        {/* Смена (только официант) */}
        {isWaiter ? (
          <Card style={{ gap: 0 }}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Смена</Text>
              <View
                style={[
                  styles.pill,
                  { backgroundColor: shiftActive ? colors.successSoft : colors.background },
                ]}
              >
                <Text style={[styles.pillText, { color: shiftActive ? colors.success : colors.textMuted }]}>
                  {shiftActive ? 'Смена активна' : 'Не начата'}
                </Text>
              </View>
            </View>
            {shiftActive ? (
              <View style={styles.shiftRow}>
                <Text style={styles.shiftLabel}>Начало</Text>
                <Text style={styles.shiftValue}>{timeHM(shift!.startedAt)}</Text>
              </View>
            ) : null}
            {shiftActive ? (
              <Button
                title="Закончить смену"
                style={{ marginTop: spacing.lg }}
                loading={endShift.isPending}
                onPress={() => endShift.mutate()}
              />
            ) : null}
          </Card>
        ) : null}

        {/* Уведомления */}
        <Card style={{ gap: spacing.md }}>
          <Text style={styles.cardTitle}>Уведомления</Text>
          <View style={styles.notifBox}>
            <Text style={styles.notifTitle}>Системные уведомления</Text>
            <Text style={styles.notifSub}>
              Включены. Сотрудник получит уведомление, даже если приложение свёрнуто.
            </Text>
            <Button
              title="Проверить звук"
              variant="secondary"
              size="md"
              loading={checkingSound}
              style={{ marginTop: spacing.md }}
              onPress={() => void onCheckSound()}
            />
          </View>
        </Card>

        <Button title="Выйти" variant="secondary" danger onPress={onLogout} />

        <Text style={styles.version}>v{Constants.expoConfig?.version ?? '0.1.1'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  container: { padding: spacing.md, gap: spacing.lg },
  panelTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.primary },
  userName: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  userMeta: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },

  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  pillText: { fontSize: fontSize.sm, fontWeight: '500' },
  shiftRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg },
  shiftLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  shiftValue: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },

  notifBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  notifTitle: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  notifSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },

  version: { textAlign: 'center', fontSize: fontSize.xs, color: colors.textLight, paddingTop: 4 },
});
