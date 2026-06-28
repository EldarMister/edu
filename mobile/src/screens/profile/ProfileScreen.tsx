import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { Button, Card } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { PwaIcon } from '@/components/PwaIcon';
import { OrderBadge } from '@/components/StatusBadge';
import { colors, fontSize, radius, spacing } from '@/theme';
import { beep } from '@/lib/sound';
import { useAuth } from '@/store/auth';
import { useLocale, type Locale } from '@/store/locale';
import { useNotifications } from '@/store/notifications';
import { useCurrentShift, useEndShift, useWaiterCabinet, type CabinetRecentOrder } from '@/services/api/waiter';
import { disconnectSocket } from '@/services/socket';
import {
  playNotificationSoundTest,
  unregisterPushDevice,
  useWaiterPushNotifications,
  type PushStatus,
} from '@/services/push';
import { displayOrderNumber, money, timeHM } from '@/utils/format';
import type { WaiterShift } from '@/types';

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

export function ProfileScreen() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const isWaiter = user?.role === 'WAITER';
  const shiftQuery = useCurrentShift(isWaiter);
  const endShift = useEndShift();
  const push = useNotifications((s) => s.push);
  const history = useNotifications((s) => s.history);
  const pushNotifications = useWaiterPushNotifications(isWaiter);
  const [checkingSound, setCheckingSound] = React.useState(false);
  const [notifOpen, setNotifOpen] = React.useState(true);
  const [showAllNotif, setShowAllNotif] = React.useState(false);
  const [cabinetOpen, setCabinetOpen] = React.useState(false);
  const [shiftSummary, setShiftSummary] = React.useState<WaiterShift | null>(null);
  const shift = isWaiter ? shiftQuery.data : null;
  const shiftActive = shift?.status === 'active';
  const visibleNotifs = showAllNotif ? history : history.slice(0, 3);
  const showEnablePush =
    pushNotifications.status !== 'subscribed' &&
    pushNotifications.status !== 'unsupported' &&
    pushNotifications.status !== 'denied' &&
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
    } catch {
      push({ message: 'Не удалось завершить смену', type: 'error', at: new Date().toISOString() });
    }
  };

  if (isWaiter && cabinetOpen) {
    return (
      <WaiterCabinetScreen
        onBack={() => setCabinetOpen(false)}
        onLogout={onLogout}
      />
    );
  }

  return (
    <>
      <SafeAreaView style={styles.safe} edges={[]}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <Text style={styles.panelTitle}>Профиль</Text>

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
                {ROLE_LABEL[user?.role ?? ''] ?? user?.role} · {user?.phone}
              </Text>
            </View>
            <PwaIcon name="chevronRight" size={20} color={colors.textLight} />
          </Card>

          {/* Смена (только официант) */}
          {isWaiter ? (
            <Card style={{ gap: 0 }}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>Смена</Text>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: shiftActive ? colors.successSoft : colors.background },
                  ]}
                >
                  <Text style={[styles.pillText, { color: shiftActive ? colors.success : colors.textMuted }]}>
                    {shiftActive ? 'Смена активна' : 'Не начата'}
                  </Text>
                </View>
              </View>
              {shiftActive ? (
                <View style={styles.shiftRow}>
                  <Text style={styles.shiftLabel}>Начало</Text>
                  <Text style={styles.shiftValue}>{timeHM(shift!.startedAt)}</Text>
                </View>
              ) : null}
              {shiftActive ? (
                <Button
                  title="Закончить смену"
                  style={{ marginTop: spacing.lg }}
                  loading={endShift.isPending}
                  onPress={() => void onEndShift()}
                />
              ) : null}
            </Card>
          ) : null}

          {/* Уведомления */}
          <Card style={{ gap: spacing.md }}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Уведомления</Text>
              <Pressable style={styles.notifToggle} onPress={() => setNotifOpen((v) => !v)}>
                <Text style={styles.viewAll}>{notifOpen ? 'Скрыть' : 'Показать'}</Text>
                <View style={notifOpen ? styles.chevronUp : undefined}>
                  <PwaIcon name="chevronDown" size={14} color={colors.primary} strokeWidth={2.2} />
                </View>
              </Pressable>
            </View>

            {notifOpen ? (
              <>
                <View style={styles.notifBox}>
                  <View style={styles.notifTopRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.notifTitle}>Системные уведомления</Text>
                      <Text style={styles.notifSub}>{pushStatusText(pushNotifications.status)}</Text>
                    </View>
                    {showEnablePush ? (
                      <Button
                        title="Включить"
                        size="md"
                        loading={pushNotifications.status === 'checking'}
                        style={styles.enablePushButton}
                        onPress={() => void pushNotifications.enable()}
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
                  <Text style={styles.cabinetMuted}>Уведомлений пока нет</Text>
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
                      <Pressable
                        style={styles.showAllNotifs}
                        onPress={() => setShowAllNotif((value) => !value)}
                      >
                        <Text style={styles.viewAll}>
                          {showAllNotif ? 'Скрыть лишние уведомления' : 'Показать все уведомления'}
                        </Text>
                        <View style={showAllNotif ? styles.chevronUp : undefined}>
                          <PwaIcon name="chevronDown" size={14} color={colors.primary} strokeWidth={2.2} />
                        </View>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </>
            ) : null}
          </Card>

          <Button title="Выйти" variant="secondary" danger onPress={onLogout} />

          <Text style={styles.version}>v{Constants.expoConfig?.version ?? '0.1.1'}</Text>
        </ScrollView>
      </SafeAreaView>

      <ShiftSummarySheet
        shift={shiftSummary}
        visible={!!shiftSummary}
        onClose={() => setShiftSummary(null)}
      />
    </>
  );
}

function ShiftSummarySheet({
  shift,
  visible,
  onClose,
}: {
  shift: WaiterShift | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!shift) return null;
  const rows = [
    { label: 'Начало смены', value: dateTime(shift.startedAt) },
    { label: 'Конец смены', value: shift.endedAt ? dateTime(shift.endedAt) : '—' },
    { label: 'Отработано', value: shift.endedAt ? duration(shift.startedAt, shift.endedAt) : '—' },
    { label: 'Закрыто заказов', value: String(shift.stats?.ordersCount ?? 0) },
    { label: 'Сумма', value: money(shift.stats?.totalAmount ?? 0) },
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Смена завершена"
      sheet
      bodyStyle={styles.shiftSummaryBody}
      footer={<Button title="Готово" onPress={onClose} />}
    >
      <View style={styles.shiftSummaryHero}>
        <View style={styles.shiftSummaryIcon}>
          <PwaIcon name="check" size={34} color={colors.success} strokeWidth={2.6} />
        </View>
        <Text style={styles.shiftSummaryText}>Спасибо за работу!</Text>
      </View>

      <View style={styles.shiftSummaryRows}>
        {rows.map((row) => (
          <View key={row.label} style={styles.shiftSummaryRow}>
            <Text style={styles.shiftSummaryLabel}>{row.label}</Text>
            <Text style={styles.shiftSummaryValue} numberOfLines={1}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

function WaiterCabinetScreen({
  onBack,
  onLogout,
}: {
  onBack: () => void;
  onLogout: () => void;
}) {
  const navigation = useNavigation<any>();
  const locale = useLocale((s) => s.locale);
  const setLocale = useLocale((s) => s.setLocale);
  const [period, setPeriod] = React.useState<'day' | 'week' | 'month'>('week');
  const [periodOpen, setPeriodOpen] = React.useState(false);
  const cabinet = useWaiterCabinet(period);
  const periodMeta = PERIODS.find((item) => item.key === period) ?? PERIODS[1];
  const groups = groupCabinetOrders(cabinet.data?.recentOrders ?? []);

  const openOrders = () => {
    onBack();
    navigation.navigate('Orders');
  };
  const openOrder = (orderId: string) => {
    onBack();
    navigation.navigate('Orders', { screen: 'OrderDetail', params: { orderId } });
  };

  return (
    <>
      <SafeAreaView style={styles.safe} edges={[]}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.cabinetHeaderRow}>
            <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
              <PwaIcon name="chevronLeft" size={24} color={colors.textSecondary} strokeWidth={2.2} />
            </Pressable>
            <Text style={styles.cabinetTitle}>Личный кабинет</Text>
          </View>

          <Card style={styles.languageCard}>
            <Text style={styles.languageLabel}>Язык</Text>
            <LanguageSwitch locale={locale} onChange={setLocale} />
          </Card>

          <Card style={styles.cabinetSection}>
            <View style={styles.cabinetSectionHead}>
              <Text style={styles.cabinetSectionTitle}>{periodMeta.title}</Text>
              <Pressable style={styles.periodSelect} onPress={() => setPeriodOpen(true)}>
                <Text style={styles.periodSelectText}>{periodMeta.label}</Text>
                <PwaIcon name="chevronDown" size={16} color={colors.textLight} strokeWidth={2.2} />
              </Pressable>
            </View>

            {cabinet.isLoading ? (
              <Text style={styles.cabinetMuted}>Загрузка статистики...</Text>
            ) : cabinet.isError ? (
              <Text style={styles.cabinetError}>Не удалось загрузить кабинет официанта</Text>
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
              <Text style={styles.cabinetSectionTitle}>Последние заказы</Text>
              <Pressable onPress={openOrders}>
                <Text style={styles.viewAll}>Смотреть все</Text>
              </Pressable>
            </View>

            {cabinet.isLoading ? (
              <Text style={styles.cabinetMuted}>Загрузка заказов...</Text>
            ) : groups.length === 0 ? (
              <Text style={styles.cabinetMuted}>Заказов пока нет</Text>
            ) : (
              <View style={styles.orderGroups}>
                {groups.map((group) => (
                  <View key={group.key} style={styles.orderGroup}>
                    <Text style={styles.orderGroupLabel}>{group.label}</Text>
                    <View style={styles.cabinetOrdersList}>
                      {group.orders.map((order) => (
                        <CabinetOrderRow key={order.id} order={order} onPress={() => openOrder(order.id)} />
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Card>

          <Button title="Выйти" variant="secondary" danger onPress={onLogout} />
        </ScrollView>
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
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.languageButton, active && styles.languageButtonActive]}
          >
            <Text style={[styles.languageButtonText, active && styles.languageButtonTextActive]}>
              {item.label}
            </Text>
          </Pressable>
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
        <Text style={styles.statRowLabel}>{label}</Text>
      </View>
      <Text style={[styles.statRowValue, { color: tint === 'primary' ? colors.primary : colors.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

function CabinetOrderRow({ order, onPress }: { order: CabinetRecentOrder; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.cabinetOrderRow}>
      <Text style={styles.cabinetOrderNo} numberOfLines={1}>
        {displayOrderNumber(order.orderNumber)}
      </Text>
      <Text style={styles.cabinetOrderTable} numberOfLines={1}>
        Стол {order.tableNumber}
      </Text>
      <Text style={styles.cabinetOrderTime}>{timeHM(order.createdAt)}</Text>
      <Text style={styles.cabinetOrderAmount} numberOfLines={1}>
        {money(order.finalAmount)}
      </Text>
      <OrderBadge status={order.status} size="sm" />
      <PwaIcon name="chevronRight" size={14} color={colors.textLight} strokeWidth={2} />
    </Pressable>
  );
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
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.periodOption, active && styles.periodOptionActive]}
          >
            <Text style={[styles.periodOptionText, active && styles.periodOptionTextActive]}>
              {item.label}
            </Text>
            {active ? <PwaIcon name="check" size={18} color={colors.primary} strokeWidth={2.5} /> : null}
          </Pressable>
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

function dateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function duration(startIso: string, endIso: string): string {
  const ms = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m} мин`;
}

function pushStatusText(status: PushStatus) {
  switch (status) {
    case 'subscribed':
      return 'Включены. Официант получит уведомление, даже если приложение свёрнуто.';
    case 'denied':
      return 'Запрещены в настройках телефона. Разрешите уведомления для EDU POS.';
    case 'unavailable':
      return 'Push-уведомления ещё не настроены на сервере.';
    case 'unsupported':
      return 'Это устройство не поддерживает push-уведомления.';
    case 'checking':
      return 'Проверяем статус уведомлений...';
    case 'error':
      return 'Не удалось включить. Проверьте разрешения и настройки push.';
    default:
      return 'Нажмите "Включить", чтобы получать готовность заказа в фоне.';
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  container: { padding: spacing.md, gap: spacing.lg },
  panelTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
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

  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  pill: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  pillText: { fontSize: fontSize.sm, fontWeight: '500' },
  shiftRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg },
  shiftLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  shiftValue: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  shiftSummaryBody: { gap: spacing.lg },
  shiftSummaryHero: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  shiftSummaryIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successSoft,
  },
  shiftSummaryText: { marginTop: spacing.md, fontSize: fontSize.sm, color: colors.textMuted },
  shiftSummaryRows: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  shiftSummaryRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  shiftSummaryLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textMuted },
  shiftSummaryValue: { maxWidth: '54%', fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600' },

  cabinetHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  backButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  cabinetTitle: { fontSize: 24, fontWeight: '800', color: colors.textPrimary },
  languageCard: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
  },
  languageLabel: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  languageSwitch: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 2,
    backgroundColor: colors.white,
  },
  languageButton: { borderRadius: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  languageButtonActive: { backgroundColor: colors.primary },
  languageButtonText: { fontSize: fontSize.base, fontWeight: '600', color: colors.textSecondary },
  languageButtonTextActive: { color: colors.white },
  cabinetSection: { gap: spacing.md, padding: spacing.lg },
  cabinetSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  cabinetSectionTitle: { flex: 1, fontSize: fontSize.lg, fontWeight: '800', color: colors.textPrimary },
  periodSelect: {
    minWidth: 132,
    height: 46,
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
  periodSelectText: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '500' },
  statRows: { borderTopWidth: 1, borderTopColor: colors.border },
  statRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  statLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0, flex: 1 },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  statRowLabel: { flex: 1, fontSize: fontSize.base, color: colors.textSecondary },
  statRowValue: { fontSize: fontSize.base, fontWeight: '800', color: colors.textPrimary },
  orderGroups: { gap: spacing.lg },
  orderGroup: { gap: spacing.sm },
  orderGroupLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textLight },
  cabinetOrdersList: { borderTopWidth: 1, borderTopColor: colors.border },
  cabinetOrderRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 9,
  },
  cabinetOrderNo: { width: 52, fontSize: fontSize.base, fontWeight: '700', color: colors.textPrimary },
  cabinetOrderTable: { width: 58, fontSize: fontSize.sm, color: colors.textMuted },
  cabinetOrderTime: { width: 45, fontSize: fontSize.sm, color: colors.textLight },
  cabinetOrderAmount: {
    flex: 1,
    minWidth: 58,
    textAlign: 'right',
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.textPrimary,
  },
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
  enablePushButton: { width: 96 },
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
