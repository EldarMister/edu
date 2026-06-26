import React, { memo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Card, EmptyState, Loading } from '@/components/ui';
import { PwaIcon } from '@/components/PwaIcon';
import { OrderBadge } from '@/components/StatusBadge';
import { NumberTicker } from '@/components/NumberTicker';
import { colors, fontSize, spacing } from '@/theme';
import { useActiveOrders, useCancelOrder, useClaimQrOrder } from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { useNotifications } from '@/store/notifications';
import { displayOrderNumber, hallSuffix, timeHM } from '@/utils/format';
import { apiError } from '@/lib/api';
import type { Order } from '@/types';

const EDITABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking'];
const CANCELLABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready', 'partially_rejected'];

export function OrdersScreen() {
  const navigation = useNavigation<any>();
  const rootRef = React.useRef<View>(null);
  const { width: screenWidth } = useWindowDimensions();
  const orders = useActiveOrders();
  const selectTable = useCart((s) => s.selectTable);
  const push = useNotifications((s) => s.push);
  const cancel = useCancelOrder();
  const claimQr = useClaimQrOrder();
  const [menuFor, setMenuFor] = React.useState<{ order: Order; top: number; left: number } | null>(null);

  const sorted = React.useMemo(() => {
    const attention = (o: Order) =>
      o.requiresWaiterDecision || ['ready', 'rejected'].includes(o.status) ? 1 : 0;
    return [...(orders.data ?? [])].sort((a, b) => {
      const d = attention(b) - attention(a);
      if (d !== 0) return d;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [orders.data]);

  const openOrder = React.useCallback((order: Order) => {
    navigation.navigate('OrderDetail', { orderId: order.id });
  }, [navigation]);

  const editOrder = React.useCallback((order: Order) => {
    setMenuFor(null);
    selectTable(
      { id: order.table.id, number: order.table.number, hallName: order.table.hall?.name },
      order.id,
    );
    navigation.navigate('Menu');
  }, [navigation, selectTable]);

  const cancelOrder = React.useCallback((order: Order) => {
    setMenuFor(null);
    cancel.mutate(
      { orderId: order.id },
      {
        onSuccess: () => push({ message: 'Заказ отменён', type: 'success', at: new Date().toISOString() }),
        onError: (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() }),
      },
    );
  }, [cancel, push]);

  const claimOrder = React.useCallback((order: Order) => {
    claimQr.mutate(order.id, {
      onSuccess: (updated) => {
        selectTable(
          { id: updated.table.id, number: updated.table.number, hallName: updated.table.hall?.name },
          updated.id,
        );
        push({ message: `QR-заказ взят · Стол ${updated.table.number}`, type: 'success', at: new Date().toISOString() });
        navigation.navigate('OrderDetail', { orderId: updated.id });
      },
      onError: (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() }),
    });
  }, [claimQr, navigation, push, selectTable]);

  const renderOrder = React.useCallback(({ item }: { item: Order }) => (
    <OrderCard
      order={item}
      menuOpen={menuFor?.order.id === item.id}
      claimPending={claimQr.isPending}
      onOpen={openOrder}
      onClaim={claimOrder}
      onToggleMenu={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        rootRef.current?.measureInWindow((rootX, rootY) => {
          const menuWidth = 244;
          setMenuFor((current) => {
            if (current?.order.id === item.id) return null;
            const left = Math.min(
              screenWidth - menuWidth - spacing.lg,
              Math.max(spacing.lg, pageX - rootX - menuWidth + 28),
            );
            return { order: item, top: Math.max(spacing.sm, pageY - rootY + 8), left };
          });
        });
      }}
    />
  ), [claimOrder, claimQr.isPending, menuFor?.order.id, openOrder, screenWidth]);

  const keyOrder = React.useCallback((order: Order) => order.id, []);

  return (
    <SafeAreaView ref={rootRef} style={styles.safe} edges={[]}>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Активные заказы</Text>
        {orders.isLoading ? (
          <Loading />
        ) : sorted.length === 0 ? (
          <EmptyState text="Активных заказов нет" />
        ) : (
          <FlatList
            data={sorted}
            renderItem={renderOrder}
            keyExtractor={keyOrder}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={orders.isFetching} onRefresh={() => orders.refetch()} />
            }
            removeClippedSubviews
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
          />
        )}
      </View>
      {menuFor ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuFor(null)} />
          <View style={[styles.actionsMenuOverlay, { top: menuFor.top, left: menuFor.left }]}>
            {EDITABLE.includes(menuFor.order.status) ? (
              <Pressable
                onPress={() => editOrder(menuFor.order)}
                style={styles.menuItem}
              >
                <Text style={styles.menuItemText}>Редактировать заказ</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={!CANCELLABLE.includes(menuFor.order.status)}
              onPress={() => cancelOrder(menuFor.order)}
              style={[styles.menuItem, !CANCELLABLE.includes(menuFor.order.status) && { opacity: 0.4 }]}
            >
              <Text style={[styles.menuItemText, styles.menuDanger]}>Отменить заказ</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const OrderCard = memo(function OrderCard({
  order,
  menuOpen,
  claimPending,
  onOpen,
  onClaim,
  onToggleMenu,
}: {
  order: Order;
  menuOpen: boolean;
  claimPending: boolean;
  onOpen: (order: Order) => void;
  onClaim: (order: Order) => void;
  onToggleMenu: (event: any) => void;
}) {
  const attention = order.requiresWaiterDecision || ['ready', 'rejected'].includes(order.status);
  const unclaimedQr = order.source === 'qr' && !order.waiter;

  return (
    <Card highlighted={attention || unclaimedQr} onPress={() => onOpen(order)} style={styles.orderCard}>
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
            <PwaIcon name="clock" size={13} color={colors.textLight} strokeWidth={2} />
            <Text style={styles.metaText}>
              {timeHM(order.createdAt)} · {order.items.length} поз.
            </Text>
          </View>
        </View>

        <View style={styles.headRight}>
          <OrderBadge status={order.status} />
          {unclaimedQr ? (
            <Pressable
              disabled={claimPending}
              onPress={(event) => {
                event.stopPropagation();
                onClaim(order);
              }}
              style={[styles.claimBtn, claimPending && { opacity: 0.6 }]}
            >
              <Text style={styles.claimText}>{claimPending ? 'Берём...' : 'Взять'}</Text>
            </Pressable>
          ) : null}
          <NumberTicker value={Number(order.finalAmount)} style={styles.money} digitHeight={20} />
        </View>

        {!unclaimedQr ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onToggleMenu(event);
            }}
            hitSlop={10}
            style={[styles.dots, menuOpen && styles.dotsActive]}
          >
            <PwaIcon name="dotsVertical" size={16} color={colors.textLight} />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}, (prev, next) =>
  prev.order === next.order &&
  prev.menuOpen === next.menuOpen &&
  prev.claimPending === next.claimPending
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  panel: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: 18 },
  panelTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.lg },
  list: { gap: spacing.sm, paddingBottom: spacing.lg },
  orderCard: { paddingHorizontal: spacing.lg, paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  headLeft: { flex: 1, minWidth: 0, justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  orderNumber: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  qrTag: { backgroundColor: colors.primarySoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  qrTagText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  tableText: { fontSize: fontSize.base, color: colors.textMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: fontSize.sm, color: colors.textLight },
  headRight: { alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  money: { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
  dots: { paddingLeft: 4, paddingTop: 2 },
  dotsActive: { borderRadius: 12, backgroundColor: colors.background },
  claimBtn: {
    borderRadius: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  claimText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.white },
  actionsMenuOverlay: {
    position: 'absolute',
    width: 244,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.white,
    overflow: 'hidden',
    zIndex: 100,
  },
  menuItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuItemText: { fontSize: fontSize.sm, color: colors.textPrimary },
  menuDanger: { color: colors.danger },
});
