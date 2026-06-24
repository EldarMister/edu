import React from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, Loading } from '@/components/ui';
import { OrderBadge } from '@/components/StatusBadge';
import { AppHeader } from '@/components/AppHeader';
import { BrandLogo } from '@/components/BrandLogo';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { colors, fontSize, spacing } from '@/theme';
import { useActiveOrders } from '@/services/api/waiter';
import { useAuth } from '@/store/auth';
import { disconnectSocket } from '@/services/socket';
import { unregisterPushDevice } from '@/services/push';
import { API_URL } from '@/config/env';
import { displayOrderNumber, hallSuffix, money, timeHM } from '@/utils/format';

/** Облегчённый экран ADMIN/OWNER (ТЗ §7): активные заказы + переход в PWA-админку. */
export function StaffScreen() {
  const orders = useActiveOrders();
  const logout = useAuth((s) => s.logout);
  const user = useAuth((s) => s.user);

  const onLogout = () => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <OfflineBanner />
      <AppHeader left={<BrandLogo />} right={<ConnectionStatus />} />

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={orders.isFetching} onRefresh={() => orders.refetch()} />
        }
      >
        <Card style={{ gap: spacing.md }}>
          <Text style={styles.cardTitle}>{user?.name}</Text>
          <Text style={styles.muted}>
            Полное управление (меню, персонал, статистика, склад) — в веб-версии.
          </Text>
          <Button title="Открыть PWA-админку" onPress={() => Linking.openURL(API_URL)} />
          <Button title="Выйти" variant="secondary" danger onPress={onLogout} />
        </Card>

        <Text style={styles.sectionTitle}>Активные заказы</Text>

        {orders.isLoading ? (
          <Loading />
        ) : (orders.data?.length ?? 0) === 0 ? (
          <EmptyState text="Активных заказов нет" />
        ) : (
          orders.data!.map((o) => (
            <Card key={o.id} style={{ gap: spacing.sm }}>
              <View style={styles.row}>
                <Text style={styles.orderNumber}>
                  {displayOrderNumber(o.orderNumber)}
                  <Text style={styles.tableText}>
                    {'  '}Стол {o.table.number}
                    {hallSuffix(o.table)}
                  </Text>
                </Text>
                <OrderBadge status={o.status} />
              </View>
              <View style={styles.row}>
                <Text style={styles.muted}>
                  {timeHM(o.createdAt)} · {o.waiter?.name ?? '—'}
                </Text>
                <Text style={styles.money}>{money(o.finalAmount)}</Text>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md, gap: spacing.md },
  cardTitle: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  sectionTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.sm },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderNumber: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
  tableText: { fontSize: fontSize.sm, fontWeight: '400', color: colors.textMuted },
  money: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
});
