import React from 'react';
import { ScrollView, StyleSheet, Text, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card } from '@/components/ui';
import { CashShiftPanel } from '@/components/CashShiftPanel';
import { EndWorkShiftControl, useWorkShiftRequired } from '@/components/WorkShiftControls';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useAuth } from '@/store/auth';
import { disconnectSocket } from '@/services/socket';
import { unregisterPushDevice } from '@/services/push';

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
  const workShiftRequired = useWorkShiftRequired();

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

        {workShiftRequired ? <Card><EndWorkShiftControl /></Card> : null}
        <CashShiftPanel />

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
              style={{ marginTop: spacing.md }}
              onPress={() => Vibration.vibrate(200)}
            />
          </View>
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

  cardTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },

  notifBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  notifTitle: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  notifSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },

  version: { textAlign: 'center', fontSize: fontSize.xs, color: colors.textLight, paddingTop: 4 },
});
