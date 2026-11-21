import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { View } from '@/components/themed';
import { Alert, Text, TextInput } from '@/components/typography';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button, Loading, PillTabs, Toggle } from '@/components/ui';
import { apiError } from '@/lib/api';
import { ACTION_KEYS, ACTION_LABELS, getDefaultPermissionsByRole, READ_ONLY_SECTION_KEYS, resolvePermissions, SECTION_KEYS, SECTION_LABELS, SECTION_WRITE_ACTIONS } from '@/lib/permissions';
import { useStaffPositionMutations, useStaffPositions, type PositionRole, type PositionSalary, type StaffPosition } from '@/services/api/positions';
import { colors, spacing } from '@/theme';
import type { ActionKey, EmployeePermissions, SectionKey } from '@/types';

const SECTIONS = SECTION_KEYS.filter((key) => key !== 'paymentReconciliation');
const SECTION_ACTIONS: Partial<Record<SectionKey, ActionKey[]>> = {
  menu: ['editMenu'], staff: ['manageStaff'], checks: ['refundChecks'],
  warehouse: ['warehouseReceive', 'warehouseTransfer', 'warehouseWriteoff', 'warehouseCount', 'warehouseApprove',
    'warehouseRecipes', 'warehouseProduce', 'warehouseCosts', 'warehouseReports', 'warehouseSettings'],
};
const TERMINAL_ACTIONS: ActionKey[] = ['acceptOrderPayments', 'printReceipts', 'requestReceiptPrints', 'createDeliveryOrders', 'financeCashShifts'];
const RATES = [
  ['hourly', 'За час, с'], ['perShift', 'За смену, с'], ['monthly', 'За месяц, с'],
  ['personalPercent', 'Процент от личных продаж'], ['shiftPercent', 'Процент от продаж за смену'],
] as const satisfies readonly [keyof PositionSalary, string][];
const TABS = [
  { key: 'general', label: 'Общие данные' },
  { key: 'admin', label: 'Админ-панель' },
  { key: 'terminal', label: 'Касса' },
] as const;
const LEVELS = [
  { key: 'none', label: 'Нет доступа' },
  { key: 'view', label: 'Просмотр' },
  { key: 'full', label: 'Полный доступ' },
] as const;
const ACTION_OPTIONS = [
  { key: 'denied', label: 'Запрещено' },
  { key: 'allowed', label: 'Разрешено' },
] as const;
const SCREENS: { value: PositionRole; label: string }[] = [
  { value: 'ADMIN', label: 'Не используется' },
  { value: 'KITCHEN', label: 'Кухня' },
  { value: 'BAR', label: 'Бар' },
];
type Level = (typeof LEVELS)[number]['key'];
type EditorTab = (typeof TABS)[number]['key'];

function initialPermissions(position: StaffPosition | null): EmployeePermissions {
  if (position) {
    const current = resolvePermissions(position.role, position.permissions);
    if (!current.adminAccess && position.role === 'WAITER') {
      current.sections = { ...current.sections };
      for (const key of SECTIONS) current.sections[key] = false;
    }
    return current;
  }
  const current = getDefaultPermissionsByRole('ADMIN');
  for (const key of Object.keys(current.sections) as SectionKey[]) current.sections[key] = false;
  for (const key of Object.keys(current.actions) as ActionKey[]) current.actions[key] = false;
  current.actions.acceptOrderPayments = true;
  current.actions.requestReceiptPrints = true;
  return { ...current, adminAccess: false, terminalAccess: false };
}

function accessSummary(position: StaffPosition) {
  const permissions = position.permissions;
  const parts: string[] = [];
  if (permissions.terminalAccess) {
    parts.push('Касса');
    if (permissions.actions.acceptOrderPayments) parts.push('Приём оплаты');
    if (permissions.actions.printReceipts) parts.push('Печать чеков');
    if (permissions.actions.createDeliveryOrders) parts.push('Оформление доставки');
  }
  if (position.role === 'KITCHEN') parts.push('Экран кухни');
  if (position.role === 'BAR') parts.push('Экран бара');
  if (permissions.adminAccess) {
    for (const key of SECTIONS) {
      const label = SECTION_LABELS[key];
      if (permissions.sections[key]) parts.push(permissions.readOnlySections?.includes(key) ? label + ' (просмотр)' : label);
    }
  }
  return parts.join(', ');
}

export function PositionsPanel({ enabled = true }: { enabled?: boolean }) {
  const positions = useStaffPositions(enabled);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<StaffPosition | 'new' | null>(null);
  const [deleting, setDeleting] = useState<StaffPosition | null>(null);
  if (!enabled) return null;
  const rows = positions.data ?? [];
  const term = search.trim().toLocaleLowerCase();
  return (
    <View style={styles.group}>
      <View style={styles.header}>
        <Text style={styles.heading} translate>Должности</Text>
        <Button title="Добавить должность" onPress={() => setEditing('new')} />
      </View>
      <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="Поиск по названию" placeholderTextColor={colors.textLight} />
      {positions.isLoading ? <Loading /> : positions.isError ? <Text style={styles.error}>{apiError(positions.error)}</Text> : (
        <View style={styles.list}>
          {term === '' || 'владелец'.includes(term) ? <View style={styles.item}>
            <View style={styles.grow}>
              <Text style={styles.name} translate>Владелец</Text>
              <Text style={styles.hint} translate>Полный доступ</Text>
            </View>
          </View> : null}
          {rows.filter(({ name }) => name.toLocaleLowerCase().includes(term)).map((position) => (
            <View key={position.id} style={styles.item}>
              <FastPressable style={styles.grow} onPress={() => setEditing(position)}>
                <Text style={styles.name}>{position.name}</Text>
                <Text style={styles.hint}>{accessSummary(position) || 'Доступ не назначен'}</Text>
              </FastPressable>
              <FastPressable style={styles.icon} accessibilityLabel="Редактировать должность" onPress={() => setEditing(position)}>
                <PwaIcon name="pencil" color={colors.textMuted} size={18} />
              </FastPressable>
              <FastPressable style={styles.icon} accessibilityLabel="Удалить должность" onPress={() => setDeleting(position)}>
                <PwaIcon name="trash" color={colors.danger} size={18} />
              </FastPressable>
            </View>
          ))}
        </View>
      )}
      {editing ? <PositionEditor position={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeletePosition position={deleting} positions={rows} onClose={() => setDeleting(null)} /> : null}
    </View>
  );
}

function AccessRow<T extends string>({ label, hint, options, value, onChange }: {
  label: string; hint?: string; options: readonly { key: T; label: string }[];
  value: T | 'custom'; onChange: (key: T) => void;
}) {
  return <View style={styles.accessRow}>
    <Text style={styles.name} translate>{label}</Text>
    {hint ? <Text style={styles.hint} translate>{hint}</Text> : null}
    <View style={styles.segments} accessibilityRole="radiogroup">
      {options.map((option) => {
        const active = value === option.key;
        return <FastPressable key={option.key} accessibilityRole="radio" accessibilityState={{ checked: active }}
          onPress={() => onChange(option.key)} style={[styles.segment, active && styles.segmentActive]}>
          <Text style={[styles.segmentText, active && styles.segmentTextActive]} translate>{option.label}</Text>
        </FastPressable>;
      })}
    </View>
  </View>;
}

function PermissionToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.switchRow}>
    <Text style={styles.switchLabel} translate>{label}</Text>
    <Toggle checked={checked} onChange={onChange} accessibilityLabel={label} />
  </View>;
}

function PositionEditor({ position, onClose }: { position: StaffPosition | null; onClose: () => void }) {
  const [tab, setTab] = useState<EditorTab>('general');
  const [name, setName] = useState(position?.name ?? '');
  const [role, setRole] = useState<PositionRole>(position?.role ?? 'ADMIN');
  const [permissions, setPermissions] = useState(() => initialPermissions(position));
  const [rates, setRates] = useState(() => Object.fromEntries(RATES.map(([key]) =>
    [key, position?.salary[key] ? String(position.salary[key]) : ''])) as Record<keyof PositionSalary, string>);
  const [details, setDetails] = useState(false);
  const [panelKey, setPanelKey] = useState(0);
  const { save } = useStaffPositionMutations();
  const canChangeAdmin = !position?.fixedWorkspace;
  const canChangeTerminal = position?.fixedWorkspace !== 'production';
  const adminEnabled = canChangeAdmin && permissions.adminAccess === true;
  const terminalEnabled = canChangeTerminal && permissions.terminalAccess === true;
  const production = role === 'KITCHEN' || role === 'BAR';
  const hasAccess = terminalEnabled || production || (adminEnabled && SECTIONS.some((key) => permissions.sections[key]));
  const tabs = TABS.filter(({ key }) => key === 'general' || (key === 'admin' && adminEnabled) || (key === 'terminal' && terminalEnabled));
  const parsedRates = RATES.map(([key]) => {
    const input = rates[key].trim().replace(',', '.');
    const amount = Number(input);
    const limit = key.endsWith('Percent') ? 100 : 9_999_999_999.99;
    return [key, (!input || /^\d+(\.\d{0,2})?$/.test(input)) && amount <= limit ? amount : null] as const;
  });
  const validSalary = parsedRates.every(([, amount]) => amount !== null);
  const dirty = name !== (position?.name ?? '') || role !== (position?.role ?? 'ADMIN')
    || JSON.stringify(permissions) !== JSON.stringify(initialPermissions(position))
    || RATES.some(([key]) => rates[key] !== (position?.salary[key] ? String(position.salary[key]) : ''));

  const close = () => {
    if (save.isPending) { setPanelKey((current) => current + 1); return; }
    if (!dirty) { onClose(); return; }
    Alert.alert('Выйти без сохранения?', 'Изменения должности будут потеряны.', [
      { text: 'Продолжить редактирование', style: 'cancel', onPress: () => setPanelKey((current) => current + 1) },
      { text: 'Выйти', style: 'destructive', onPress: onClose },
    ], { cancelable: false });
  };

  function level(section: SectionKey): Level | 'custom' {
    if (!permissions.sections[section]) return 'none';
    const readOnly = !READ_ONLY_SECTION_KEYS.includes(section) || permissions.readOnlySections?.includes(section);
    const required = (SECTION_ACTIONS[section] ?? []).filter((action) => !readOnly || !SECTION_WRITE_ACTIONS[section]?.includes(action));
    return required.some((action) => !permissions.actions[action]) ? 'custom' : readOnly ? 'view' : 'full';
  }
  function changeLevel(section: SectionKey, value: Level) {
    setPermissions((current) => {
      const readOnly = value === 'view' && READ_ONLY_SECTION_KEYS.includes(section);
      const readOnlySections = (current.readOnlySections ?? []).filter((key) => key !== section);
      if (readOnly) readOnlySections.push(section);
      const actions = { ...current.actions };
      for (const action of SECTION_ACTIONS[section] ?? []) actions[action] = value !== 'none' && !(readOnly && SECTION_WRITE_ACTIONS[section]?.includes(action));
      return { ...current, actions, sections: { ...current.sections, [section]: value !== 'none' }, readOnlySections };
    });
  }
  function changeAction(key: ActionKey, checked: boolean) {
    setPermissions((current) => ({ ...current, actions: { ...current.actions, [key]: checked } }));
  }
  const individualActions = ACTION_KEYS.filter((action) => action !== 'editPermissions' && !TERMINAL_ACTIONS.includes(action)
    && !SECTIONS.some((section) => SECTION_ACTIONS[section]?.includes(action) && (!permissions.sections[section]
      || (permissions.readOnlySections?.includes(section) && SECTION_WRITE_ACTIONS[section]?.includes(action)))));
  const canSave = !!name.trim() && hasAccess && validSalary;

  return <BottomSheet key={panelKey} visible onClose={close} title={position ? 'Редактирование должности' : 'Добавление должности'}
    footer={<View style={styles.footer}>
      {save.error ? <Text style={styles.error}>{apiError(save.error)}</Text> : null}
      {!validSalary ? <Text style={styles.error} translate>Проверьте ставки и проценты (от 0 до 100).</Text> : null}
      {!hasAccess ? <Text style={styles.hint} translate>Разрешите кассу, раздел админ-панели или экран приготовления.</Text> : null}
      {position ? <Text style={styles.hint} translate>Сотрудников с этой должностью: {position.employees}</Text> : null}
      <View style={styles.buttons}>
        <Button title="Отмена" variant="secondary" disabled={save.isPending} onPress={close} />
        <Button title="Сохранить" disabled={!canSave} loading={save.isPending} onPress={() => {
          if (!canSave || save.isPending) return;
          save.mutate({ id: position?.id, name: name.trim(), role, permissions, salary: Object.fromEntries(parsedRates) as PositionSalary }, { onSuccess: onClose });
        }} />
      </View>
    </View>}>
    <View style={styles.group}>
      {tabs.length > 1 ? <PillTabs items={tabs} value={tab} onChange={setTab} /> : null}
      {tab === 'general' ? <>
        <View style={styles.field}>
          <Text style={styles.name} translate>Название должности</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={80} placeholder="Например, управляющий" placeholderTextColor={colors.textLight} />
        </View>
        {canChangeAdmin || canChangeTerminal ? <View style={styles.field}>
          <Text style={styles.heading} translate>Рабочие места</Text>
          {canChangeAdmin ? <PermissionToggle label="Вход в админ-панель" checked={adminEnabled} onChange={(adminAccess) => setPermissions({ ...permissions, adminAccess })} /> : null}
          {canChangeTerminal ? <PermissionToggle label="Открывать кассу и оформлять заказы гостей" checked={terminalEnabled} onChange={(terminalAccess) => setPermissions({ ...permissions, terminalAccess })} /> : null}
        </View> : null}
        <View style={styles.field}>
          <Text style={styles.heading} translate>Экран приготовления</Text>
          <Select value={production ? role : 'ADMIN'} options={SCREENS} onChange={setRole} disabled={!!position} title="Экран приготовления" />
          <Text style={styles.hint} translate>Цех выбирается в карточке сотрудника.</Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.heading} translate>Рабочие смены</Text>
          <PermissionToggle label="Учитывать рабочие смены" checked={permissions.workShiftRequired !== false} onChange={(workShiftRequired) => setPermissions({ ...permissions, workShiftRequired })} />
        </View>
        <View style={styles.field}>
          <Text style={styles.heading} translate>Расчёт зарплаты</Text>
          {RATES.map(([key, label]) => <View key={key} style={styles.switchRow}>
            <Text style={styles.switchLabel} translate>{label}</Text>
            <TextInput style={[styles.input, styles.rate]} accessibilityLabel={label} keyboardType="decimal-pad"
              value={rates[key]} onChangeText={(value) => setRates((current) => ({ ...current, [key]: value }))} placeholder="0" placeholderTextColor={colors.textLight} />
          </View>)}
          <Text style={styles.hint} translate>Ставки складываются и применяются с текущего месяца.</Text>
        </View>
      </> : null}
      {tab === 'admin' && adminEnabled ? <>
        {SECTIONS.map((key) => {
          const selected = level(key);
          return <AccessRow key={key} label={SECTION_LABELS[key]} value={selected} options={READ_ONLY_SECTION_KEYS.includes(key) ? LEVELS : LEVELS.slice(0, 2)}
            hint={selected === 'custom' ? 'Индивидуальные ограничения' : undefined} onChange={(value) => changeLevel(key, value)} />;
        })}
        <Button title="Отдельные действия и ограничения" variant="secondary" onPress={() => setDetails(!details)} />
        {details ? individualActions.map((key) => <PermissionToggle key={key} label={ACTION_LABELS[key]}
          checked={permissions.actions[key]} onChange={(checked) => changeAction(key, checked)} />) : null}
      </> : null}
      {tab === 'terminal' && terminalEnabled ? TERMINAL_ACTIONS.map((key) => <AccessRow key={key}
        label={ACTION_LABELS[key]} options={ACTION_OPTIONS} value={permissions.actions[key] ? 'allowed' : 'denied'}
        onChange={(value) => changeAction(key, value === 'allowed')} />) : null}
    </View>
  </BottomSheet>;
}

function DeletePosition({ position, positions, onClose }: { position: StaffPosition; positions: StaffPosition[]; onClose: () => void }) {
  const { remove } = useStaffPositionMutations();
  const [replacementPositionId, setReplacementPositionId] = useState('');
  const needsReplacement = position.employees > 0;
  return <BottomSheet visible onClose={onClose} title={`Удалить «${position.name}»?`}
    footer={<View style={styles.buttons}>
      <Button title="Отмена" variant="secondary" disabled={remove.isPending} onPress={onClose} />
      <Button title="Удалить" variant="danger" disabled={needsReplacement && !replacementPositionId} loading={remove.isPending}
        onPress={() => remove.mutate({ id: position.id, replacementPositionId: replacementPositionId || undefined }, { onSuccess: onClose })} />
    </View>}>
    {needsReplacement ? <View style={styles.field}>
      <Text style={styles.hint} translate>Выберите должность, на которую будут переведены сотрудники.</Text>
      <Select title="Новая должность" placeholder="Выберите должность" value={replacementPositionId} onChange={setReplacementPositionId}
        options={positions.filter(({ id }) => id !== position.id).map(({ id, name }) => ({ value: id, label: name, translate: false }))} />
    </View> : <Text style={styles.hint} translate>Должность будет удалена из списка.</Text>}
    {remove.error ? <Text style={styles.error}>{apiError(remove.error)}</Text> : null}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  group: { gap: spacing.md },
  field: { gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  heading: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  name: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 13 },
  input: { minHeight: 42, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.textPrimary, backgroundColor: colors.white },
  rate: { width: 108, textAlign: 'right' },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, minHeight: 60 },
  grow: { flex: 1, minWidth: 0, paddingVertical: spacing.sm, gap: 4 },
  icon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, minHeight: 42 },
  switchLabel: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  accessRow: { gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingBottom: spacing.md },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 7, paddingHorizontal: 4 },
  segmentActive: { backgroundColor: colors.primarySoft },
  segmentText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center' },
  segmentTextActive: { color: colors.primary, fontWeight: '600' },
  footer: { gap: spacing.sm },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  error: { color: colors.danger, fontSize: 13 },
});
