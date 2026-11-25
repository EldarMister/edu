import { FinishShiftButton, ShiftSummarySheet } from '@/components/ShiftSummarySheet';
import { StaffShiftCard } from '@/components/StaffShiftGate';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { PrivacyPolicyLink } from '@/components/PrivacyPolicyLink';
import { ScrollView, View, SafeAreaView } from '@/components/themed';
import React from 'react';
import { BackHandler, Image, Linking, StyleSheet } from 'react-native';
import { Text } from '@/components/typography';

import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import Constants from 'expo-constants';
import { FastPressable } from '@/components/FastPressable';
import { Button, Card } from '@/components/ui';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import { ORDER_STATUS } from '@/theme/status';
import { beep } from '@/lib/sound';
import { apiError } from '@/lib/api';
import { TerminalOrderRefunds } from '@/features/refunds/OrderRefunds';
import { refundStatusLabel } from '@/features/refunds/refundRules';
import { CabinetOrderRow, WaiterOrderArchive } from '@/features/refunds/WaiterOrderArchive';
import { useAuth } from '@/store/auth';
import { useRadioVisibility } from '@/features/ptt/radioVisibility';
import { useLocale, type Locale } from '@/store/locale';
import { useNotifications } from '@/store/notifications';
import {
  useCurrentShift,
  useEndShift,
  useOrderDetails,
  useStartShift,
  useWaiterCabinet,
  type CabinetRecentOrder,
} from '@/services/api/waiter';
import { useShiftStartRequest } from '@/services/api/shift-request';
import { useRetryFiscal } from '@/services/api/admin';
import { WaiterVoiceSettingsSheet } from '@/screens/kitchen/KitchenVoiceSettingsSheet';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { disconnectSocket } from '@/services/socket';
import {
  playNotificationSoundTest,
  unregisterPushDevice,
  usePushNotifications,
  type PushStatus,
} from '@/services/push';
import {
  displayOrderNumber,
  hallSuffix,
  isSplitPayment,
  money,
  orderItemDisplayName,
  paymentMethodLabel,
  timeHM,
} from '@/utils/format';
import type { Order, OrderItemStatus, WaiterShift } from '@/types';

const ROLE_LABEL: Record<string, string> = {
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
  ADMIN: 'Администратор',
  OWNER: 'Владелец',
};
const PERIODS: { key: 'day' | 'week' | 'month'; label: string; title: string }[] = [
  { key: 'day', label: 'За день', title: 'Статистика за день' },
  { key: 'week', label: 'За 7 дней', title: 'Статистика за 7 дней' },
  { key: 'month', label: 'За месяц', title: 'Статистика за месяц' },
];
const ITEM_STATUS: Record<OrderItemStatus, string> = {
  new: 'Новое',
  accepted: 'Принято',
  cooking: 'Готовится',
  ready: 'Готово',
  rejected: 'Отказано',
  served: 'Подано',
  cancelled: 'Отменено',
};

export function ProfileScreen() {
  const focused = useIsFocused();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const isWaiter = useAuth((state) => state.workspace === 'terminal');
  const trackShift = isWaiter && user?.permissions?.workShiftRequired !== false;
  const shiftQuery = useCurrentShift(trackShift);
  const shiftRequest = useShiftStartRequest(trackShift && shiftQuery.isSuccess && !shiftQuery.data);
  const startShift = useStartShift();
  const endShift = useEndShift();
  const push = useNotifications((s) => s.push);
  const history = useNotifications((s) => s.history);
  const pushNotifications = usePushNotifications(!!user);
  const [checkingSound, setCheckingSound] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(true);
  const [showAllNotif, setShowAllNotif] = React.useState(false);
  const [cabinetOpen, setCabinetOpen] = React.useState(false);
  const [shiftSummary, setShiftSummary] = React.useState<WaiterShift | null>(null);
  const setRadioCabinetOpen = useRadioVisibility((s) => s.setCabinetOpen);

  // Пробрасываем открытость личного кабинета в стор, чтобы PttOverlay спрятал
  // кнопку рации, пока кабинет открыт (кабинет — внутренний экран, не маршрут).
  React.useEffect(() => {
    setRadioCabinetOpen(isWaiter && cabinetOpen && focused);
    return () => setRadioCabinetOpen(false);
  }, [isWaiter, cabinetOpen, focused, setRadioCabinetOpen]);
  useFocusEffect(React.useCallback(() => () => setCabinetOpen(false), []));
  React.useEffect(() => {
    if (!focused || !isWaiter || !cabinetOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setCabinetOpen(false); return true; });
    return () => subscription.remove();
  }, [focused, isWaiter, cabinetOpen]);
  const shift = trackShift ? shiftQuery.data : null;
  const shiftActive = shift?.status === 'active';
  const visibleNotifs = showAllNotif ? history : history.slice(0, 3);
  const showEnablePush =
    pushNotifications.status !== 'subscribed' &&
    pushNotifications.status !== 'unsupported' &&
    pushNotifications.status !== 'unavailable' &&
    pushNotifications.status !== 'checking';

  const onLogout = () => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
  };

  const onCheckSound = async () => {
    if (checkingSound) return;
    setCheckingSound(true);
    const [beepOk, notificationOk] = await Promise.all([
      beep('notify'),
      playNotificationSoundTest(),
    ]);
    const ok = beepOk || notificationOk;
    push({
      type: ok ? 'success' : 'error',
      message:
        beepOk && notificationOk
          ? 'Тестовый звук и уведомление отправлены'
          : beepOk
            ? 'Звук приложения воспроизведён, системное уведомление недоступно'
            : notificationOk
              ? 'Тестовое уведомление отправлено'
              : 'Не удалось воспроизвести звук уведомления',
      at: new Date().toISOString(),
    });
    setCheckingSound(false);
  };

  const onEndShift = async () => {
    try {
      const ended = await endShift.mutateAsync();
      setShiftSummary(ended);
    } catch (error) {
      push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
    }
  };

  const onStartShift = async () => {
    try {
      const shift = await startShift.mutateAsync();
      push({ message: shift ? 'Смена начата' : 'Запрос на начало смены отправлен', type: 'success', at: new Date().toISOString() });
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

  if (isWaiter && user && cabinetOpen) {
    return (
      <WaiterCabinetScreen
        userId={user.id}
        onBack={() => setCabinetOpen(false)}
        onLogout={onLogout}
      />
    );
  }

  return (
    <>
      <SafeAreaView style={styles.safe} edges={[]}>
        <SheetScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <Text style={styles.panelTitle} translate>Профиль</Text>

          {/* Карточка пользователя */}
          <Card style={styles.userCard} onPress={isWaiter ? () => setCabinetOpen(true) : undefined}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user?.name?.[0] ?? '?'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.userName} numberOfLines={1}>
                {user?.name}
              </Text>
              <Text style={styles.userMeta} numberOfLines={1}>
                {user?.positionName ?? ROLE_LABEL[user?.role ?? ''] ?? user?.role} · {user?.phone}
              </Text>
            </View>
            {isWaiter && <PwaIcon name="chevronRight" size={20} color={colors.textLight} />}
          </Card>

          {/* Смена (только официант) */}
          {trackShift ? (
          <Card style={styles.shiftCard}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle} translate>Смена</Text>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: shiftActive ? colors.successSoft : colors.background },
                  ]}
                >
                  <Text style={[styles.pillText, { color: shiftActive ? colors.success : colors.textMuted }]} translate>
                    {shiftActive ? 'Смена активна' : shiftRequest.data?.status === 'pending' ? 'Ожидается подтверждение' : 'Не начата'}
                  </Text>
                </View>
              </View>
              {shiftActive ? (
                <View style={styles.shiftRow}>
                  <Text style={styles.shiftLabel} translate>Начало</Text>
                  <Text style={styles.shiftValue}>{timeHM(shift!.startedAt)}</Text>
                </View>
              ) : null}
              {shiftActive && shift ? (
                <FinishShiftButton startedAt={shift.startedAt} loading={endShift.isPending}
                  style={{ marginTop: spacing.lg }} onPress={() => void onEndShift()} />
              ) : shiftRequest.data?.status !== 'pending' ? (
                <Button title="Начать смену" style={{ marginTop: spacing.lg }}
                  loading={startShift.isPending} disabled={shiftQuery.isLoading} onPress={() => void onStartShift()} />
              ) : null}
            </Card>
          ) : null}

          {!isWaiter && <StaffShiftCard />}

          {/* Уведомления */}
          <Card style={styles.notificationCard}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle} translate>Уведомления</Text>
              <FastPressable style={styles.notifToggle} onPress={() => setNotifOpen((v) => !v)}>
                <Text style={styles.viewAll} translate>{notifOpen ? 'Скрыть' : 'Показать'}</Text>
                <View style={notifOpen ? styles.chevronUp : undefined}>
                  <PwaIcon name="chevronDown" size={14} color={colors.primary} strokeWidth={2.2} />
                </View>
              </FastPressable>
            </View>

            {notifOpen ? (
              <>
                <View style={styles.notifBox}>
                  <View style={styles.notifTopRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.notifTitle} translate>Системные уведомления</Text>
                      <Text style={styles.notifSub}>{pushStatusText(pushNotifications.status)}</Text>
                    </View>
                    {showEnablePush ? (
                      <Button
                        title={pushNotifications.status === 'denied' ? 'Настройки' : 'Включить'}
                        size="md"
                        loading={pushNotifications.status === 'checking'}
                        style={styles.enablePushButton}
                        onPress={() => {
                          if (pushNotifications.status === 'denied') void Linking.openSettings().catch(() => {
                            push({ message: 'Откройте настройки уведомлений EDU POS на телефоне', type: 'info', at: new Date().toISOString() });
                          });
                          else void pushNotifications.enable();
                        }}
                      />
                    ) : null}
                  </View>
                  <Button
                    title="Проверить звук"
                    variant="secondary"
                    size="md"
                    loading={checkingSound}
                    style={{ marginTop: spacing.md }}
                    onPress={() => void onCheckSound()}
                  />
                </View>

                {history.length === 0 ? (
                  <Text style={styles.cabinetMuted} translate>Уведомлений пока нет</Text>
                ) : (
                  <View style={styles.notifHistory}>
                    {visibleNotifs.map((notification) => (
                      <View key={notification.id} style={styles.notifItem}>
                        <View style={styles.notifDot} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.notifMessage}>{notification.message}</Text>
                          <Text style={styles.notifTime}>{timeHM(notification.at)}</Text>
                        </View>
                      </View>
                    ))}
                    {history.length > 3 ? (
                      <FastPressable
                        style={styles.showAllNotifs}
                        onPress={() => setShowAllNotif((value) => !value)}
                      >
                        <Text style={styles.viewAll} translate>
                          {showAllNotif ? 'Скрыть лишние уведомления' : 'Показать все уведомления'}
                        </Text>
                        <View style={showAllNotif ? styles.chevronUp : undefined}>
                          <PwaIcon name="chevronDown" size={14} color={colors.primary} strokeWidth={2.2} />
                        </View>
                      </FastPressable>
                    ) : null}
                  </View>
                )}
              </>
            ) : null}
          </Card>

          <WorkspaceSwitcher />
          <PrivacyPolicyLink />
          <Button title="Выйти" variant="secondary" danger onPress={onLogout} />

          <Text style={styles.version}>v{Constants.expoConfig?.version ?? '0.1.1'}</Text>
        </SheetScrollView>
      </SafeAreaView>

      <ShiftSummarySheet
        shift={shiftSummary}
        visible={!!shiftSummary}
        onClose={() => setShiftSummary(null)}
      />
    </>
  );
}

function WaiterCabinetScreen({
  userId,
  onBack,
  onLogout,
}: {
  userId: string;
  onBack: () => void;
  onLogout: () => void;
}) {
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const [period, setPeriod] = React.useState<'day' | 'week' | 'month'>('week');
  const [periodOpen, setPeriodOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const cabinet = useWaiterCabinet(period);
  const detail = useOrderDetails(detailId);
  const periodMeta = PERIODS.find((item) => item.key === period) ?? PERIODS[1];
  const groups = groupCabinetOrders(cabinet.data?.recentOrders ?? []);

  return (
    <>
      <SafeAreaView style={styles.safe} edges={[]}>
        <SheetScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.cabinetHeaderRow}>
            <FastPressable onPress={onBack} hitSlop={12} style={styles.backButton}>
              <PwaIcon name="chevronLeft" size={24} color={colors.textSecondary} strokeWidth={2.2} />
            </FastPressable>
            <Text style={styles.cabinetTitle} translate>Личный кабинет</Text>
          </View>

          <Card style={styles.languageCard}>
            <Text style={styles.languageLabel} translate>Язык</Text>
            <LanguageSwitch locale={locale} onChange={setLocale} />
          </Card>
          <Button title="Настройки озвучки" variant="secondary" onPress={() => setVoiceOpen(true)} />
          <Card><ThemeSwitch /></Card>

          <Card style={styles.cabinetSection}>
            <View style={styles.cabinetSectionHead}>
              <Text style={styles.cabinetSectionTitle} translate>{periodMeta.title}</Text>
              <FastPressable style={styles.periodSelect} onPress={() => setPeriodOpen(true)}>
                <Text style={styles.periodSelectText} translate>{periodMeta.label}</Text>
                <PwaIcon name="chevronDown" size={16} color={colors.textLight} strokeWidth={2.2} />
              </FastPressable>
            </View>

            {cabinet.isLoading ? (
              <Text style={styles.cabinetMuted} translate>Загрузка статистики...</Text>
            ) : cabinet.isError ? (
              <Text style={styles.cabinetError} translate>Не удалось загрузить кабинет официанта</Text>
            ) : (
              <View style={styles.statRows}>
                <StatRow icon="check" tint="success" label="Завершено" value={String(cabinet.data?.stats.completed ?? 0)} />
                <StatRow icon="close" tint="warning" label="Отменено" value={String(cabinet.data?.stats.cancelled ?? 0)} />
                <StatRow icon="transfer" tint="primary" label="Выручка" value={money(cabinet.data?.stats.revenue ?? 0)} />
              </View>
            )}
          </Card>

          <Card style={styles.cabinetSection}>
            <View style={styles.recentHead}>
              <Text style={styles.cabinetSectionTitle} translate>Последние заказы</Text>
              <FastPressable accessibilityRole="button" onPress={() => setHistoryOpen(true)}>
                <Text style={styles.viewAll} translate>Смотреть все</Text>
              </FastPressable>
            </View>

            {cabinet.isLoading ? (
              <Text style={styles.cabinetMuted} translate>Загрузка заказов...</Text>
            ) : groups.length === 0 ? (
              <Text style={styles.cabinetMuted} translate>Заказов пока нет</Text>
            ) : (
              <View style={styles.orderGroups}>
                {groups.map((group) => (
                  <View key={group.key} style={styles.orderGroup}>
                    <Text style={styles.orderGroupLabel} translate>{group.label}</Text>
                    <View style={styles.cabinetOrdersList}>
                      {group.orders.map((order) => (
                        <CabinetOrderRow key={order.id} order={order} onPress={() => setDetailId(order.id)} />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Card>

          <WorkspaceSwitcher />
          <PrivacyPolicyLink />
          <Button title="Выйти" variant="secondary" danger onPress={onLogout} />
        </SheetScrollView>
      </SafeAreaView>

      <PeriodPickerSheet
        visible={periodOpen}
        value={period}
        onClose={() => setPeriodOpen(false)}
        onChange={(next) => {
          setPeriod(next);
          setPeriodOpen(false);
        }}
      />
      <WaiterOrderArchive
        visible={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={setDetailId}
      />
      <WaiterVoiceSettingsSheet visible={voiceOpen} onClose={() => setVoiceOpen(false)} userId={userId} />
      <OrderDetailsSheet
        visible={!!detailId}
        order={detail.data ?? null}
        loading={detail.isLoading || detail.isFetching}
        onClose={() => setDetailId(null)}
        onRetriedFiscal={() => void detail.refetch()}
      />
    </>
  );
}

function LanguageSwitch({ locale, onChange }: { locale: Locale; onChange: (locale: Locale) => void }) {
  const items: { key: Locale; label: string }[] = [
    { key: 'ky', label: 'Кыргызча' },
    { key: 'ru', label: 'Русский' },
  ];
  return (
    <View style={styles.languageSwitch}>
      {items.map((item) => {
        const active = locale === item.key;
        return (
          <FastPressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.languageButton, active && styles.languageButtonActive]}
          >
            <Text style={[styles.languageButtonText, active && styles.languageButtonTextActive]} translate>
              {item.label}
            </Text>
          </FastPressable>
        );
      })}
    </View>
  );
}

function StatRow({
  icon,
  tint,
  label,
  value,
}: {
  icon: 'check' | 'close' | 'transfer';
  tint: 'success' | 'warning' | 'primary';
  label: string;
  value: string;
}) {
  const color = tint === 'success' ? colors.success : tint === 'warning' ? colors.warning : colors.primary;
  return (
    <View style={styles.statRow}>
      <View style={styles.statLeft}>
        <View style={styles.statIcon}>
          <PwaIcon name={icon} size={15} color={color} strokeWidth={2.3} />
        </View>
        <Text style={styles.statRowLabel} translate>{label}</Text>
      </View>
      <Text style={[styles.statRowValue, { color: tint === 'primary' ? colors.primary : colors.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

function OrderDetailsSheet({
  visible,
  order,
  loading,
  onClose,
  onRetriedFiscal,
}: {
  visible: boolean;
  order: Order | null;
  loading: boolean;
  onClose: () => void;
  onRetriedFiscal: () => void;
}) {
  const showMixedBreakdown = order?.paymentMethod === 'mixed' && !isSplitPayment(order) && !!order.payments?.length;
  const refunded = Number(order?.refundedAmount ?? 0);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={order ? `Заказ ${displayOrderNumber(order.orderNumber)}` : 'Заказ'}
      maxHeight="88%"
    >
      {loading && !order ? (
        <Text style={styles.cabinetMuted} translate>Загрузка заказа...</Text>
      ) : !order ? (
        <Text style={styles.cabinetError} translate>Не удалось загрузить заказ</Text>
      ) : (
        <SheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.orderDetailsBody}>
          <View>
            <Text style={styles.detailSectionTitle} translate>Информация</Text>
            <View style={styles.detailInfoBox}>
              <View style={styles.detailInfoPair}>
                <DetailRow label="Статус" value={refundStatusLabel(order) ?? ORDER_STATUS[order.status]?.label ?? order.status} column />
                <View style={styles.detailInfoDivider} />
                <DetailRow label="Официант" value={order.waiter?.name ?? 'QR menu'} column />
              </View>
              <View style={styles.detailInfoPair}>
                <DetailRow label="Дата" value={`${orderDate(order.createdAt)} ${timeHM(order.createdAt)}`} column />
                <View style={styles.detailInfoDivider} />
                <DetailRow label="Стол" value={`Стол ${order.table.number}${hallSuffix(order.table)}`} column />
              </View>
              <View style={styles.detailInfoPair}>
                <DetailRow label="Сумма" value={money(order.finalAmount)} strong column />
                <View style={styles.detailInfoDivider} />
                <DetailRow label="Оплата" value={order.paymentMethod ? detailPaymentLabel(order) : '—'} column />
              </View>
              {showMixedBreakdown ? (
                <>
                  <DetailRow label="Наличными" value={money(mixedSumBy(order, 'cash'))} />
                  <DetailRow label="QR" value={money(mixedSumBy(order, 'qr'))} />
                </>
              ) : null}
            </View>
          </View>

          {isSplitPayment(order) && order.payments?.length ? (
            <View style={styles.detailNoteBox}>
              <Text style={styles.detailNoteTitle} translate>Платежи</Text>
              {order.payments.map((payment, index) => (
                <View key={`${payment.method}-${index}`} style={styles.detailPaymentRow}>
                  <Text style={styles.detailPaymentLabel} translate>Платеж {index + 1} — {paymentMethodLabel(payment.method)}</Text>
                  <Text style={styles.detailPaymentAmount}>{money(payment.amount)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {order.comment ? (
            <View style={styles.detailNoteBox}>
              <Text style={styles.detailNoteTitle} translate>Комментарий</Text>
              <Text style={styles.detailComment}>{order.comment}</Text>
            </View>
          ) : null}

          <View>
            <View style={styles.detailSectionHead}>
              <Text style={styles.detailSectionTitle} translate>Блюда</Text>
              <Text style={styles.detailItemsCount} translate>{order.items.length} поз.</Text>
            </View>
            <View style={styles.detailItemsBox}>
              {order.items.map((item) => (
                <View key={item.id} style={styles.detailItemRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.detailItemName}>
                      {item.quantity}× {orderItemDisplayName(item)}
                    </Text>
                    {item.refundedQuantity ? <Text style={styles.detailItemComment} translate>Возвращено · {item.refundedQuantity} / {item.quantity}</Text> : null}
                    {item.comment ? <Text style={styles.detailItemComment}>{item.comment}</Text> : null}
                    {item.rejectReason ? <Text style={styles.detailItemReject} translate>Отказ: {item.rejectReason}</Text> : null}
                  </View>
                  <View style={styles.detailItemRight}>
                    <Text style={styles.detailItemPrice}>{money(item.finalPrice)}</Text>
                    <Text style={styles.detailItemStatus}>{ITEM_STATUS[item.status]}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.detailTotals}>
            <DetailTotal label="Итого" value={money(order.totalAmount)} />
            {Number(order.discountAmount) > 0 ? <DetailTotal label="Скидка" value={money(order.discountAmount)} /> : null}
            {Number(order.serviceChargeAmount) > 0 ? <DetailTotal label="Обслуживание" value={money(order.serviceChargeAmount)} /> : null}
            <DetailTotal label={order.status === 'paid' ? 'Оплачено' : 'К оплате'} value={money(order.finalAmount)} strong />
            {refunded > 0 ? (
              <>
                <DetailTotal label="Возвращено" value={money(refunded)} />
                <DetailTotal label="Оплата после возврата" value={money(Number(order.finalAmount) - refunded)} />
              </>
            ) : null}
          </View>

          <TerminalOrderRefunds order={order} />
          <FiscalBlock order={order} onRetried={onRetriedFiscal} />
        </SheetScrollView>
      )}
    </BottomSheet>
  );
}

function FiscalBlock({ order, onRetried }: { order: Order; onRetried: () => void }) {
  const retry = useRetryFiscal();
  const push = useNotifications((s) => s.push);
  const hasReceipt = !!order.fiscalReceiptNumber;
  const hasError = !hasReceipt && !!order.fiscalError;
  if (!hasReceipt && !hasError) return null;

  const onRetry = async () => {
    try {
      const res = await retry.mutateAsync(order.id);
      if (res?.success) {
        push({ message: 'Фискальный чек пробит', type: 'success', at: new Date().toISOString() });
      } else {
        push({
          message: res?.error ?? 'ККМ вернул ошибку',
          type: 'error',
          at: new Date().toISOString(),
        });
      }
      onRetried();
    } catch (err) {
      push({ message: apiError(err), type: 'error', at: new Date().toISOString() });
    }
  };

  if (hasReceipt) {
    const qr = order.fiscalQrCode ?? '';
    const isImage = qr.startsWith('data:image');
    const canOpen = !!qr && !isImage;
    return (
      <View style={styles.fiscalBoxSuccess}>
        <View style={styles.fiscalTopRow}>
          <View style={styles.fiscalSuccessBadge}>
            <Text style={styles.fiscalSuccessBadgeText} translate>Фискальный чек</Text>
          </View>
          <Text style={styles.fiscalReceiptNumber}>№ {order.fiscalReceiptNumber}</Text>
        </View>
        {order.fiscalSign ? (
          <Text style={styles.fiscalMeta} translate>Фискальный признак: {order.fiscalSign}</Text>
        ) : null}
        {qr ? (
          isImage ? (
            <Image source={{ uri: qr }} style={styles.fiscalQrImage} resizeMode="contain" />
          ) : (
            <FastPressable
              disabled={!canOpen}
              onPress={() => void Linking.openURL(qr)}
              style={styles.fiscalLinkPress}
            >
              <Text style={styles.fiscalLink}>{qr}</Text>
            </FastPressable>
          )
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.fiscalBoxError}>
      <View style={styles.fiscalErrorTopRow}>
        <View style={styles.fiscalErrorBadge}>
          <Text style={styles.fiscalErrorBadgeText} translate>Ошибка ККМ</Text>
        </View>
        <FastPressable
          disabled={retry.isPending}
          onPress={() => void onRetry()}
          style={[styles.fiscalRetryButton, retry.isPending && styles.fiscalRetryButtonDisabled]}
        >
          <Text style={styles.fiscalRetryText} translate>{retry.isPending ? 'Повтор…' : 'Повторить'}</Text>
        </FastPressable>
      </View>
      <Text style={styles.fiscalErrorText}>{order.fiscalError}</Text>
    </View>
  );
}

function DetailRow({
  label,
  value,
  strong = false,
  column = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  column?: boolean;
}) {
  return (
    <View style={column ? styles.detailInfoCell : styles.detailInfoRow}>
      <Text style={[styles.detailInfoLabel, column && styles.detailInfoCellText]} translate>{label}</Text>
      <Text style={[styles.detailInfoValue, column && styles.detailInfoCellText, strong && styles.detailInfoValueStrong]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function DetailTotal({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.detailTotalRow}>
      <Text style={[styles.detailTotalLabel, strong && styles.detailTotalStrong]} translate>{label}</Text>
      <Text style={[styles.detailTotalValue, strong && styles.detailTotalStrong]}>{value}</Text>
    </View>
  );
}

function detailPaymentLabel(order: Order): string {
  if (isSplitPayment(order)) return 'Раздельная';
  if (order.paymentMethod === 'mixed' && order.payments && order.payments.length > 1) return 'Смешанная';
  return paymentMethodLabel(order.paymentMethod);
}

function mixedSumBy(order: { payments?: { method: string; amount: string }[] }, method: string): number {
  return (order.payments ?? [])
    .filter((payment) => payment.method === method)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
}

function PeriodPickerSheet({
  visible,
  value,
  onClose,
  onChange,
}: {
  visible: boolean;
  value: 'day' | 'week' | 'month';
  onClose: () => void;
  onChange: (period: 'day' | 'week' | 'month') => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Период" sheet bodyStyle={styles.periodSheetBody}>
      {PERIODS.map((item) => {
        const active = value === item.key;
        return (
          <FastPressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.periodOption, active && styles.periodOptionActive]}
          >
            <Text style={[styles.periodOptionText, active && styles.periodOptionTextActive]} translate>
              {item.label}
            </Text>
            {active ? <PwaIcon name="check" size={18} color={colors.primary} strokeWidth={2.5} /> : null}
          </FastPressable>
        );
      })}
    </BottomSheet>
  );
}

function groupCabinetOrders(orders: CabinetRecentOrder[]) {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayStart = startOfDay(new Date());
  const dayMs = 86_400_000;
  const buckets: Record<string, CabinetRecentOrder[]> = { today: [], yesterday: [], earlier: [] };
  for (const order of orders) {
    const diff = todayStart - startOfDay(new Date(order.createdAt));
    if (diff <= 0) buckets.today.push(order);
    else if (diff === dayMs) buckets.yesterday.push(order);
    else buckets.earlier.push(order);
  }
  return [
    { key: 'today', label: 'СЕГОДНЯ', orders: buckets.today },
    { key: 'yesterday', label: 'ВЧЕРА', orders: buckets.yesterday },
    { key: 'earlier', label: 'РАНЕЕ', orders: buckets.earlier },
  ].filter((group) => group.orders.length > 0);
}

function orderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

function pushStatusText(status: PushStatus) {
  switch (status) {
    case 'subscribed':
      return 'Включены. Уведомления доступны, даже если приложение свёрнуто.';
    case 'denied':
      return 'Запрещены в настройках телефона. Разрешите уведомления для EDU POS.';
    case 'unavailable':
      return 'Для уведомлений нужна установленная сборка EDU POS.';
    case 'unsupported':
      return 'Это устройство не поддерживает push-уведомления.';
    case 'checking':
      return 'Проверяем статус уведомлений...';
    case 'error':
      return 'Не удалось включить. Проверьте разрешения и настройки push.';
    default:
      return 'Нажмите "Включить", чтобы получать уведомления в фоне.';
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  container: { width: '100%', maxWidth: 800, alignSelf: 'center', padding: spacing.md, gap: spacing.lg },
  panelTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: 20 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: '600', color: colors.primary },
  userName: { fontSize: 17, fontWeight: '600', color: colors.textPrimary },
  userMeta: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },

  shiftCard: { gap: 0, padding: 20 },
  notificationCard: { gap: spacing.md, padding: 20 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  pillText: { fontSize: fontSize.sm, fontWeight: '500' },
  shiftRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg },
  shiftLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  shiftValue: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  cabinetHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 0 },
  backButton: { width: 36, height: 36, marginLeft: -4, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  cabinetTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary },
  languageCard: {
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
  },
  languageLabel: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  languageSwitch: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 2,
    backgroundColor: colors.white,
  },
  languageButton: { borderRadius: 6, paddingHorizontal: spacing.md, paddingVertical: 6 },
  languageButtonActive: { backgroundColor: colors.primary },
  languageButtonText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  languageButtonTextActive: { color: colors.white },
  cabinetSection: { gap: spacing.md, padding: 20 },
  cabinetSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  cabinetSectionTitle: { flex: 1, fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  periodSelect: {
    width: 144,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
  },
  periodSelectText: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '500' },
  statRows: { borderTopWidth: 1, borderTopColor: colors.border },
  statRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
  },
  statLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 },
  statIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  statRowLabel: { flex: 1, fontSize: fontSize.base, color: colors.textSecondary },
  statRowValue: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  orderGroups: { gap: spacing.md },
  orderGroup: { gap: 4 },
  orderGroupLabel: { fontSize: fontSize.xs, fontWeight: '500', color: colors.textLight, textTransform: 'uppercase' },



  cabinetOrdersList: { borderTopWidth: 1, borderTopColor: colors.border },







  orderDetailsBody: { gap: spacing.lg, paddingBottom: spacing.md },
  detailSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  detailSectionTitle: { marginBottom: spacing.sm, fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary },
  detailItemsCount: { fontSize: fontSize.xs, color: colors.textMuted },
  detailInfoBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  detailInfoPair: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  detailInfoCell: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailInfoCellText: { flex: 0, textAlign: 'left' },
  detailInfoDivider: { width: 1, backgroundColor: colors.border },
  detailInfoRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailInfoLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textMuted },
  detailInfoValue: { flex: 1.25, textAlign: 'right', fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  detailInfoValueStrong: { color: colors.primary },
  detailNoteBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background, padding: spacing.md },
  detailNoteTitle: { marginBottom: 6, fontSize: fontSize.xs, fontWeight: '800', color: colors.textMuted },
  detailComment: { fontSize: fontSize.sm, color: colors.textPrimary, lineHeight: 20 },
  detailPaymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 3 },
  detailPaymentLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  detailPaymentAmount: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  detailItemsBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  detailItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailItemName: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary, lineHeight: 19 },
  detailItemComment: { marginTop: 3, fontSize: fontSize.xs, color: colors.warning },
  detailItemReject: { marginTop: 3, fontSize: fontSize.xs, color: colors.danger },
  detailItemRight: { alignItems: 'flex-end', minWidth: 72 },
  detailItemPrice: { fontSize: fontSize.sm, fontWeight: '800', color: colors.textPrimary },
  detailItemStatus: { marginTop: 2, fontSize: fontSize.xs, color: colors.textMuted },
  detailTotals: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
  detailTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  detailTotalLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  detailTotalValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '700' },
  detailTotalStrong: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '800' },
  fiscalBoxSuccess: {
    borderWidth: 1,
    borderColor: 'rgba(22,163,74,0.30)',
    borderRadius: radius.sm,
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  fiscalTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fiscalSuccessBadge: {
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,163,74,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  fiscalSuccessBadgeText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.success },
  fiscalReceiptNumber: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textPrimary },
  fiscalMeta: { marginTop: 4, fontSize: fontSize.xs, color: colors.textMuted },
  fiscalQrImage: {
    width: 112,
    height: 112,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
  },
  fiscalLinkPress: { marginTop: spacing.sm },
  fiscalLink: { fontSize: fontSize.xs, color: colors.primary },
  fiscalBoxError: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.30)',
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  fiscalErrorTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  fiscalErrorBadge: {
    borderRadius: radius.pill,
    backgroundColor: 'rgba(239,68,68,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  fiscalErrorBadgeText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.danger },
  fiscalRetryButton: {
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.40)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  fiscalRetryButtonDisabled: { opacity: 0.5 },
  fiscalRetryText: { fontSize: fontSize.xs, fontWeight: '600', color: colors.danger },
  fiscalErrorText: { marginTop: 6, fontSize: fontSize.xs, color: colors.danger },
  periodSheetBody: { gap: 0, paddingTop: spacing.sm },
  periodOption: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  periodOptionActive: { backgroundColor: colors.primaryFaint },
  periodOptionText: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '600' },
  periodOptionTextActive: { color: colors.primary },

  recentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  viewAll: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  cabinetMuted: { fontSize: fontSize.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  cabinetError: { fontSize: fontSize.sm, color: colors.danger, textAlign: 'center', paddingVertical: spacing.md },

  notifBox: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  notifTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  notifTitle: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  notifSub: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 },
  notifToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  enablePushButton: { flexShrink: 0 },
  chevronUp: { transform: [{ rotate: '180deg' }] },
  notifHistory: { gap: 10 },
  notifItem: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  notifDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 7,
  },
  notifMessage: { fontSize: fontSize.sm, color: colors.textSecondary },
  notifTime: { marginTop: 2, fontSize: fontSize.xs, color: colors.textLight },
  showAllNotifs: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },

  version: { textAlign: 'center', fontSize: fontSize.xs, color: colors.textLight, paddingTop: 4 },
});
