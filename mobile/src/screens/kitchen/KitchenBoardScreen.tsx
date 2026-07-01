import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import {
  useKitchenOrders,
  useAccept,
  useReadyItems,
  useRejectItems,
  type KitchenTab,
} from '@/services/api/kitchen';
import { useSocketEvent } from '@/services/socket';
import { SERVER_EVENTS } from '@/services/socket/events';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { disconnectSocket } from '@/services/socket';
import { unregisterPushDevice } from '@/services/push';
import { kitchenVoice } from '@/services/kitchenVoice';
import { getKitchenVoiceSettings } from '@/services/kitchenVoiceSettings';
import { beep } from '@/lib/sound';
import {
  displayOrderNumber,
  hallSuffix,
  timeHM,
  dateDM,
  elapsed,
  orderItemDisplayName,
} from '@/utils/format';
import { apiError } from '@/lib/api';
import { StopListSheet } from './StopListSheet';
import { KitchenVoiceSettingsSheet } from './KitchenVoiceSettingsSheet';
import type { Order, OrderItemStatus, OrderSetComponent, OrderStatus, PrepStation } from '@/types';

const TABS: { key: KitchenTab; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'in_work', label: 'В работе' },
  { key: 'ready', label: 'Завершенные' },
  { key: 'rejected', label: 'Отказанные' },
];

/** Порог «долгого» ожидания, после которого таймер краснеет (сек). */
const SLOW_AFTER = 20 * 60;
/** Сколько секунд показывается блок отмены, прежде чем действие уйдёт официанту. */
const UNDO_SECONDS = 8;

const FINAL_ITEM_STATUSES: OrderItemStatus[] = ['rejected', 'cancelled', 'ready', 'served'];
const QR_ORDER_COMMENT = 'Заказ из QR-меню';

type PendingAction = {
  orderId: string;
  type: 'reject' | 'ready';
  itemIds: string[];
  setComponentIds: string[];
  /** Частичный отказ по количеству для обычных позиций. */
  partial?: { itemId: string; quantity: number }[];
  deadline: number;
};

/** Заказ из сокета может нести готовый текст озвучки (формирует backend). */
type VoicedOrder = Order & {
  voice?: {
    text?: string | null;
    byStation?: Partial<Record<Exclude<PrepStation, 'none'>, string | null>>;
  } | null;
};

function stationVoice(order: VoicedOrder, station: PrepStation): string | null {
  if (station === 'none') return null;
  return order.voice?.byStation?.[station] ?? order.voice?.text ?? null;
}

/** Русское склонение: 1 позиция, 2 позиции, 5 позиций. */
function pluralPositions(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'позиций';
  if (b > 1 && b < 5) return 'позиции';
  if (b === 1) return 'позиция';
  return 'позиций';
}

function kitchenCardBadgeStatus(order: Order, tab: KitchenTab): OrderStatus {
  if (tab !== 'ready' || order.status === 'paid') return order.status;
  const activeItems = order.items.filter((item) => item.status !== 'rejected' && item.status !== 'cancelled');
  if (activeItems.length === 0) return order.status;
  if (activeItems.every((item) => item.status === 'served')) return 'served';
  if (activeItems.every((item) => item.status === 'ready' || item.status === 'served')) return 'ready';
  return order.status;
}

function isQrOrder(order: Order) {
  return order.source === 'qr' || order.comment?.trim() === QR_ORDER_COMMENT;
}

function kitchenItemComment(comment: string | null, qrOrder: boolean) {
  if (!comment) return null;
  const value = comment.trim();
  if (!qrOrder) return value;
  const withoutGuestPrefix = value.replace(/^Гость\s+\d+\s*·\s*/, '').trim();
  if (/^Гость\s+\d+$/.test(withoutGuestPrefix)) return null;
  return withoutGuestPrefix || null;
}

function kitchenOrderComment(comment: string | null, qrOrder: boolean) {
  if (!comment) return null;
  const value = comment.trim();
  if (qrOrder && value === QR_ORDER_COMMENT) return null;
  return value;
}

export function KitchenBoardScreen({ station }: { station: PrepStation }) {
  const [tab, setTab] = useState<KitchenTab>('new');
  const [now, setNow] = useState(() => Date.now());
  const [stopListOpen, setStopListOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const orders = useKitchenOrders(tab, station);
  const accept = useAccept(station);
  const readyItems = useReadyItems(station);
  const rejectItems = useRejectItems(station);
  const logout = useAuth((s) => s.logout);
  const push = useNotifications((s) => s.push);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Новый заказ: звук + вибрация + тост (по настройкам) + озвучка станции.
  useSocketEvent<VoicedOrder>(
    SERVER_EVENTS.KITCHEN_NEW_ORDER,
    (order) => {
      const text = stationVoice(order, station);
      if (!text) return;
      const settings = getKitchenVoiceSettings();
      if (settings.notificationsEnabled) {
        void beep('newOrder');
        Vibration.vibrate(400);
        const orderNumber = displayOrderNumber(order.orderNumber);
        push({
          message: `Новый заказ ${orderNumber} · Стол ${order.table?.number}`,
          orderId: order.id,
          orderNumber,
          at: new Date().toISOString(),
        });
      }
      kitchenVoice.enqueue(text);
    },
    [station, push],
  );

  // Backend добавляет voice.text только для полной отмены/отказа — озвучиваем.
  useSocketEvent<VoicedOrder>(
    SERVER_EVENTS.ORDER_STATUS_CHANGED,
    (order) => {
      const text = stationVoice(order, station);
      if (!text) return;
      if (getKitchenVoiceSettings().notificationsEnabled) void beep('notify');
      kitchenVoice.enqueue(text);
    },
    [station],
  );

  const onLogout = () => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
  };

  // Отправляет отложенное действие на сервер (= «уходит официанту»).
  const commit = useCallback(
    (p: PendingAction) => {
      const run =
        p.type === 'reject'
          ? rejectItems.mutateAsync({
              orderId: p.orderId,
              itemIds: p.itemIds,
              setComponentIds: p.setComponentIds,
              partial: p.partial,
            })
          : readyItems.mutateAsync({
              orderId: p.orderId,
              itemIds: p.itemIds,
              setComponentIds: p.setComponentIds,
            });
      run.catch((err) => push({ message: apiError(err), at: new Date().toISOString() }));
    },
    [push, readyItems, rejectItems],
  );

  const commitRef = useRef(commit);
  commitRef.current = commit;

  // По истечении таймера действие фиксируется и уходит на сервер.
  useEffect(() => {
    if (!pending) return undefined;
    const id = setTimeout(() => {
      commitRef.current(pending);
      setPending(null);
    }, Math.max(0, pending.deadline - Date.now()));
    return () => clearTimeout(id);
  }, [pending]);

  const onBatch = useCallback(
    (
      orderId: string,
      type: 'reject' | 'ready',
      ids: { itemIds: string[]; setComponentIds: string[]; partial?: { itemId: string; quantity: number }[] },
    ) => {
      // Новое действие, пока предыдущее не подтверждено — фиксируем предыдущее сразу.
      setPending((current) => {
        if (current) commitRef.current(current);
        return { orderId, type, ...ids, deadline: Date.now() + UNDO_SECONDS * 1000 };
      });
    },
    [],
  );

  const list = orders.data ?? [];
  const undoSecondsLeft = pending ? Math.max(0, Math.ceil((pending.deadline - now) / 1000)) : 0;
  const pendingCount = pending ? pending.itemIds.length + pending.setComponentIds.length : 0;

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
        <View style={{ flex: 1, minWidth: 0 }}>
          <SegmentTabs items={TABS} value={tab} onChange={setTab} count={list.length} />
        </View>
        <Pressable onPress={() => setVoiceOpen(true)} style={styles.voiceBtn} hitSlop={6}>
          <PwaIcon name="speaker" size={18} color={colors.primary} />
        </Pressable>
        <Pressable onPress={() => setStopListOpen(true)} style={styles.stopListBtn} hitSlop={6}>
          <Text style={styles.stopListText}>Стоп-лист</Text>
        </Pressable>
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
            <KitchenCard
              key={o.id}
              order={o}
              tab={tab}
              now={now}
              submitting={accept.isPending}
              pendingItemIds={pending?.orderId === o.id ? [...pending.itemIds, ...pending.setComponentIds] : []}
              pendingType={pending?.orderId === o.id ? pending.type : null}
              onAccept={() =>
                accept.mutate(o.id, {
                  onError: (err: unknown) => push({ message: apiError(err), at: new Date().toISOString() }),
                })
              }
              onBatch={(type, ids) => onBatch(o.id, type, ids)}
            />
          ))}
        </ScrollView>
      )}

      {/* Нижний блок отмены действия с таймером */}
      {pending ? (
        <View pointerEvents="box-none" style={styles.undoOuter}>
          <View style={styles.undoCard}>
            <View style={styles.undoIcon}>
              <PwaIcon name="rotateCcw" size={20} color={colors.white} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.undoTitle} numberOfLines={1}>
                {pendingCount} {pluralPositions(pendingCount)}{' '}
                {pending.type === 'reject' ? 'помечены как отказ' : 'помечены как готовые'}
              </Text>
              <Text style={styles.undoSub}>
                Отправка официанту через{' '}
                <Text style={styles.undoSeconds}>{String(undoSecondsLeft).padStart(2, '0')} сек</Text>
              </Text>
            </View>
            <Pressable onPress={() => setPending(null)} style={styles.undoBtn}>
              <Text style={styles.undoBtnText}>Отменить</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <StopListSheet visible={stopListOpen} station={station} onClose={() => setStopListOpen(false)} />
      <KitchenVoiceSettingsSheet visible={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </SafeAreaView>
  );
}

function KitchenCard({
  order,
  tab,
  now,
  submitting,
  pendingItemIds,
  pendingType,
  onAccept,
  onBatch,
}: {
  order: Order;
  tab: KitchenTab;
  now: number;
  submitting: boolean;
  /** Блюда заказа с отложенным (ещё не подтверждённым) действием. */
  pendingItemIds: string[];
  pendingType: 'reject' | 'ready' | null;
  onAccept: () => void;
  onBatch: (
    type: 'reject' | 'ready',
    ids: { itemIds: string[]; setComponentIds: string[]; partial?: { itemId: string; quantity: number }[] },
  ) => void;
}) {
  const waitSec = Math.floor((now - new Date(order.createdAt).getTime()) / 1000);
  const slow = waitSec > SLOW_AFTER && (tab === 'new' || tab === 'in_work');
  const badgeStatus = kitchenCardBadgeStatus(order, tab);
  const qrOrder = isQrOrder(order);
  const visibleOrderComment = kitchenOrderComment(order.comment, qrOrder);
  // Частичный отказ/ожидание решения — только если отказ есть среди позиций ЭТОЙ станции.
  const stationRejected = order.items.some((it) => it.status === 'rejected');
  const waitingDecision = order.requiresWaiterDecision && stationRejected;
  const canSelect = (tab === 'new' || tab === 'in_work') && !waitingDecision;

  // «С собой»: если все живые позиции навынос — бейдж на весь заказ, иначе помечаем точечно.
  const liveItems = order.items.filter((it) => it.status !== 'rejected' && it.status !== 'cancelled');
  const allTakeaway = liveItems.length > 0 && liveItems.every((it) => it.takeaway);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Сколько штук отказать у выбранной позиции (по умолчанию — всё количество).
  const [rejectQtys, setRejectQtys] = useState<Record<string, number>>({});
  // Свёрнутые сеты (по id позиции-сета): по умолчанию состав раскрыт.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapsed = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Карта статусов по id — и обычные позиции, и блюда внутри сетов.
  const { statusById, componentIds } = useMemo(() => {
    const statusById = new Map<string, OrderItemStatus>();
    const componentIds = new Set<string>();
    for (const it of order.items) {
      statusById.set(it.id, it.status);
      for (const sc of it.setComponents ?? []) {
        statusById.set(sc.id, sc.status);
        componentIds.add(sc.id);
      }
    }
    return { statusById, componentIds };
  }, [order.items]);

  // Позицию можно выбрать, если она ещё «живая» и по ней нет отложенного действия.
  const isSelectable = (status: OrderItemStatus, id: string) =>
    canSelect && !FINAL_ITEM_STATUSES.includes(status) && !pendingItemIds.includes(id);

  // Чистим выбор от позиций, которые стали невыбираемыми (обновление по сокету / отложенное действие).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(
        [...prev].filter((id) => {
          const status = statusById.get(id);
          return status !== undefined && isSelectable(status, id);
        }),
      );
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusById, pendingItemIds.join(','), canSelect]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Выбор/снятие всего сета сразу.
  const toggleSet = (ids: string[], allSelected: boolean) => {
    if (ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) (allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setRejectQtys({});
  };

  const runBatch = (type: 'reject' | 'ready') => {
    if (selected.size === 0) return;
    const itemIds: string[] = [];
    const setComponentIds: string[] = [];
    for (const id of selected) (componentIds.has(id) ? setComponentIds : itemIds).push(id);
    // Частичный отказ по количеству — только для обычных позиций и только при отказе.
    const partial: { itemId: string; quantity: number }[] = [];
    if (type === 'reject') {
      for (const id of itemIds) {
        const it = order.items.find((i) => i.id === id);
        if (!it) continue;
        const qty = rejectQtys[id] ?? it.quantity;
        if (qty > 0 && qty < it.quantity) partial.push({ itemId: id, quantity: qty });
      }
    }
    onBatch(type, { itemIds, setComponentIds, partial: partial.length > 0 ? partial : undefined });
    clearSelection();
  };

  // Все ещё «живые» позиции станции (для действий по всему заказу).
  const collectAllActive = () => {
    const itemIds: string[] = [];
    const setComponentIds: string[] = [];
    for (const it of order.items) {
      const setParts = it.setComponents ?? [];
      if (setParts.length > 0) {
        for (const sc of setParts) {
          if (isSelectable(sc.status, sc.id)) setComponentIds.push(sc.id);
        }
      } else if (isSelectable(it.status, it.id)) {
        itemIds.push(it.id);
      }
    }
    return { itemIds, setComponentIds };
  };

  /** Действие по всему заказу (отмена/готово целиком) — та же логика onBatch с undo. */
  const runWhole = (type: 'reject' | 'ready') => {
    const ids = collectAllActive();
    if (ids.itemIds.length === 0 && ids.setComponentIds.length === 0) return;
    onBatch(type, ids);
    clearSelection();
  };

  const selectionMode = selected.size > 0;

  /** Подпись блюда состава сета (замена: старое зачёркнуто → новое выделено). */
  const componentLabel = (sc: OrderSetComponent) => {
    const orig = sc.originalVariantNameSnapshot
      ? `${sc.originalNameSnapshot} ${sc.originalVariantNameSnapshot}`
      : sc.originalNameSnapshot;
    if (sc.action !== 'replaced') return <Text>{orig}</Text>;
    return (
      <Text>
        <Text style={styles.replacedOld}>{orig}</Text>
        <Text style={styles.replacedArrow}> {'>'} </Text>
        <Text style={styles.replacedNew}>{sc.finalNameSnapshot}</Text>
      </Text>
    );
  };

  // Единая строка позиции — и для обычных блюд, и для блюд внутри сета.
  const renderLine = (id: string, status: OrderItemStatus, content: React.ReactNode, isComponent = false) => {
    const selectable = isSelectable(status, id);
    const pendingItem = pendingItemIds.includes(id);
    const rejected = status === 'rejected' || (pendingItem && pendingType === 'reject');
    const isReady = status === 'ready' || status === 'served' || (pendingItem && pendingType === 'ready');
    // Заказ уже в работе, а позиция всё ещё «new» — добавили/заменили при редактировании.
    const isFresh = tab === 'in_work' && status === 'new' && !pendingItem;
    const checked = selected.has(id);

    return (
      <Pressable
        key={id}
        disabled={!selectable}
        onPress={() => toggle(id)}
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
            isFresh && styles.itemFresh,
          ]}
        >
          {content}
        </Text>
        {isFresh ? (
          <View style={styles.freshBadge}>
            <Text style={styles.freshBadgeText}>Новое</Text>
          </View>
        ) : null}
        {isReady ? <Text style={styles.itemFlagDone}>✓ Готово</Text> : null}
        {rejected ? <Text style={styles.itemFlagRej}>Отказ</Text> : null}
      </Pressable>
    );
  };

  const itemHeader = (it: Order['items'][number]) => {
    const itemComment = kitchenItemComment(it.comment, qrOrder);
    return (
      <Text>
        <Text style={styles.itemQty}>{it.quantity}× </Text>
        {orderItemDisplayName(it)}
        {itemComment ? <Text style={styles.itemCommentInline}> · {itemComment}</Text> : null}
        {it.takeaway && !allTakeaway ? <Text style={styles.takeawayInline}>  · с собой</Text> : null}
      </Text>
    );
  };

  return (
    <Card style={{ gap: 0 }}>
      {/* Шапка карточки */}
      <View style={styles.cardHead}>
        <View style={{ minWidth: 0, flex: 1 }}>
          <Text style={styles.orderNumber}>{displayOrderNumber(order.orderNumber)}</Text>
          <Text style={styles.tableText}>
            Стол {order.table.number}
            {hallSuffix(order.table)}
          </Text>
          {qrOrder ? (
            <View style={styles.qrBadge}>
              <Text style={styles.qrBadgeText}>{QR_ORDER_COMMENT}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.time}>
            {tab === 'new' || tab === 'in_work'
              ? timeHM(order.createdAt)
              : `${dateDM(order.createdAt)} ${timeHM(order.createdAt)}`}
          </Text>
          {tab === 'new' || tab === 'in_work' ? (
            <Text style={[styles.elapsed, slow && { color: colors.danger }]}>{elapsed(order.createdAt, now)}</Text>
          ) : (
            <View style={{ marginTop: 4 }}>
              <OrderBadge status={badgeStatus} />
            </View>
          )}
        </View>
      </View>

      {order.waiter ? <Text style={styles.waiter}>Официант: {order.waiter.name}</Text> : null}

      {allTakeaway ? (
        <View style={styles.badgeRow}>
          <View style={styles.takeawayBadge}>
            <PwaIcon name="bag" size={12} color={colors.primary} strokeWidth={2} />
            <Text style={styles.takeawayBadgeText}>Весь заказ с собой</Text>
          </View>
        </View>
      ) : null}

      {stationRejected ? (
        <View style={styles.badgeRow}>
          <View style={styles.partialBadge}>
            <Text style={styles.partialBadgeText}>Частичный отказ</Text>
          </View>
          {waitingDecision ? (
            <View style={styles.waitBadge}>
              <Text style={styles.waitBadgeText}>Ожидает решения официанта</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Позиции */}
      <View style={styles.items}>
        {order.items.map((it) => {
          const setParts = it.setComponents ?? [];
          const isSet = setParts.length > 0;

          if (!isSet) {
            // Степпер «сколько отказать» — у выбранной обычной позиции с количеством > 1.
            const showStepper =
              tab !== 'ready' && selected.has(it.id) && it.quantity > 1 && isSelectable(it.status, it.id);
            const rejectQty = rejectQtys[it.id] ?? it.quantity;
            return (
              <View key={it.id}>
                {renderLine(it.id, it.status, itemHeader(it))}
                {showStepper ? (
                  <View style={styles.stepperRow}>
                    <Text style={styles.stepperLabel}>Отказать:</Text>
                    <QtyStepper
                      value={rejectQty}
                      min={1}
                      max={it.quantity}
                      onChange={(v) => setRejectQtys((prev) => ({ ...prev, [it.id]: v }))}
                    />
                    <Text style={styles.stepperMuted}>из {it.quantity}</Text>
                  </View>
                ) : null}
              </View>
            );
          }

          // Сет: заголовок выбирается целиком (вся начинка), рядом — стрелка сворачивания.
          const setSelectableIds = setParts
            .filter((sc) => sc.action !== 'removed' && isSelectable(sc.status, sc.id))
            .map((sc) => sc.id);
          const setSelectable = canSelect && setSelectableIds.length > 0;
          const setAllSelected = setSelectableIds.length > 0 && setSelectableIds.every((id) => selected.has(id));
          const setSomeSelected = setSelectableIds.some((id) => selected.has(id));
          const isCollapsed = collapsed.has(it.id);
          return (
            <View key={it.id}>
              <View style={styles.setHeadRow}>
                <Pressable
                  disabled={!setSelectable}
                  onPress={() => toggleSet(setSelectableIds, setAllSelected)}
                  style={styles.setHeadPress}
                >
                  {setSelectable && selectionMode ? (
                    <View
                      style={[styles.checkbox, (setAllSelected || setSomeSelected) && styles.checkboxOn]}
                    >
                      {setAllSelected ? (
                        <Ionicons name="checkmark" size={13} color={colors.white} />
                      ) : setSomeSelected ? (
                        <Ionicons name="remove" size={13} color={colors.white} />
                      ) : null}
                    </View>
                  ) : null}
                  <Text style={styles.itemText}>{itemHeader(it)}</Text>
                </Pressable>
                <Pressable onPress={() => toggleCollapsed(it.id)} hitSlop={8} style={styles.collapseBtn}>
                  <View style={isCollapsed ? undefined : styles.chevronUp}>
                    <PwaIcon name="chevronDown" size={16} color={colors.textMuted} strokeWidth={2.5} />
                  </View>
                </Pressable>
              </View>
              {!isCollapsed ? (
                <View style={styles.setComponents}>
                  {setParts.map((sc) =>
                    sc.action === 'removed' ? (
                      <View key={sc.id} style={styles.removedRow}>
                        <Text style={styles.removedName}>{sc.originalNameSnapshot}</Text>
                        <Text style={styles.removedNote}>— убрали</Text>
                      </View>
                    ) : (
                      renderLine(sc.id, sc.status, componentLabel(sc), true)
                    ),
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {visibleOrderComment ? <Text style={styles.comment}>{visibleOrderComment}</Text> : null}

      {waitingDecision ? (
        <View style={styles.waitBox}>
          <Text style={styles.waitBoxText}>Ожидаем решение официанта по частичному отказу</Text>
        </View>
      ) : null}

      {/* Действия: выбраны блюда → по выбранным, иначе — по всему заказу. */}
      {canSelect && selectionMode ? (
        <>
          <View style={styles.actionsTop}>
            <Text style={styles.selectedText}>Выбрано: {selected.size}</Text>
            <View style={styles.actionsBtns}>
              <Button title="Отказать выбранные" variant="danger" size="md" onPress={() => runBatch('reject')} />
              {tab === 'in_work' ? (
                <Button title="Готово выбранные" size="md" onPress={() => runBatch('ready')} />
              ) : null}
            </View>
          </View>
          <Pressable onPress={clearSelection} style={styles.clearSelection} hitSlop={6}>
            <Text style={styles.clearSelectionText}>Снять выбор</Text>
          </Pressable>
        </>
      ) : canSelect ? (
        <View style={styles.actions}>
          <Button
            title="Отменить заказ"
            variant="danger"
            size="md"
            style={{ flex: 1 }}
            disabled={submitting}
            onPress={() => runWhole('reject')}
          />
          {tab === 'new' ? (
            <Button
              title="Принять в работу"
              size="md"
              style={{ flex: 1 }}
              loading={submitting}
              onPress={onAccept}
            />
          ) : (
            <Button
              title="Готово"
              size="md"
              style={{ flex: 1 }}
              disabled={submitting}
              onPress={() => runWhole('ready')}
            />
          )}
        </View>
      ) : null}
    </Card>
  );
}

/** Степпер выбора количества (например, сколько штук отказать). */
function QtyStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <View style={styles.stepper}>
      <Pressable
        disabled={value <= min}
        onPress={() => onChange(clamp(value - 1))}
        style={[styles.stepperBtn, value <= min && { opacity: 0.4 }]}
      >
        <PwaIcon name="minus" size={13} color={colors.textSecondary} />
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable
        disabled={value >= max}
        onPress={() => onChange(clamp(value + 1))}
        style={[styles.stepperBtn, value >= max && { opacity: 0.4 }]}
      >
        <PwaIcon name="plus" size={13} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  clock: { fontSize: fontSize.xxl, fontWeight: '500', color: colors.textPrimary, letterSpacing: -0.5 },
  logout: { fontSize: fontSize.sm, color: colors.textMuted },
  tabsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  voiceBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopListBtn: {
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  stopListText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.primary },
  list: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 96 },

  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  orderNumber: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  tableText: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  waiter: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  time: { fontSize: fontSize.sm, color: colors.textMuted },
  elapsed: { fontSize: fontSize.base, fontWeight: '600', color: colors.textSecondary },
  qrBadge: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  qrBadgeText: { fontSize: fontSize.xs, fontWeight: '500', color: colors.warning },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  takeawayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  takeawayBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  partialBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  partialBadgeText: { fontSize: fontSize.xs, fontWeight: '500', color: colors.danger },
  waitBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  waitBadgeText: { fontSize: fontSize.xs, fontWeight: '500', color: colors.warning },

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
  itemCommentInline: { color: colors.warning, fontWeight: '500' },
  takeawayInline: { color: colors.primary, fontWeight: '600', fontSize: fontSize.sm },
  itemComponent: { fontSize: fontSize.sm, color: colors.textSecondary },
  itemRejected: { color: colors.danger, textDecorationLine: 'line-through' },
  itemDone: { color: colors.textMuted },
  itemFresh: { color: colors.primary, fontWeight: '600' },
  freshBadge: {
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  freshBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  itemFlagDone: { fontSize: fontSize.sm, fontWeight: '700', color: colors.green600 },
  itemFlagRej: { fontSize: fontSize.sm, fontWeight: '700', color: colors.danger },
  setHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  setHeadPress: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  collapseBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  chevronUp: { transform: [{ rotate: '180deg' }] },
  setComponents: { paddingLeft: spacing.md, gap: 6, marginTop: 6 },
  removedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  removedName: { fontSize: fontSize.sm, fontWeight: '500', color: colors.danger, textDecorationLine: 'line-through' },
  removedNote: { fontSize: fontSize.xs, fontWeight: '500', color: colors.danger },
  replacedOld: { color: colors.textMuted, textDecorationLine: 'line-through' },
  replacedArrow: { fontWeight: '700', color: colors.textMuted },
  replacedNew: { fontWeight: '700', color: colors.primary },
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
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 6,
    paddingLeft: 32,
  },
  stepperLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  stepperMuted: { fontSize: fontSize.sm, color: colors.textMuted },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { minWidth: 24, textAlign: 'center', fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },

  comment: {
    marginTop: spacing.md,
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: fontSize.sm,
  },
  waitBox: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  waitBoxText: { fontSize: fontSize.sm, color: colors.warning },
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
  clearSelection: { alignSelf: 'flex-start', marginTop: spacing.sm },
  clearSelectionText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.primary },

  undoOuter: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
    alignItems: 'center',
  },
  undoCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  undoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  undoSub: { marginTop: 2, fontSize: fontSize.sm, color: colors.textMuted },
  undoSeconds: { fontWeight: '600', color: colors.danger },
  undoBtn: {
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  undoBtnText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '700' },
});
