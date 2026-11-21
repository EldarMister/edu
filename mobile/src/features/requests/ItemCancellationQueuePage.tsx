import { useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, Loading } from '@/components/ui';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { colors, radius, spacing } from '@/theme';
import { displayOrderNumber, timeHM } from '@/utils/format';
import { useDecideItemCancellation, useItemCancellationQueue, type ItemCancellationRequest } from './itemCancellations';

export function ItemCancellationQueuePage() {
  const queue = useItemCancellationQueue();
  const [review, setReview] = useState<ItemCancellationRequest>();
  return <SheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {queue.isPending && <Loading />}
    {queue.error && <View style={styles.card}>
      <Text accessibilityRole="alert" style={styles.error}>{apiError(queue.error)}</Text>
      <Button title="Повторить" size="md" variant="secondary" onPress={() => void queue.refetch()} />
    </View>}
    {queue.isSuccess && !queue.data.length && <Text style={styles.muted} translate>Ожидающих заявок на отмену блюд нет</Text>}
    {queue.data?.map((request) => <View key={request.id} style={styles.card}>
      <Text style={styles.heading}>{request.quantity} × {request.itemName}</Text>
      <Text style={styles.muted}><Text translate>Заказ</Text> {displayOrderNumber(request.order.orderNumber)} · {request.requestedByName} · {timeHM(request.createdAt)}</Text>
      <Text>{request.reason}</Text>
      <View style={styles.buttons}>
        <Button title="Рассмотреть заявку" size="md" onPress={() => setReview(request)} />
      </View>
    </View>)}
    {review && <ReviewCancellation key={review.id} request={review} onClose={() => setReview(undefined)} />}
  </SheetScrollView>;
}

function ReviewCancellation({ request, onClose }: { request: ItemCancellationRequest; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const { canOwnerOperation } = usePermissions();
  const decision = useDecideItemCancellation(request);
  return <BottomSheet visible title="Заявка на отмену блюда" presentation={width >= 768 ? 'dialog' : 'bottom'}
    onClose={onClose} dismissible={!decision.isPending} footer={<View style={styles.buttons}>
      <Button title="Отклонить" variant="secondary" disabled={decision.isPending}
        onPress={() => decision.mutate('reject', { onSuccess: onClose })} />
      {canOwnerOperation('cancelItems') && <Button title="Подтвердить отмену" variant="danger" disabled={decision.isPending}
        onPress={() => decision.mutate('approve', { onSuccess: onClose })} />}
    </View>}>
    <View style={styles.details}>
      <Text style={styles.heading}><Text translate>Заказ</Text> {displayOrderNumber(request.order.orderNumber)} · {request.quantity} × {request.itemName}</Text>
      <Text style={styles.muted}>{request.reason}</Text>
      {decision.isError && <Text accessibilityRole="alert" style={styles.error}>{apiError(decision.error)}</Text>}
    </View>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  details: { gap: spacing.sm },
  heading: { color: colors.textPrimary, fontWeight: '600' },
  muted: { color: colors.textMuted },
  error: { color: colors.danger },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
});
