import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/typography';
import { BottomSheet } from '@/components/BottomSheet';
import { Button, Toggle } from '@/components/ui';
import { ACTION_KEYS, SECTION_KEYS, resolvePermissions } from '@/lib/permissions';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { useUpdatePermissions, type StaffMember } from '@/services/api/admin';
import { colors, spacing } from '@/theme';
import type { ActionKey, SectionKey } from '@/types';

const sectionLabels: Record<SectionKey, string> = { statistics: 'Статистика', orders: 'Заказы', tables: 'Столы', menu: 'Меню', warehouse: 'Склад', staff: 'Персонал', journal: 'Журнал', paymentReconciliation: 'Сверка оплат', checks: 'Печать чека', settings: 'Настройки' };
const actionLabels: Record<ActionKey, string> = { editMenu: 'Редактировать меню', refundChecks: 'Отмена и возврат чеков', exportReports: 'Экспортировать отчёты', closeShift: 'Закрывать смены', manageStaff: 'Управлять персоналом', editPermissions: 'Изменять права сотрудников' };

export function EmployeePermissionsSheet({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const owner = member.role === 'OWNER';
  const [permissions, setPermissions] = useState(() => resolvePermissions(member.role, member.permissions));
  const update = useUpdatePermissions();
  const push = useNotifications((s) => s.push);
  async function save() {
    try { await update.mutateAsync({ id: member.id, ...permissions }); push({ message: 'Права доступа сохранены', type: 'success', at: new Date().toISOString() }); onClose(); }
    catch (error) { push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
  }
  return <BottomSheet visible onClose={onClose} title="Изменить права сотрудника" footer={<Button title="Сохранить" disabled={owner} loading={update.isPending} onPress={() => void save()} />}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><Text style={styles.name}>{member.name}</Text>{owner ? <Text style={styles.muted} translate>Владелец всегда имеет полный доступ — права изменить нельзя.</Text> : null}<Text style={styles.heading} translate>Доступ к разделам</Text>{SECTION_KEYS.map((key) => <View key={key} style={styles.row}><Text style={styles.label}>{sectionLabels[key]}</Text><Toggle checked={permissions.sections[key]} onChange={(value) => !owner && setPermissions((p) => ({ ...p, sections: { ...p.sections, [key]: value } }))} /></View>)}<Text style={styles.heading} translate>Дополнительные права</Text>{ACTION_KEYS.map((key) => <View key={key} style={styles.row}><Text style={styles.label}>{actionLabels[key]}</Text><Toggle checked={permissions.actions[key]} onChange={(value) => !owner && setPermissions((p) => ({ ...p, actions: { ...p.actions, [key]: value } }))} /></View>)}</ScrollView></BottomSheet>;
}
const styles = StyleSheet.create({ content: { gap: spacing.sm }, name: { fontSize: 18, fontWeight: '700', color: colors.textPrimary }, muted: { color: colors.textMuted }, heading: { color: colors.textPrimary, fontWeight: '700', marginTop: spacing.md }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 4 }, label: { color: colors.textSecondary, flex: 1 } });
