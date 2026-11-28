import { View } from '@/components/themed';
import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '@/components/typography';
import type { Order, OrderStatus, TableStatus } from '@/types';
import { ORDER_STATUS, TABLE_STATUS, orderStationStatuses } from '@/theme/status';
import { colors, fontSize, radius, spacing } from '@/theme';
import { usePrepStations } from '@/services/api/prepStations';
import { refundStatusLabel } from '@/features/refunds/refundRules';

/** Бейдж статуса заказа — зеркало OrderBadge из PWA. */
export function OrderBadge({ status, source, size = 'md' }: { status: OrderStatus; source?: Order['source']; size?: 'sm' | 'md' }) {
  const meta = ORDER_STATUS[status];
  const deliveryStatus = source === 'delivery' && (['sent_to_kitchen', 'accepted_by_kitchen', 'cooking'].includes(status) ? 'Готовится'
    : status === 'ready' ? 'Готов' : status === 'picked_up' ? 'В пути' : status === 'served' ? 'Доставлен' : null);
  return (
    <View
      style={[
        styles.badge,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: meta.bg },
      ]}
    >
      <Text style={[styles.text, size === 'sm' ? styles.textSm : styles.textMd, { color: meta.fg }]} translate>
        {deliveryStatus || meta.label}
      </Text>
    </View>
  );
}

/** Станционные бейджи заказа — зеркало PWA OrderStatusBadges. */
export function OrderStatusBadges({
  order,
  size = 'md',
  align = 'end',
}: {
  order: Order;
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
}) {
  const { stations } = usePrepStations();
  const refundLabel = refundStatusLabel(order);
  if (refundLabel) {
    return (
      <View style={[styles.badge, size === 'sm' ? styles.sm : styles.md, { backgroundColor: colors.warningSoft }]}>
        <Text style={[styles.text, size === 'sm' ? styles.textSm : styles.textMd, { color: colors.warning }]} translate>{refundLabel}</Text>
      </View>
    );
  }
  const chips = orderStationStatuses(order, stations);
  if (chips.length === 0) return <OrderBadge status={order.status} source={order.source} size={size} />;

  return (
    <View style={[styles.badgesRow, align === 'start' && styles.badgesRowStart]}>
      {chips.map((chip) => (
        <View
          key={chip.station}
          style={[
            styles.badge,
            size === 'sm' ? styles.sm : styles.md,
            { backgroundColor: chip.bg },
          ]}
        >
          <Text style={[styles.text, size === 'sm' ? styles.textSm : styles.textMd, { color: chip.fg }]} translate>
            {chip.stationLabel}: {chip.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Бейдж статуса стола. */
export function TableBadge({ status }: { status: TableStatus }) {
  const meta = TABLE_STATUS[status];
  return (
    <View style={[styles.badge, styles.md, { backgroundColor: meta.bg }]}>
      <Text style={[styles.text, styles.textMd, { color: meta.fg }]} translate>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.xs, maxWidth: 220 },
  badgesRowStart: { justifyContent: 'flex-start', maxWidth: '100%' },
  badge: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  sm: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  md: { borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  text: { fontWeight: '500' },
  textSm: { fontSize: 11 },
  textMd: { fontSize: fontSize.xs },
});
