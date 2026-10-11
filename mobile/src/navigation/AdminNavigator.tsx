import React from 'react';
import { Animated, AppState, BackHandler, Easing, ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Constants from 'expo-constants';
import { Text } from '@/components/typography';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon, type PwaIconName } from '@/components/PwaIcon';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { disconnectSocket, useSocketEvent } from '@/services/socket';
import { isRemotePushRegistered, notificationDeduper, unregisterPushDevice } from '@/services/push';
import { beep } from '@/lib/sound';
import { waiterVoice } from '@/services/waiterVoice';
import { useNotifications } from '@/store/notifications';
import { ScreenTransition } from '@/components/ScreenTransition';
import { StatisticsScreen } from '@/screens/admin/StatisticsScreen';
import { OrdersScreen } from '@/screens/admin/OrdersScreen';
import { TablesScreen } from '@/screens/admin/TablesScreen';
import { MenuScreen } from '@/screens/admin/MenuScreen';
import { StaffScreen } from '@/screens/admin/StaffScreen';
import { AuditScreen } from '@/screens/admin/AuditScreen';
import { SettingsScreen } from '@/screens/admin/SettingsScreen';
import { WarehouseScreen } from '@/screens/admin/WarehouseScreen';
import { ReconciliationScreen } from '@/screens/admin/ReconciliationScreen';
import { ReceiptPrintsScreen } from '@/screens/admin/ReceiptPrintsScreen';
import type { ReceiptPrintRequest, SectionKey } from '@/types';
import type { RootStackParamList } from './types';

type Section =
  | 'stats'
  | 'orders'
  | 'receipts'
  | 'tables'
  | 'menu'
  | 'warehouse'
  | 'staff'
  | 'audit'
  | 'reconcile'
  | 'settings';

const SECTIONS: {
  key: Section;
  label: string;
  icon: PwaIconName;
  perm: SectionKey;
  adminOnly?: boolean;
}[] = [
  { key: 'stats', label: 'Статистика', icon: 'adminStats', perm: 'statistics' },
  { key: 'orders', label: 'Заказы', icon: 'adminOrders', perm: 'orders' },
  { key: 'receipts', label: 'Печать чека', icon: 'adminPrinter', perm: 'checks', adminOnly: true },
  { key: 'tables', label: 'Столы', icon: 'grid', perm: 'tables' },
  { key: 'menu', label: 'Меню', icon: 'menu', perm: 'menu' },
  { key: 'warehouse', label: 'Склад', icon: 'adminWarehouse', perm: 'warehouse' },
  { key: 'staff', label: 'Персонал', icon: 'adminStaff', perm: 'staff' },
  { key: 'audit', label: 'Журнал', icon: 'adminJournal', perm: 'journal' },
  { key: 'reconcile', label: 'Сверка оплат', icon: 'adminReconcile', perm: 'paymentReconciliation' },
  { key: 'settings', label: 'Настройки', icon: 'adminSettings', perm: 'settings' },
];

/** Админ/владелец — порт PWA AdminApp (сайдбар → выезжающий drawer на мобиле). */
export function AdminNavigator() {
  const route = useRoute<RouteProp<RootStackParamList, 'Admin'>>();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { canSection } = usePermissions();
  const isOwner = user?.role === 'OWNER';
  const isAdmin = user?.role === 'ADMIN';

  const sections = React.useMemo(
    () => SECTIONS.filter((s) => (!s.adminOnly || isAdmin) && canSection(s.perm)),
    [canSection, isAdmin],
  );
  const [section, setSection] = React.useState<Section>(isOwner ? 'stats' : 'orders');
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const current = sections.find((s) => s.key === section) ?? sections[0];
  React.useEffect(() => {
    const requested = route.params?.section;
    if (requested && sections.some((s) => s.key === requested)) setSection(requested);
  }, [route.params?.section, route.params?.orderId, sections]);

  const invalidateReceipts = () => { void qc.invalidateQueries({ queryKey: ['admin', 'receipt-prints'] }); };
  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_created', (request) => {
    invalidateReceipts();
    if (AppState.currentState !== 'active' && isRemotePushRegistered()) return;
    const label = request.type === 'preliminary' ? 'счёта' : 'чека';
    const message = `Официант ${request.waiterName} отправил заявку на печать ${label}. Стол ${request.tableNumber}.`;
    if (!notificationDeduper.claim({ notificationId: `receipt:${request.id}:created`, type: 'info', orderId: request.orderId }, message)) return;
    push({ message, type: 'info', orderId: request.orderId, at: request.createdAt });
    void beep('notify');
    waiterVoice.enqueue(request.voice?.text ?? message);
  }, [qc, push]);
  useSocketEvent('receipt_print_request_approved', invalidateReceipts, [qc]);
  useSocketEvent('receipt_print_request_printed', invalidateReceipts, [qc]);
  useSocketEvent('receipt_print_request_rejected', invalidateReceipts, [qc]);
  useSocketEvent<{ message: string; orderId?: string; orderNumber?: string; createdAt: string; voice?: { text?: string } }>('administrator:called', (call) => {
    if (AppState.currentState !== 'active' && isRemotePushRegistered()) return;
    if (!notificationDeduper.claim({ type: 'info', orderId: call.orderId }, call.message)) return;
    push({ message: call.message, type: 'info', orderId: call.orderId, orderNumber: call.orderNumber, at: call.createdAt, durationMs: 12_000 });
    void beep('notify');
    waiterVoice.enqueue(call.voice?.text);
  }, [push]);

  React.useEffect(() => {
    if (sections.length > 0 && !sections.some((s) => s.key === section)) {
      setSection(sections[0].key);
    }
  }, [section, sections]);

  const onLogout = () => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
  };

  const go = (s: Section) => {
    navigation.setParams({ section: undefined, orderId: undefined });
    setSection(s);
    setDrawerOpen(false);
  };
  const preview = React.useCallback((s: Section) => {
    navigation.setParams({ section: undefined, orderId: undefined });
    setSection(s);
  }, [navigation]);
  const openDrawer = React.useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);
  const edgeSwipe = React.useMemo(() => Gesture.Pan().enabled(!drawerOpen).maxPointers(1)
    .activeOffsetX(72).failOffsetY([-48, 48])
    .onTouchesDown((event, manager) => {
      if ((event.allTouches[0]?.absoluteX ?? 999) > 68) manager.fail();
    })
    .onStart(() => { runOnJS(openDrawer)(); }), [drawerOpen, openDrawer]);

  return (
    <GestureDetector gesture={edgeSwipe}>
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <OfflineBanner />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <FastPressable onPress={() => setDrawerOpen(true)} hitSlop={8} style={styles.burger} accessibilityLabel="Открыть меню">
            <PwaIcon name="menu" size={22} color={colors.textSecondary} />
          </FastPressable>
          <Text style={styles.headerTitle} translate>{current?.label ?? ''}</Text>
        </View>
        <ConnectionStatus />
      </View>

      <ScreenTransition style={styles.body} transitionKey={section}>
        {!current ? <Text style={{ padding: spacing.lg, color: colors.textMuted }} translate>Нет доступных разделов. Обратитесь к владельцу.</Text> : section === 'stats' ? (
          <StatisticsScreen />
        ) : section === 'orders' ? (
          <OrdersScreen initialOrderId={route.params?.orderId} />
        ) : section === 'receipts' ? (
          <ReceiptPrintsScreen initialOrderId={route.params?.orderId} />
        ) : section === 'tables' ? (
          <TablesScreen />
        ) : section === 'menu' ? (
          <MenuScreen />
        ) : section === 'warehouse' ? (
          <WarehouseScreen />
        ) : section === 'staff' ? (
          <StaffScreen />
        ) : section === 'audit' ? (
          <AuditScreen />
        ) : section === 'reconcile' ? (
          <ReconciliationScreen />
        ) : section === 'settings' ? (
          <SettingsScreen />
        ) : null}
      </ScreenTransition>

      <AdminDrawer
        visible={drawerOpen}
        sections={sections}
        current={section}
        onSelect={go}
        onPreview={preview}
        onClose={closeDrawer}
        onLogout={onLogout}
        onOpenWorkspace={(target) => { setDrawerOpen(false); navigation.navigate(target); }}
      />
    </SafeAreaView>
    </GestureDetector>
  );
}

function AdminDrawer({
  visible,
  sections,
  current,
  onSelect,
  onPreview,
  onClose,
  onLogout,
  onOpenWorkspace,
}: {
  visible: boolean;
  sections: { key: Section; label: string; icon: PwaIconName }[];
  current: Section;
  onSelect: (s: Section) => void;
  onPreview: (s: Section) => void;
  onClose: () => void;
  onLogout: () => void;
  onOpenWorkspace: (target: 'Kitchen' | 'Bar' | 'PublicHome') => void;
}) {
  const [render, setRender] = React.useState(visible);
  const progress = React.useRef(new Animated.Value(0)).current;
  const initialIndex = React.useRef(0);
  const drawerState = React.useRef({ sections, current, onPreview });
  drawerState.current = { sections, current, onPreview };
  const closeGesture = React.useMemo(() => Gesture.Pan().activeOffsetX(-70).failOffsetY([-48, 48])
    .onStart(() => runOnJS(onClose)()), [onClose]);
  const selectGesture = React.useMemo(() => Gesture.Pan().activeOffsetY([-44, 44]).failOffsetX([-48, 48]).runOnJS(true)
    .onBegin(() => { initialIndex.current = Math.max(0, drawerState.current.sections.findIndex(s => s.key === drawerState.current.current)); })
    .onUpdate(event => {
      const state = drawerState.current;
      const index = Math.max(0, Math.min(state.sections.length - 1, initialIndex.current + Math.trunc(event.translationY / 44)));
      const next = state.sections[index];
      if (next && next.key !== state.current) state.onPreview(next.key);
    }), []);
  const drawerGesture = React.useMemo(() => Gesture.Race(closeGesture, selectGesture), [closeGesture, selectGesture]);

  React.useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [visible, onClose]);

  React.useEffect(() => {
    progress.stopAnimation();
    if (visible) {
      setRender(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setRender(false));
    }
  }, [progress, visible]);

  if (!render) return null;

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-208, 0] });
  const opacity = progress;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <FastPressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <GestureDetector gesture={drawerGesture}>
      <Animated.View style={[styles.drawer, { transform: [{ translateX }] }]}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left']}>
          <View style={styles.drawerLogo}>
            <BrandLogo />
          </View>
          <View style={[styles.drawerNav, styles.drawerNavContent]}>
            {sections.map((s) => {
              const active = s.key === current;
              return (
                <FastPressable
                  key={s.key}
                  onPress={() => onSelect(s.key)}
                  style={[styles.navItem, active && styles.navItemActive]}
                >
                  <PwaIcon name={s.icon} size={18} color={active ? colors.white : colors.textSecondary} />
                  <Text style={[styles.navLabel, active && styles.navLabelActive]} translate>{s.label}</Text>
                </FastPressable>
              );
            })}
          </View>
          <View style={styles.drawerFooter}>
            <FastPressable onPress={onLogout} style={styles.navItem}>
              <PwaIcon name="logout" size={18} color={colors.textSecondary} />
              <Text style={styles.navLabel} translate>Выйти</Text>
            </FastPressable>
            <Text style={{ fontSize: 11, lineHeight: 16, textAlign: 'center', color: colors.textLight, marginTop: 8 }}>v{Constants.expoConfig?.version ?? '0.2.1'}</Text>
          </View>
        </SafeAreaView>
      </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 64,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0, flex: 1 },
  burger: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  headerTitle: { fontSize: fontSize.xl, fontWeight: '600', color: colors.textPrimary },
  body: { flex: 1 },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 208,
    backgroundColor: colors.white,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  drawerLogo: { height: 64, justifyContent: 'center', paddingHorizontal: 20 },
  drawerNav: { flex: 1 },
  drawerNavContent: { paddingHorizontal: spacing.md, gap: 4, paddingVertical: spacing.sm },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  navItemActive: { backgroundColor: colors.primary },
  navLabel: { fontSize: fontSize.base, fontWeight: '500', color: colors.textSecondary },
  navLabelActive: { color: colors.white },
  drawerFooter: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md },
});
