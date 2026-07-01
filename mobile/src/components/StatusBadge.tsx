import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Order, OrderStatus, TableStatus } from '@/types';
import { ORDER_STATUS, TABLE_STATUS, orderStationStatuses } from '@/theme/status';
import { fontSize, radius, spacing } from '@/theme';

/** Бейдж статуса заказа — зеркало OrderBadge из PWA. */
export function OrderBadge({ status, size = 'md' }: { status: OrderStatus; size?: 'sm' | 'md' }) {
  const meta = ORDER_STATUS[status];
  return (
    <View
      style={[
        styles.badge,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: meta.bg },
      ]}
    >
      <Text style={[styles.text, size === 'sm' ? styles.textSm : styles.textMd, { color: meta.fg }]}>
        {meta.label}
      </Text>
    </View>
  );
}

/** Станционные бейджи заказа — зеркало PWA OrderStatusBadges. */
export function OrderStatusBadges({ order, size = 'md' }: { order: Order; size?: 'sm' | 'md' }) {
  const chips = orderStationStatuses(order);
  if (chips.length === 0) return <OrderBadge status={order.status} size={size} />;

  return (
    <View style={styles.badgesRow}>
      {chips.map((chip) => (
        <View
          key={chip.station}
          style={[
            styles.badge,
            size === 'sm' ? styles.sm : styles.md,
            { backgroundColor: chip.bg },
          ]}
        >
          <Text style={[styles.text, size === 'sm' ? styles.textSm : styles.textMd, { color: chip.fg }]}>
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
      <Text style={[styles.text, styles.textMd, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.xs, maxWidth: 220 },
  badge: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  sm: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  md: { borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  text: { fontWeight: '500' },
  textSm: { fontSize: fontSize.xs },
  textMd: { fontSize: fontSize.sm },
});
