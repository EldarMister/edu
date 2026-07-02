import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon, type PwaIconName } from '@/components/PwaIcon';
import { ConnectionStatus, OfflineBanner } from '@/components/ConnectionStatus';
import { BrandLogo } from '@/components/BrandLogo';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useAuth } from '@/store/auth';
import { disconnectSocket } from '@/services/socket';
import { unregisterPushDevice } from '@/services/push';
import { StatisticsScreen } from '@/screens/admin/StatisticsScreen';
import { OrdersScreen } from '@/screens/admin/OrdersScreen';
import { AdminPlaceholderScreen } from '@/screens/admin/AdminPlaceholderScreen';

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
  ownerOnly?: boolean;
  adminOnly?: boolean;
}[] = [
  { key: 'stats', label: 'Статистика', icon: 'chart', ownerOnly: true },
  { key: 'orders', label: 'Заказы', icon: 'list' },
  { key: 'receipts', label: 'Печать чека', icon: 'clock', adminOnly: true },
  { key: 'tables', label: 'Столы', icon: 'grid' },
  { key: 'menu', label: 'Меню', icon: 'menu' },
  { key: 'warehouse', label: 'Склад', icon: 'bag' },
  { key: 'staff', label: 'Персонал', icon: 'user' },
  { key: 'audit', label: 'Журнал', icon: 'eye', ownerOnly: true },
  { key: 'reconcile', label: 'Сверка оплат', icon: 'transfer', ownerOnly: true },
  { key: 'settings', label: 'Настройки', icon: 'info', ownerOnly: true },
];

/** Админ/владелец — порт PWA AdminApp (сайдбар → выезжающий drawer на мобиле). */
export function AdminNavigator() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const isOwner = user?.role === 'OWNER';
  const isAdmin = user?.role === 'ADMIN';

  const sections = React.useMemo(
    () => SECTIONS.filter((s) => (!s.ownerOnly || isOwner) && (!s.adminOnly || isAdmin)),
    [isOwner, isAdmin],
  );
  const [section, setSection] = React.useState<Section>(isOwner ? 'stats' : 'orders');
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const current = sections.find((s) => s.key === section) ?? sections[0];

  const onLogout = () => {
    void unregisterPushDevice();
    disconnectSocket();
    logout();
  };

  const go = (s: Section) => {
    setSection(s);
    setDrawerOpen(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <OfflineBanner />
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <FastPressable onPress={() => setDrawerOpen(true)} hitSlop={8} style={styles.burger}>
            <PwaIcon name="menu" size={22} color={colors.textSecondary} />
          </FastPressable>
          <Text style={styles.headerTitle}>{current?.label ?? ''}</Text>
        </View>
        <ConnectionStatus />
      </View>

      <View style={styles.body}>
        {section === 'stats' && isOwner ? (
          <StatisticsScreen />
        ) : section === 'orders' ? (
          <OrdersScreen />
        ) : (
          <AdminPlaceholderScreen title={current?.label ?? ''} />
        )}
      </View>

      <AdminDrawer
        visible={drawerOpen}
        sections={sections}
        current={section}
        onSelect={go}
        onClose={() => setDrawerOpen(false)}
        onLogout={onLogout}
      />
    </SafeAreaView>
  );
}

function AdminDrawer({
  visible,
  sections,
  current,
  onSelect,
  onClose,
  onLogout,
}: {
  visible: boolean;
  sections: { key: Section; label: string; icon: PwaIconName }[];
  current: Section;
  onSelect: (s: Section) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [render, setRender] = React.useState(visible);
  const progress = React.useRef(new Animated.Value(0)).current;

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

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-288, 0] });
  const opacity = progress;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.backdrop, { opacity }]}>
        <FastPressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.drawer, { transform: [{ translateX }] }]}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom', 'left']}>
          <View style={styles.drawerLogo}>
            <BrandLogo />
          </View>
          <View style={styles.drawerNav}>
            {sections.map((s) => {
              const active = s.key === current;
              return (
                <FastPressable
                  key={s.key}
                  onPress={() => onSelect(s.key)}
                  style={[styles.navItem, active && styles.navItemActive]}
                >
                  <PwaIcon name={s.icon} size={18} color={active ? colors.white : colors.textSecondary} />
                  <Text style={[styles.navLabel, active && styles.navLabelActive]}>{s.label}</Text>
                </FastPressable>
              );
            })}
          </View>
          <View style={styles.drawerFooter}>
            <FastPressable onPress={onLogout} style={styles.navItem}>
              <PwaIcon name="transfer" size={18} color={colors.textSecondary} />
              <Text style={styles.navLabel}>Выйти</Text>
            </FastPressable>
          </View>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
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
    width: 272,
    backgroundColor: colors.white,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  drawerLogo: { height: 64, justifyContent: 'center', paddingHorizontal: spacing.lg },
  drawerNav: { flex: 1, paddingHorizontal: spacing.md, gap: 4 },
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
