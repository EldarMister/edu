import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
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
  const shift = isWaiter ? shiftQuery.data : null;
  const shiftActive = shift?.status === 'active';

  const history = useNotifications((s) => s.history);
  const [notifOpen, setNotifOpen] = React.useState(true);
  const [showAllNotif, setShowAllNotif] = React.useState(false);
  const visibleNotifs = showAllNotif ? history : history.slice(0, 3);

  const onLogout = () => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
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
          <Ionicons name="chevron-forward" size={20} color={colors.textLight} />
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
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Уведомления</Text>
            <Pressable style={styles.notifToggle} onPress={() => setNotifOpen((v) => !v)} hitSlop={8}>
              <Text style={styles.notifToggleText}>{notifOpen ? 'Скрыть' : 'Показать'}</Text>
              <Ionicons
                name={notifOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.primary}
              />
            </Pressable>
          </View>

          {notifOpen ? (
            <>
              <View style={styles.notifBox}>
                <Text style={styles.notifTitle}>Системные уведомления</Text>
                <Text style={styles.notifSub}>
                  Включены. Сотрудник получит уведомление, даже если приложение свёрнуто.
                </Text>
                <Button
                  title="Проверить звук"
                  variant="secondary"
                  size="md"
                  style={{ marginTop: spacing.md }}
                  onPress={() => Vibration.vibrate(200)}
                />
              </View>

              {history.length === 0 ? (
                <Text style={styles.notifEmpty}>Уведомлений пока нет</Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {visibleNotifs.map((n) => (
                    <View key={n.id} style={styles.notifItem}>
                      <View style={styles.notifDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.notifItemText}>{n.message}</Text>
                        <Text style={styles.notifItemTime}>{timeHM(n.at)}</Text>
                      </View>
                    </View>
                  ))}
                  {history.length > 3 ? (
                    <Pressable
                      style={styles.notifToggle}
                      onPress={() => setShowAllNotif((v) => !v)}
                      hitSlop={8}
                    >
                      <Text style={styles.notifToggleText}>
                        {showAllNotif ? 'Скрыть лишние уведомления' : 'Показать все уведомления'}
                      </Text>
                      <Ionicons
                        name={showAllNotif ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colors.primary}
                      />
                    </Pressable>
                  ) : null}
                </View>
              )}
            </>
          ) : null}
        </Card>

        <Button title="Выйти" variant="secondary" danger onPress={onLogout} />

        <Text style={styles.version}>v{Constants.expoConfig?.version ?? '0.1.0'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  container: { padding: spacing.md, gap: spacing.lg },
  // PWA Panel title: text-lg font-semibold (18/600).
  panelTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
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

  notifToggle: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  notifToggleText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.primary },
  notifBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  notifTitle: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  notifSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
  notifEmpty: { fontSize: fontSize.sm, color: colors.textMuted },
  notifItem: { flexDirection: 'row', gap: 10 },
  notifDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 6 },
  notifItemText: { fontSize: fontSize.sm, color: colors.textSecondary },
  notifItemTime: { fontSize: fontSize.xs, color: colors.textLight, marginTop: 2 },

  version: { textAlign: 'center', fontSize: fontSize.xs, color: colors.textLight, paddingTop: 4 },
});
