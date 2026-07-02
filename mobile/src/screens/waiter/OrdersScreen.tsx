import React, { memo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Button, Card, EmptyState, Loading } from '@/components/ui';
import { popTiming } from '@/components/motion';
import { PwaIcon } from '@/components/PwaIcon';
import { OrderBadge } from '@/components/StatusBadge';
import { NumberTicker } from '@/components/NumberTicker';
import { colors, fontSize, spacing } from '@/theme';
import { useActiveOrders, useCancelOrder, useClaimQrOrder, useDishes } from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { useNotifications } from '@/store/notifications';
import { displayOrderNumber, hallSuffix, timeHM } from '@/utils/format';
import { orderToCartLines } from '@/utils/orderCart';
import { apiError } from '@/lib/api';
import type { Order } from '@/types';

const EDITABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking'];
const CANCELLABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready', 'partially_rejected'];
const CANCEL_UNDO_SECONDS = 6;
const CANCEL_REASONS = ['Клиент передумал', 'Ошибка официанта', 'Другое'] as const;
const DEFAULT_CANCEL_REASON = CANCEL_REASONS[0];

type PendingCancel = { order: Order; reason: string; deadline: number };

export function OrdersScreen() {
  const navigation = useNavigation<any>();
  const rootRef = React.useRef<View>(null);
  const { width: screenWidth } = useWindowDimensions();
  const orders = useActiveOrders();
  const dishes = useDishes();
  const selectTable = useCart((s) => s.selectTable);
  const startEditing = useCart((s) => s.startEditing);
  const push = useNotifications((s) => s.push);
  const cancel = useCancelOrder();
  const claimQr = useClaimQrOrder();
  const [menuFor, setMenuFor] = React.useState<{ order: Order; top: number; left: number } | null>(null);
  const [menuRender, setMenuRender] = React.useState<{ order: Order; top: number; left: number } | null>(null);
  const menuProgress = useSharedValue(0);
  const clearMenuRender = React.useCallback(() => setMenuRender(null), []);
  const [cancelTarget, setCancelTarget] = React.useState<Order | null>(null);
  const [cancelReason, setCancelReason] = React.useState<string>(DEFAULT_CANCEL_REASON);
  const [cancelOther, setCancelOther] = React.useState('');
  const [pendingCancel, setPendingCancel] = React.useState<PendingCancel | null>(null);
  const [now, setNow] = React.useState(Date.now());

  const sorted = React.useMemo(() => {
    const attention = (o: Order) =>
      o.requiresWaiterDecision || ['ready', 'rejected'].includes(o.status) ? 1 : 0;
    return [...(orders.data ?? [])].sort((a, b) => {
      const d = attention(b) - attention(a);
      if (d !== 0) return d;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [orders.data]);

  const closeMenu = React.useCallback(() => {
    setMenuFor(null);
    menuProgress.value = withTiming(
      0,
      {
        duration: popTiming.exitMs,
        easing: popTiming.easing,
      },
      (finished) => {
        if (finished) runOnJS(clearMenuRender)();
      },
    );
  }, [clearMenuRender, menuProgress]);

  const showMenu = React.useCallback((next: { order: Order; top: number; left: number }) => {
    setMenuFor(next);
    setMenuRender(next);
    menuProgress.value = 0;
    menuProgress.value = withTiming(1, {
      duration: popTiming.enterMs,
      easing: popTiming.easing,
    });
  }, [menuProgress]);

  const menuStyle = useAnimatedStyle(() => ({
    opacity: menuProgress.value,
    transform: [
      { translateY: interpolate(menuProgress.value, [0, 1], [-6, 0]) },
      { scale: interpolate(menuProgress.value, [0, 1], [0.98, 1]) },
    ],
  }));

  const openOrder = React.useCallback((order: Order) => {
    navigation.navigate('OrderDetail', { orderId: order.id });
  }, [navigation]);

  const editOrder = React.useCallback((order: Order) => {
    closeMenu();
    const lines = orderToCartLines(order, dishes.data ?? []);
    if (lines.length === 0) {
      push({ message: 'Не удалось восстановить позиции заказа для редактирования', type: 'error', at: new Date().toISOString() });
      return;
    }
    startEditing(
      { id: order.table.id, number: order.table.number, hallName: order.table.hall?.name },
      { id: order.id, orderNumber: order.orderNumber, comment: order.comment },
      lines,
    );
    navigation.navigate('Menu');
  }, [closeMenu, dishes.data, navigation, push, startEditing]);

  const commitCancel = React.useCallback((pending: PendingCancel) => {
    setPendingCancel((current) => (
      current?.order.id === pending.order.id && current.deadline === pending.deadline ? null : current
    ));
    cancel.mutate(
      { orderId: pending.order.id, reason: pending.reason || undefined },
      {
        onSuccess: () => push({ message: 'Заказ отменён', type: 'success', at: new Date().toISOString() }),
        onError: (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() }),
      },
    );
  }, [cancel, push]);

  React.useEffect(() => {
    if (!pendingCancel) return undefined;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 250);
    const timeout = setTimeout(() => commitCancel(pendingCancel), Math.max(0, pendingCancel.deadline - Date.now()));
    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [commitCancel, pendingCancel]);

  const requestCancelOrder = React.useCallback((order: Order) => {
    closeMenu();
    setCancelReason(DEFAULT_CANCEL_REASON);
    setCancelOther('');
    setCancelTarget(order);
  }, [closeMenu]);

  const confirmCancelOrder = React.useCallback(() => {
    if (!cancelTarget) return;
    if (pendingCancel) commitCancel(pendingCancel);
    const finalReason = cancelReason === 'Другое' ? cancelOther.trim() || 'Другое' : cancelReason;
    setPendingCancel({
      order: cancelTarget,
      reason: finalReason,
      deadline: Date.now() + CANCEL_UNDO_SECONDS * 1000,
    });
    setCancelTarget(null);
    setCancelReason(DEFAULT_CANCEL_REASON);
    setCancelOther('');
  }, [cancelOther, cancelReason, cancelTarget, commitCancel, pendingCancel]);

  const undoCancel = React.useCallback(() => {
    setPendingCancel(null);
    push({ message: 'Отмена заказа отменена', type: 'info', at: new Date().toISOString() });
  }, [push]);

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
        if (menuFor?.order.id === item.id) {
          closeMenu();
          return;
        }
        const { pageX, pageY } = event.nativeEvent;
        rootRef.current?.measureInWindow((rootX, rootY) => {
          const menuWidth = 244;
          const left = Math.min(
            screenWidth - menuWidth - spacing.lg,
            Math.max(spacing.lg, pageX - rootX - menuWidth + 28),
          );
          showMenu({ order: item, top: Math.max(spacing.sm, pageY - rootY + 8), left });
        });
      }}
    />
  ), [claimOrder, claimQr.isPending, closeMenu, menuFor?.order.id, openOrder, screenWidth, showMenu]);

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
      {menuRender ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <FastPressable style={StyleSheet.absoluteFill} onPress={closeMenu} />
          <Animated.View
            style={[
              styles.actionsMenuOverlay,
              {
                top: menuRender.top,
                left: menuRender.left,
              },
              menuStyle,
            ]}
          >
            {EDITABLE.includes(menuRender.order.status) ? (
              <FastPressable
                onPress={() => editOrder(menuRender.order)}
                style={styles.menuItem}
              >
                <Text style={styles.menuItemText}>Редактировать заказ</Text>
              </FastPressable>
            ) : null}
            <FastPressable
              disabled={!CANCELLABLE.includes(menuRender.order.status)}
              onPress={() => requestCancelOrder(menuRender.order)}
              style={[styles.menuItem, !CANCELLABLE.includes(menuRender.order.status) && { opacity: 0.4 }]}
            >
              <Text style={[styles.menuItemText, styles.menuDanger]}>Отменить заказ</Text>
            </FastPressable>
          </Animated.View>
        </View>
      ) : null}
      {pendingCancel ? (
        <View pointerEvents="box-none" style={styles.undoOuter}>
          <View style={styles.undoCard}>
            <View style={styles.undoIcon}>
              <PwaIcon name="rotateCcw" size={20} color={colors.white} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.undoTitle} numberOfLines={1}>
                {displayOrderNumber(pendingCancel.order.orderNumber)} · Стол {pendingCancel.order.table.number}
                {hallSuffix(pendingCancel.order.table)} — отмена заказа
              </Text>
              <Text style={styles.undoSub}>
                Отменится через{' '}
                <Text style={styles.undoSeconds}>
                  {String(Math.max(0, Math.ceil((pendingCancel.deadline - now) / 1000))).padStart(2, '0')} сек
                </Text>
              </Text>
            </View>
            <FastPressable onPress={undoCancel} style={styles.undoBtn}>
              <Text style={styles.undoBtnText}>Вернуть</Text>
            </FastPressable>
          </View>
        </View>
      ) : null}
      <CancelOrderSheet
        order={cancelTarget}
        reason={cancelReason}
        other={cancelOther}
        submitting={cancel.isPending}
        onReasonChange={setCancelReason}
        onOtherChange={setCancelOther}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancelOrder}
      />
    </SafeAreaView>
  );
}

function CancelOrderSheet({
  order,
  reason,
  other,
  submitting,
  onReasonChange,
  onOtherChange,
  onClose,
  onConfirm,
}: {
  order: Order | null;
  reason: string;
  other: string;
  submitting: boolean;
  onReasonChange: (value: string) => void;
  onOtherChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet
      visible={!!order}
      onClose={onClose}
      title="Отменить заказ?"
      footer={
        <View style={styles.cancelFooter}>
          <Button title="Назад" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Отменить заказ" variant="danger" loading={submitting} onPress={onConfirm} style={{ flex: 1 }} />
        </View>
      }
    >
      {order ? (
        <>
          <Text style={styles.cancelText}>
            {displayOrderNumber(order.orderNumber)} · Стол {order.table.number}
            {hallSuffix(order.table)}
          </Text>
          <Text style={styles.cancelHint}>Заказ ещё не принят кухней, поэтому он будет отменён сразу.</Text>
        </>
      ) : null}
      <Text style={styles.cancelReasonTitle}>Причина</Text>
      <View style={styles.cancelReasonList}>
        {CANCEL_REASONS.map((item) => {
          const active = reason === item;
          return (
            <FastPressable
              key={item}
              onPress={() => onReasonChange(item)}
              style={[styles.cancelReasonRow, active && styles.cancelReasonRowActive]}
            >
              <View style={[styles.cancelRadio, active && styles.cancelRadioActive]}>
                {active ? <View style={styles.cancelRadioDot} /> : null}
              </View>
              <Text style={[styles.cancelReasonText, active && styles.cancelReasonTextActive]}>{item}</Text>
            </FastPressable>
          );
        })}
      </View>
      {reason === 'Другое' ? (
        <TextInput
          value={other}
          onChangeText={onOtherChange}
          placeholder="Укажите причину"
          placeholderTextColor={colors.textLight}
          style={styles.cancelInput}
        />
      ) : null}
    </BottomSheet>
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
            <FastPressable
              disabled={claimPending}
              onPress={(event) => {
                event.stopPropagation();
                onClaim(order);
              }}
              style={[styles.claimBtn, claimPending && { opacity: 0.6 }]}
            >
              <Text style={styles.claimText}>{claimPending ? 'Берём...' : 'Взять'}</Text>
            </FastPressable>
          ) : null}
          <NumberTicker value={Number(order.finalAmount)} style={styles.money} digitHeight={20} />
        </View>

        {!unclaimedQr ? (
          <FastPressable
            onPress={(event) => {
              event.stopPropagation();
              onToggleMenu(event);
            }}
            hitSlop={10}
            style={[styles.dots, menuOpen && styles.dotsActive]}
          >
            <PwaIcon name="dotsVertical" size={16} color={colors.textLight} />
          </FastPressable>
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
  undoOuter: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    alignItems: 'center',
  },
  undoCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  undoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  undoSub: { marginTop: 2, fontSize: fontSize.sm, color: colors.textMuted },
  undoSeconds: { fontWeight: '600', color: colors.danger },
  undoBtn: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  undoBtnText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '700' },
  cancelFooter: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  cancelText: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  cancelHint: { marginTop: 4, fontSize: fontSize.sm, color: colors.textMuted },
  cancelReasonTitle: { marginTop: spacing.md, marginBottom: spacing.sm, fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  cancelReasonList: { gap: spacing.sm },
  cancelReasonRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cancelReasonRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  cancelRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.slate300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelRadioActive: { borderColor: colors.primary },
  cancelRadioDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.primary },
  cancelReasonText: { fontSize: fontSize.base, color: colors.textSecondary },
  cancelReasonTextActive: { color: colors.textPrimary },
  cancelInput: {
    height: 44,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
  },
});
