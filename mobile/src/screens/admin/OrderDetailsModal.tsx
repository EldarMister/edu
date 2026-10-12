import React from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { OrderStatusBadges } from '@/components/StatusBadge';
import QRCode from 'react-native-qrcode-svg';
import { colors, fontSize, radius, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import {
  displayOrderNumber,
  hallSuffix,
  isSplitPayment,
  money,
  orderItemDisplayName,
  paymentDisplayLabel,
  paymentMethodLabel,
  timeHM,
} from '@/utils/format';
import { useCancelOrderItem, useRetryFiscal } from '@/services/api/admin';
import { CancelOrderModal } from './CancelOrderModal';
import type { Order, OrderItemStatus } from '@/types';

const ITEM_STATUS: Record<OrderItemStatus, string> = {
  new: 'Новое',
  accepted: 'Принято',
  cooking: 'Готовится',
  ready: 'Готово',
  rejected: 'Отказано',
  served: 'Подано',
  cancelled: 'Отменено',
};

function mixedSumBy(order: { payments?: { method: string; amount: string }[] }, method: string): number {
  return (order.payments ?? []).filter((p) => p.method === method).reduce((acc, p) => acc + Number(p.amount), 0);
}

/** Подробная карточка заказа (порт PWA OrderDetailsModal). */
export function OrderDetailsModal({ order, onClose, onOrderChange, allowItemCancellation = false }: { order: Order | null; onClose: () => void; onOrderChange?: (order: Order) => void; allowItemCancellation?: boolean }) {
  const [cancelItem, setCancelItem] = React.useState<Order['items'][number] | null>(null);
  const cancel = useCancelOrderItem();
  const push = useNotifications((s) => s.push);
  React.useEffect(() => { setCancelItem(null); }, [order?.id]);
  if (!order) return null;
  const date = new Date(order.createdAt);
  const showMixedBreakdown =
    order.paymentMethod === 'mixed' && !isSplitPayment(order) && !!order.payments?.length;

  const infoRows: { label: string; value: React.ReactNode }[] = [
    { label: 'Статус', value: <OrderStatusBadges order={order} /> },
    { label: 'Официант', value: <Text style={styles.infoVal} translate>{order.source === 'delivery' ? 'Доставка' : order.waiter?.name ?? 'QR menu'}</Text> },
    { label: 'Дата', value: <Text style={styles.infoVal}>{`${date.toLocaleDateString('ru-RU')} ${timeHM(order.createdAt)}`}</Text> },
    { label: 'Сумма', value: <Text style={styles.infoVal}>{money(order.finalAmount)}</Text> },
    { label: 'Стол', value: <Text style={styles.infoVal} translate>{order.source === 'delivery' ? '—' : `Стол ${order.table.number}${hallSuffix(order.table)}`}</Text> },
    { label: 'Оплата', value: <Text style={styles.infoVal}>{order.paymentMethod ? paymentDisplayLabel(order) : '—'}</Text> },
  ];
  if (showMixedBreakdown) {
    infoRows.push({ label: 'Наличными', value: <Text style={styles.infoVal}>{money(mixedSumBy(order, 'cash'))}</Text> });
    infoRows.push({ label: 'QR', value: <Text style={styles.infoVal}>{money(mixedSumBy(order, 'qr'))}</Text> });
  }
  if (order.source === 'delivery') {
    infoRows.push(...[{ label: 'Внешний заказ', value: order.externalOrderId ?? '—' }, { label: 'Клиент', value: order.deliveryCustomerName ?? '—' }, { label: 'Телефон', value: order.deliveryCustomerPhone ?? '—' }, { label: 'Адрес доставки', value: order.deliveryAddress ?? '—' }].map((r) => ({ label: r.label, value: <Text style={styles.infoVal}>{r.value}</Text> })));
  }
  const itemCancellationAllowed = allowItemCancellation && !['paid', 'cancelled', 'rejected', 'waiting_payment'].includes(order.status);
  async function confirmItemCancellation(reason: string) {
    if (!cancelItem || !order) return;
    try { const updated = await cancel.mutateAsync({ orderId: order.id, itemId: cancelItem.id, reason }); onOrderChange?.(updated); setCancelItem(null); push({ message: 'Блюдо отменено', type: 'success', at: new Date().toISOString() }); }
    catch (error) { push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
  }

  return (<>
    <BottomSheet visible={!!order} onClose={onClose} title={`Заказ ${displayOrderNumber(order.orderNumber)}`} maxHeight="90%">
      <SheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.md }}>
        {/* Информация */}
        <View>
          <Text style={styles.sectionTitle} translate>Информация</Text>
          <View style={styles.infoBox}>
            {infoRows.map((r, i) => (
              <View key={i} style={[styles.infoRow, i < infoRows.length - 1 && styles.rowBorder]}>
                <Text style={styles.infoLabel} translate>{r.label}</Text>
                <View style={styles.infoValueWrap}>{r.value}</View>
              </View>
            ))}
          </View>
        </View>

        {isSplitPayment(order) && !!order.payments?.length ? (
          <View style={styles.softBox}>
            <Text style={styles.softLabel} translate>ПЛАТЕЖИ</Text>
            {order.payments.map((payment, index) => (
              <View key={index} style={styles.softRow}>
                <Text style={styles.softRowLabel} translate>
                  Платеж {index + 1} — {paymentMethodLabel(payment.method)}
                </Text>
                <Text style={styles.softRowValue}>{money(payment.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {order.comment ? (
          <View style={styles.softBox}>
            <Text style={styles.softLabel} translate>КОММЕНТАРИЙ</Text>
            <Text style={styles.commentText}>{order.comment}</Text>
          </View>
        ) : null}

        {/* Блюда */}
        <View>
          <View style={styles.dishesHead}>
            <Text style={styles.sectionTitle} translate>Блюда</Text>
            <Text style={styles.dishesCount} translate>{order.items.length} поз.</Text>
          </View>
          <View style={styles.infoBox}>
            {order.items.map((item, i) => (
              <View key={item.id} style={[styles.dishRow, i < order.items.length - 1 && styles.rowBorder]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.dishName}>
                    {item.quantity}× {orderItemDisplayName(item)}
                  </Text>
                  {item.comment ? <Text style={styles.dishComment}>{item.comment}</Text> : null}
                  {item.rejectReason ? <Text style={styles.dishReject} translate>Отказ: {item.rejectReason}</Text> : null}
                </View>
                <View style={styles.dishRight}>
                  <Text style={styles.dishPrice}>{money(item.finalPrice)}</Text>
                  <Text style={styles.dishStatus}>{ITEM_STATUS[item.status]}</Text>
                  {itemCancellationAllowed && !['rejected', 'cancelled'].includes(item.status) ? <FastPressable accessibilityLabel={`Отменить блюдо ${orderItemDisplayName(item)}`} onPress={() => setCancelItem(item)} style={{ paddingVertical: spacing.sm }}><Text style={{ color: colors.danger, fontSize: 12 }} translate>Отменить блюдо</Text></FastPressable> : null}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Итоги */}
        <View style={styles.totals}>
          <Total label="Итого" value={money(order.totalAmount)} />
          {Number(order.discountAmount) > 0 ? <Total label="Скидка" value={money(order.discountAmount)} /> : null}
          {Number(order.serviceChargeAmount) > 0 ? <Total label="Обслуживание" value={money(order.serviceChargeAmount)} /> : null}
          <Total label="К оплате" value={money(order.finalAmount)} strong />
        </View>

        <FiscalBlock order={order} />
      </SheetScrollView>
    </BottomSheet>
    <CancelOrderModal visible={!!cancelItem} title="Отменить блюдо?" confirmLabel="Отменить блюдо" orderLabel={cancelItem ? `${cancelItem.quantity}× ${orderItemDisplayName(cancelItem)} · ${money(cancelItem.finalPrice)}` : ''} submitting={cancel.isPending} onClose={() => setCancelItem(null)} onConfirm={(reason) => void confirmItemCancellation(reason)} />
    </>
  );
}

function FiscalBlock({ order }: { order: Order }) {
  const retry = useRetryFiscal();
  const push = useNotifications((s) => s.push);
  const hasReceipt = !!order.fiscalReceiptNumber;
  const hasError = !hasReceipt && !!order.fiscalError;
  if (!hasReceipt && !hasError) return null;

  const onRetry = async () => {
    try {
      const res = await retry.mutateAsync(order.id);
      if (res?.success) push({ message: 'Фискальный чек пробит', type: 'success', at: new Date().toISOString() });
      else push({ message: res?.error ?? 'ККМ вернул ошибку', type: 'error', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

  if (hasReceipt) {
    const qr = order.fiscalQrCode ?? '';
    const isImage = qr.startsWith('data:image');
    return (
      <View style={styles.fiscalOk}>
        <View style={styles.fiscalHeadRow}>
          <View style={styles.fiscalOkBadge}>
            <Text style={styles.fiscalOkBadgeText} translate>Фискальный чек</Text>
          </View>
          <Text style={styles.fiscalNumber}>№ {order.fiscalReceiptNumber}</Text>
        </View>
        {order.fiscalSign ? <Text style={styles.fiscalSign} translate>Фискальный признак: {order.fiscalSign}</Text> : null}
        {qr ? (
          isImage ? (
            <Image source={{ uri: qr }} style={styles.fiscalQr} resizeMode="contain" />
          ) : (
            <FastPressable onPress={() => void Linking.openURL(qr).catch((error) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() }))} style={{ marginTop: 8 }}>
              <QRCode value={qr} size={112} quietZone={8} ecl="M" />
              <Text style={styles.fiscalLink}>{qr}</Text>
            </FastPressable>
          )
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.fiscalErr}>
      <View style={styles.fiscalHeadRow}>
        <View style={styles.fiscalErrBadge}>
          <Text style={styles.fiscalErrBadgeText} translate>Ошибка ККМ</Text>
        </View>
        <FastPressable onPress={() => void onRetry()} disabled={retry.isPending} style={styles.retryBtn}>
          <Text style={styles.retryText} translate>{retry.isPending ? 'Повтор…' : 'Повторить'}</Text>
        </FastPressable>
      </View>
      <Text style={styles.fiscalErrText}>{order.fiscalError}</Text>
    </View>
  );
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, strong && styles.totalStrong]} translate>{label}</Text>
      <Text style={[styles.totalValue, strong && styles.totalStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  infoBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  infoValueWrap: { alignItems: 'flex-end' },
  infoVal: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary, textAlign: 'right' },

  softBox: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  softLabel: { fontSize: 11, fontWeight: '500', letterSpacing: 0.5, color: colors.textMuted },
  softRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: 6 },
  softRowLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  softRowValue: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  commentText: { marginTop: 4, fontSize: fontSize.sm, color: colors.textPrimary },

  dishesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  dishesCount: { fontSize: fontSize.xs, color: colors.textMuted },
  dishRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  dishName: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  dishComment: { marginTop: 2, fontSize: fontSize.xs, color: colors.warning },
  dishReject: { marginTop: 2, fontSize: fontSize.xs, color: colors.danger },
  dishRight: { alignItems: 'flex-end', flexShrink: 0 },
  dishPrice: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  dishStatus: { marginTop: 2, fontSize: 11, color: colors.textMuted },

  totals: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: 6 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  totalValue: { fontSize: fontSize.sm, color: colors.textSecondary },
  totalStrong: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },

  fiscalOk: { borderWidth: 1, borderColor: 'rgba(22,163,74,0.3)', backgroundColor: colors.successSoft, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  fiscalErr: { borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', backgroundColor: colors.dangerSoft, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  fiscalHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  fiscalOkBadge: { borderRadius: radius.pill, backgroundColor: 'rgba(22,163,74,0.15)', paddingHorizontal: 10, paddingVertical: 2 },
  fiscalOkBadgeText: { fontSize: fontSize.xs, fontWeight: '500', color: colors.success },
  fiscalNumber: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  fiscalSign: { marginTop: 4, fontSize: fontSize.xs, color: colors.textMuted },
  fiscalQr: { marginTop: 8, width: 112, height: 112, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  fiscalLink: { marginTop: 8, fontSize: fontSize.xs, color: colors.primary, textDecorationLine: 'underline' },
  fiscalErrBadge: { borderRadius: radius.pill, backgroundColor: 'rgba(239,68,68,0.15)', paddingHorizontal: 10, paddingVertical: 2 },
  fiscalErrBadgeText: { fontSize: fontSize.xs, fontWeight: '500', color: colors.danger },
  fiscalErrText: { marginTop: 6, fontSize: fontSize.xs, color: colors.danger },
  retryBtn: { borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)', borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { fontSize: fontSize.xs, fontWeight: '500', color: colors.danger },
});
