import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button, Toggle } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { money, timeHM } from '@/utils/format';
import {
  useSetCashHanded,
  useShiftReport,
  useStaffMutations,
  type ShiftReportCategory,
  type ShiftReportRow,
  type StaffMember,
} from '@/services/api/admin';
import type { Role } from '@/types';

const ROLE_LABEL: Record<Role, string> = {
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
  ADMIN: 'Администратор',
  OWNER: 'Владелец',
};

const ROLE_OPTIONS = [
  { value: 'WAITER', label: 'Официант' },
  { value: 'KITCHEN', label: 'Кухня' },
  { value: 'BAR', label: 'Бар' },
  { value: 'ADMIN', label: 'Администратор' },
  { value: 'OWNER', label: 'Владелец' },
];

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const shiftDateLabel = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
};
const addDays = (ymd: string, delta: number) => {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function durationLabel(min: number | null) {
  if (min == null) return '—';
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)} ч ${min % 60} мин`;
}
function shiftLabel(row: ShiftReportRow) {
  if (!row.shiftStart) return '—';
  const end = row.shiftEnd ? timeHM(row.shiftEnd) : row.shiftOpen ? 'сейчас' : '—';
  return `${timeHM(row.shiftStart)} – ${end}`;
}
function signedMoney(n: number) {
  const r = Math.round(n);
  return `${r > 0 ? '+' : ''}${money(n)}`;
}

/** Персонал и текущая смена (порт PWA StaffPage — вкладка «Текущая смена» + CRUD). */
export function StaffScreen() {
  const [date, setDate] = useState(todayYmd());
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffMember | null | 'new'>(null);

  const reportQ = useShiftReport(date);
  const { remove } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const rows = reportQ.data ?? [];

  const delMember = (id: string, name: string) =>
    Alert.alert('Удалить сотрудника?', `«${name}» будет удалён.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          remove
            .mutateAsync(id)
            .then(() => push({ message: 'Сотрудник удалён', at: new Date().toISOString() }))
            .catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() })),
      },
    ]);

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Button title="+ Добавить сотрудника" size="md" onPress={() => setEditing('new')} />

        <View style={styles.tabsRow}>
          <TabBtn active={tab === 'current'} label="Текущая смена" onPress={() => setTab('current')} />
          <TabBtn active={tab === 'history'} label="История смен" onPress={() => setTab('history')} />
        </View>

        {tab === 'current' ? (
          <>
            <View style={styles.dateRow}>
              <FastPressable onPress={() => setDate((d) => addDays(d, -1))} hitSlop={8} style={styles.dateArrow}>
                <View style={{ transform: [{ rotate: '90deg' }] }}>
                  <PwaIcon name="chevronDown" size={16} color={colors.textSecondary} strokeWidth={2} />
                </View>
              </FastPressable>
              <Text style={styles.dateLabel}>{shiftDateLabel(date)}</Text>
              <FastPressable
                onPress={() => setDate((d) => (d < todayYmd() ? addDays(d, 1) : d))}
                hitSlop={8}
                style={styles.dateArrow}
              >
                <View style={{ transform: [{ rotate: '-90deg' }] }}>
                  <PwaIcon name="chevronDown" size={16} color={colors.textSecondary} strokeWidth={2} />
                </View>
              </FastPressable>
            </View>

            {reportQ.isLoading ? (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : rows.length === 0 ? (
              <Text style={styles.empty}>Нет данных за выбранную дату</Text>
            ) : (
              rows.map((row) => (
                <ShiftRow
                  key={row.waiterId}
                  row={row}
                  date={date}
                  open={expanded === row.waiterId}
                  onToggle={() => setExpanded((cur) => (cur === row.waiterId ? null : row.waiterId))}
                  onEdit={() => {
                    const m: StaffMember = {
                      id: row.waiterId,
                      name: row.name,
                      phone: '',
                      role: row.role,
                      isActive: true,
                      createdAt: '',
                      onShift: row.shiftOpen,
                    };
                    setEditing(m);
                  }}
                  onDelete={() => delMember(row.waiterId, row.name)}
                />
              ))
            )}
          </>
        ) : (
          <View style={styles.center}>
            <Text style={styles.empty}>История смен появится в следующем обновлении</Text>
          </View>
        )}
      </ScrollView>

      {editing !== null ? (
        <StaffModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

function ShiftRow({
  row,
  date,
  open,
  onToggle,
  onEdit,
  onDelete,
}: {
  row: ShiftReportRow;
  date: string;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isWaiter = row.isWaiter;
  const diffColor =
    Math.round(row.difference) === 0 ? colors.textSecondary : row.difference > 0 ? colors.success : colors.danger;

  return (
    <View style={styles.card}>
      <FastPressable onPress={isWaiter ? onToggle : undefined} style={styles.cardTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            {isWaiter ? (
              <View style={open ? styles.chevronUp : undefined}>
                <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
              </View>
            ) : null}
            <Text style={styles.staffName} numberOfLines={1}>
              {row.name}
            </Text>
          </View>
          <Text style={styles.staffRole}>{ROLE_LABEL[row.role]}</Text>
        </View>
        <View style={styles.actions}>
          <FastPressable onPress={onEdit} hitSlop={6} style={styles.iconBtn}>
            <PwaIcon name="pencil" size={16} color={colors.textMuted} strokeWidth={2} />
          </FastPressable>
          <FastPressable onPress={onDelete} hitSlop={6} style={styles.iconBtn}>
            <PwaIcon name="trash" size={16} color={colors.danger} strokeWidth={2} />
          </FastPressable>
        </View>
      </FastPressable>

      {isWaiter ? (
        <View style={styles.finRow}>
          <Fin label="Смена" value={shiftLabel(row)} />
          <Fin label="Оборот" value={money(row.turnover)} />
          <Fin label="Касса (должен)" value={money(row.cashDue)} />
          <View style={styles.finItem}>
            <Text style={styles.finLabel}>Касса (сдал)</Text>
            <CashHandedCell row={row} date={date} />
          </View>
          <Fin label="Разница" value={signedMoney(row.difference)} valueColor={diffColor} />
        </View>
      ) : null}

      {isWaiter && open ? <ShiftDetails row={row} /> : null}
    </View>
  );
}

function Fin({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.finItem}>
      <Text style={styles.finLabel}>{label}</Text>
      <Text style={[styles.finValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

function CashHandedCell({ row, date }: { row: ShiftReportRow; date: string }) {
  const setCash = useSetCashHanded();
  const [val, setVal] = useState(row.cashHanded ? String(row.cashHanded) : '');
  useEffect(() => {
    setVal(row.cashHanded ? String(row.cashHanded) : '');
  }, [row.cashHanded]);

  const commit = () => {
    const num = Number(val.replace(/\s/g, '').replace(',', '.')) || 0;
    if (num === row.cashHanded) return;
    setCash.mutate({ waiterId: row.waiterId, date, cashHanded: num });
  };

  return (
    <TextInput
      style={styles.cashInput}
      value={val}
      onChangeText={setVal}
      onBlur={commit}
      keyboardType="decimal-pad"
      placeholder="0"
      placeholderTextColor={colors.textLight}
    />
  );
}

function ShiftDetails({ row }: { row: ShiftReportRow }) {
  return (
    <View style={styles.details}>
      <Text style={styles.detailsTitle}>Товарная разбивка:</Text>
      {row.categories.length === 0 ? (
        <Text style={styles.muted}>Продаж нет</Text>
      ) : (
        row.categories.map((cat) => <CategoryRow key={cat.categoryId} cat={cat} />)
      )}

      <Text style={[styles.detailsTitle, { marginTop: spacing.md }]}>
        Отменённые чеки ({row.cancellations.length}):
      </Text>
      {row.cancellations.length === 0 ? (
        <Text style={styles.muted}>Отмен нет</Text>
      ) : (
        row.cancellations.map((c, i) => (
          <Text key={i} style={styles.cancelLine}>
            <Text style={styles.muted}>{timeHM(c.time)}</Text> — {c.name}{' '}
            <Text style={styles.detailPrimary}>({money(c.amount)})</Text>
            <Text style={styles.muted}> — Причина: {c.reason}</Text>
          </Text>
        ))
      )}
    </View>
  );
}

function CategoryRow({ cat }: { cat: ShiftReportCategory }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <FastPressable onPress={() => setOpen((o) => !o)} style={styles.catRow}>
        <View style={open ? styles.chevronUp : undefined}>
          <PwaIcon name="chevronDown" size={13} color={colors.textMuted} strokeWidth={2} />
        </View>
        <Text style={styles.catName} numberOfLines={1}>
          {cat.name}
        </Text>
        <Text style={styles.catQty}>
          {cat.qty} шт. <Text style={styles.muted}>({money(cat.amount)})</Text>
        </Text>
      </FastPressable>
      {open ? (
        <View style={styles.catItems}>
          {cat.items.map((it, i) => (
            <View key={i}>
              <View style={styles.catItemRow}>
                <Text style={styles.catItemName} numberOfLines={1}>
                  {it.name}
                </Text>
                <Text style={styles.catItemQty}>
                  {it.qty} шт. <Text style={styles.muted}>({money(it.amount)})</Text>
                </Text>
              </View>
              {it.components && it.components.length > 0 ? (
                <View style={styles.compBox}>
                  {it.components.map((c, j) => (
                    <View key={j} style={styles.catItemRow}>
                      <Text style={styles.compName} numberOfLines={1}>
                        {c.name}
                      </Text>
                      <Text style={styles.compQty}>{c.qty} шт.</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StaffModal({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const isEdit = !!member;
  const { create, update } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(member?.name ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'WAITER');
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(member?.isActive ?? true);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  const onSubmit = async () => {
    setError('');
    try {
      if (isEdit) {
        await update.mutateAsync({ id: member!.id, name, phone, role, isActive, ...(password ? { password } : {}) });
        push({ message: 'Сотрудник обновлён', at: new Date().toISOString() });
      } else {
        if (!password) {
          setError('Укажите пароль');
          return;
        }
        await create.mutateAsync({ name, phone, role, password });
        push({ message: 'Сотрудник добавлен', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={isEdit ? 'Изменить сотрудника' : 'Новый сотрудник'}
      footer={<Button title={isEdit ? 'Сохранить' : 'Добавить'} size="lg" loading={pending} onPress={onSubmit} />}
    >
      <View style={{ gap: spacing.md }}>
        <Field label="Имя">
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={colors.textLight} />
        </Field>
        <Field label="Телефон">
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholderTextColor={colors.textLight} />
        </Field>
        <Field label="Роль">
          <Select value={role} onChange={(v) => setRole(v as Role)} options={ROLE_OPTIONS} title="Роль" />
        </Field>
        <Field label={isEdit ? 'Новый пароль (если менять)' : 'Пароль'}>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder={isEdit ? 'Оставьте пустым' : 'Пароль для входа'}
            placeholderTextColor={colors.textLight}
          />
        </Field>
        {isEdit ? (
          <View style={styles.checkRow}>
            <Text style={styles.checkLabel}>Активен (может входить)</Text>
            <Toggle checked={isActive} onChange={setIsActive} />
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

function TabBtn({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <FastPressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </FastPressable>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  tabsRow: { flexDirection: 'row', gap: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn: { paddingVertical: spacing.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: fontSize.base, fontWeight: '500', color: colors.textMuted },
  tabTextActive: { color: colors.primary },

  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  dateArrow: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dateLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary, minWidth: 150, textAlign: 'center' },

  center: { paddingVertical: 60, alignItems: 'center' },
  empty: { paddingVertical: 40, textAlign: 'center', color: colors.textMuted },

  card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chevronUp: { transform: [{ rotate: '180deg' }] },
  staffName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary, flexShrink: 1 },
  staffRole: { marginTop: 2, fontSize: fontSize.xs, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: 2 },
  iconBtn: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },

  finRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  finItem: { minWidth: 90 },
  finLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  finValue: { marginTop: 2, fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
  cashInput: {
    marginTop: 2,
    height: 32,
    width: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    fontSize: fontSize.sm,
    color: colors.textPrimary,
    textAlign: 'right',
  },

  details: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  detailsTitle: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary, marginBottom: 6 },
  muted: { fontSize: fontSize.sm, color: colors.textMuted },
  detailPrimary: { color: colors.textPrimary },
  cancelLine: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: 4 },

  catRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  catName: { flex: 1, minWidth: 0, fontSize: fontSize.sm, color: colors.textPrimary },
  catQty: { fontSize: fontSize.sm, color: colors.textSecondary },
  catItems: { paddingLeft: 22, gap: 4, paddingBottom: 4 },
  catItemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  catItemName: { flex: 1, minWidth: 0, fontSize: fontSize.sm, color: colors.textSecondary },
  catItemQty: { fontSize: fontSize.sm, color: colors.textSecondary },
  compBox: { marginTop: 2, borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 10, gap: 2 },
  compName: { flex: 1, minWidth: 0, fontSize: fontSize.xs, color: colors.textMuted },
  compQty: { fontSize: fontSize.xs, color: colors.textMuted },

  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  fieldLabel: { marginBottom: 6, fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  error: { fontSize: fontSize.sm, color: colors.danger },
});
