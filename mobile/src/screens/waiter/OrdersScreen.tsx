import React from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card, EmptyState, Loading } from '@/components/ui';
import { OrderBadge } from '@/components/StatusBadge';
import { colors, fontSize, spacing } from '@/theme';
import { useActiveOrders, useCancelOrder } from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { displayOrderNumber, hallSuffix, money, timeHM } from '@/utils/format';
import { apiError } from '@/lib/api';
import type { Order } from '@/types';

const EDITABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking'];
const CANCELLABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready', 'partially_rejected'];

export function OrdersScreen() {
  const orders = useActiveOrders();

  const sorted = React.useMemo(() => {
    const attention = (o: Order) =>
      o.requiresWaiterDecision || ['ready', 'rejected'].includes(o.status) ? 1 : 0;
    return [...(orders.data ?? [])].sort((a, b) => {
      const d = attention(b) - attention(a);
      if (d !== 0) return d;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [orders.data]);

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Активные заказы</Text>
        {orders.isLoading ? (
          <Loading />
        ) : sorted.length === 0 ? (
          <EmptyState text="Активных заказов нет" />
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={orders.isFetching} onRefresh={() => orders.refetch()} />
            }
          >
            {sorted.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

function OrderCard({ order }: { order: Order }) {
  const navigation = useNavigation<any>();
  const selectTable = useCart((s) => s.selectTable);
  const cancel = useCancelOrder();
  const attention = order.requiresWaiterDecision || ['ready', 'rejected'].includes(order.status);
  const unclaimedQr = order.source === 'qr' && !order.waiter;

  const openMenu = () => {
    const buttons: any[] = [];
    if (EDITABLE.includes(order.status) || order.status === 'ready') {
      buttons.push({
        text: 'Добавить блюда',
        onPress: () => {
          selectTable(
            { id: order.table.id, number: order.table.number, hallName: order.table.hall?.name },
            order.id,
          );
          navigation.navigate('Menu');
        },
      });
    }
    if (CANCELLABLE.includes(order.status)) {
      buttons.push({
        text: 'Отменить заказ',
        style: 'destructive',
        onPress: () =>
          cancel.mutate(
            { orderId: order.id },
            { onError: (e: unknown) => Alert.alert('Ошибка', apiError(e)) },
          ),
      });
    }
    buttons.push({ text: 'Закрыть', style: 'cancel' });
    Alert.alert(`Заказ ${displayOrderNumber(order.orderNumber)}`, undefined, buttons);
  };

  return (
    <Card highlighted={attention} onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}>
      <View style={styles.row}>
        <View style={styles.headLeft}>
          <View style={styles.titleRow}>
            <Text style={styles.orderNumber}>{displayOrderNumber(order.orderNumber)}</Text>
            {unclaimedQr ? (
              <View style={styles.qrTag}>
                <Text style={styles.qrTagText}>QR</Text>
              </View>
            ) : null}
            <Text style={styles.tableText}>
              Стол {order.table.number}
              {hallSuffix(order.table)}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={13} color={colors.textLight} />
            <Text style={styles.metaText}>
              {timeHM(order.createdAt)} · {order.items.length} поз.
            </Text>
          </View>
        </View>

        <View style={styles.headRight}>
          <OrderBadge status={order.status} />
          <Text style={styles.money}>{money(order.finalAmount)}</Text>
        </View>

        <Pressable onPress={openMenu} hitSlop={10} style={styles.dots}>
          <Ionicons name="ellipsis-vertical" size={18} color={colors.textLight} />
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  panel: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  // PWA Panel title: text-lg font-semibold (18/600).
  panelTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.md },
  list: { gap: spacing.md, paddingBottom: spacing.md },
  // PWA OrdersList: gap-3, номер/сумма text-base font-semibold (16/600), стол text-sm, время text-xs.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headLeft: { flex: 1, minWidth: 0, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  orderNumber: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
  qrTag: { backgroundColor: colors.primarySoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  qrTagText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  tableText: { fontSize: 14, color: colors.textMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: colors.textLight },
  headRight: { alignItems: 'flex-end', gap: spacing.sm },
  money: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
  dots: { paddingLeft: 4, paddingTop: 2 },
});
