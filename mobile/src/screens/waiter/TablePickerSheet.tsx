import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/typography';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { Button } from '@/components/ui';
import { colors, fontSize, radius, spacing, waiterLayout } from '@/theme';
import { TABLE_STATUS } from '@/theme/status';
import { useActiveOrders, useHalls } from '@/services/api/waiter';
import { useAuth } from '@/store/auth';
import { useCart } from '@/store/cart';
import { useNotifications } from '@/store/notifications';
import type { TableItem } from '@/types';

/** Смена стола на экране меню — список столов по залам (как в PWA TableSelectModal). */
export function TablePickerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const halls = useHalls();
  const orders = useActiveOrders();
  const user = useAuth((s) => s.user);
  const push = useNotifications((s) => s.push);
  const selectTable = useCart((s) => s.selectTable);
  const moveDraftTo = useCart((s) => s.moveDraftTo);
  const currentTableId = useCart((s) => s.tableId);
  const lines = useCart((s) => s.lines);
  const [pending, setPending] = React.useState<{ table: TableItem; hallName: string } | null>(null);
  const { width: windowWidth } = useWindowDimensions();
  const columns = windowWidth >= 640 ? 5 : 4;
  const [gridWidth, setGridWidth] = React.useState(0);
  const tableWidth = Math.max(0, ((gridWidth || Math.min(windowWidth, 448) - 32) - spacing.sm * (columns - 1)) / columns);

  const ordersByTable = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const order of orders.data ?? []) {
      if (order.source !== 'delivery' && !m.has(order.table.id)) m.set(order.table.id, order.id);
    }
    return m;
  }, [orders.data]);

  const close = () => {
    setPending(null);
    onClose();
  };

  const apply = (tbl: TableItem, hallName: string, preserveDraft = false) => {
    const table = { id: tbl.id, number: tbl.number, hallName };
    const activeOrderId = ordersByTable.get(tbl.id) ?? null;
    if (preserveDraft) moveDraftTo(table, activeOrderId);
    else selectTable(table, activeOrderId);
    close();
  };

  const pick = (tbl: TableItem, hallName: string) => {
    if (tbl.id === currentTableId) {
      close();
      return;
    }
    if (tbl.occupiedBy && tbl.occupiedBy.id !== user?.id) {
      push({
        message: `Этот стол занят другим официантом: ${tbl.occupiedBy?.name}`,
        type: 'error',
        at: new Date().toISOString(),
      });
      return;
    }
    if (lines.length > 0) {
      setPending({ table: tbl, hallName });
    } else {
      apply(tbl, hallName);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Выбор стола"
      footer={
        pending ? (
          <View style={styles.confirmFooter}>
            <Text style={styles.confirmTitle} translate>Сменить стол?</Text>
            <Text style={styles.confirmText} translate>
              В корзине уже есть блюда. Они будут перенесены на стол {pending.table.number}.
            </Text>
            <View style={styles.confirmActions}>
              <Button title="Отмена" variant="secondary" onPress={() => setPending(null)} style={{ flex: 1 }} />
              <Button title="Сменить" onPress={() => apply(pending.table, pending.hallName, true)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : undefined
      }
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        {(halls.data ?? []).filter((hall) => hall.tables.length > 0).map((hall) => (
          <View key={hall.id} style={styles.section}>
            <Text style={styles.hallName}>{hall.name}</Text>
            <View style={styles.grid} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
              {hall.tables.map((tbl) => {
                const selected = tbl.id === currentTableId;
                const meta = TABLE_STATUS[tbl.status];
                return (
                  <FastPressable
                    key={tbl.id}
                    onPress={() => pick(tbl, hall.name)}
                    style={[styles.table, { width: tableWidth }, selected && styles.tableSelected]}
                  >
                    {!selected ? <View style={[styles.dot, { backgroundColor: meta.dot }]} /> : null}
                    <Text style={[styles.tableNumber, selected && { color: colors.white }]}>
                      {tbl.number}
                    </Text>
                  </FastPressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.md },
  confirmFooter: { gap: spacing.sm, paddingBottom: spacing.sm },
  confirmTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.textPrimary },
  confirmText: { fontSize: fontSize.sm, color: colors.textMuted, lineHeight: 18 },
  confirmActions: { flexDirection: 'row', gap: spacing.sm, paddingTop: 2 },
  hallName: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  table: {
    height: waiterLayout.tablePickerCardHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dot: { position: 'absolute', right: 8, top: 8, width: 10, height: 10, borderRadius: 5 },
  tableNumber: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
});
