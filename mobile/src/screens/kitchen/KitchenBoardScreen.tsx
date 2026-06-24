import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, EmptyState, Loading, SegmentTabs } from '@/components/ui';
import { OrderBadge } from '@/components/StatusBadge';
import { AppHeader } from '@/components/AppHeader';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { colors, fontSize, radius, spacing } from '@/theme';
import { REJECT_REASONS } from '@/theme/status';
import {
  useKitchenOrders,
  useAccept,
  useReady,
  useRejectOrder,
  useReadyItems,
  useRejectItems,
  type KitchenTab,
} from '@/services/api/kitchen';
import { useSocketEvent } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';
import { useAuth } from '@/store/auth';
import { disconnectSocket } from '@/services/socket';
import { unregisterPushDevice } from '@/services/push';
import { displayOrderNumber, hallSuffix, timeHM, dateDM, elapsed } from '@/utils/format';
import { apiError } from '@/lib/api';
import type { Order, OrderItem, PrepStation } from '@/types';

const TABS: { key: KitchenTab; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'in_work', label: 'В работе' },
  { key: 'ready', label: 'Завершенные' },
  { key: 'rejected', label: 'Отказанные' },
];

const FINAL_STATUSES = ['rejected', 'cancelled', 'ready', 'served'];

export function KitchenBoardScreen({ station }: { station: PrepStation }) {
  const [tab, setTab] = useState<KitchenTab>('new');
  const [now, setNow] = useState(() => Date.now());
  const orders = useKitchenOrders(tab, station);
  const logout = useAuth((s) => s.logout);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useSocketEvent(SERVER_EVENTS.KITCHEN_NEW_ORDER, () => Vibration.vibrate(400), []);

  const onLogout = () => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
  };

  const list = orders.data ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <OfflineBanner />
      <AppHeader
        left={
          <Text style={styles.clock}>
            {new Date(now).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        }
        right={
          <>
            <ConnectionStatus />
            <Pressable onPress={onLogout} hitSlop={8}>
              <Text style={styles.logout}>Выйти</Text>
            </Pressable>
          </>
        }
      />

      <View style={styles.tabsBar}>
        <SegmentTabs items={TABS} value={tab} onChange={setTab} count={list.length} />
      </View>

      {orders.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState
          text={
            tab === 'new'
              ? 'Новых заказов нет'
              : tab === 'in_work'
                ? 'Нет заказов в работе'
                : tab === 'ready'
                  ? 'Завершённых заказов нет'
                  : 'Отказанных заказов нет'
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={orders.isFetching} onRefresh={() => orders.refetch()} />
          }
        >
          {list.map((o) => (
            <KitchenCard key={o.id} order={o} tab={tab} now={now} station={station} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function KitchenCard({
  order,
  tab,
  now,
  station,
}: {
  order: Order;
  tab: KitchenTab;
  now: number;
  station: PrepStation;
}) {
  const accept = useAccept(station);
  const ready = useReady();
  const rejectOrder = useRejectOrder();
  const readyItems = useReadyItems(station);
  const rejectItems = useRejectItems(station);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const onError = (e: unknown) => Alert.alert('Ошибка', apiError(e));
  const canSelect = tab === 'new' || tab === 'in_work';
  const slow = Math.floor((now - new Date(order.createdAt).getTime()) / 1000) > 20 * 60 && canSelect;

  const componentIds = useMemo(() => {
    const s = new Set<string>();
    for (const it of order.items) for (const sc of it.setComponents ?? []) s.add(sc.id);
    return s;
  }, [order.items]);

  const isSelectable = (status: string) => canSelect && !FINAL_STATUSES.includes(status);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const pickReason = (onPick: (reason: string) => void) =>
    Alert.alert('Причина отказа', undefined, [
      ...REJECT_REASONS.map((r) => ({ text: r, onPress: () => onPick(r) })),
      { text: 'Отмена', style: 'cancel' as const },
    ]);

  const runBatch = (type: 'ready' | 'reject') => {
    const itemIds: string[] = [];
    const setComponentIds: string[] = [];
    for (const id of selected) (componentIds.has(id) ? setComponentIds : itemIds).push(id);
    if (itemIds.length === 0 && setComponentIds.length === 0) return;
    const clear = () => setSelected(new Set());
    if (type === 'ready') {
      readyItems.mutate({ orderId: order.id, itemIds, setComponentIds }, { onError, onSuccess: clear });
    } else {
      pickReason((reason) =>
        rejectItems.mutate({ orderId: order.id, itemIds, setComponentIds, reason }, { onError, onSuccess: clear }),
      );
    }
  };

  const badgeStatus = order.status;
  const showBadge = tab === 'ready' || tab === 'rejected';
  const selectionMode = selected.size > 0;

  const renderItemLine = (item: OrderItem, isComponent = false) => {
    const selectable = isSelectable(item.status);
    const checked = selected.has(item.id);
    const rejected = item.status === 'rejected';
    const isReady = item.status === 'ready' || item.status === 'served';
    return (
      <Pressable
        key={item.id}
        disabled={!selectable}
        onPress={() => toggle(item.id)}
        style={styles.itemRow}
      >
        {selectable && selectionMode ? (
          <View style={[styles.checkbox, checked && styles.checkboxOn]}>
            {checked ? <Ionicons name="checkmark" size={13} color={colors.white} /> : null}
          </View>
        ) : null}
        <Text
          style={[
            styles.itemText,
            isComponent && styles.itemComponent,
            rejected && styles.itemRejected,
            isReady && styles.itemDone,
          ]}
        >
          {!isComponent ? <Text style={styles.itemQty}>{item.quantity}× </Text> : null}
          {item.dishNameSnapshot}
          {item.dishVariantNameSnapshot ? ` (${item.dishVariantNameSnapshot})` : ''}
          {item.takeaway ? '  · с собой' : ''}
        </Text>
        {isReady ? <Text style={styles.itemFlagDone}>✓</Text> : null}
        {rejected ? <Text style={styles.itemFlagRej}>Отказ</Text> : null}
      </Pressable>
    );
  };

  return (
    <Card style={{ gap: 0 }}>
      {/* Шапка карточки */}
      <View style={styles.cardHead}>
        <View style={{ minWidth: 0 }}>
          <Text style={styles.orderNumber}>{displayOrderNumber(order.orderNumber)}</Text>
          <Text style={styles.tableText}>
            Стол {order.table.number}
            {hallSuffix(order.table)}
          </Text>
          {order.waiter ? <Text style={styles.waiter}>Официант: {order.waiter.name}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.time}>
            {canSelect ? timeHM(order.createdAt) : `${dateDM(order.createdAt)} ${timeHM(order.createdAt)}`}
          </Text>
          {canSelect ? (
            <Text style={[styles.elapsed, slow && { color: colors.danger }]}>{elapsed(order.createdAt, now)}</Text>
          ) : showBadge ? (
            <View style={{ marginTop: 4 }}>
              <OrderBadge status={badgeStatus} />
            </View>
          ) : null}
        </View>
      </View>

      {/* Позиции */}
      <View style={styles.items}>
        {order.items.map((it) => {
          const setParts = it.setComponents ?? [];
          if (setParts.length === 0) return renderItemLine(it);
          return (
            <View key={it.id} style={{ gap: 6 }}>
              <Text style={styles.setHeader}>
                <Text style={styles.itemQty}>{it.quantity}× </Text>
                {it.dishNameSnapshot}
              </Text>
              <View style={styles.setComponents}>
                {setParts
                  .filter((sc) => sc.action !== 'removed')
                  .map((sc) =>
                    renderItemLine(
                      {
                        ...(it as OrderItem),
                        id: sc.id,
                        status: sc.status,
                        dishNameSnapshot: sc.finalNameSnapshot ?? sc.originalNameSnapshot,
                        dishVariantNameSnapshot: null,
                        quantity: sc.quantity,
                      },
                      true,
                    ),
                  )}
              </View>
            </View>
          );
        })}
      </View>

      {order.comment ? <Text style={styles.comment}>{order.comment}</Text> : null}

      {/* Действия */}
      {canSelect && selectionMode ? (
        <View style={styles.actionsTop}>
          <Text style={styles.selectedText}>Выбрано: {selected.size}</Text>
          <View style={styles.actionsBtns}>
            <Button title="Отказать" variant="danger" size="md" onPress={() => runBatch('reject')} />
            {tab === 'in_work' ? (
              <Button title="Готово" size="md" onPress={() => runBatch('ready')} />
            ) : null}
          </View>
        </View>
      ) : canSelect ? (
        <View style={styles.actions}>
          <Button
            title="Отменить заказ"
            variant="danger"
            size="md"
            style={{ flex: 1 }}
            onPress={() => pickReason((reason) => rejectOrder.mutate({ orderId: order.id, reason }, { onError }))}
          />
          {tab === 'new' ? (
            <Button
              title="Принять в работу"
              size="md"
              style={{ flex: 1 }}
              loading={accept.isPending}
              onPress={() => accept.mutate(order.id, { onError })}
            />
          ) : (
            <Button
              title="Готово"
              size="md"
              style={{ flex: 1 }}
              loading={ready.isPending}
              onPress={() => ready.mutate(order.id, { onError })}
            />
          )}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  clock: { fontSize: fontSize.xxl, fontWeight: '500', color: colors.textPrimary, letterSpacing: -0.5 },
  logout: { fontSize: fontSize.sm, color: colors.textMuted },
  tabsBar: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  list: { padding: spacing.lg, gap: spacing.lg },

  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  orderNumber: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  tableText: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  waiter: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  time: { fontSize: fontSize.sm, color: colors.textMuted },
  elapsed: { fontSize: fontSize.base, fontWeight: '600', color: colors.textSecondary },

  items: {
    gap: spacing.md,
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemText: { flex: 1, fontSize: fontSize.base, color: colors.textPrimary },
  itemQty: { fontWeight: '700' },
  itemComponent: { fontSize: fontSize.sm, color: colors.textSecondary },
  itemRejected: { color: colors.danger, textDecorationLine: 'line-through' },
  itemDone: { color: colors.textMuted },
  itemFlagDone: { fontSize: fontSize.sm, fontWeight: '700', color: colors.green600 },
  itemFlagRej: { fontSize: fontSize.sm, fontWeight: '700', color: colors.danger },
  setHeader: { fontSize: fontSize.base, color: colors.textPrimary },
  setComponents: { paddingLeft: spacing.md, gap: 6 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.slate300,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },

  comment: {
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: fontSize.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  actionsTop: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  selectedText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  actionsBtns: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
});
