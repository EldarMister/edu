import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Pressable } from 'react-native';
import { Button, EmptyState, Loading } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { OrderBadge } from '@/components/StatusBadge';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useAuth } from '@/store/auth';
import {
  useActiveOrders,
  usePickedUp,
  useServed,
  useToPayment,
  useResolvePartialRejection,
  useCreateReceiptPrintRequest,
} from '@/services/api/waiter';
import { apiError } from '@/lib/api';
import { displayOrderNumber, hallSuffix, money } from '@/utils/format';
import { orderCustomizationText } from '@/utils/order-customization';
import { PaymentScreen } from './PaymentScreen';
import { SplitAmountsSheet, SplitItemsSheet } from './OrderSplitSheets';
import { canSplitAmount, canSplitOrder, SPLIT_OPTIONS, type AmountSplitMode, type SplitMode } from '../../../../frontend/src/features/waiter/splitBillModel';
import type { Order, OrderItem } from '@/types';

type R = RouteProp<{ OrderDetail: { orderId: string } }, 'OrderDetail'>;

export function OrderDetailScreen() {
  const route = useRoute<R>();
  const navigation = useNavigation<any>();
  const { orderId } = route.params;
  const canPay = useAuth((state) => state.user?.permissions?.actions?.acceptOrderPayments !== false);
  const orders = useActiveOrders();
  const order = orders.data?.find((o) => o.id === orderId) ?? null;

  const pickedUp = usePickedUp();
  const served = useServed();
  const toPayment = useToPayment();
  const resolve = useResolvePartialRejection();
  const print = useCreateReceiptPrintRequest();
  const [payOpen, setPayOpen] = useState(false);
  const [splitMenu, setSplitMenu] = useState(false);
  const [itemSplit, setItemSplit] = useState<Order | null>(null);
  const [amountSplit, setAmountSplit] = useState<{ order: Order; mode: AmountSplitMode } | null>(null);

  const onError = (e: unknown) => Alert.alert('Ошибка', apiError(e));

  if (orders.isLoading && !order) return <Loading />;
  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <Header onBack={() => navigation.goBack()} />
        <EmptyState text="Заказ не найден" />
      </SafeAreaView>
    );
  }

  const busy = pickedUp.isPending || served.isPending || toPayment.isPending || resolve.isPending;

  const canSplitItems = canPay && canSplitOrder(order);
  const canSplitMoney = canPay && canSplitAmount(order);
  const canPrintBill = ['sent_to_kitchen', 'accepted_by_kitchen', 'cooking', 'ready',
    'picked_up', 'partially_rejected', 'served', 'waiting_payment'].includes(order.status) && !order.requiresWaiterDecision &&
    (order.source !== 'qr' || !!order.waiter);

  function openSplit(mode: SplitMode) {
    if (!order || busy) return;
    setSplitMenu(false);
    if (mode === 'items') {
      setItemSplit(order);
      return;
    }
    if (order.status === 'waiting_payment') setAmountSplit({ order, mode });
    else toPayment.mutate(order.id, { onError, onSuccess: (updated) => setAmountSplit({ order: updated, mode }) });
  }

  function finishPayment() {
    setPayOpen(false);
    setAmountSplit(null);
    navigation.goBack();
  }

  const mainAction = () => {
    if (order.requiresWaiterDecision) {
      return (
        <Button
          title="Продолжить без отказанного"
          variant="danger"
          loading={resolve.isPending}
          onPress={() => resolve.mutate(order.id, { onError })}
        />
      );
    }
    switch (order.status) {
      case 'ready':
        return (
          <Button title="Забрать" loading={busy} onPress={() => pickedUp.mutate(order.id, { onError })} />
        );
      case 'picked_up':
        return (
          <Button title="Подать" loading={busy} onPress={() => served.mutate(order.id, { onError })} />
        );
      case 'served':
        return canPay ? (
          <Button
            title="Перейти к оплате"
              loading={busy}
            onPress={() =>
              toPayment.mutate(order.id, { onError, onSuccess: () => setPayOpen(true) })
            }
          />
        ) : null;
      case 'waiting_payment':
        return canPay ? <Button title="Перейти к оплате" onPress={() => setPayOpen(true)} /> : null;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <Header onBack={() => navigation.goBack()} />

      <View style={styles.titleRow}>
        <Text style={styles.title}>
          Заказ {displayOrderNumber(order.orderNumber)}{' '}
          <Text style={styles.titleMuted}>
            Стол {order.table.number}
            {hallSuffix(order.table)}
          </Text>
        </Text>
        <OrderBadge status={order.status} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {order.items.map((it) => (
          <ItemCard key={it.id} item={it} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Итого</Text>
          <Text style={styles.totalValue}>{money(order.finalAmount)}</Text>
        </View>
        {(canPrintBill || canSplitItems || canSplitMoney) && (
          <View style={styles.actions}>
            {canPrintBill && <Button title="Счёт" variant="secondary" accent style={styles.outline}
              leadingIcon={<Ionicons name="print-outline" size={18} color={colors.primary} />}
              loading={print.isPending}
              onPress={() => print.mutate(
                { orderId: order.id, type: 'preliminary' },
                { onSuccess: () => Alert.alert('Готово', 'Запрос на печать отправлен администратору'), onError },
              )} />}
            {(canSplitItems || canSplitMoney) && <Button title="Разделить счёт" variant="secondary" accent style={styles.outline}
              leadingIcon={<Ionicons name="git-branch-outline" size={18} color={colors.primary} />}
              disabled={busy || print.isPending} onPress={() => setSplitMenu(true)} />}
          </View>
        )}
        {mainAction()}
      </View>

      {splitMenu && <BottomSheet visible title="Разделить счёт" onClose={() => setSplitMenu(false)}>
        {SPLIT_OPTIONS.map(({ value, label }) => {
          const disabled = value === 'items' ? !canSplitItems : !canSplitMoney;
          return <Pressable key={value} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
            style={[styles.splitOption, disabled && styles.disabled]} onPress={() => openSplit(value)}>
            <Text style={styles.splitLabel}>{label}</Text>
          </Pressable>;
        })}
      </BottomSheet>}
      {itemSplit && canPay && <SplitItemsSheet order={itemSplit} onClose={() => setItemSplit(null)}
        onSplit={(created) => {
          setItemSplit(null);
          Alert.alert('Создан отдельный чек', displayOrderNumber(created.orderNumber), [
            { text: 'Закрыть' },
            { text: 'Открыть чек', onPress: () => navigation.replace('OrderDetail', { orderId: created.id }) },
          ]);
        }} />}
      {amountSplit && canPay && <SplitAmountsSheet order={amountSplit.order} mode={amountSplit.mode}
        onClose={() => setAmountSplit(null)} onPaid={finishPayment} />}
      {payOpen && canPay && <PaymentScreen order={order} onClose={() => setPayOpen(false)} onPaid={finishPayment}
        onSplitItems={canSplitItems ? () => { setPayOpen(false); openSplit('items'); } : undefined} />}
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <Pressable onPress={onBack} style={styles.back} hitSlop={10}>
      <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
      <Text style={styles.backText}>Назад</Text>
    </Pressable>
  );
}

function ItemCard({ item }: { item: OrderItem }) {
  const name = item.dishVariantNameSnapshot
    ? `${item.dishNameSnapshot} · ${item.dishVariantNameSnapshot}`
    : item.dishNameSnapshot;
  const done = item.status === 'ready' || item.status === 'served';
  const rejected = item.status === 'rejected' || item.status === 'cancelled';
  const customization = orderCustomizationText(item);
  return (
    <View style={styles.itemCard}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.itemName, rejected && styles.itemRejectedName]} numberOfLines={2}>
          {name}
          {item.takeaway ? '  · с собой' : ''}
        </Text>
        {!!customization && <Text style={styles.itemCustomization}>{customization}</Text>}
      </View>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  backText: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '500' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  title: { flex: 1, fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  titleMuted: { fontSize: fontSize.base, fontWeight: '400', color: colors.textMuted },
  scroll: { flex: 1 },
  list: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.md },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  itemName: { fontSize: fontSize.md, color: colors.textPrimary },
  itemCustomization: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 3 },
  itemRejectedName: { color: colors.danger, textDecorationLine: 'line-through' },
  itemQty: { fontSize: fontSize.base, color: colors.textMuted },
  itemRight: { alignItems: 'flex-end', gap: 2, minWidth: 72 },
  itemPrice: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  itemDone: { fontSize: fontSize.sm, color: colors.success, fontWeight: '600' },
  itemRejected: { fontSize: fontSize.sm, color: colors.danger, fontWeight: '600' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: fontSize.md, color: colors.textSecondary },
  totalValue: { fontSize: fontSize.xxl, fontWeight: '700', color: colors.textPrimary },
  outline: { flex: 1, borderColor: colors.primary },
  splitOption: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  splitLabel: { fontSize: fontSize.base, color: colors.textPrimary },
  disabled: { opacity: 0.5 },
  actions: { flexDirection: 'row', gap: spacing.sm },
});
