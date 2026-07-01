import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Button, EmptyState, Loading } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { OrderStatusBadges } from '@/components/StatusBadge';
import { NumberTicker } from '@/components/NumberTicker';
import { colors, fontSize, radius, spacing } from '@/theme';
import { ORDER_STATUS } from '@/theme/status';
import { useNotifications } from '@/store/notifications';
import {
  useActiveOrders,
  useCancelOrder,
  useCancelReadyItem,
  useClaimQrOrder,
  usePickedUp,
  useRemoveRejectedItem,
  useServed,
  useToPayment,
  useResolvePartialRejection,
  useCreateReceiptPrintRequest,
  useDishes,
  fetchReceipt,
} from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { useReceiptPrint } from '@/store/receiptPrint';
import { useReplacement } from '@/store/replacement';
import { apiError } from '@/lib/api';
import { displayOrderNumber, hallSuffix, money } from '@/utils/format';
import { orderToCartLines } from '@/utils/orderCart';
import { PaymentSheet } from './PaymentSheet';
import type { Order, OrderItem } from '@/types';

type R = RouteProp<{ OrderDetail: { orderId: string } }, 'OrderDetail'>;
const DETAIL_EDITABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking'];

export function OrderDetailScreen() {
  const route = useRoute<R>();
  const navigation = useNavigation<any>();
  const { orderId } = route.params;
  const orders = useActiveOrders();
  const dishes = useDishes();
  const order = orders.data?.find((o) => o.id === orderId) ?? null;

  const pickedUp = usePickedUp();
  const served = useServed();
  const toPayment = useToPayment();
  const resolve = useResolvePartialRejection();
  const removeRejected = useRemoveRejectedItem();
  const cancelReadyItem = useCancelReadyItem();
  const cancelOrder = useCancelOrder();
  const claimQr = useClaimQrOrder();
  const print = useCreateReceiptPrintRequest();
  const selectTable = useCart((s) => s.selectTable);
  const clearCart = useCart((s) => s.clear);
  const startEditing = useCart((s) => s.startEditing);
  const beginPrint = useReceiptPrint((s) => s.begin);
  const setReplacementTarget = useReplacement((s) => s.setTarget);
  const [payOpen, setPayOpen] = useState(false);
  const [billItem, setBillItem] = useState<OrderItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [actionCooldown, setActionCooldown] = useState(0);
  const push = useNotifications((s) => s.push);

  const onError = (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() });

  React.useEffect(() => {
    if (order?.status === 'waiting_payment') setPayOpen(true);
  }, [order?.id, order?.status]);

  React.useEffect(() => {
    if (actionCooldown <= 0) return undefined;
    const id = setTimeout(() => setActionCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(id);
  }, [actionCooldown]);

  React.useEffect(() => {
    setActionCooldown(0);
  }, [order?.id]);

  if (orders.isLoading && !order) return <Loading />;
  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <EmptyState text="Заказ не найден" />
      </SafeAreaView>
    );
  }

  const unclaimedQr = order.source === 'qr' && !order.waiter;
  const busy = pickedUp.isPending || served.isPending || toPayment.isPending || resolve.isPending || claimQr.isPending;
  const cooldownActive = actionCooldown > 0;
  const stationItems = order.items.filter((item) => item.prepStation !== 'none');
  const hasReadyStationItem = stationItems.some((item) => item.status === 'ready');
  const billCorrection = ['ready', 'picked_up', 'served'].includes(order.status);

  const runProtectedAction = (action: () => void) => {
    setActionCooldown(5);
    action();
  };

  const requestPreliminaryReceipt = () => {
    Promise.all([
      print.mutateAsync({ orderId: order.id, type: 'preliminary' }),
      fetchReceipt(order.id),
    ])
      .then(([request, receipt]) => beginPrint(request, receipt))
      .catch(onError);
  };

  const confirmCancelReadyItem = () => {
    if (!billItem) return;
    cancelReadyItem.mutate(
      { orderId: order.id, itemId: billItem.id, reason: cancelReason.trim() },
      {
        onSuccess: () => {
          push({ message: `${orderItemName(billItem)} отменено`, type: 'success', at: new Date().toISOString() });
          setBillItem(null);
          setCancelReason('');
        },
        onError,
      },
    );
  };

  if (order.status === 'partially_rejected' && order.requiresWaiterDecision) {
    return (
      <PartialRejectionScreen
        order={order}
        busy={resolve.isPending || removeRejected.isPending || cancelOrder.isPending}
        onReplacePress={(item) => {
          selectTable(
            { id: order.table.id, number: order.table.number, hallName: order.table.hall?.name },
            order.id,
          );
          setReplacementTarget({
            orderId: order.id,
            table: { id: order.table.id, number: order.table.number, hallName: order.table.hall?.name },
            item,
          });
          push({ message: `Выберите блюдо на замену: ${orderItemName(item)}`, type: 'info', at: new Date().toISOString() });
          navigation.navigate('Menu');
        }}
        onRemove={(item) =>
          removeRejected.mutate(
            { orderId: order.id, itemId: item.id },
            {
              onSuccess: () => push({ message: `${orderItemName(item)} убрано из заказа`, type: 'success', at: new Date().toISOString() }),
              onError,
            },
          )
        }
        onContinue={() =>
          resolve.mutate(order.id, {
            onSuccess: () => push({ message: 'Заказ продолжен без отказанных блюд', type: 'success', at: new Date().toISOString() }),
            onError,
          })
        }
        onCancel={() =>
          cancelOrder.mutate(
            { orderId: order.id, reason: 'Клиент отменил заказ после частичного отказа кухни' },
            {
              onSuccess: () => {
                clearCart();
                push({ message: 'Заказ отменён', type: 'success', at: new Date().toISOString() });
                navigation.getParent()?.navigate('Tables');
              },
              onError,
            },
          )
        }
      />
    );
  }

  const mainAction = () => {
    if (unclaimedQr) {
      return (
        <Button
          title="Взять заказ"
          loading={claimQr.isPending}
          disabled={busy}
          onPress={() =>
            claimQr.mutate(order.id, {
              onSuccess: (updated) => {
                selectTable(
                  { id: updated.table.id, number: updated.table.number, hallName: updated.table.hall?.name },
                  updated.id,
                );
                push({ message: `QR-заказ взят · Стол ${updated.table.number}`, type: 'success', at: new Date().toISOString() });
              },
              onError,
            })
          }
        />
      );
    }
    if (order.requiresWaiterDecision) {
      return (
        <Button
          title="Продолжить без отказанного"
          variant="danger"
          style={{ flex: 1 }}
          loading={resolve.isPending}
          onPress={() => resolve.mutate(order.id, { onError })}
        />
      );
    }
    if (
      hasReadyStationItem &&
      !['paid', 'cancelled', 'rejected', 'waiting_payment', 'picked_up', 'served', 'ready'].includes(order.status)
    ) {
      return (
        <Button
          title={cooldownActive ? String(actionCooldown) : 'Забрал с кухни'}
          loading={busy && !cooldownActive}
          disabled={cooldownActive}
          onPress={() => runProtectedAction(() => pickedUp.mutate(order.id, { onError }))}
        />
      );
    }
    switch (order.status) {
      case 'ready':
        return (
          <Button
            title={cooldownActive ? String(actionCooldown) : 'Вынес гостям'}
            loading={busy && !cooldownActive}
            disabled={cooldownActive}
            onPress={() => runProtectedAction(() => served.mutate(order.id, { onError }))}
          />
        );
      case 'picked_up':
        return (
          <Button
            title={cooldownActive ? String(actionCooldown) : 'Вынес гостям'}
            loading={busy && !cooldownActive}
            disabled={cooldownActive}
            onPress={() => runProtectedAction(() => served.mutate(order.id, { onError }))}
          />
        );
      case 'served':
        return (
          <View style={styles.actions}>
            <Button
              title="Счёт"
              variant="secondary"
              style={{ width: 110 }}
              loading={print.isPending}
              onPress={requestPreliminaryReceipt}
            />
            <Button
              title={cooldownActive ? String(actionCooldown) : 'Перейти к оплате'}
              style={{ flex: 1 }}
              loading={busy && !cooldownActive}
              disabled={cooldownActive}
              onPress={() =>
                runProtectedAction(() => toPayment.mutate(order.id, { onError, onSuccess: () => setPayOpen(true) }))
              }
            />
          </View>
        );
      case 'waiting_payment':
        return (
          <View style={styles.waitingPaymentBox}>
            <Text style={styles.waitingPaymentText}>Ожидает оплаты</Text>
          </View>
        );
      case 'sent_to_kitchen':
      case 'accepted_by_kitchen':
      case 'cooking':
      case 'partially_rejected':
        return (
          <View style={styles.statusInfoBox}>
            <PwaIcon name="info" size={16} color={colors.primary} strokeWidth={2} />
            <Text style={styles.statusInfoText}>{ORDER_STATUS[order.status].label} - ожидаем кухню</Text>
          </View>
        );
      case 'rejected':
        return (
          <View style={styles.rejectedInfoBox}>
            <Text style={styles.rejectedInfoText}>Кухня отказала в заказе</Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <View style={styles.titleBlock}>
        <View style={styles.titleMainRow}>
          <Text style={styles.title} numberOfLines={1}>
            Заказ {displayOrderNumber(order.orderNumber)}{' '}
            <Text style={styles.titleMuted}>
              Стол {order.table.number}
              {hallSuffix(order.table)}
            </Text>
          </Text>
          <View style={styles.titleActions}>
            {unclaimedQr ? (
              <View style={styles.qrBadge}>
                <Text style={styles.qrBadgeText}>QR</Text>
              </View>
            ) : null}
            {DETAIL_EDITABLE.includes(order.status) && !unclaimedQr ? (
              <Pressable
                onPress={() => {
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
                }}
                style={styles.editOrderBtn}
              >
                <PwaIcon name="pencil" size={14} color={colors.textSecondary} />
                <Text style={styles.editOrderText}>Изменить</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.statusRow}>
          <OrderStatusBadges order={order} size="sm" align="start" />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {order.items.map((it) => (
          <ItemCard
            key={it.id}
            item={it}
            billCorrection={billCorrection}
            disabled={cancelReadyItem.isPending}
            onCancel={() => {
              setBillItem(it);
              setCancelReason('');
            }}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {unclaimedQr ? (
          <View style={styles.qrInfoBox}>
            <Text style={styles.qrInfoText}>Этот QR-заказ видят все официанты. Нажмите «Взять заказ», чтобы закрепить его за собой.</Text>
          </View>
        ) : null}
        {order.comment ? (
          <Text style={styles.orderComment}>{order.comment}</Text>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Итого</Text>
          <NumberTicker value={Number(order.finalAmount)} style={styles.totalValue} digitHeight={32} />
        </View>
        {mainAction()}
      </View>

      <PaymentSheet
        order={order}
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        onPaid={() => {
          setPayOpen(false);
          navigation.getParent()?.navigate('Tables');
        }}
      />
      <CancelReadyItemSheet
        item={billItem}
        reason={cancelReason}
        submitting={cancelReadyItem.isPending}
        onReasonChange={setCancelReason}
        onClose={() => {
          setBillItem(null);
          setCancelReason('');
        }}
        onConfirm={confirmCancelReadyItem}
      />
    </SafeAreaView>
  );
}

function orderItemName(item: OrderItem) {
  return item.dishVariantNameSnapshot
    ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}`
    : item.dishNameSnapshot;
}

function safeComment(value: string | null | undefined): string | null {
  if (!value) return null;
  if ([...value].every((char) => char === '�' || char === ' ')) return null;
  return value;
}

function ItemCard({
  item,
  billCorrection,
  disabled,
  onCancel,
}: {
  item: OrderItem;
  billCorrection: boolean;
  disabled: boolean;
  onCancel: () => void;
}) {
  const name = orderItemName(item);
  const done = item.status === 'ready' || item.status === 'served';
  const rejected = item.status === 'rejected' || item.status === 'cancelled';
  const cooking = item.status === 'accepted' || item.status === 'cooking';
  const comment = safeComment(item.comment);
  const clickable = billCorrection && (item.status === 'ready' || item.status === 'served') && !disabled;
  const hasExtra = comment || ((rejected || item.status === 'cancelled') && item.rejectReason);
  return (
    <Pressable disabled={!clickable} onPress={onCancel} style={[styles.itemCard, clickable && styles.itemCardClickable]}>
      <View style={styles.itemMainRow}>
        <Text style={[styles.itemName, rejected && styles.itemRejectedName]} numberOfLines={2}>
          {name}
          {item.takeaway ? '  · с собой' : ''}
        </Text>
        <Text style={styles.itemQty}>×{item.quantity}</Text>
        <View style={styles.itemRight}>
          <Text style={styles.itemPrice}>{money(item.finalPrice)}</Text>
          {done ? (
            <Text style={styles.itemDone}>✓ Готово</Text>
          ) : cooking ? (
            <Text style={styles.itemCooking}>Готовится</Text>
          ) : rejected ? (
            <Text style={styles.itemRejected}>{item.status === 'cancelled' ? 'Отменено' : 'Отказано'}</Text>
          ) : null}
        </View>
      </View>
      {hasExtra ? (
        <View style={styles.itemExtra}>
          {comment ? <Text style={styles.itemComment}>{comment}</Text> : null}
          {rejected && item.rejectReason ? (
            <Text style={styles.itemRejectReason}>
              {item.status === 'cancelled' ? 'Причина' : 'Отказ'}: {item.rejectReason}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function CancelReadyItemSheet({
  item,
  reason,
  submitting,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  item: OrderItem | null;
  reason: string;
  submitting: boolean;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet
      visible={!!item}
      onClose={onClose}
      title="Действие с блюдом"
      footer={
        <View style={styles.cancelReadyFooter}>
          <Button
            title="Отменить блюдо"
            variant="danger"
            loading={submitting}
            disabled={reason.trim().length < 2}
            onPress={onConfirm}
          />
          <Button title="Закрыть" variant="secondary" disabled={submitting} onPress={onClose} />
        </View>
      }
    >
      {item ? (
        <View style={styles.cancelReadyDish}>
          <Text style={styles.cancelReadyName}>{orderItemName(item)}</Text>
          <Text style={styles.cancelReadyMeta}>×{item.quantity} · {money(item.finalPrice)}</Text>
        </View>
      ) : null}
      <Text style={styles.cancelReadyLabel}>Причина отмены</Text>
      <TextInput
        value={reason}
        onChangeText={onReasonChange}
        multiline
        maxLength={160}
        placeholder="Например: клиент отказался"
        placeholderTextColor={colors.textLight}
        style={styles.cancelReadyInput}
      />
    </BottomSheet>
  );
}

function PartialRejectionScreen({
  order,
  busy,
  onReplacePress,
  onRemove,
  onContinue,
  onCancel,
}: {
  order: Order;
  busy: boolean;
  onReplacePress: (item: OrderItem) => void;
  onRemove: (item: OrderItem) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const activeItems = order.items.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled');
  const rejectedItems = order.items.filter(
    (item) => item.status === 'rejected' && (item.rejectionDecision == null || item.rejectionDecision === 'pending'),
  );
  const activeTotal = activeItems.reduce((sum, item) => sum + Number(item.finalPrice), 0);

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>
          Заказ {displayOrderNumber(order.orderNumber)}{' '}
          <Text style={styles.titleMuted}>
            Стол {order.table.number}
            {hallSuffix(order.table)}
          </Text>
        </Text>
        <View style={styles.rejectBadge}>
          <Text style={styles.rejectBadgeText}>Отказ кухни</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.partialList} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>1. Активные блюда</Text>
        <View style={styles.partialStack}>
          {activeItems.map((item) => (
            <View key={item.id} style={styles.activeItemCard}>
              <Text style={styles.partialItemName} numberOfLines={1}>{orderItemName(item)}</Text>
              <Text style={styles.partialQty}>×{item.quantity}</Text>
              <Text style={styles.partialPrice}>{money(item.finalPrice)}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>2. Требуют решения</Text>
        <View style={styles.partialStack}>
          {rejectedItems.map((item) => (
            <View key={item.id} style={styles.rejectedDecisionCard}>
              <View style={styles.rejectedTopRow}>
                <Text style={styles.rejectedDecisionName} numberOfLines={1}>{orderItemName(item)}</Text>
                <Text style={styles.partialQtyStrong}>×{item.quantity}</Text>
                <Text style={styles.rejectedDecisionPrice}>{money(item.finalPrice)}</Text>
                <Text style={styles.rejectedStatus}>Отказано</Text>
              </View>
              {item.rejectReason ? <Text style={styles.rejectReason}>{item.rejectReason}</Text> : null}
              <View style={styles.rejectActions}>
                <Pressable disabled={busy} onPress={() => onReplacePress(item)} style={styles.replaceBtn}>
                  <Text style={styles.replaceBtnText}>Заменить</Text>
                </Pressable>
                <Pressable disabled={busy} onPress={() => onRemove(item)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>Убрать</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.partialTotalBlock}>
          <Text style={styles.totalLabel}>Итого</Text>
          <NumberTicker value={activeTotal} style={styles.totalValue} digitHeight={32} />
        </View>

        <Text style={styles.sectionTitle}>3. Решение</Text>
        <View style={styles.warningBox}>
          <Text style={styles.warningIcon}>!</Text>
          <Text style={styles.warningText}>Кухня отказала часть заказа. Решите по каждой отказанной позиции.</Text>
        </View>
        <Button title="Продолжить без отказанных блюд" onPress={onContinue} loading={busy} style={styles.partialContinueBtn} />
        <Pressable disabled={busy} onPress={onCancel} style={styles.cancelWholeBtn}>
          <Text style={styles.cancelWholeText}>Отменить весь заказ</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  titleBlock: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: 20,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  titleMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: 20,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  title: { flex: 1, fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  titleMuted: { fontSize: fontSize.base, fontWeight: '400', color: colors.textMuted },
  titleActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', minHeight: 24 },
  qrBadge: { borderRadius: 6, backgroundColor: colors.primarySoft, paddingHorizontal: 7, paddingVertical: 3 },
  qrBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  editOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 30,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  editOrderText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm, paddingBottom: spacing.md },
  itemCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    gap: 4,
  },
  itemCardClickable: { borderColor: 'rgba(0,91,255,0.4)', backgroundColor: colors.primaryFaint },
  itemMainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemName: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary },
  itemRejectedName: { color: colors.danger, textDecorationLine: 'line-through' },
  itemQty: { fontSize: fontSize.base, color: colors.textMuted },
  itemRight: { alignItems: 'flex-end', gap: 2, minWidth: 72 },
  itemPrice: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  itemDone: { fontSize: fontSize.sm, color: colors.success, fontWeight: '600' },
  itemCooking: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '500' },
  itemRejected: { fontSize: fontSize.sm, color: colors.danger, fontWeight: '600' },
  itemExtra: { gap: 2 },
  itemComment: { fontSize: fontSize.xs, color: colors.textMuted },
  itemRejectReason: { fontSize: fontSize.xs, color: colors.danger },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: fontSize.md, color: colors.textSecondary },
  totalValue: { fontSize: 22, fontWeight: '600', color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  qrInfoBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(0,91,255,0.2)',
    backgroundColor: colors.primaryFaint,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  qrInfoText: { fontSize: fontSize.sm, color: colors.primary, lineHeight: 18 },
  orderComment: {
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  waitingPaymentBox: {
    borderRadius: radius.md,
    backgroundColor: colors.purple100,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  waitingPaymentText: { fontSize: fontSize.sm, color: colors.purple600 },
  statusInfoBox: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  statusInfoText: { flexShrink: 1, fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center' },
  rejectedInfoBox: {
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  rejectedInfoText: { fontSize: fontSize.sm, color: colors.danger },
  cancelReadyFooter: { gap: spacing.sm, paddingBottom: spacing.sm },
  cancelReadyDish: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  cancelReadyName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  cancelReadyMeta: { marginTop: 4, fontSize: fontSize.sm, color: colors.textMuted },
  cancelReadyLabel: { marginBottom: 6, fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  cancelReadyInput: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  partialList: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm },
  sectionTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  partialStack: { gap: spacing.sm },
  activeItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  partialItemName: { flex: 1, fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  partialQty: { minWidth: 32, textAlign: 'right', fontSize: fontSize.sm, color: colors.textMuted },
  partialQtyStrong: { minWidth: 28, textAlign: 'right', fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  partialPrice: { minWidth: 68, textAlign: 'right', fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  rejectedDecisionCard: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.24)',
    borderRadius: radius.sm,
    backgroundColor: 'rgba(239,68,68,0.035)',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.sm,
  },
  rejectedTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rejectedDecisionName: { flex: 1, fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted, textDecorationLine: 'line-through' },
  rejectedDecisionPrice: { minWidth: 62, textAlign: 'right', fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  rejectedStatus: { fontSize: 12, fontWeight: '600', color: colors.danger },
  rejectReason: { fontSize: fontSize.sm, color: colors.danger },
  rejectActions: { flexDirection: 'row', gap: spacing.sm },
  replaceBtn: {
    height: 32,
    minWidth: 104,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replaceBtnText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '700' },
  removeBtn: {
    height: 32,
    minWidth: 84,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.48)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: colors.danger, fontSize: fontSize.sm, fontWeight: '700' },
  partialTotalBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.28)',
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  warningIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.warning,
  },
  warningText: { flex: 1, fontSize: fontSize.sm, color: colors.warning, lineHeight: 18 },
  partialContinueBtn: { height: 44 },
  cancelWholeBtn: { height: 40, alignItems: 'center', justifyContent: 'center' },
  cancelWholeText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.danger },
  rejectBadge: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.22)',
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  rejectBadgeText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.danger },
});
