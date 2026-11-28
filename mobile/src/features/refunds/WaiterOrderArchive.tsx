import React from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheet, SheetFlatList } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button } from '@/components/ui';
import { useWaiterOrderHistory, type CabinetRecentOrder } from '@/services/api/waiter';
import { colors, fontSize, spacing } from '@/theme';
import { ORDER_STATUS } from '@/theme/status';
import { displayOrderNumber, money, timeHM } from '@/utils/format';
import type { OrderStatus } from '@/types';
import { refundStatusLabel } from './refundRules';

export function WaiterOrderArchive({
  visible,
  title = 'История заказов',
  onClose,
  onSelect,
}: {
  visible: boolean;
  title?: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const history = useWaiterOrderHistory(visible);
  const orders = React.useMemo(() => history.data?.pages.flatMap((page) => page.items) ?? [], [history.data]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} inline expanded maxHeight="88%">
      <SheetFlatList
        data={orders}
        keyExtractor={(order) => order.id}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => {
          const date = orderDate(item.createdAt);
          const newDate = index === 0 || orderDate(orders[index - 1].createdAt) !== date;
          return (
            <View>
              {newDate ? <Text style={[styles.orderGroupLabel, styles.historyDate]}>{date}</Text> : null}
              <CabinetOrderRow order={item} onPress={() => onSelect(item.id)} />
            </View>
          );
        }}
        ListEmptyComponent={history.isLoading ? (
          <Text style={styles.cabinetMuted} translate>Загрузка заказов...</Text>
        ) : history.isError ? (
          <View style={styles.historyAction}>
            <Text style={styles.cabinetError} translate>Не удалось загрузить заказы</Text>
            <Button title="Повторить" size="md" variant="secondary" onPress={() => void history.refetch()} />
          </View>
        ) : (
          <Text style={styles.cabinetMuted} translate>Заказов пока нет</Text>
        )}
        ListFooterComponent={history.hasNextPage ? (
          <View style={[styles.historyAction, styles.historyFooter]}>
            {history.isFetchNextPageError ? (
              <Text style={styles.cabinetError} translate>Не удалось загрузить заказы</Text>
            ) : null}
            <Button
              title={history.isFetchNextPageError ? 'Повторить' : 'Показать ещё'}
              size="md"
              variant="secondary"
              loading={history.isFetchingNextPage}
              disabled={history.isFetching}
              onPress={() => void history.fetchNextPage({ cancelRefetch: false })}
            />
          </View>
        ) : null}
      />
    </BottomSheet>
  );
}

export function CabinetOrderRow({ order, onPress }: { order: CabinetRecentOrder; onPress: () => void }) {
  return (
    <FastPressable accessibilityRole="button" onPress={onPress} style={styles.cabinetOrderRow}>
      <Text style={styles.cabinetOrderNo} numberOfLines={1}>
        {displayOrderNumber(order.orderNumber)}
      </Text>
      <Text style={styles.cabinetOrderTable} numberOfLines={1} translate>
        {order.source === 'pickup' ? 'Самовывоз' : order.source === 'delivery' ? 'Доставка' : 'Стол ' + order.tableNumber}
      </Text>
      <Text style={styles.cabinetOrderTime}>{timeHM(order.createdAt)}</Text>
      <Text style={styles.cabinetOrderAmount} numberOfLines={1}>
        {money(order.finalAmount)}
      </Text>
      <CabinetStatusBadge status={order.status} refundLabel={refundStatusLabel(order)} />
      <PwaIcon name="chevronRight" size={14} color={colors.textLight} strokeWidth={2} />
    </FastPressable>
  );
}

function CabinetStatusBadge({ status, refundLabel }: { status: OrderStatus; refundLabel?: string }) {
  const meta = refundLabel ? { label: refundLabel, bg: colors.warningSoft, fg: colors.warning } : cabinetStatusMeta(status);
  return (
    <View style={[styles.cabinetStatusBadge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.cabinetStatusText, { color: meta.fg }]} translate>{meta.label}</Text>
    </View>
  );
}

function cabinetStatusMeta(status: OrderStatus) {
  if (status === 'paid') return { label: 'Оплачен', bg: colors.successSoft, fg: colors.success };
  if (status === 'cancelled') return { label: 'Отменён', bg: colors.dangerSoft, fg: colors.danger };
  if (status === 'rejected') return { label: 'Отказан', bg: colors.dangerSoft, fg: colors.danger };
  return { label: ORDER_STATUS[status]?.label ?? status, bg: colors.slate100, fg: colors.textMuted };
}

function orderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

const styles = StyleSheet.create({
  orderGroupLabel: { fontSize: fontSize.xs, fontWeight: '500', color: colors.textLight, textTransform: 'uppercase' },
  historyDate: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  historyAction: { gap: spacing.sm },
  historyFooter: { paddingTop: spacing.md },
  cabinetOrderRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 10,
  },
  cabinetOrderNo: { width: 52, fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  cabinetOrderTable: { width: 58, fontSize: fontSize.sm, color: colors.textMuted },
  cabinetOrderTime: { width: 45, fontSize: fontSize.sm, color: colors.textLight },
  cabinetOrderAmount: {
    flex: 1,
    minWidth: 58,
    textAlign: 'right',
    fontSize: fontSize.sm,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  cabinetStatusBadge: { flexShrink: 1, borderRadius: 6, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  cabinetStatusText: { fontSize: fontSize.xs, fontWeight: '500' },
  cabinetError: { fontSize: fontSize.sm, color: colors.danger, textAlign: 'center', paddingVertical: spacing.md },
  cabinetMuted: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
});
