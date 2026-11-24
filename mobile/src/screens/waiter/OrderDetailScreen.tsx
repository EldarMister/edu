import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Pressable } from 'react-native';
import { Button, EmptyState, Loading } from '@/components/ui';
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
import { PaymentSheet } from './PaymentSheet';
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
        return canPay ? <Button title="Оплатить" style={{ flex: 1 }} onPress={() => setPayOpen(true)} /> : null;
      default:
        return <View style={{ flex: 1 }} />;
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

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {order.items.map((it) => (
          <ItemCard key={it.id} item={it} />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Итого</Text>
          <Text style={styles.totalValue}>{money(order.finalAmount)}</Text>
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
                { onSuccess: () => Alert.alert('Готово', 'Запрос на печать отправлен администратору'), onError },
              )
            }
          />
          {mainAction()}
        </View>
      </View>

      {payOpen && canPay && <PaymentSheet
        order={order}
        onClose={() => setPayOpen(false)}
        onPaid={() => {
          setPayOpen(false);
          navigation.goBack();
        }}
      />}
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
  actions: { flexDirection: 'row', gap: spacing.sm },
});
