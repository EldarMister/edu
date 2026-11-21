import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { Button, Loading } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/store/auth';
import { colors, radius, spacing } from '@/theme';
import { displayOrderNumber, money, timeHM } from '@/utils/format';
import type { Order } from '@/types';
import { usePendingRefunds, useRefundHistory, type OrderRefund } from './api';
import { OrderRefundForm, ReviewOrderRefund } from './RefundDialogs';
import { canRefundOrder } from './refundRules';

const statusLabels = {
  pending: 'Ожидает подтверждения',
  approved: 'Возврат оформлен',
  rejected: 'Заявка на возврат отклонена',
} as const;

export function TerminalOrderRefunds({ order }: { order: Order }) {
  const userId = useAuth((state) => state.user?.id);
  const { effectiveRole, canSection } = usePermissions();
  if (effectiveRole !== 'WAITER' || !canSection('orders') || order.waiter?.id !== userId || order.status !== 'paid') return null;
  return <OrderRefunds key={order.id} order={order} mode="request" />;
}

export function OrderRefunds({ order, mode }: { order: Order; mode: 'request' | 'manage' }) {
  const history = useRefundHistory(order.id);
  const [formOpen, setFormOpen] = useState(false);
  const [review, setReview] = useState<OrderRefund>();
  const pending = history.data?.find((refund) => refund.status === 'pending');

  return (
    <View style={styles.card}>
      <Text style={styles.heading} translate>Возвраты</Text>
      {history.isPending ? <Loading /> : null}
      {history.error ? <RefundLoadError message={apiError(history.error)} retry={() => void history.refetch()} /> : null}
      {history.data?.map((refund) => (
        <View style={styles.entry} key={refund.id}>
          <View style={styles.row}>
            <Text style={[styles.heading, styles.label, refund.status === 'pending' && styles.pending]} translate>{statusLabels[refund.status]}</Text>
            <Text style={styles.heading}>{money(refund.amount)}</Text>
          </View>
          <RefundScope refund={refund} />
          <Text style={styles.body}>{refund.reason}</Text>
          {refund.decidedByName ? <Text style={styles.muted}>{refund.decidedByName}{refund.decidedAt ? ' · ' + timeHM(refund.decidedAt) : ''}</Text> : null}
          {refund.fiscalRefundReference ? (
            <Text style={styles.muted}><Text translate>Номер чека возврата ККМ</Text> · {refund.fiscalRefundReference}</Text>
          ) : null}
        </View>
      ))}
      {pending && mode === 'manage' ? (
        <Button title="Рассмотреть заявку" size="md" onPress={() => setReview(pending)} />
      ) : null}
      {history.isSuccess && !pending && canRefundOrder(order) ? (
        <Button title={mode === 'request' ? 'Запросить возврат' : 'Оформить возврат'} size="md" variant="secondary" onPress={() => setFormOpen(true)} />
      ) : null}
      {formOpen ? <OrderRefundForm order={order} mode={mode} onClose={() => setFormOpen(false)} /> : null}
      {review ? <ReviewOrderRefund key={review.id} refund={review} onClose={() => setReview(undefined)} /> : null}
    </View>
  );
}

export function RefundQueueButton() {
  const t = useT();
  const pending = usePendingRefunds(true);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<OrderRefund>();
  const requests = pending.data ?? [];
  const title = t('Заявки на возврат');
  return (
    <>
      <Button title={requests.length ? title + ' · ' + requests.length : title}
        size="md" variant="secondary" onPress={() => setOpen(true)} />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={title} maxHeight="88%">
        <SheetScrollView contentContainerStyle={styles.stack}>
          {pending.isPending ? <Loading /> : null}
          {pending.error ? <RefundLoadError message={apiError(pending.error)} retry={() => void pending.refetch()} /> : null}
          {pending.isSuccess && requests.length === 0 ? (
            <Text style={styles.muted} translate>Ожидающих заявок на возврат нет</Text>
          ) : null}
          {requests.map((refund) => (
            <View style={styles.card} key={refund.id}>
              <View style={styles.row}>
                <Text style={styles.heading}><Text translate>Заказ</Text> {displayOrderNumber(refund.orderNumber)}</Text>
                <Text style={styles.heading}>{money(refund.amount)}</Text>
              </View>
              <Text style={styles.muted}>{refund.requestedByName} · {timeHM(refund.createdAt)}</Text>
              <RefundScope refund={refund} />
              <Text style={styles.body}>{refund.reason}</Text>
              <Button title="Рассмотреть заявку" size="md" onPress={() => setReview(refund)} />
            </View>
          ))}
          {review ? <ReviewOrderRefund key={review.id} refund={review} onClose={() => setReview(undefined)} /> : null}
        </SheetScrollView>
      </BottomSheet>
    </>
  );
}

function RefundScope({ refund }: { refund: OrderRefund }) {
  const item = refund.itemId ? refund.items[0] : undefined;
  return (
    <Text style={styles.muted}>
      <Text translate>{refund.itemId ? 'Возврат позиции' : 'Возврат остатка заказа'}</Text>
      {item ? ' · ' + item.quantity + ' × ' + item.name : ''}
    </Text>
  );
}

function RefundLoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={styles.stack}>
      <Text accessibilityRole="alert" style={styles.error}>{message}</Text>
      <Button title="Повторить" size="md" variant="secondary" onPress={retry} />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md, paddingBottom: spacing.sm },
  card: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  entry: { gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  label: { flex: 1 },
  heading: { color: colors.textPrimary, fontWeight: '600' },
  body: { color: colors.textPrimary },
  muted: { color: colors.textSecondary },
  error: { color: colors.danger },
  pending: { color: colors.warning },
});
