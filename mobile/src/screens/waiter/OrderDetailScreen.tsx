import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Button, EmptyState, Loading } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { OrderBadge } from '@/components/StatusBadge';
import { NumberTicker } from '@/components/NumberTicker';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useNotifications } from '@/store/notifications';
import {
  useActiveOrders,
  useCancelOrder,
  usePickedUp,
  useRemoveRejectedItem,
  useServed,
  useToPayment,
  useResolvePartialRejection,
  useCreateReceiptPrintRequest,
} from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { useReplacement } from '@/store/replacement';
import { apiError } from '@/lib/api';
import { displayOrderNumber, hallSuffix, money } from '@/utils/format';
import { PaymentSheet } from './PaymentSheet';
import type { CartLine, Dish, DishVariant, Order, OrderItem } from '@/types';

type R = RouteProp<{ OrderDetail: { orderId: string } }, 'OrderDetail'>;
const DETAIL_EDITABLE = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready'];

export function OrderDetailScreen() {
  const route = useRoute<R>();
  const navigation = useNavigation<any>();
  const { orderId } = route.params;
  const orders = useActiveOrders();
  const order = orders.data?.find((o) => o.id === orderId) ?? null;

  const pickedUp = usePickedUp();
  const served = useServed();
  const toPayment = useToPayment();
  const resolve = useResolvePartialRejection();
  const removeRejected = useRemoveRejectedItem();
  const cancelOrder = useCancelOrder();
  const print = useCreateReceiptPrintRequest();
  const selectTable = useCart((s) => s.selectTable);
  const setReplacementTarget = useReplacement((s) => s.setTarget);
  const [payOpen, setPayOpen] = useState(false);
  const push = useNotifications((s) => s.push);

  const onError = (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() });

  if (orders.isLoading && !order) return <Loading />;
  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <EmptyState text="Заказ не найден" />
      </SafeAreaView>
    );
  }

  const busy = pickedUp.isPending || served.isPending || toPayment.isPending || resolve.isPending;

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
                push({ message: 'Заказ отменён', type: 'success', at: new Date().toISOString() });
                navigation.goBack();
              },
              onError,
            },
          )
        }
      />
    );
  }

  const mainAction = () => {
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
    switch (order.status) {
      case 'ready':
        return (
          <Button title="Забрать" style={{ flex: 1 }} loading={busy} onPress={() => pickedUp.mutate(order.id, { onError })} />
        );
      case 'picked_up':
        return (
          <Button title="Подать" style={{ flex: 1 }} loading={busy} onPress={() => served.mutate(order.id, { onError })} />
        );
      case 'served':
        return (
          <Button
            title="Перейти к оплате"
            style={{ flex: 1 }}
            loading={busy}
            onPress={() =>
              toPayment.mutate(order.id, { onError, onSuccess: () => setPayOpen(true) })
            }
          />
        );
      case 'waiting_payment':
        return <Button title="Оплатить" style={{ flex: 1 }} onPress={() => setPayOpen(true)} />;
      default:
        return <View style={{ flex: 1 }} />;
    }
  };

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
        <View style={styles.titleActions}>
          <OrderBadge status={order.status} />
          {DETAIL_EDITABLE.includes(order.status) ? (
            <Pressable
              onPress={() => {
                selectTable(
                  { id: order.table.id, number: order.table.number, hallName: order.table.hall?.name },
                  order.id,
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

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {order.items.map((it) => (
          <ItemCard key={it.id} item={it} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Итого</Text>
          <NumberTicker value={Number(order.finalAmount)} style={styles.totalValue} digitHeight={32} />
        </View>
        <View style={styles.actions}>
          <Button
            title="Счёт"
            variant="secondary"
            style={{ width: 110 }}
            loading={print.isPending}
            onPress={() =>
              print.mutate(
                { orderId: order.id, type: 'preliminary' },
                {
                  onSuccess: () =>
                    push({ message: 'Запрос на печать отправлен администратору', type: 'success', at: new Date().toISOString() }),
                  onError,
                },
              )
            }
          />
          {mainAction()}
        </View>
      </View>

      <PaymentSheet
        order={order}
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        onPaid={() => {
          setPayOpen(false);
          navigation.goBack();
        }}
      />
    </SafeAreaView>
  );
}

function orderItemName(item: OrderItem) {
  return item.dishVariantNameSnapshot
    ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}`
    : item.dishNameSnapshot;
}

function ItemCard({ item }: { item: OrderItem }) {
  const name = orderItemName(item);
  const done = item.status === 'ready' || item.status === 'served';
  const rejected = item.status === 'rejected' || item.status === 'cancelled';
  return (
    <View style={styles.itemCard}>
      <Text style={[styles.itemName, rejected && styles.itemRejectedName]} numberOfLines={2}>
        {name}
        {item.takeaway ? '  · с собой' : ''}
      </Text>
      <Text style={styles.itemQty}>×{item.quantity}</Text>
      <View style={styles.itemRight}>
        <Text style={styles.itemPrice}>{money(item.finalPrice)}</Text>
        {done ? (
          <Text style={styles.itemDone}>✓ Готово</Text>
        ) : rejected ? (
          <Text style={styles.itemRejected}>Отказ</Text>
        ) : null}
      </View>
    </View>
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
        <Button title="Продолжить без отказанных блюд" onPress={onContinue} loading={busy} />
        <Pressable disabled={busy} onPress={onCancel} style={styles.cancelWholeBtn}>
          <Text style={styles.cancelWholeText}>Отменить весь заказ</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReplacementSheet({
  item,
  dishes,
  onClose,
  onReplace,
  onSelectTable,
}: {
  item: OrderItem | null;
  dishes: Dish[];
  onClose: () => void;
  onReplace: (line: CartLine) => void;
  onSelectTable: () => void;
}) {
  const [variantDish, setVariantDish] = React.useState<Dish | null>(null);
  React.useEffect(() => setVariantDish(null), [item]);
  const available = dishes.filter((dish) => !dish.isSet && dish.isAvailable);
  if (!item) return null;
  const addDish = (dish: Dish, variant?: DishVariant) => {
    onSelectTable();
    onReplace({ dish, variant, quantity: 1 });
  };

  return (
    <>
      <BottomSheet visible={!!item} onClose={onClose} title="Выберите замену" maxHeight="78%">
        <Text style={styles.sheetHint}>Заменить: {orderItemName(item)}</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.replacementList}>
            {available.map((dish) => (
              <Pressable
                key={dish.id}
                onPress={() => {
                  if (dish.variants.length > 0) setVariantDish(dish);
                  else addDish(dish);
                }}
                style={styles.replacementItem}
              >
                <Text style={styles.replacementName}>{dish.name}</Text>
                <Text style={styles.replacementPrice}>
                  {dish.variants.length > 0
                    ? `от ${money(Math.min(...dish.variants.map((variant) => Number(variant.price))))}`
                    : money(dish.price)}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </BottomSheet>
      <BottomSheet visible={!!variantDish} onClose={() => setVariantDish(null)} title={variantDish?.name} maxHeight="62%">
        <View style={styles.replacementList}>
          {(variantDish?.variants ?? []).map((variant) => (
            <Pressable
              key={variant.id}
              onPress={() => variantDish && addDish(variantDish, variant)}
              style={styles.replacementItem}
            >
              <Text style={styles.replacementName}>{variant.name}</Text>
              <Text style={styles.replacementPrice}>{money(variant.price)}</Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  itemName: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary },
  itemRejectedName: { color: colors.danger, textDecorationLine: 'line-through' },
  itemQty: { fontSize: fontSize.base, color: colors.textMuted },
  itemRight: { alignItems: 'flex-end', gap: 2, minWidth: 72 },
  itemPrice: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  itemDone: { fontSize: fontSize.sm, color: colors.success, fontWeight: '600' },
  itemRejected: { fontSize: fontSize.sm, color: colors.danger, fontWeight: '600' },
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
  partialList: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  sectionTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm },
  partialStack: { gap: spacing.sm },
  activeItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  partialItemName: { flex: 1, fontSize: fontSize.md, color: colors.textPrimary },
  partialQty: { fontSize: fontSize.base, color: colors.textMuted },
  partialQtyStrong: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  partialPrice: { minWidth: 72, textAlign: 'right', fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  rejectedDecisionCard: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.24)',
    borderRadius: radius.md,
    backgroundColor: 'rgba(239,68,68,0.035)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  rejectedTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rejectedDecisionName: { flex: 1, fontSize: fontSize.md, color: colors.textMuted, textDecorationLine: 'line-through' },
  rejectedDecisionPrice: { minWidth: 70, textAlign: 'right', fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  rejectedStatus: { fontSize: fontSize.sm, fontWeight: '600', color: colors.danger },
  rejectReason: { fontSize: fontSize.sm, color: colors.danger },
  rejectActions: { flexDirection: 'row', gap: spacing.sm },
  replaceBtn: {
    height: 40,
    minWidth: 116,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replaceBtnText: { color: colors.primary, fontSize: fontSize.base, fontWeight: '700' },
  removeBtn: {
    height: 40,
    minWidth: 96,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.48)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: colors.danger, fontSize: fontSize.base, fontWeight: '700' },
  partialTotalBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    marginTop: spacing.sm,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.28)',
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  warningIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.warning,
    textAlign: 'center',
    lineHeight: 24,
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.warning,
  },
  warningText: { flex: 1, fontSize: fontSize.sm, color: colors.warning, lineHeight: 20 },
  cancelWholeBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelWholeText: { fontSize: fontSize.base, fontWeight: '600', color: colors.danger },
  rejectBadge: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.22)',
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  rejectBadgeText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.danger },
  sheetHint: { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.sm },
  replacementList: { gap: spacing.sm, paddingBottom: spacing.md },
  replacementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  replacementName: { flex: 1, fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  replacementPrice: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
});
