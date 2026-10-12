import React, { useState } from 'react';
import { ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/typography';
import { OrderStatusBadges } from '@/components/StatusBadge';
import { Select } from '@/components/Select';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { DateField } from '@/components/DateField';
import { colors, fontSize, radius, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { displayOrderNumber, hallSuffix, money, paymentCell, timeHM } from '@/utils/format';
import {
  useAdminOrdersInfinite,
  useCancelOrder,
  useOrdersSummary,
  useStaff,
  useUpdateOrderStatus,
  useAdminOrderDetails,
} from '@/services/api/admin';
import type { Order, OrderStatus } from '@/types';
import { OrderDetailsModal } from './OrderDetailsModal';
import { CancelOrderModal } from './CancelOrderModal';

const CANCELLABLE = new Set<OrderStatus>([
  'draft',
  'sent_to_kitchen',
  'accepted_by_kitchen',
  'cooking',
  'ready',
  'picked_up',
  'served',
  'waiting_payment',
  'partially_rejected',
]);

const STATUS_OPTIONS = [
  { value: 'all', label: 'Все статусы' },
  { value: 'paid', label: 'Оплачен' },
  { value: 'active', label: 'Не оплачен' },
  { value: 'cancelled', label: 'Отменён' },
];

const MANUAL_STATUS_OPTIONS: { value: OrderStatus; label: string }[] = [
  { value: 'sent_to_kitchen', label: 'Активный' },
  { value: 'accepted_by_kitchen', label: 'Принят кухней' },
  { value: 'cooking', label: 'Готовится' },
  { value: 'ready', label: 'Готов' },
  { value: 'picked_up', label: 'Забран' },
  { value: 'served', label: 'Подан гостям' },
  { value: 'waiting_payment', label: 'Ожидает оплаты' },
  { value: 'cancelled', label: 'Отменён' },
];

const PAYMENT_OPTIONS = [
  { value: '', label: 'Все способы оплаты' },
  { value: 'cash', label: 'Наличные' },
  { value: 'qr', label: 'QR' },
  { value: 'mixed', label: 'Смешанная' },
  { value: 'card', label: 'Карта' },
];

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Всё время' },
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'За неделю' },
  { value: 'month', label: 'За месяц' },
  { value: 'custom', label: 'Выбрать дату' },
];
const SORT_OPTIONS = [{ value: 'default', label: 'По умолчанию' }, { value: 'date_desc', label: 'Дата: новые → старые' }, { value: 'date_asc', label: 'Дата: старые → новые' }, { value: 'amount_desc', label: 'Сумма: больше → меньше' }, { value: 'amount_asc', label: 'Сумма: меньше → больше' }];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function periodRange(period: string): { dateFrom?: string; dateTo?: string } {
  const today = new Date();
  const minus = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  };
  switch (period) {
    case 'today':
      return { dateFrom: ymd(today), dateTo: ymd(today) };
    case 'week':
      return { dateFrom: ymd(minus(6)), dateTo: ymd(today) };
    case 'month':
      return { dateFrom: ymd(minus(29)), dateTo: ymd(today) };
    default:
      return {};
  }
}

/** Заказы (владелец/админ) — порт PWA OrdersPage. */
export function OrdersScreen({ initialOrderId }: { initialOrderId?: string } = {}) {
  const [tab, setTab] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [waiterId, setWaiterId] = useState('');
  const [period, setPeriod] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('default');
  const [customDate, setCustomDate] = useState('');
  const [calendarRequest, setCalendarRequest] = useState(0);

  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [detailsOrder, setDetailsOrder] = useState<Order | null>(null);
  const [detailId, setDetailId] = useState<string | null>(initialOrderId ?? null);
  React.useEffect(() => { if (initialOrderId) setDetailId(initialOrderId); }, [initialOrderId]);
  const details = useAdminOrderDetails(detailId ?? detailsOrder?.id ?? null);
  const [statusTarget, setStatusTarget] = useState<Order | null>(null);
  const [manualStatus, setManualStatus] = useState<OrderStatus>('served');
  const [manualReason, setManualReason] = useState('');

  const push = useNotifications((s) => s.push);
  const cancelOrder = useCancelOrder();
  const updateStatus = useUpdateOrderStatus();

  const waiters = useStaff('WAITER', '');
  const waiterOptions = [
    { value: '', label: 'Все официанты' },
    ...(waiters.data ?? []).map((w) => ({ value: w.id, label: w.name })),
  ];

  const filters = { search, paymentMethod, waiterId, ...(period === 'custom' ? customDate ? { dateFrom: customDate, dateTo: customDate } : {} : periodRange(period)) };
  const ordersQ = useAdminOrdersInfinite({ tab, ...filters, sort: sort.startsWith('date') ? 'date' : sort.startsWith('amount') ? 'amount' : 'default', sortDirection: sort.endsWith('_asc') ? 'asc' : 'desc' });
  const summaryQ = useOrdersSummary(filters);
  const items = ordersQ.data?.pages.flatMap((p) => p.items) ?? [];
  const ordersError = ordersQ.isError ? apiError(ordersQ.error) : null;
  const s = summaryQ.data;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = ordersQ;

  const confirmCancel = async (reason: string) => {
    if (!cancelTarget) return;
    try {
      await cancelOrder.mutateAsync({ orderId: cancelTarget.id, reason });
      push({ message: 'Заказ отменён', type: 'success', at: new Date().toISOString() });
      setCancelTarget(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

  const openStatusEditor = (order: Order) => {
    setStatusTarget(order);
    setManualStatus(order.status === 'paid' || order.status === 'rejected' ? 'waiting_payment' : order.status);
    setManualReason('');
  };

  const confirmStatusChange = async () => {
    if (!statusTarget) return;
    try {
      await updateStatus.mutateAsync({
        orderId: statusTarget.id,
        status: manualStatus,
        reason: manualReason.trim() || undefined,
      });
      push({ message: 'Статус заказа изменён', type: 'success', at: new Date().toISOString() });
      setStatusTarget(null);
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 400) {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }
  };

  return (
    <>
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.pageContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {/* Inline-сводка под заголовком */}
        <View style={styles.summary}>
          <Sum label="Всего заказов" value={s ? String(s.total) : '—'} />
          <Sep />
          <Sum label="Оплачено" value={s ? String(s.paid) : '—'} />
          <Sep />
          <Sum label="Не оплачено" value={s ? String(s.unpaid) : '—'} />
          <Sep />
          <Sum label="Отменено" value={s ? String(s.cancelled) : '—'} />
          <Sep />
          <Sum label="Выручка" value={s ? money(s.revenue) : '—'} />
        </View>

        {/* Фильтры */}
        <View style={styles.filters}>
          <Select style={styles.filterControl} value={tab} onChange={setTab} options={STATUS_OPTIONS} title="Статус" />
          <Select style={styles.filterControl} value={paymentMethod} onChange={setPaymentMethod} options={PAYMENT_OPTIONS} title="Способ оплаты" />
          <Select style={styles.filterControl} value={waiterId} onChange={setWaiterId} options={waiterOptions} title="Официант" />
          <Select style={styles.filterControl} value={period} onChange={(next) => { setPeriod(next); if (next === 'custom') setCalendarRequest(request => request + 1); }} options={PERIOD_OPTIONS} title="Период" />
          {period === 'custom' ? <DateField key={calendarRequest} accessibilityLabel="Дата заказов" value={customDate} onChangeText={setCustomDate} openOnMount /> : null}
          <Select style={styles.filterControl} value={sort} onChange={setSort} options={SORT_OPTIONS} title="Сортировка" />
          <View style={styles.searchWrap}><PwaIcon name="search" size={21} color="#64799E" /><TextInput
            style={styles.search}
            placeholder="Поиск по заказам"
            placeholderTextColor={colors.textLight}
            value={search}
            onChangeText={setSearch}
          /></View>
        </View>

        {/* Таблица заказов */}
        <View style={styles.tableCard}>
          {ordersQ.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : ordersError ? (
            <View style={styles.center}>
              <Text style={styles.errTitle} translate>Не удалось загрузить заказы</Text>
              <Text style={styles.errSub}>{ordersError}</Text>
            </View>
          ) : items.length === 0 ? (
            <Text style={styles.empty} translate>Заказы не найдены</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ width: TABLE_WIDTH }}
            >
              <View style={{ width: TABLE_WIDTH }}>
                <View style={styles.thead}>
                  <Text style={[styles.th, { width: COL.num }]} translate>№ заказа</Text>
                  <Text style={[styles.th, { width: COL.date }]} translate>Дата и время</Text>
                  <Text style={[styles.th, { width: COL.table }]} translate>Стол</Text>
                  <Text style={[styles.th, { width: COL.waiter }]} translate>Официант</Text>
                  <Text style={[styles.th, styles.thRight, { width: COL.amount }]} translate>Сумма</Text>
                  <Text style={[styles.th, { width: COL.status }]} translate>Статус заказа</Text>
                  <Text style={[styles.th, { width: COL.pay }]} translate>Способ оплаты</Text>
                  <Text style={[styles.th, styles.thCenter, { width: COL.act }]} translate>Действия</Text>
                </View>
                {items.map((ord) => (
                  <OrderTableRow
                    key={ord.id}
                    order={ord}
                    onOpen={() => { setDetailsOrder(ord); setDetailId(ord.id); }}
                    onEdit={() => openStatusEditor(ord)}
                    onCancel={CANCELLABLE.has(ord.status) ? () => setCancelTarget(ord) : undefined}
                  />
                ))}
              </View>
            </ScrollView>
          )}
          {items.length > 0 && isFetchingNextPage ? (
            <View style={styles.footerLoad}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : items.length > 0 && !hasNextPage ? (
            <Text style={styles.footerDone} translate>Все заказы загружены</Text>
          ) : null}
        </View>
      </ScrollView>

      <CancelOrderModal
        visible={!!cancelTarget}
        orderLabel={
          cancelTarget
            ? `Заказ ${displayOrderNumber(cancelTarget.orderNumber)} · Стол ${cancelTarget.table.number}${hallSuffix(
                cancelTarget.table,
              )} · ${money(cancelTarget.finalAmount)}`
            : ''
        }
        submitting={cancelOrder.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
      <StatusEditorModal
        order={statusTarget}
        value={manualStatus}
        reason={manualReason}
        submitting={updateStatus.isPending}
        onValueChange={setManualStatus}
        onReasonChange={setManualReason}
        onClose={() => setStatusTarget(null)}
        onConfirm={confirmStatusChange}
      />
      <OrderDetailsModal order={details.data ?? detailsOrder} onOrderChange={setDetailsOrder} allowItemCancellation onClose={() => { setDetailsOrder(null); setDetailId(null); }} />
    </>
  );
}

const COL = { num: 90, date: 157, table: 112, waiter: 123, amount: 101, status: 213, pay: 235, act: 89 } as const;
const TABLE_WIDTH = COL.num + COL.date + COL.table + COL.waiter + COL.amount + COL.status + COL.pay + COL.act;

function OrderTableRow({
  order,
  onOpen,
  onEdit,
  onCancel,
}: {
  order: Order;
  onOpen: () => void;
  onEdit: () => void;
  onCancel?: () => void;
}) {
  return (
    <FastPressable onPress={onOpen} style={styles.tr}>
      <Text style={[styles.td, styles.tdStrong, { width: COL.num }]} numberOfLines={1}>
        {displayOrderNumber(order.orderNumber)}
      </Text>
      <Text style={[styles.td, styles.tdSecondary, { width: COL.date }]} numberOfLines={1}>
        {new Date(order.createdAt).toLocaleDateString('ru-RU')} {timeHM(order.createdAt)}
      </Text>
      <Text style={[styles.td, styles.tdSecondary, { width: COL.table }]} numberOfLines={1} translate>
        {order.source === 'delivery' ? '—' : `Стол ${order.table.number}${hallSuffix(order.table)}`}
      </Text>
      <Text style={[styles.td, styles.tdSecondary, { width: COL.waiter }]} numberOfLines={1} translate>
        {order.source === 'delivery' ? 'Доставка' : order.waiter?.name ?? 'QR menu'}
      </Text>
      <Text style={[styles.td, styles.tdStrong, styles.tdRight, { width: COL.amount }]} numberOfLines={1}>
        {money(order.finalAmount)}
      </Text>
      <View style={[styles.tdCell, { width: COL.status }]}>
        <OrderStatusBadges order={order} size="sm" align="start" />
      </View>
      <Text style={[styles.td, styles.tdSecondary, { width: COL.pay }]} numberOfLines={1}>
        {paymentCell(order)}
      </Text>
      <View style={[styles.tdCell, styles.tdActions, { width: COL.act }]}>
        <FastPressable onPress={onEdit} hitSlop={6} style={styles.actionBtn}>
          <PwaIcon name="pencil" size={16} color={colors.textMuted} />
        </FastPressable>
        {onCancel ? (
          <FastPressable onPress={onCancel} hitSlop={6} style={styles.actionBtn}>
            <PwaIcon name="close" size={16} color={colors.danger} />
          </FastPressable>
        ) : null}
      </View>
    </FastPressable>
  );
}

function StatusEditorModal({
  order,
  value,
  reason,
  submitting,
  onValueChange,
  onReasonChange,
  onClose,
  onConfirm,
}: {
  order: Order | null;
  value: OrderStatus;
  reason: string;
  submitting: boolean;
  onValueChange: (v: OrderStatus) => void;
  onReasonChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!order) return null;
  return (
    <BottomSheet
      visible={!!order}
      onClose={onClose}
      title="Изменить статус заказа"
      footer={
        <View style={styles.footer}>
          <Button title="Отмена" variant="secondary" size="lg" style={{ flex: 1 }} onPress={onClose} disabled={submitting} />
          <Button
            title="Сохранить"
            size="lg"
            style={{ flex: 1 }}
            loading={submitting}
            disabled={order.status === value}
            onPress={onConfirm}
          />
        </View>
      }
    >
      <Text style={styles.editorSub} translate>
        {displayOrderNumber(order.orderNumber)} · Стол {order.table.number}
        {hallSuffix(order.table)}
      </Text>
      <View style={{ gap: spacing.md, marginTop: spacing.md }}>
        <Select value={value} onChange={(v) => onValueChange(v as OrderStatus)} options={MANUAL_STATUS_OPTIONS} title="Статус" />
        <TextInput
          style={styles.textarea}
          placeholder="Причина изменения"
          placeholderTextColor={colors.textLight}
          value={reason}
          onChangeText={onReasonChange}
          maxLength={240}
          multiline
        />
        {order.status === 'cancelled' && value !== 'cancelled' ? (
          <Text style={styles.restoreNote} translate>Отменённые позиции будут восстановлены в выбранный статус.</Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function Sum({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.sumText} translate>
      {label}: <Text style={styles.sumValue}>{value}</Text>
    </Text>
  );
}
function Sep() {
  return null;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F8FD' },
  pageContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 12, paddingHorizontal: 19, borderWidth: 1, borderColor: '#E8EEF7', borderRadius: 15, backgroundColor: colors.white },
  sumText: { fontSize: 15, color: '#536686' },
  sumValue: { fontWeight: '600', color: '#162445' },
  sumSep: { fontSize: fontSize.sm, color: colors.textLight },
  filters: { gap: 10, marginBottom: 5 },
  filterControl: { height: 46, borderColor: '#DCE5F2', borderRadius: 11 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, height: 46, borderWidth: 1, borderColor: '#DCE5F2', borderRadius: 11, backgroundColor: colors.white },
  search: {
    flex: 1,
    height: 44,
    padding: 0,
    fontSize: 14,
    color: '#1F3156',
  },

  center: { paddingVertical: 60, alignItems: 'center', gap: 4 },
  errTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.danger },
  errSub: { fontSize: fontSize.sm, color: colors.textMuted },
  empty: { paddingVertical: 60, textAlign: 'center', color: colors.textMuted },
  footerLoad: { paddingVertical: spacing.md, alignItems: 'center' },
  footerDone: { paddingVertical: spacing.md, textAlign: 'center', fontSize: fontSize.xs, color: colors.textLight },

  // Таблица заказов (как в PWA: карточка со скроллом по горизонтали).
  tableCard: {
    borderWidth: 1,
    borderColor: '#E4EBF5',
    borderRadius: 16,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  thead: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: '#F8FAFD',
    minHeight: 46,
  },
  th: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    fontWeight: '600',
    color: '#657691',
  },
  thRight: { textAlign: 'right' },
  thCenter: { textAlign: 'center' },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  td: { paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, lineHeight: 19 },
  tdStrong: { fontWeight: '600', color: '#1A294A' },
  tdSecondary: { color: '#506383' },
  tdRight: { textAlign: 'right' },
  tdCell: { paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center' },
  tdActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4 },
  actionBtn: { width: 29, height: 29, borderRadius: 8, borderWidth: 1, borderColor: '#E4EAF4', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },

  footer: { flexDirection: 'row', gap: spacing.sm },
  editorSub: { fontSize: fontSize.sm, color: colors.textMuted },
  textarea: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  restoreNote: {
    backgroundColor: colors.primarySoft,
    color: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: fontSize.xs,
  },
});
