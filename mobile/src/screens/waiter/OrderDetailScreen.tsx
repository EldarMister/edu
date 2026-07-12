import React, { useState } from 'react';
import { ActivityIndicator, InteractionManager, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import Svg, { Path } from 'react-native-svg';
import { FastPressable } from '@/components/FastPressable';
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
import type { Order, OrderItem, OrderItemStatus, OrderSetComponent } from '@/types';

type R = RouteProp<{ OrderDetail: { orderId: string } }, 'OrderDetail'>;
const DETAIL_EDITABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking'];
const ITEM_CANCEL_REASONS = ['Клиент передумал', 'Ошибка официанта', 'Другое'] as const;
const DEFAULT_ITEM_CANCEL_REASON = ITEM_CANCEL_REASONS[0];

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
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [billItem, setBillItem] = useState<OrderItem | null>(null);
  const [cancelReason, setCancelReason] = useState<string>(DEFAULT_ITEM_CANCEL_REASON);
  const [cancelOther, setCancelOther] = useState('');
  const [actionCooldown, setActionCooldown] = useState(0);
  const push = useNotifications((s) => s.push);
  const latestOrderRef = React.useRef<Order | null>(null);

  const onError = (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() });
  const navigateToMenu = React.useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      navigation.getParent()?.navigate('Menu');
    });
  }, [navigation]);

  React.useEffect(() => {
    latestOrderRef.current = order;
    if (order) setPaymentOrder(order);
  }, [order]);

  React.useEffect(() => {
    if (order?.status === 'waiting_payment') {
      setPaymentOrder(order);
      setPayOpen(true);
    }
  }, [order?.id, order?.status]);

  useFocusEffect(
    React.useCallback(() => {
      const focusedOrder = latestOrderRef.current;
      if (focusedOrder?.status === 'waiting_payment') {
        setPaymentOrder(focusedOrder);
        setPayOpen(true);
      }
      return undefined;
    }, [orderId]),
  );

  React.useEffect(() => {
    if (actionCooldown <= 0) return undefined;
    const id = setTimeout(() => setActionCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(id);
  }, [actionCooldown]);

  React.useEffect(() => {
    setActionCooldown(0);
  }, [order?.id]);

  // После оплаты заказ сразу исчезает из active-запроса. Sheet должен
  // оставаться на той же позиции в дереве, иначе React размонтирует его в
  // момент показа экрана успеха и создаст заново обычный лист оплаты.
  const paymentSheet = (
    <PaymentSheet
      order={paymentOrder ?? order}
      visible={payOpen}
      onClose={() => setPayOpen(false)}
      onPaid={() => {
        setPayOpen(false);
        setPaymentOrder(null);
        navigation.getParent()?.navigate('Tables');
      }}
    />
  );

  if (orders.isLoading && !order) return <Loading />;
  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        {paymentSheet}
        {!payOpen ? <EmptyState text="Заказ не найден" /> : null}
      </SafeAreaView>
    );
  }

  const unclaimedQr = order.source === 'qr' && !order.waiter;
  const busy = pickedUp.isPending || served.isPending || toPayment.isPending || resolve.isPending || claimQr.isPending;
  const cooldownActive = actionCooldown > 0;
  const stationItems = order.items.filter((item) => item.prepStation !== 'none');
  const hasReadyStationItem = stationItems.some((item) => item.status === 'ready');
  const activeItems = order.items.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled');
  const allActiveItemsServed = activeItems.length > 0 && activeItems.every((item) => item.status === 'served');
  const billCorrection = !['paid', 'cancelled', 'rejected', 'waiting_payment'].includes(order.status);

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
    const reason = cancelReason === 'Другое' ? cancelOther.trim() || 'Другое' : cancelReason;
    cancelReadyItem.mutate(
      { orderId: order.id, itemId: billItem.id, reason },
      {
        onSuccess: () => {
          push({ message: `${orderItemName(billItem)} отменено`, type: 'success', at: new Date().toISOString() });
          setBillItem(null);
          setCancelReason(DEFAULT_ITEM_CANCEL_REASON);
          setCancelOther('');
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
          navigateToMenu();
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
          <View style={{ gap: spacing.sm }}>
            {!allActiveItemsServed ? (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>Нельзя перейти к оплате: есть неподанные блюда.</Text>
              </View>
            ) : null}
            <View style={styles.actions}>
              <FastPressable
                disabled={print.isPending}
                onPress={requestPreliminaryReceipt}
                style={[styles.preReceiptBtn, print.isPending && styles.preReceiptBtnDisabled]}
              >
                {print.isPending ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.preReceiptText}>Счёт</Text>
                )}
              </FastPressable>
              <Button
                title={cooldownActive ? String(actionCooldown) : 'Перейти к оплате'}
                style={{ flex: 1 }}
                loading={busy && !cooldownActive}
                disabled={cooldownActive || !allActiveItemsServed}
                onPress={() =>
                  runProtectedAction(() =>
                    toPayment.mutate(order.id, {
                      onError,
                      onSuccess: () => {
                        setPaymentOrder(order);
                        setPayOpen(true);
                      },
                    })
                  )
                }
              />
            </View>
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
      {paymentSheet}
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
              <FastPressable
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
                  navigateToMenu();
                }}
                style={styles.editOrderBtn}
              >
                <PwaIcon name="pencil" size={14} color={colors.textSecondary} />
                <Text style={styles.editOrderText}>Изменить</Text>
              </FastPressable>
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
              setCancelReason(DEFAULT_ITEM_CANCEL_REASON);
              setCancelOther('');
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

      <CancelReadyItemSheet
        item={billItem}
        reason={cancelReason}
        other={cancelOther}
        submitting={cancelReadyItem.isPending}
        onReasonChange={setCancelReason}
        onOtherChange={setCancelOther}
        onClose={() => {
          setBillItem(null);
          setCancelReason(DEFAULT_ITEM_CANCEL_REASON);
          setCancelOther('');
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

function setComponentLabel(component: OrderSetComponent) {
  const original = component.originalVariantNameSnapshot
    ? `${component.originalNameSnapshot} ${component.originalVariantNameSnapshot}`
    : component.originalNameSnapshot;
  if (component.action !== 'replaced') return { original, final: null };
  const final = component.finalVariantNameSnapshot
    ? `${component.finalNameSnapshot ?? ''} ${component.finalVariantNameSnapshot}`
    : component.finalNameSnapshot;
  return { original, final };
}

function itemStatusText(status: OrderItemStatus) {
  if (status === 'ready' || status === 'served') return 'Готово';
  if (status === 'cooking' || status === 'accepted') return 'Готовится';
  if (status === 'rejected') return 'Отказано';
  if (status === 'cancelled') return 'Отменено';
  return 'Ожидает';
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
  const setParts = item.setComponents ?? [];
  const clickable = billCorrection && !rejected && !disabled;
  const hasExtra = setParts.length > 0 || comment || (rejected && item.rejectReason);
  return (
    <FastPressable disabled={!clickable} onPress={onCancel} style={[styles.itemCard, rejected && styles.itemCardRejected]}>
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
          {setParts.length > 0 ? (
            <View style={styles.setParts}>
              {setParts.map((component) => {
                const removed = component.action === 'removed' || component.status === 'cancelled';
                const componentRejected = component.status === 'rejected';
                const label = setComponentLabel(component);
                return (
                  <View key={component.id} style={styles.setPartRow}>
                    <Text
                      style={[
                        styles.setPartName,
                        (removed || componentRejected) && styles.setPartRejectedName,
                      ]}
                      numberOfLines={1}
                    >
                      {label.final ? (
                        <>
                          <Text style={styles.setPartOld}>{label.original}</Text>
                          <Text style={styles.setPartArrow}> &gt; </Text>
                          <Text style={styles.setPartNew}>{label.final}</Text>
                        </>
                      ) : (
                        label.original
                      )}
                    </Text>
                    {component.quantity > 1 ? (
                      <Text style={styles.setPartQty}>×{component.quantity}</Text>
                    ) : null}
                    <View
                      style={[
                        styles.setPartStatus,
                        (component.status === 'ready' || component.status === 'served') && styles.setPartStatusDone,
                        (component.status === 'rejected' || component.status === 'cancelled') && styles.setPartStatusDanger,
                        (component.status === 'cooking' || component.status === 'accepted') && styles.setPartStatusCooking,
                      ]}
                    >
                      <Text
                        style={[
                          styles.setPartStatusText,
                          (component.status === 'ready' || component.status === 'served') && styles.setPartStatusTextDone,
                          (component.status === 'rejected' || component.status === 'cancelled') && styles.setPartStatusTextDanger,
                          (component.status === 'cooking' || component.status === 'accepted') && styles.setPartStatusTextCooking,
                        ]}
                      >
                        {itemStatusText(component.status)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
          {comment ? <Text style={styles.itemComment}>{comment}</Text> : null}
          {rejected && item.rejectReason ? (
            <Text style={styles.itemRejectReason}>
              {item.status === 'cancelled' ? 'Причина' : 'Отказ'}: {item.rejectReason}
            </Text>
          ) : null}
        </View>
      ) : null}
    </FastPressable>
  );
}

function CancelReadyItemSheet({
  item,
  reason,
  other,
  submitting,
  onReasonChange,
  onOtherChange,
  onClose,
  onConfirm,
}: {
  item: OrderItem | null;
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
      visible={!!item}
      onClose={onClose}
      title="Действие с блюдом"
      footer={
        <View style={styles.cancelReadyFooter}>
          <Button
            title="Отменить блюдо"
            variant="danger"
            loading={submitting}
            onPress={onConfirm}
          />
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
      <View style={styles.cancelReasonList}>
        {ITEM_CANCEL_REASONS.map((itemReason) => {
          const active = reason === itemReason;
          return (
            <FastPressable
              key={itemReason}
              onPress={() => onReasonChange(itemReason)}
              style={[styles.cancelReasonRow, active && styles.cancelReasonRowActive]}
            >
              <View style={[styles.cancelRadio, active && styles.cancelRadioActive]}>
                {active ? <View style={styles.cancelRadioDot} /> : null}
              </View>
              <Text style={[styles.cancelReasonText, active && styles.cancelReasonTextActive]}>{itemReason}</Text>
            </FastPressable>
          );
        })}
      </View>
      {reason === 'Другое' ? (
        <TextInput
          value={other}
          onChangeText={onOtherChange}
          maxLength={160}
          placeholder="Укажите причину"
          placeholderTextColor={colors.textLight}
          style={styles.cancelReadyInput}
        />
      ) : null}
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
        <Text style={styles.partialTitle}>
          Заказ {displayOrderNumber(order.orderNumber)}{' '}
          <Text style={styles.partialTitleMuted}>
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
              <View style={styles.rejectActions}>
                <FastPressable disabled={busy} onPress={() => onReplacePress(item)} style={styles.replaceBtn}>
                  <Text style={styles.replaceBtnText}>Заменить</Text>
                </FastPressable>
                <FastPressable disabled={busy} onPress={() => onRemove(item)} style={styles.removeBtn}>
                  <Text style={styles.removeBtnText}>Убрать</Text>
                </FastPressable>
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
          <WarningTriangleIcon />
          <Text style={styles.warningText}>Кухня отказала часть заказа. Решите по каждой отказанной позиции.</Text>
        </View>
        <Button title="Продолжить без отказанных блюд" onPress={onContinue} loading={busy} style={styles.partialContinueBtn} />
        <FastPressable disabled={busy} onPress={onCancel} style={styles.cancelWholeBtn}>
          <Text style={styles.cancelWholeText}>Отменить весь заказ</Text>
        </FastPressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function WarningTriangleIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="m21.7 18.6-8.5-15a1.4 1.4 0 0 0-2.4 0l-8.5 15A1.4 1.4 0 0 0 3.5 21h17a1.4 1.4 0 0 0 1.2-2.4Z"
        stroke={colors.warning}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M12 9v4M12 17h.01" stroke={colors.warning} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  titleBlock: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
    paddingBottom: 5,
    gap: 4,
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
    paddingTop: 4,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  titleWithStatus: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { flexShrink: 1, fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  titleMuted: { fontSize: fontSize.sm, fontWeight: '400', color: colors.textMuted },
  titleActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', minHeight: 20 },
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
  list: { paddingHorizontal: spacing.lg, paddingTop: 6, gap: 6, paddingBottom: spacing.md },
  itemCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: 3,
  },
  itemCardRejected: {
    borderColor: 'rgba(239,68,68,0.30)',
    backgroundColor: colors.dangerSoft,
  },
  itemMainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemName: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary },
  itemRejectedName: { color: colors.danger, textDecorationLine: 'line-through' },
  itemQty: { fontSize: fontSize.base, color: colors.textMuted },
  itemRight: { alignItems: 'flex-end', gap: 2, minWidth: 72 },
  itemPrice: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  itemDone: { fontSize: fontSize.sm, color: colors.success, fontWeight: '600' },
  itemCooking: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '500' },
  itemRejected: { fontSize: fontSize.sm, color: colors.danger, fontWeight: '600' },
  itemExtra: { gap: 6, marginTop: 2 },
  setParts: {
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.70)',
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.70)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  setPartRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  setPartName: { flex: 1, minWidth: 0, fontSize: fontSize.xs, color: colors.textSecondary },
  setPartRejectedName: { color: colors.danger, textDecorationLine: 'line-through' },
  setPartOld: { color: colors.textMuted, textDecorationLine: 'line-through' },
  setPartArrow: { color: colors.textMuted, fontWeight: '700' },
  setPartNew: { color: colors.primary, fontWeight: '700' },
  setPartQty: { fontSize: fontSize.xs, color: colors.textMuted },
  setPartStatus: {
    flexShrink: 0,
    borderRadius: 6,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  setPartStatusDone: { backgroundColor: 'rgba(22,163,74,0.08)' },
  setPartStatusDanger: { backgroundColor: colors.dangerSoft },
  setPartStatusCooking: { backgroundColor: colors.background },
  setPartStatusText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.warning },
  setPartStatusTextDone: { color: colors.green600 },
  setPartStatusTextDanger: { color: colors.danger },
  setPartStatusTextCooking: { color: colors.textSecondary },
  itemComment: { fontSize: fontSize.xs, color: colors.textMuted },
  itemRejectReason: { fontSize: fontSize.xs, color: colors.danger },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: fontSize.md, color: colors.textSecondary },
  totalValue: { fontSize: 22, fontWeight: '600', color: colors.textPrimary },
  actions: { flexDirection: 'row', gap: spacing.sm },
  preReceiptBtn: {
    width: 110,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preReceiptBtnDisabled: { opacity: 0.5 },
  preReceiptText: { color: colors.primary, fontSize: fontSize.base, fontWeight: '600' },
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
  cancelReasonList: { gap: spacing.sm, marginBottom: spacing.md },
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
  cancelReadyInput: {
    minHeight: 44,
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
  partialTitle: { flexShrink: 1, fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary },
  partialTitleMuted: { fontSize: fontSize.sm, fontWeight: '400', color: colors.textMuted },
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
