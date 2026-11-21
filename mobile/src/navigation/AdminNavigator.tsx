import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { ScrollView, View, SafeAreaView } from '@/components/themed';
import React from 'react';
import { AppState, BackHandler, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { sheetTiming } from '@/components/motion';
import Constants from 'expo-constants';
import { Text } from '@/components/typography';
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';

import { FastPressable } from '@/components/FastPressable';
import { PwaIcon, type PwaIconName } from '@/components/PwaIcon';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { colors, fontSize, radius, spacing, useThemedStyle } from '@/theme';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { disconnectSocket, useSocketEvent } from '@/services/socket';
import { isRemotePushRegistered, notificationDeduper, unregisterPushDevice } from '@/services/push';
import { beep } from '@/lib/sound';
import { announceAdministratorCall, announceReceiptRequest, type AdministratorVoiceCall } from '@/services/adminVoice';
import { isPttBackgroundRuntimeActive } from '@/features/ptt/backgroundFlag';
import { useRadioOverlayBlocker } from '@/features/ptt/radioVisibility';
import { CashShiftBanner } from '@/features/cash-shifts/CashShiftControls';
import { useNotifications } from '@/store/notifications';
import { ScreenTransition } from '@/components/ScreenTransition';
import { StatisticsScreen } from '@/screens/admin/StatisticsScreen';
import { OrdersScreen } from '@/screens/admin/OrdersScreen';
import { TablesScreen } from '@/screens/admin/TablesScreen';
import { MenuScreen } from '@/screens/admin/MenuScreen';
import { StaffScreen } from '@/screens/admin/StaffScreen';
import { PositionsPanel } from '@/screens/admin/PositionsPanel';
import { PrepStationsPage } from '@/screens/admin/PrepStationsPage';
import { AuditScreen } from '@/screens/admin/AuditScreen';
import { SettingsScreen, type SettingsNavigationGuard } from '@/screens/admin/SettingsScreen';
import { WarehouseScreen } from '@/screens/admin/WarehouseScreen';
import { TaxReportScreen } from '@/screens/admin/TaxReportScreen';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';
import { useFinanceAccess } from '@/features/finance/api';
import { FinanceScreen } from '@/screens/admin/FinanceScreen';
import { TaxesScreen } from '@/screens/admin/TaxesScreen';
import { ReceiptPrintsScreen } from '@/screens/admin/ReceiptPrintsScreen';
import { useWarehouseLocations, useWarehousePolicy } from '@/services/api/warehouse';
import type { ReceiptPrintRequest, SectionKey } from '@/types';
import type { RootStackParamList } from './types';
import {
  financeNavigation, menuNavigation, resolveAdminSection, settingsNavigation, staffNavigation, statisticsNavigation, warehouseNavigation, type FinanceView, type SettingsView, type AdminSection as Section, type MenuView,
  type StaffView, type StatisticsView, type WarehouseView, type WorkspaceEntry,
} from './adminWorkspaceNavigation';

type Group = WorkspaceEntry['section'];
const submenuLayout = LinearTransition.duration(180);

const SECTIONS: {
  key: Section;
  label: string;
  icon: PwaIconName;
  perm: SectionKey;
  adminOnly?: boolean;
}[] = [
  { key: 'stats', label: 'Статистика', icon: 'adminStats', perm: 'statistics' },
  { key: 'finance', label: 'Финансы', icon: 'adminReconcile', perm: 'finance' },
  { key: 'orders', label: 'Заказы', icon: 'adminOrders', perm: 'orders' },
  { key: 'receipts', label: 'Печать чека', icon: 'adminPrinter', perm: 'checks', adminOnly: true },
  { key: 'tables', label: 'Столы', icon: 'grid', perm: 'tables' },
  { key: 'menu', label: 'Меню', icon: 'menu', perm: 'menu' },
  { key: 'warehouse', label: 'Склад', icon: 'adminWarehouse', perm: 'warehouse' },
  { key: 'staff', label: 'Персонал', icon: 'adminStaff', perm: 'staff' },
  { key: 'audit', label: 'Журнал', icon: 'adminJournal', perm: 'journal' },
  { key: 'settings', label: 'Настройки', icon: 'adminSettings', perm: 'settings' },
];

/** Админ/владелец — порт PWA AdminApp (сайдбар → выезжающий drawer на мобиле). */
export function AdminNavigator() {
  const { width } = useWindowDimensions();
  const permanentMenu = width >= 1024;
  const route = useRoute<RouteProp<RootStackParamList, 'Admin'>>();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const qc = useQueryClient();
  const push = useNotifications((s) => s.push);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const { canAction, canSection, effectiveRole } = usePermissions();
  const isOwner = effectiveRole === 'OWNER';
  const isAdmin = effectiveRole === 'ADMIN' || isOwner;

  const financeAccess = useFinanceAccess(isAdmin);
  const canSeeFinance = canSection('finance') || financeAccess.data?.allowed || canAction('financeCashShifts');
  const financeEntries = React.useMemo(() => financeNavigation.filter(({ key }) => (
    key === 'cashShifts' ? canAction('financeCashShifts') || canSection('finance') || financeAccess.data?.canViewAll
      : key === 'transactions' ? canSection('finance') || financeAccess.data?.allowed
      : canSection('finance') || financeAccess.data?.canViewAll
  )), [canAction, canSection, financeAccess.data]);
  const sections = React.useMemo(
    () => SECTIONS.filter((s) => (!s.adminOnly || isAdmin) && (s.key === 'finance' ? canSeeFinance : canSection(s.perm))),
    [canSection, isAdmin, canSeeFinance],
  );
  const [section, setSection] = React.useState<Section>(isOwner ? 'stats' : 'orders');
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsedGroup, setCollapsedGroup] = React.useState<Group | null>(null);
  const [statisticsView, setStatisticsView] = React.useState<StatisticsView>('overview');
  const [staffView, setStaffView] = React.useState<StaffView>('employees');
  const [menuView, setMenuView] = React.useState<MenuView>('goods');
  const settingsGuard = React.useRef<SettingsNavigationGuard | null>(null);
  const [financeView, setFinanceView] = React.useState<FinanceView>('transactions');
  const [settingsView, setSettingsView] = React.useState<SettingsView>('general');
  const [warehouseView, setWarehouseView] = React.useState<WarehouseView>('balances');
  const warehouseAccess = canSection('warehouse');
  const locations = useWarehouseLocations(warehouseAccess);
  const policy = useWarehousePolicy(warehouseAccess);
  const menuEntries = React.useMemo(() => menuNavigation(warehouseAccess), [warehouseAccess]);
  const warehouseEntries = React.useMemo(() => warehouseAccess
    ? warehouseNavigation(canAction, locations.data?.locations.length ?? 0, policy.data) : [],
  [canAction, locations.data?.locations.length, policy.data, warehouseAccess]);
  const currentMenu = menuEntries.find((entry) => entry.key === menuView) ?? menuEntries[0];
  const currentWarehouse = warehouseEntries.find((entry) => entry.key === warehouseView) ?? warehouseEntries[0];
  const staffEntries = React.useMemo(() => canSection('staff') ? staffNavigation(isOwner) : [], [canSection, isOwner]);
  const currentStaff = staffEntries.find((entry) => entry.key === staffView) ?? staffEntries[0];
  const workspaces = React.useMemo(() => ({
    stats: statisticsNavigation,
    finance: financeEntries,
    settings: canSection('settings') ? settingsNavigation : [],
    menu: menuEntries,
    warehouse: warehouseEntries,
    staff: staffEntries,
  }), [canSection, financeEntries, menuEntries, warehouseEntries, staffEntries]);
  const view = section === 'stats' ? statisticsView : section === 'finance' ? financeView : section === 'settings' ? settingsView
    : section === 'warehouse' ? currentWarehouse?.key : section === 'staff' ? currentStaff?.key : currentMenu?.key;
  const activeWorkspace = workspaces[section as Group]?.find((entry) => entry.key === view);
  const currentFinanceView = financeEntries.find(({ key }) => key === financeView)?.key ?? financeEntries[0]?.key;

  const current = sections.find((s) => s.key === section) ?? sections[0];
  React.useEffect(() => {
    const requested = resolveAdminSection(route.params?.section, route.params?.view);
    if (!requested || (requested !== 'profile' && !sections.some((s) => s.key === requested))) return;
    setSection(requested);
    setCollapsedGroup(null);
    const entry = workspaces[requested as Group]?.find(({ key }) => key === route.params?.view);
    if (entry?.section === 'menu') setMenuView(entry.key);
    if (requested === 'staff') setStaffView(entry?.section === 'staff' ? entry.key : 'employees');
    if (entry?.section === 'warehouse') setWarehouseView(entry.key);
    if (entry?.section === 'settings') setSettingsView(entry.key);
    if (entry?.section === 'finance') setFinanceView(entry.key);
    if (requested === 'stats') setStatisticsView(entry?.section === 'stats' ? entry.key : 'overview');
  }, [route.params?.section, route.params?.view, route.params?.orderId, sections, workspaces]);

  const invalidateReceipts = () => { void qc.invalidateQueries({ queryKey: ['admin', 'receipt-prints'] }); };
  useSocketEvent<ReceiptPrintRequest>('receipt_print_request_created', (request) => {
    invalidateReceipts();
    if (AppState.currentState !== 'active' && (isRemotePushRegistered() || isPttBackgroundRuntimeActive())) return;
    const label = request.type === 'preliminary' ? 'счёта' : 'чека';
    const message = `Официант ${request.waiterName} отправил заявку на печать ${label}. Стол ${request.tableNumber}.`;
    if (notificationDeduper.claim({ notificationId: `receipt:${request.id}:created`, type: 'info', orderId: request.orderId }, message)) {
      push({ message, type: 'info', orderId: request.orderId, at: request.createdAt });
      void beep('notify');
    }
    announceReceiptRequest(request);
  }, [qc, push]);
  useSocketEvent('receipt_print_request_approved', invalidateReceipts, [qc]);
  useSocketEvent('receipt_print_request_printed', invalidateReceipts, [qc]);
  useSocketEvent('receipt_print_request_rejected', invalidateReceipts, [qc]);
  useSocketEvent<AdministratorVoiceCall>('administrator:called', (call) => {
    if (AppState.currentState !== 'active' && (isRemotePushRegistered() || isPttBackgroundRuntimeActive())) return;
    if (notificationDeduper.claim({ type: 'info', orderId: call.orderId }, call.message)) {
      push({ message: call.message, type: 'info', orderId: call.orderId, orderNumber: call.orderNumber, at: call.createdAt, durationMs: 12_000 });
      void beep('notify');
    }
    announceAdministratorCall(call);
  }, [push]);

  React.useEffect(() => {
    if (section !== 'profile' && !sections.some((s) => s.key === section)) {
      setSection(sections[0]?.key ?? 'profile');
    }
  }, [section, sections]);

  const guardNavigation = (next: () => void) => {
    if (settingsGuard.current) settingsGuard.current(next);
    else next();
  };

  const onLogout = () => guardNavigation(() => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
  });

  const go = (s: Section) => {
    const group = s as Group;
    const hasChildren = !!workspaces[group]?.length;
    if (group && hasChildren && s === section) {
      setCollapsedGroup((current) => current === group ? null : group);
      return;
    }
    guardNavigation(() => {
      navigation.setParams({ section: undefined, view: undefined, orderId: undefined });
      setSection(s);
      setCollapsedGroup(null);
      if (!hasChildren) setDrawerOpen(false);
    });
  };
  function goToWorkspace(entry: WorkspaceEntry) {
    const change = () => {
      navigation.setParams({ section: undefined, view: undefined, orderId: undefined });
      setSection(entry.section);
      if (entry.section === 'menu') setMenuView(entry.key);
      if (entry.section === 'staff') setStaffView(entry.key);
      if (entry.section === 'stats') setStatisticsView(entry.key);
      if (entry.section === 'warehouse') setWarehouseView(entry.key);
      if (entry.section === 'finance') setFinanceView(entry.key);
      if (entry.section === 'settings') setSettingsView(entry.key);
      setCollapsedGroup(null);
      setDrawerOpen(false);
    };
    if (entry.section === section && entry.key === view) setDrawerOpen(false);
    else guardNavigation(change);
  }
  const openDrawer = React.useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);
  const edgeSwipe = React.useMemo(() => Gesture.Pan().enabled(!drawerOpen && !permanentMenu).maxPointers(1)
    .activeOffsetX(16).failOffsetY([-16, 16])
    .onTouchesDown((event, manager) => {
      if ((event.allTouches[0]?.absoluteX ?? 999) > 24) manager.fail();
    })
    .onStart(() => { runOnJS(openDrawer)(); }), [drawerOpen, openDrawer, permanentMenu]);

  const hasSection = !!current && current.key === section;
  const orderId = route.params?.orderId;
  const staffTab = route.params?.view === 'waiter-report' ? 'waiter' : 'current';
  const sectionContent = React.useMemo(() => (
    section === 'profile' ? <ProfileScreen /> : !hasSection ? <Text style={{ padding: spacing.lg, color: colors.textMuted }} translate>Нет доступных разделов. Обратитесь к владельцу.</Text> : section === 'stats' ? (
      statisticsView === 'taxes' ? <TaxReportScreen /> : <StatisticsScreen view={statisticsView} />
    ) : section === 'orders' ? (
      <OrdersScreen initialOrderId={orderId} />
    ) : section === 'receipts' ? (
      <ReceiptPrintsScreen initialOrderId={orderId} />
    ) : section === 'tables' ? (
      <TablesScreen />
    ) : section === 'menu' ? (
      <MenuScreen view={currentMenu?.key ?? 'goods'} />
    ) : section === 'warehouse' ? (
      <WarehouseScreen view={currentWarehouse?.key ?? 'balances'} />
    ) : section === 'staff' ? (
      currentStaff?.key === 'positions' && isOwner ? (
        <ScrollView contentContainerStyle={styles.staffPage} keyboardShouldPersistTaps="handled">
          <PositionsPanel />
        </ScrollView>
      ) : currentStaff?.key === 'stations' ? <PrepStationsPage />
        : <StaffScreen key={staffTab} initialTab={staffTab} />
    ) : section === 'audit' ? (
      <AuditScreen />
    ) : section === 'finance' ? (
      currentFinanceView ? <FinanceScreen view={currentFinanceView} /> : null
    ) : section === 'settings' ? (
      settingsView === 'taxes' && canSection('settings') ? <TaxesScreen /> :
        <SettingsScreen key={settingsView} view={settingsView} navigationGuard={settingsGuard} />
    ) : null
  ), [currentMenu?.key, currentWarehouse?.key, currentStaff?.key, staffTab, isOwner, hasSection, orderId, section, statisticsView, currentFinanceView, settingsView, canSection]);

  return (
    <GestureDetector gesture={edgeSwipe}>
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <OfflineBanner />
      <View style={[styles.header, permanentMenu && { marginLeft: DRAWER_WIDTH }]}>
        <View style={styles.headerLeft}>
          <FastPressable onPress={() => setDrawerOpen(true)} hitSlop={8} style={[styles.burger, permanentMenu && { display: 'none' }]} accessibilityLabel="Открыть меню">
            <PwaIcon name="menu" size={22} color={colors.textSecondary} />
          </FastPressable>
          <Text style={styles.headerTitle} numberOfLines={2} translate>{section === 'profile' ? 'Личный кабинет' : activeWorkspace?.label ?? current?.label ?? ''}</Text>
        </View>
        <ConnectionStatus />
      </View>

      <ScreenTransition style={[styles.body, permanentMenu && { marginLeft: DRAWER_WIDTH }]} transitionKey={section}>
        {section === 'orders' && hasSection && <CashShiftBanner />}
        {sectionContent}
      </ScreenTransition>

      <AdminDrawer
        visible={drawerOpen || permanentMenu}
        permanent={permanentMenu}
        sections={sections}
        current={section}
        activeWorkspace={activeWorkspace}
        collapsedGroup={collapsedGroup}
        workspaces={workspaces}
        onSwitchWorkspace={guardNavigation}
        profileName={user?.name}
        onSelect={go}
        onSelectWorkspace={goToWorkspace}
        onClose={closeDrawer}
        onLogout={onLogout}
      />
    </SafeAreaView>
    </GestureDetector>
  );
}

const DRAWER_WIDTH = 208;
const DRAWER_TIMING = { duration: 160, easing: Easing.out(Easing.cubic) };

function AdminDrawer({
  visible,
  permanent = false,
  sections,
  current,
  activeWorkspace,
  collapsedGroup,
  workspaces,
  onSwitchWorkspace,
  profileName,
  onSelect,
  onSelectWorkspace,
  onClose,
  onLogout,
}: {
  visible: boolean;
  permanent?: boolean;
  sections: { key: Section; label: string; icon: PwaIconName }[];
  current: Section;
  activeWorkspace?: WorkspaceEntry;
  collapsedGroup: Group | null;
  workspaces: Record<Group, WorkspaceEntry[]>;
  onSwitchWorkspace: SettingsNavigationGuard;
  profileName?: string;
  onSelect: (s: Section) => void;
  onSelectWorkspace: (entry: WorkspaceEntry) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [render, setRender] = React.useState(visible);
  useRadioOverlayBlocker(!permanent && (visible || render));
  const offset = useSharedValue(permanent ? 0 : -DRAWER_WIDTH);
  const startX = useSharedValue(0);
  const activeDrag = useSharedValue(false);
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: permanent ? 0 : offset.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 + offset.value / DRAWER_WIDTH,
  }));
  const drawerGesture = React.useMemo(() => Gesture.Pan().enabled(visible && !permanent)
    .maxPointers(1).activeOffsetX(-10).failOffsetY([-10, 10])
    .onStart(event => {
      cancelAnimation(offset);
      startX.value = offset.value - event.absoluteX;
      activeDrag.value = true;
    })
    .onUpdate(event => {
      offset.value = Math.min(0, Math.max(-DRAWER_WIDTH, startX.value + event.absoluteX));
    })
    .onEnd((event, success) => {
      if (!success) return;
      activeDrag.value = false;
      if (offset.value < -DRAWER_WIDTH * 0.35 || (event.velocityX < -550 && event.translationX < -12)) {
        runOnJS(onClose)();
      } else {
        offset.value = withTiming(0, DRAWER_TIMING);
      }
    })
    .onFinalize(() => {
      if (!activeDrag.value) return;
      activeDrag.value = false;
      offset.value = withTiming(0, DRAWER_TIMING);
    }), [activeDrag, offset, onClose, permanent, startX, visible]);

  React.useEffect(() => {
    if (!visible || permanent) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [visible, onClose, permanent]);

  React.useLayoutEffect(() => {
    cancelAnimation(offset);
    if (permanent) {
      setRender(false);
      offset.value = 0;
    } else if (visible) {
      setRender(true);
      offset.value = withTiming(0, { duration: sheetTiming.enterMs, easing: sheetTiming.easing });
    } else {
      offset.value = withTiming(-DRAWER_WIDTH, DRAWER_TIMING, finished => {
        if (finished) runOnJS(setRender)(false);
      });
    }
  }, [offset, permanent, visible]);

  const drawerSurface = useThemedStyle(styles.drawer);
  if (!visible && !render) return null;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, permanent && { width: DRAWER_WIDTH, zIndex: 50 }]}>
      {!permanent && <Animated.View style={[styles.backdrop, backdropStyle]}>
        <FastPressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>}
      <GestureDetector gesture={drawerGesture}>
      <Animated.View style={[drawerSurface, drawerStyle]}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left']}>
          <View style={styles.drawerLogo}>
            <BrandLogo />
          </View>
          <ScrollView style={styles.drawerNav} contentContainerStyle={styles.drawerNavContent}>
            {sections.map((s) => {
              const active = s.key === current;
              const entries = workspaces[s.key as Group] ?? [];
              const expanded = !!entries.length && active && collapsedGroup !== s.key;
              const selected = active && !entries.length;
              return (
                <Animated.View key={s.key} layout={submenuLayout}>
                  <FastPressable
                    accessibilityRole="button"
                    accessibilityState={entries.length ? { expanded } : { selected }}
                    onPress={() => onSelect(s.key)}
                    style={[styles.navItem, selected && styles.navItemActive]}
                  >
                    <PwaIcon name={s.icon} size={18} color={selected ? colors.white : colors.textSecondary} />
                    <Text style={[styles.navLabel, selected && styles.navLabelActive]} translate>{s.label}</Text>
                  </FastPressable>
                  {expanded && <View style={styles.navChildren}>
                    {entries.map((entry) => {
                      const currentPage = activeWorkspace?.section === entry.section && activeWorkspace.key === entry.key;
                      return <FastPressable key={entry.key} accessibilityRole="button" accessibilityState={{ selected: currentPage }}
                        onPress={() => onSelectWorkspace(entry)}
                        style={[styles.navChild, currentPage && styles.navItemActive]}>
                        <Text style={[styles.navChildLabel, currentPage && styles.navChildLabelActive]} translate>{entry.label}</Text>
                      </FastPressable>;
                    })}
                  </View>}
                </Animated.View>
              );
            })}
          </ScrollView>
          <View style={styles.drawerFooter}>
            <FastPressable onPress={() => onSelect('profile')} accessibilityLabel="Личный кабинет" accessibilityRole="button"
              accessibilityState={{ selected: current === 'profile' }} style={styles.navItem}>
              <PwaIcon name="user" size={18} color={colors.textSecondary} />
              <Text style={styles.navLabel} numberOfLines={1}>{profileName ?? 'Профиль'}</Text>
            </FastPressable>
            <WorkspaceSwitcher beforeSwitch={onSwitchWorkspace} />
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
  staffPage: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
    width: DRAWER_WIDTH,
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
  navChildren: { gap: 2, marginTop: 6, marginBottom: 8 },
  navChild: { borderRadius: radius.sm, minHeight: 40, justifyContent: 'center', paddingLeft: 34, paddingRight: spacing.sm, paddingVertical: spacing.sm },
  navChildLabel: { fontSize: fontSize.sm, lineHeight: 21, color: colors.textSecondary },
  navChildLabelActive: { color: colors.white, fontWeight: '500' },
  navLabelActive: { color: colors.white },
  drawerFooter: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md },
});
