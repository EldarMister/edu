import React from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { View } from '@/components/themed';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Text } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { Button } from '@/components/ui';
import { PwaIcon, type PwaIconName } from '@/components/PwaIcon';
import { ACTION_KEYS, ACTION_LABELS, SECTION_KEYS, SECTION_LABELS, resolvePermissions } from '@/lib/permissions';
import type { StaffMember } from '@/services/api/admin';
import { colors } from '@/theme';
import type { ActionKey, SectionKey } from '@/types';

type PermissionIcon = PwaIconName | 'download' | 'lock' | 'key' | 'card';
const sectionIcons: Partial<Record<SectionKey, PermissionIcon>> = { finance: 'card', statistics: 'adminStats', orders: 'adminOrders', tables: 'grid', menu: 'menu', warehouse: 'adminWarehouse', staff: 'adminStaff', journal: 'adminJournal', paymentReconciliation: 'adminReconcile', checks: 'card', settings: 'adminSettings' };
const actionIcons: Partial<Record<ActionKey, PermissionIcon>> = { acceptOrderPayments: 'card', printReceipts: 'adminOrders', requestReceiptPrints: 'adminOrders', createDeliveryOrders: 'adminOrders',
  editMenu: 'pencil', refundChecks: 'clock', exportReports: 'download', closeShift: 'lock', financeCashShifts: 'clock', manageStaff: 'adminStaff', editPermissions: 'key',
  warehouseReceive: 'adminWarehouse', warehouseTransfer: 'transfer', warehouseWriteoff: 'adminJournal', warehouseCount: 'grid',
  warehouseApprove: 'key', warehouseRecipes: 'menu', warehouseProduce: 'adminOrders', warehouseCosts: 'card',
  warehouseReports: 'adminStats', warehouseSettings: 'adminSettings',
};
const roleLabels = { OWNER: 'Владелец', ADMIN: 'Администратор', WAITER: 'Официант', KITCHEN: 'Кухня', BAR: 'Бар' };

export function EmployeePermissionsSheet({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const owner = member.role === 'OWNER';
  const twoColumns = useWindowDimensions().width >= 640;
  const permissions = resolvePermissions(member.role, member.permissions);
  return <BottomSheet visible onClose={onClose} title="Права сотрудника" panelStyle={{ width: '100%', maxWidth: 672, alignSelf: 'center' }}
    footer={<Button title="Закрыть" variant="secondary" onPress={onClose} />}>
    <SheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.member}><View style={styles.avatar}><Text style={styles.avatarText}>{member.name.trim().charAt(0).toUpperCase() || '—'}</Text></View><View style={{ flex: 1 }}><Text style={styles.name} numberOfLines={1}>{member.name}</Text><Text style={styles.muted} translate>Должность: {member.positionName ?? roleLabels[member.role]}</Text></View></View>
      {owner ? <Text style={[styles.muted, styles.ownerNote]} translate>Владелец всегда имеет полный доступ.</Text> : <Text style={[styles.muted, styles.ownerNote]} translate>Права сотрудника определяются его должностью.</Text>}
      {permissions.adminAccess ? <View><Text style={styles.heading} translate>Доступ к админ-панели</Text><View style={styles.grid}>{SECTION_KEYS.filter((key) => permissions.sections[key]).map((key) =>
        <PermissionItem key={key} label={SECTION_LABELS[key]} icon={sectionIcons[key] ?? 'grid'} twoColumns={twoColumns} readOnly={permissions.readOnlySections?.includes(key)} />)}</View></View> : null}
      {permissions.terminalAccess ? <Text style={styles.heading} translate>Разрешён вход в кассу</Text> : null}
      {member.role === 'KITCHEN' || member.role === 'BAR' ? <Text style={styles.heading} translate>Разрешён экран приготовления</Text> : null}
      <View><Text style={styles.heading} translate>Разрешённые действия</Text><View style={styles.grid}>{ACTION_KEYS.filter((key) => permissions.actions[key]).map((key) =>
        <PermissionItem key={key} label={ACTION_LABELS[key]} icon={actionIcons[key] ?? 'key'} twoColumns={twoColumns} />)}</View></View>
    </SheetScrollView>
  </BottomSheet>;
}

function PermissionItem({ label, icon, twoColumns, readOnly }: { label: string; icon: PermissionIcon; twoColumns: boolean; readOnly?: boolean }) {
  return <View style={[styles.permission, twoColumns && { width: '49%' }]}>
    <PermissionSymbol icon={icon} color={colors.textSecondary} />
    <Text style={styles.label} translate>{label}{readOnly ? ' · Просмотр' : ''}</Text>
  </View>;
}
function PermissionSymbol({ icon, color }: { icon: PermissionIcon; color: string }) {
  if (icon !== 'download' && icon !== 'lock' && icon !== 'key' && icon !== 'card') return <PwaIcon name={icon} size={18} color={color} />;
  return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {icon === 'download' ? <><Path d="M12 3v12m0 0l4-4m-4 4l-4-4" /><Path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></> : icon === 'lock' ? <><Rect x={5} y={11} width={14} height={10} rx={2} /><Path d="M8 11V7a4 4 0 0 1 8 0v4" /></> : icon === 'key' ? <><Circle cx={7.5} cy={15.5} r={3.5} /><Path d="M10 13l8-8m-2 0h3v3" /></> : <><Rect x={2} y={5} width={20} height={14} rx={2} /><Path d="M2 10h20" /></>}
  </Svg>;
}
const styles = StyleSheet.create({
  content: { gap: 20 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary }, muted: { color: colors.textMuted, fontSize: 14 }, ownerNote: { padding: 12, backgroundColor: colors.background, borderRadius: 8 },
  heading: { color: colors.textPrimary, fontWeight: '600', fontSize: 14, marginBottom: 8 }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  permission: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.white },
  label: { fontSize: 14, color: colors.textPrimary, flex: 1 },
});
