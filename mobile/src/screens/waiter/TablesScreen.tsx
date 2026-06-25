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
import { Ionicons } from '@expo/vector-icons';
import { Button, Loading, PillTabs } from '@/components/ui';
import { colors, fontSize, radius, spacing, softShadow } from '@/theme';
import { TABLE_STATUS } from '@/theme/status';
import { useAuth } from '@/store/auth';
import { useHalls, useCurrentShift, useStartShift, useActiveOrders } from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { apiError } from '@/lib/api';
import type { TableStatus, TableItem, Order } from '@/types';

const LEGEND: TableStatus[] = ['free', 'occupied', 'accepted', 'ready', 'waiting_payment'];

export function TablesScreen() {
  const navigation = useNavigation<any>();
  const user = useAuth((s) => s.user);
  const shiftQuery = useCurrentShift();
  const startShift = useStartShift();
  const halls = useHalls();
  const ordersQ = useActiveOrders();
  const selectTable = useCart((s) => s.selectTable);
  const selectedTableId = useCart((s) => s.tableId);
  const [hallId, setHallId] = useState<string | null>(null);

  const activeShift = shiftQuery.data?.status === 'active';

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

  if (shiftQuery.isLoading) return <Loading text="Загрузка…" />;

  if (!activeShift) {
    return (
      <SafeAreaView style={styles.safe} edges={[]}>
        <View style={styles.shiftGate}>
          <Text style={styles.gateTitle}>Смена не начата</Text>
          <Text style={styles.muted}>Чтобы принимать заказы, начните смену в профиле.</Text>
          <Button
            title="Начать смену"
            loading={startShift.isPending}
            onPress={() =>
              startShift.mutate(undefined, { onError: (e) => Alert.alert('Ошибка', apiError(e)) })
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  const tables = currentHall?.tables ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <View style={styles.panel}>
        <View style={styles.titleRow}>
          <Text style={styles.panelTitle}>Выбор стола</Text>
          <View style={styles.editBtn}>
            <Ionicons name="create-outline" size={16} color={colors.textLight} />
            <Text style={styles.editBtnText}>Редактировать</Text>
          </View>
        </View>

        {halls.data && halls.data.length > 0 ? (
          <PillTabs
            items={halls.data.map((h) => ({ key: h.id, label: h.name }))}
            value={currentHall?.id ?? ''}
            onChange={setHallId}
            style={{ marginBottom: spacing.md }}
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
  panel: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  // PWA Panel title: text-lg font-semibold (18/600).
  panelTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  editBtnText: { fontSize: fontSize.sm, color: colors.textLight, fontWeight: '500' },
  muted: { color: colors.textMuted, fontSize: fontSize.base, textAlign: 'center' },
  shiftGate: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.white },
  gateTitle: { fontSize: fontSize.xl, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingBottom: spacing.md },
  table: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableSelected: { backgroundColor: 'rgba(0,91,255,0.9)', borderColor: 'rgba(0,91,255,0.9)', ...softShadow },
  // PWA: точка right-2 top-2 h-2.5 w-2.5 (10px). Цифра — text-2xl (24/500) как в PWA TablesGrid.
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
