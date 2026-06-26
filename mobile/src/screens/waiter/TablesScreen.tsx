import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { BottomSheet } from '@/components/BottomSheet';
import { Button, Loading, PillTabs } from '@/components/ui';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing, waiterLayout } from '@/theme';
import { TABLE_STATUS } from '@/theme/status';
import { useAuth } from '@/store/auth';
import {
  useActiveOrders,
  useAvailableWaiters,
  useCloseTable,
  useHalls,
  useMoveTable,
  useTransferTable,
  type AvailableWaiter,
} from '@/services/api/waiter';
import { useCart } from '@/store/cart';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import type { TableStatus, TableItem, Order } from '@/types';

const LEGEND: TableStatus[] = ['free', 'occupied', 'accepted', 'ready', 'waiting_payment'];
type TableModal = 'close' | 'move' | 'transfer' | null;

export function TablesScreen() {
  const navigation = useNavigation<any>();
  const user = useAuth((s) => s.user);
  const push = useNotifications((s) => s.push);
  const halls = useHalls();
  const ordersQ = useActiveOrders();
  const selectTable = useCart((s) => s.selectTable);
  const selectedTableId = useCart((s) => s.tableId);
  const [hallId, setHallId] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [tableModal, setTableModal] = useState<TableModal>(null);

  const closeTable = useCloseTable();
  const moveTable = useMoveTable();
  const transferTable = useTransferTable();
  const waitersQ = useAvailableWaiters(tableModal === 'transfer');

  const currentHall = useMemo(() => {
    if (!halls.data?.length) return null;
    return halls.data.find((h) => h.id === hallId) ?? halls.data[0];
  }, [halls.data, hallId]);

  const ordersByTable = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of ordersQ.data ?? []) if (!m.has(o.table.id)) m.set(o.table.id, o);
    return m;
  }, [ordersQ.data]);

  const onTablePress = React.useCallback((tbl: TableItem) => {
    const occupiedByOther = tbl.occupiedBy && tbl.occupiedBy.id !== user?.id;
    if (occupiedByOther) {
      push({
        message: `Этот стол занят другим официантом: ${tbl.occupiedBy?.name}`,
        type: 'error',
        at: new Date().toISOString(),
      });
      return;
    }
    const activeOrder = ordersByTable.get(tbl.id);
    selectTable(
      { id: tbl.id, number: tbl.number, hallName: currentHall?.name },
      activeOrder?.id ?? null,
    );
    navigation.navigate('Menu');
  }, [currentHall?.name, navigation, ordersByTable, push, selectTable, user?.id]);

  const tables = currentHall?.tables ?? [];
  const selectedTable = useMemo(
    () => (halls.data ?? []).flatMap((h) => h.tables).find((tbl) => tbl.id === selectedTableId) ?? null,
    [halls.data, selectedTableId],
  );
  const selectedOrder = selectedTableId ? ordersByTable.get(selectedTableId) ?? null : null;

  const openTableAction = (modal: TableModal) => {
    setActionsOpen(false);
    if (!selectedTable) {
      push({ message: 'Сначала выберите стол', type: 'error', at: new Date().toISOString() });
      return;
    }
    setTableModal(modal);
  };

  const doCloseTable = () => {
    if (!selectedTable) return;
    closeTable.mutate(selectedTable.id, {
      onSuccess: () => {
        push({ message: 'Стол закрыт', type: 'success', at: new Date().toISOString() });
        setTableModal(null);
      },
      onError: (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() }),
    });
  };

  const doMoveTable = (targetTableId: string) => {
    if (!selectedTable) return;
    moveTable.mutate(
      { tableId: selectedTable.id, targetTableId },
      {
        onSuccess: (updated) => {
          selectTable(
            { id: updated.table.id, number: updated.table.number, hallName: updated.table.hall?.name },
            updated.id,
          );
          push({ message: `Заказ перенесён на стол №${updated.table.number}`, type: 'success', at: new Date().toISOString() });
          setTableModal(null);
        },
        onError: (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() }),
      },
    );
  };

  const doTransferTable = (waiter: AvailableWaiter) => {
    if (!selectedTable) return;
    transferTable.mutate(
      { tableId: selectedTable.id, waiterId: waiter.id },
      {
        onSuccess: () => {
          push({ message: `Стол передан официанту ${waiter.name}`, type: 'success', at: new Date().toISOString() });
          setTableModal(null);
        },
        onError: (e: unknown) => push({ message: apiError(e), type: 'error', at: new Date().toISOString() }),
      },
    );
  };

  const renderTable = React.useCallback(({ item: tbl }: { item: TableItem }) => {
    const meta = TABLE_STATUS[tbl.status];
    const selected = tbl.id === selectedTableId;
    return (
      <Pressable
        onPress={() => onTablePress(tbl)}
        style={[styles.table, selected ? styles.tableSelected : null]}
      >
        {!selected ? <View style={[styles.dot, { backgroundColor: meta.dot }]} /> : null}
        <Text style={[styles.tableNumber, selected && { color: colors.white }]}>
          {tbl.number}
        </Text>
      </Pressable>
    );
  }, [onTablePress, selectedTableId]);

  const keyTable = React.useCallback((tbl: TableItem) => tbl.id, []);

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <View style={styles.panel}>
        <View style={styles.titleRow}>
          <Text style={styles.panelTitle}>Выбор стола</Text>
          <View style={styles.actionsAnchor}>
            <Pressable
              onPress={() => setActionsOpen((v) => !v)}
              style={[styles.editBtn, !selectedTable && styles.editBtnDisabled]}
            >
              <PwaIcon name="pencil" size={16} color={colors.textLight} />
              <Text style={styles.editBtnText}>Редактировать</Text>
            </Pressable>
            {actionsOpen ? (
              <View style={styles.tableActionsMenu}>
                <Pressable onPress={() => openTableAction('close')} style={styles.tableActionItem}>
                  <Text style={styles.tableActionText}>Закрыть стол</Text>
                </Pressable>
                <Pressable onPress={() => openTableAction('move')} style={styles.tableActionItem}>
                  <Text style={styles.tableActionText}>Перенести стол</Text>
                </Pressable>
                <Pressable onPress={() => openTableAction('transfer')} style={styles.tableActionItem}>
                  <Text style={styles.tableActionText}>Передать стол</Text>
                </Pressable>
              </View>
            ) : null}
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

        <FlatList
          data={halls.isLoading ? [] : tables}
          renderItem={renderTable}
          keyExtractor={keyTable}
          numColumns={3}
          style={styles.tableList}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={halls.isFetching} onRefresh={() => halls.refetch()} />
          }
          ListEmptyComponent={halls.isLoading ? <Loading /> : null}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={5}
        />

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

      <CloseTableSheet
        visible={tableModal === 'close'}
        table={selectedTable}
        hasActiveOrder={!!selectedOrder}
        pending={closeTable.isPending}
        onConfirm={doCloseTable}
        onClose={() => setTableModal(null)}
      />
      <MoveTableSheet
        visible={tableModal === 'move'}
        halls={halls.data ?? []}
        currentTableId={selectedTable?.id ?? null}
        pending={moveTable.isPending}
        onConfirm={doMoveTable}
        onClose={() => setTableModal(null)}
      />
      <TransferTableSheet
        visible={tableModal === 'transfer'}
        waiters={waitersQ.data ?? []}
        loading={waitersQ.isLoading}
        excludeWaiterId={user?.id ?? null}
        pending={transferTable.isPending}
        onConfirm={doTransferTable}
        onClose={() => setTableModal(null)}
      />
    </SafeAreaView>
  );
}

function CloseTableSheet({
  visible,
  table,
  hasActiveOrder,
  pending,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  table: TableItem | null;
  hasActiveOrder: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Закрыть стол?"
      footer={
        hasActiveOrder ? (
          <Button title="Понятно" variant="secondary" onPress={onClose} />
        ) : (
          <View style={styles.sheetActions}>
            <Button title="Отмена" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button title="Закрыть стол" onPress={onConfirm} loading={pending} disabled={!table} style={{ flex: 1 }} />
          </View>
        )
      }
    >
      <Text style={styles.sheetText}>
        {hasActiveOrder
          ? 'У этого стола есть активный заказ. Завершите или оплатите заказ перед закрытием стола.'
          : `Вы действительно хотите закрыть стол №${table?.number ?? ''}?`}
      </Text>
    </BottomSheet>
  );
}

function MoveTableSheet({
  visible,
  halls,
  currentTableId,
  pending,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  halls: { id: string; name: string; tables: TableItem[] }[];
  currentTableId: string | null;
  pending: boolean;
  onConfirm: (targetTableId: string) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = React.useState<string | null>(null);
  React.useEffect(() => setTarget(null), [visible]);
  const groups = halls
    .map((hall) => ({
      name: hall.name,
      tables: hall.tables.filter((tbl) => tbl.status === 'free' && tbl.id !== currentTableId),
    }))
    .filter((group) => group.tables.length > 0);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Перенести стол"
      maxHeight="78%"
      footer={
        <View style={styles.sheetActions}>
          <Button title="Отмена" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button
            title="Перенести"
            onPress={() => target && onConfirm(target)}
            loading={pending}
            disabled={!target}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <Text style={styles.sheetHint}>Выберите стол, на который нужно перенести заказ</Text>
      {groups.length === 0 ? (
        <Text style={styles.emptySheetText}>Нет доступных столов для переноса</Text>
      ) : (
        <View style={styles.sheetSections}>
          {groups.map((group) => (
            <View key={group.name}>
              <Text style={styles.sheetSectionTitle}>{group.name}</Text>
              <View style={styles.pickGrid}>
                {group.tables.map((tbl) => (
                  <Pressable
                    key={tbl.id}
                    onPress={() => setTarget(tbl.id)}
                    style={[styles.pickTable, target === tbl.id && styles.pickTableSelected]}
                  >
                    <Text style={[styles.pickTableText, target === tbl.id && styles.pickTableTextSelected]}>{tbl.number}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

function TransferTableSheet({
  visible,
  waiters,
  loading,
  excludeWaiterId,
  pending,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  waiters: AvailableWaiter[];
  loading: boolean;
  excludeWaiterId: string | null;
  pending: boolean;
  onConfirm: (waiter: AvailableWaiter) => void;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  React.useEffect(() => setSelectedId(null), [visible]);
  const list = waiters.filter((waiter) => waiter.id !== excludeWaiterId);
  const selected = list.find((waiter) => waiter.id === selectedId) ?? null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Передать стол"
      footer={
        <View style={styles.sheetActions}>
          <Button title="Отмена" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button
            title="Передать"
            onPress={() => selected && onConfirm(selected)}
            loading={pending}
            disabled={!selected}
            style={{ flex: 1 }}
          />
        </View>
      }
    >
      <Text style={styles.sheetHint}>Выберите официанта, которому нужно передать стол</Text>
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Text style={styles.emptySheetText}>Нет доступных официантов для передачи</Text>
      ) : (
        <View style={styles.waiterList}>
          {list.map((waiter) => (
            <Pressable
              key={waiter.id}
              onPress={() => setSelectedId(waiter.id)}
              style={[styles.waiterPick, selectedId === waiter.id && styles.waiterPickSelected]}
            >
              <View style={styles.waiterAvatar}>
                <Text style={styles.waiterAvatarText}>{waiter.name[0]}</Text>
              </View>
              <Text style={styles.waiterName}>{waiter.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  panel: { flex: 1, paddingHorizontal: spacing.xs, paddingTop: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  panelTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  actionsAnchor: { position: 'relative', zIndex: 30 },
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
  editBtnDisabled: { opacity: 0.65 },
  editBtnText: { fontSize: fontSize.sm, color: colors.textLight, fontWeight: '500' },
  tableActionsMenu: {
    position: 'absolute',
    right: 0,
    top: 38,
    width: 180,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    overflow: 'hidden',
    zIndex: 50,
  },
  tableActionItem: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tableActionText: { fontSize: fontSize.sm, color: colors.textSecondary },

  tableList: { flex: 1 },
  grid: { paddingBottom: spacing.md },
  gridRow: { justifyContent: 'space-between', marginBottom: spacing.md },
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
  sheetText: { fontSize: fontSize.base, color: colors.textSecondary, lineHeight: 22 },
  sheetHint: { fontSize: fontSize.base, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 22 },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.sm },
  sheetSections: { gap: spacing.md },
  sheetSectionTitle: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textMuted, marginBottom: spacing.sm },
  pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickTable: {
    width: '22.6%',
    height: 60,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickTableSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  pickTableText: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  pickTableTextSelected: { color: colors.white },
  emptySheetText: { paddingVertical: spacing.xl, textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted },
  waiterList: { gap: spacing.sm },
  waiterPick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  waiterPickSelected: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  waiterAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waiterAvatarText: { fontSize: fontSize.base, fontWeight: '700', color: colors.primary },
  waiterName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
});
