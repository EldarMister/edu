import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
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

  const ordersByTable = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const order of orders.data ?? []) {
      if (!m.has(order.table.id)) m.set(order.table.id, order.id);
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
      maxHeight="92%"
      footer={
        pending ? (
          <View style={styles.confirmFooter}>
            <Text style={styles.confirmTitle}>Сменить стол?</Text>
            <Text style={styles.confirmText}>
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
        {(halls.data ?? []).map((hall) => (
          <View key={hall.id} style={styles.section}>
            <Text style={styles.hallName}>{hall.name}</Text>
            <View style={styles.grid}>
              {hall.tables.map((tbl) => {
                const selected = tbl.id === currentTableId;
                const meta = TABLE_STATUS[tbl.status];
                return (
                  <Pressable
                    key={tbl.id}
                    onPress={() => pick(tbl, hall.name)}
                    style={[styles.table, selected && styles.tableSelected]}
                  >
                    {!selected ? <View style={[styles.dot, { backgroundColor: meta.dot }]} /> : null}
                    <Text style={[styles.tableNumber, selected && { color: colors.white }]}>
                      {tbl.number}
                    </Text>
                  </Pressable>
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
  hallName: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted, marginBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  table: {
    width: '22.6%',
    height: waiterLayout.tablePickerCardHeight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dot: { position: 'absolute', right: 6, top: 6, width: 10, height: 10, borderRadius: 5 },
  tableNumber: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
});
