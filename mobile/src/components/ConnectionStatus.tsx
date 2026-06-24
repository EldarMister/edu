import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, spacing } from '@/theme';
import { useConnectionStatus } from '@/services/socket';

/** Индикатор соединения: точка + «Онлайн/Нет соединения» (как в PWA). */
export function ConnectionStatus({ compact = false }: { compact?: boolean }) {
  const online = useConnectionStatus();
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.danger }]} />
      {!compact ? (
        <Text style={[styles.text, { color: online ? colors.textSecondary : colors.danger }]}>
          {online ? 'Онлайн' : 'Нет соединения'}
        </Text>
      ) : null}
    </View>
  );
}

/** Баннер при потере соединения (ТЗ §9, PWA OfflineBanner). */
export function OfflineBanner() {
  const online = useConnectionStatus();
  if (online) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>Нет соединения с сервером. Переподключаемся…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: fontSize.sm },
  banner: {
    backgroundColor: colors.danger,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  bannerText: { color: colors.white, fontSize: fontSize.sm, fontWeight: '500' },
});
