import React, { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Text } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { Button } from '@/components/ui';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon, type PwaIconName } from '@/components/PwaIcon';
import { ACTION_KEYS, SECTION_KEYS, resolvePermissions } from '@/lib/permissions';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { useUpdatePermissions, type StaffMember } from '@/services/api/admin';
import { colors } from '@/theme';
import type { ActionKey, SectionKey } from '@/types';

const sectionLabels: Record<SectionKey, string> = { statistics: 'Статистика', orders: 'Заказы', tables: 'Столы', menu: 'Меню', warehouse: 'Склад', staff: 'Персонал', journal: 'Журнал', paymentReconciliation: 'Сверка оплат', checks: 'Чеки / Оплата', settings: 'Настройки' };
const actionLabels: Record<ActionKey, string> = { editMenu: 'Редактировать меню', refundChecks: 'Возврат / отмена чеков', exportReports: 'Экспорт отчётов', closeShift: 'Закрытие смены', manageStaff: 'Управление сотрудниками', editPermissions: 'Редактирование прав доступа' };
type PermissionIcon = PwaIconName | 'download' | 'lock' | 'key' | 'card';
const sectionIcons: Record<SectionKey, PermissionIcon> = { statistics: 'adminStats', orders: 'adminOrders', tables: 'grid', menu: 'menu', warehouse: 'adminWarehouse', staff: 'adminStaff', journal: 'adminJournal', paymentReconciliation: 'adminReconcile', checks: 'card', settings: 'adminSettings' };
const actionIcons: Record<ActionKey, PermissionIcon> = { editMenu: 'pencil', refundChecks: 'clock', exportReports: 'download', closeShift: 'lock', manageStaff: 'adminStaff', editPermissions: 'key' };
const roleLabels = { OWNER: 'Владелец', ADMIN: 'Администратор', WAITER: 'Официант', KITCHEN: 'Кухня', BAR: 'Бар' };

export function EmployeePermissionsSheet({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const owner = member.role === 'OWNER';
  const twoColumns = useWindowDimensions().width >= 640;
  const [permissions, setPermissions] = useState(() => resolvePermissions(member.role, member.permissions));
  const update = useUpdatePermissions();
  const push = useNotifications((s) => s.push);
  async function save() {
    try { await update.mutateAsync({ id: member.id, ...permissions }); push({ message: 'Права доступа сохранены', type: 'success', at: new Date().toISOString() }); onClose(); }
    catch (error) { push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
  }
  return <BottomSheet visible onClose={onClose} title="Изменить права сотрудника" panelStyle={{ width: '100%', maxWidth: 672, alignSelf: 'center' }} footer={<View style={styles.footer}><Button title="Отмена" variant="secondary" onPress={onClose} disabled={update.isPending} /><Button title="Сохранить" disabled={owner} loading={update.isPending} onPress={() => void save()} /></View>}>
    <SheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.member}><View style={styles.avatar}><Text style={styles.avatarText}>{member.name.trim().charAt(0).toUpperCase() || '—'}</Text></View><View style={{ flex: 1 }}><Text style={styles.name} numberOfLines={1}>{member.name}</Text><Text style={styles.muted} translate>Роль: {roleLabels[member.role]}</Text></View></View>
      {owner ? <Text style={[styles.muted, styles.ownerNote]} translate>Владелец всегда имеет полный доступ — права изменить нельзя.</Text> : null}
      <View><Text style={styles.heading} translate>Доступ к разделам</Text><View style={styles.grid}>{SECTION_KEYS.map(key => <PermissionItem key={key} label={sectionLabels[key]} icon={sectionIcons[key]} checked={permissions.sections[key]} disabled={owner || update.isPending} twoColumns={twoColumns} onToggle={() => setPermissions(p => ({ ...p, sections: { ...p.sections, [key]: !p.sections[key] } }))} />)}</View></View>
      <View><Text style={styles.heading} translate>Дополнительные права</Text><View style={styles.grid}>{ACTION_KEYS.map(key => <PermissionItem key={key} label={actionLabels[key]} icon={actionIcons[key]} checked={permissions.actions[key]} disabled={owner || update.isPending} twoColumns={twoColumns} onToggle={() => setPermissions(p => ({ ...p, actions: { ...p.actions, [key]: !p.actions[key] } }))} />)}</View></View>
    </SheetScrollView>
  </BottomSheet>;
}

function PermissionItem({ label, icon, checked, disabled, twoColumns, onToggle }: { label: string; icon: PermissionIcon; checked: boolean; disabled: boolean; twoColumns: boolean; onToggle: () => void }) {
  return <FastPressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onToggle} style={[styles.permission, twoColumns && { width: '49%' }, !checked && { backgroundColor: colors.background }, disabled && { opacity: 0.6 }]}>
    <View style={[styles.checkbox, checked && { backgroundColor: colors.primary, borderColor: colors.primary }]}>{checked ? <PwaIcon name="check" size={12} strokeWidth={3} color={colors.white} /> : null}</View>
    <PermissionSymbol icon={icon} color={checked ? colors.textSecondary : colors.textLight} /><Text style={[styles.label, !checked && { color: colors.textMuted }]} translate>{label}</Text>
  </FastPressable>;
}
function PermissionSymbol({ icon, color }: { icon: PermissionIcon; color: string }) {
  if (icon !== 'download' && icon !== 'lock' && icon !== 'key' && icon !== 'card') return <PwaIcon name={icon} size={18} color={color} />;
  return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {icon === 'download' ? <><Path d="M12 3v12m0 0l4-4m-4 4l-4-4" /><Path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></> : icon === 'lock' ? <><Rect x={5} y={11} width={14} height={10} rx={2} /><Path d="M8 11V7a4 4 0 0 1 8 0v4" /></> : icon === 'key' ? <><Circle cx={7.5} cy={15.5} r={3.5} /><Path d="M10 13l8-8m-2 0h3v3" /></> : <><Rect x={2} y={5} width={20} height={14} rx={2} /><Path d="M2 10h20" /></>}
  </Svg>;
}
const styles = StyleSheet.create({
  content: { gap: 20 }, footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  name: { fontSize: 16, fontWeight: '600', color: colors.textPrimary }, muted: { color: colors.textMuted, fontSize: 14 }, ownerNote: { padding: 12, backgroundColor: colors.background, borderRadius: 8 },
  heading: { color: colors.textPrimary, fontWeight: '600', fontSize: 14, marginBottom: 8 }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  permission: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.white },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, label: { fontSize: 14, color: colors.textPrimary, flex: 1 },
});
