import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Loading, PillTabs } from '@/components/ui';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing, waiterLayout } from '@/theme';
import { TABLE_STATUS } from '@/theme/status';
import { useAuth } from '@/store/auth';
import { useHalls, useActiveOrders } from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import type { TableStatus, TableItem, Order } from '@/types';

const LEGEND: TableStatus[] = ['free', 'occupied', 'accepted', 'ready', 'waiting_payment'];

export function TablesScreen() {
  const navigation = useNavigation<any>();
  const user = useAuth((s) => s.user);
  const halls = useHalls();
  const ordersQ = useActiveOrders();
  const selectTable = useCart((s) => s.selectTable);
  const selectedTableId = useCart((s) => s.tableId);
  const [hallId, setHallId] = useState<string | null>(null);

  const currentHall = useMemo(() => {
    if (!halls.data?.length) return null;
    return halls.data.find((h) => h.id === hallId) ?? halls.data[0];
  }, [halls.data, hallId]);

  const ordersByTable = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of ordersQ.data ?? []) if (!m.has(o.table.id)) m.set(o.table.id, o);
    return m;
  }, [ordersQ.data]);

  const onTablePress = (tbl: TableItem) => {
    const occupiedByOther = tbl.occupiedBy && tbl.occupiedBy.id !== user?.id;
    if (occupiedByOther) {
      Alert.alert('Стол занят', `Этот стол занят другим официантом: ${tbl.occupiedBy?.name}`);
      return;
    }
    const activeOrder = ordersByTable.get(tbl.id);
    selectTable(
      { id: tbl.id, number: tbl.number, hallName: currentHall?.name },
      activeOrder?.id ?? null,
    );
    navigation.navigate('Menu');
  };

  const tables = currentHall?.tables ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <View style={styles.panel}>
        <View style={styles.titleRow}>
          <Text style={styles.panelTitle}>Выбор стола</Text>
          <View style={styles.editBtn}>
            <PwaIcon name="pencil" size={16} color={colors.textLight} />
            <Text style={styles.editBtnText}>Редактировать</Text>
          </View>
        </View>

        {halls.data && halls.data.length > 0 ? (
          <PillTabs
            items={halls.data.map((h) => ({ key: h.id, label: h.name }))}
            value={currentHall?.id ?? ''}
            onChange={setHallId}
            style={{ marginBottom: spacing.lg }}
          />
        ) : null}

        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={halls.isFetching} onRefresh={() => halls.refetch()} />
          }
        >
          {halls.isLoading ? (
            <Loading />
          ) : (
            tables.map((tbl) => {
              const meta = TABLE_STATUS[tbl.status];
              const selected = tbl.id === selectedTableId;
              return (
                <Pressable
                  key={tbl.id}
                  onPress={() => onTablePress(tbl)}
                  style={[styles.table, selected ? styles.tableSelected : null]}
                >
                  {!selected ? <View style={[styles.dot, { backgroundColor: meta.dot }]} /> : null}
                  <Text style={[styles.tableNumber, selected && { color: colors.white }]}>
                    {tbl.number}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {/* Легенда */}
        <View style={styles.legend}>
          {LEGEND.map((s) => (
            <View key={s} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: TABLE_STATUS[s].dot }]} />
              <Text style={styles.legendText}>{TABLE_STATUS[s].label}</Text>
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  panel: { flex: 1, paddingHorizontal: spacing.xs, paddingTop: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  panelTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  editBtnText: { fontSize: fontSize.sm, color: colors.textLight, fontWeight: '500' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingBottom: spacing.md },
  table: {
    width: '31%',
    aspectRatio: 1,
    minHeight: 104,
    borderRadius: waiterLayout.tableCardRadius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dot: { position: 'absolute', right: 8, top: 8, width: 10, height: 10, borderRadius: 5 },
  tableNumber: { fontSize: 24, fontWeight: '500', color: colors.textPrimary },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: fontSize.xs, color: colors.textMuted },
});
