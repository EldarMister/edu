import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button, Toggle } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { displayOrderNumber, money, timeHM } from '@/utils/format';
import {
  useSetCashHanded,
  useShiftHistory,
  useShiftHistoryActions,
  useShiftReport,
  useStaff,
  useStaffMutations,
  type ShiftHistoryFilters,
  type ShiftHistoryPeriod,
  type ShiftHistoryResponse,
  type ShiftHistoryRow,
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
const HISTORY_PERIOD_OPTIONS: { value: ShiftHistoryPeriod; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'custom', label: 'Произвольный период' },
];
const HISTORY_ROLE_OPTIONS: { value: Role | ''; label: string }[] = [
  { value: '', label: 'Все роли' },
  { value: 'WAITER', label: 'Официант' },
  { value: 'BAR', label: 'Бар' },
  { value: 'KITCHEN', label: 'Кухня' },
  { value: 'ADMIN', label: 'Администратор' },
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
function dateDMY(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU');
}
function toDateTimeLocal(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

/** Персонал и текущая смена (порт PWA StaffPage — вкладка «Текущая смена» + CRUD). */
export function StaffScreen() {
  const [date, setDate] = useState(todayYmd());
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [historyFilters, setHistoryFilters] = useState<ShiftHistoryFilters>({ period: 'today' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftHistoryRow | null>(null);
  const [editing, setEditing] = useState<StaffMember | null | 'new'>(null);

  const reportQ = useShiftReport(date);
  const historyQ = useShiftHistory(historyFilters);
  const shiftActions = useShiftHistoryActions();
  const staffQ = useStaff('', '');
  const { remove } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const rows = reportQ.data ?? [];
  const memberById = useMemo(() => new Map((staffQ.data ?? []).map((m) => [m.id, m])), [staffQ.data]);
  const staffOptions = useMemo(
    () => [
      { value: '', label: 'Все сотрудники' },
      ...(staffQ.data ?? []).map((m) => ({ value: m.id, label: m.name })),
    ],
    [staffQ.data],
  );

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

  const closeShift = (row: ShiftHistoryRow) =>
    Alert.alert('Закрыть смену?', `Смена сотрудника «${row.employeeName}» будет закрыта текущим временем.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Закрыть',
        onPress: () =>
          shiftActions.close
            .mutateAsync(row.id)
            .then(() => push({ message: 'Смена закрыта', type: 'success', at: new Date().toISOString() }))
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
                    const member = memberById.get(row.waiterId);
                    const m: StaffMember = member ?? {
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
          <>
            <HistoryFilters
              filters={historyFilters}
              setFilters={setHistoryFilters}
              staffOptions={staffOptions}
              loading={historyQ.isFetching}
              onRefresh={() => historyQ.refetch()}
            />
            <ShiftHistoryList
              data={historyQ.data}
              isLoading={historyQ.isLoading}
              expanded={historyExpanded}
              onToggle={(id) => setHistoryExpanded((current) => (current === id ? null : id))}
              onEdit={setEditingShift}
              onClose={closeShift}
            />
          </>
        )}
      </ScrollView>

      {editing !== null ? (
        <StaffModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      {editingShift ? <ShiftEditModal row={editingShift} onClose={() => setEditingShift(null)} /> : null}
    </>
  );
}

function HistoryFilters({
  filters,
  setFilters,
  staffOptions,
  loading,
  onRefresh,
}: {
  filters: ShiftHistoryFilters;
  setFilters: React.Dispatch<React.SetStateAction<ShiftHistoryFilters>>;
  staffOptions: { value: string; label: string }[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <View style={styles.historyFilters}>
      <Select
        value={filters.period}
        options={HISTORY_PERIOD_OPTIONS}
        onChange={(period) => setFilters((current) => ({ ...current, period }))}
        title="Период"
      />
      {filters.period === 'custom' ? (
        <View style={styles.customDates}>
          <View style={styles.customDateField}>
            <Field label="с">
              <TextInput
                style={styles.input}
                value={filters.from ?? ''}
                onChangeText={(from) => setFilters((current) => ({ ...current, from }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textLight}
              />
            </Field>
          </View>
          <View style={styles.customDateField}>
            <Field label="по">
              <TextInput
                style={styles.input}
                value={filters.to ?? ''}
                onChangeText={(to) => setFilters((current) => ({ ...current, to }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textLight}
              />
            </Field>
          </View>
        </View>
      ) : null}
      <Select
        value={filters.employeeId ?? ''}
        options={staffOptions}
        onChange={(employeeId) => setFilters((current) => ({ ...current, employeeId: employeeId || undefined }))}
        title="Сотрудник"
      />
      <Select
        value={filters.role ?? ''}
        options={HISTORY_ROLE_OPTIONS}
        onChange={(role) => setFilters((current) => ({ ...current, role: role || undefined }))}
        title="Роль"
      />
      <FastPressable onPress={onRefresh} disabled={loading} style={[styles.refreshBtn, loading && styles.disabled]}>
        <PwaIcon name="rotateCcw" size={16} color={colors.textSecondary} strokeWidth={2} />
        <Text style={styles.refreshText}>Обновить</Text>
      </FastPressable>
    </View>
  );
}

function ShiftHistoryList({
  data,
  isLoading,
  expanded,
  onToggle,
  onEdit,
  onClose,
}: {
  data: ShiftHistoryResponse | undefined;
  isLoading: boolean;
  expanded: string | null;
  onToggle: (id: string) => void;
  onEdit: (row: ShiftHistoryRow) => void;
  onClose: (row: ShiftHistoryRow) => void;
}) {
  const rows = data?.items ?? [];
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (rows.length === 0) {
    return <Text style={styles.empty}>Нет смен за выбранный период</Text>;
  }
  return (
    <View style={{ gap: spacing.md }}>
      {rows.map((row) => (
        <ShiftHistoryCard
          key={row.id}
          row={row}
          open={expanded === row.id}
          onToggle={() => onToggle(row.id)}
          onEdit={() => onEdit(row)}
          onClose={() => onClose(row)}
        />
      ))}
      <View style={styles.summaryBox}>
        <Text style={styles.summaryText}>Всего смен: <Text style={styles.summaryValue}>{data?.summary.shiftsCount ?? 0}</Text></Text>
        <Text style={styles.summaryText}>Общая выработка: <Text style={styles.summaryValue}>{durationLabel(data?.summary.totalDurationMin ?? 0)}</Text></Text>
        <Text style={styles.summaryText}>В смене сейчас: <Text style={styles.summaryValue}>{data?.summary.activeCount ?? 0}</Text></Text>
      </View>
    </View>
  );
}

function ShiftHistoryCard({
  row,
  open,
  onToggle,
  onEdit,
  onClose,
}: {
  row: ShiftHistoryRow;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.card}>
      <FastPressable onPress={onToggle} style={styles.cardTop}>
        <View style={open ? styles.chevronUp : undefined}>
          <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.staffName} numberOfLines={1}>{row.employeeName}</Text>
          <Text style={styles.staffRole}>{ROLE_LABEL[row.role]}</Text>
        </View>
        <ShiftStatusBadge status={row.status} />
      </FastPressable>
      <View style={styles.finRow}>
        <Fin label="Дата" value={dateDMY(row.startedAt)} />
        <Fin label="Пришёл" value={timeHM(row.startedAt)} />
        <Fin label="Ушёл" value={row.endedAt ? timeHM(row.endedAt) : '—'} />
        <Fin label="Отработал" value={durationLabel(row.durationMin)} />
        <Fin label="Оборот" value={money(row.turnover)} />
      </View>
      <View style={styles.historyActions}>
        <FastPressable onPress={onEdit} style={styles.smallAction}>
          <PwaIcon name="pencil" size={15} color={colors.textSecondary} strokeWidth={2} />
          <Text style={styles.smallActionText}>Редактировать время</Text>
        </FastPressable>
        {row.status !== 'closed' ? (
          <FastPressable onPress={onClose} style={[styles.smallAction, styles.warningAction]}>
            <Text style={styles.warningActionText}>Закрыть</Text>
          </FastPressable>
        ) : null}
      </View>
      {open ? <ShiftHistoryDetails row={row} /> : null}
    </View>
  );
}

function ShiftStatusBadge({ status }: { status: ShiftHistoryRow['status'] }) {
  const label = status === 'active' ? 'В смене' : status === 'unclosed' ? 'Не закрыта' : 'Завершена';
  const tone =
    status === 'active'
      ? { backgroundColor: colors.successSoft, color: colors.success }
      : status === 'unclosed'
        ? { backgroundColor: colors.warningSoft, color: colors.warning }
        : { backgroundColor: colors.slate100, color: colors.textSecondary };
  return (
    <View style={[styles.statusBadge, { backgroundColor: tone.backgroundColor }]}>
      <Text style={[styles.statusText, { color: tone.color }]}>{label}</Text>
    </View>
  );
}

function ShiftHistoryDetails({ row }: { row: ShiftHistoryRow }) {
  return (
    <View style={styles.details}>
      <Text style={styles.detailsTitle}>Детали смены:</Text>
      <DetailLine label="Начало" value={`${dateDMY(row.startedAt)} ${timeHM(row.startedAt)}`} />
      <DetailLine label="Окончание" value={row.endedAt ? `${dateDMY(row.endedAt)} ${timeHM(row.endedAt)}` : '—'} />
      <DetailLine label="Кто закрыл" value={row.closedBy ?? '—'} />
      <DetailLine label="Заказов" value={String(row.ordersCount)} />
      <DetailLine label="Оборот за смену" value={money(row.turnover)} />
      {row.orders.length > 0 ? (
        <View style={styles.orderList}>
          {row.orders.slice(0, 12).map((order) => (
            <View key={order.id} style={styles.orderLine}>
              <Text style={styles.orderNumber}>{displayOrderNumber(order.orderNumber)}</Text>
              <Text style={styles.orderAmount}>{money(order.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ShiftEditModal({ row, onClose }: { row: ShiftHistoryRow; onClose: () => void }) {
  const actions = useShiftHistoryActions();
  const push = useNotifications((s) => s.push);
  const [startedAt, setStartedAt] = useState(toDateTimeLocal(row.startedAt));
  const [endedAt, setEndedAt] = useState(toDateTimeLocal(row.endedAt));
  const [openShift, setOpenShift] = useState(!row.endedAt);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    try {
      await actions.update.mutateAsync({
        id: row.id,
        startedAt: fromDateTimeLocal(startedAt) ?? undefined,
        endedAt: openShift ? null : fromDateTimeLocal(endedAt),
      });
      push({ message: 'Смена обновлена', type: 'success', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title="Редактировать время смены"
      footer={<Button title="Сохранить" size="lg" loading={actions.update.isPending} onPress={submit} />}
    >
      <View style={{ gap: spacing.md }}>
        <Text style={styles.muted}>{row.employeeName} · {ROLE_LABEL[row.role]}</Text>
        <Field label="Начало смены">
          <TextInput
            style={styles.input}
            value={startedAt}
            onChangeText={setStartedAt}
            placeholder="YYYY-MM-DDTHH:mm"
            placeholderTextColor={colors.textLight}
          />
        </Field>
        <View style={styles.checkRow}>
          <Text style={styles.checkLabel}>Смена ещё открыта</Text>
          <Toggle checked={openShift} onChange={setOpenShift} />
        </View>
        {!openShift ? (
          <Field label="Окончание смены">
            <TextInput
              style={styles.input}
              value={endedAt}
              onChangeText={setEndedAt}
              placeholder="YYYY-MM-DDTHH:mm"
              placeholderTextColor={colors.textLight}
            />
          </Field>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
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
  historyFilters: { gap: spacing.sm },
  customDates: { flexDirection: 'row', gap: spacing.sm },
  customDateField: { flex: 1, minWidth: 0 },
  refreshBtn: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
  },
  disabled: { opacity: 0.6 },
  refreshText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },

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
  historyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  smallAction: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
  },
  smallActionText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  warningAction: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  warningActionText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.warning },
  statusBadge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  statusText: { fontSize: fontSize.xs, fontWeight: '600' },
  summaryBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.md,
    gap: 4,
  },
  summaryText: { fontSize: fontSize.sm, color: colors.textMuted },
  summaryValue: { fontWeight: '700', color: colors.textSecondary },

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
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 3 },
  detailLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  detailValue: { flex: 1, textAlign: 'right', fontSize: fontSize.sm, fontWeight: '600', color: colors.textSecondary },
  orderList: { marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  orderLine: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  orderNumber: { fontSize: fontSize.sm, color: colors.textSecondary },
  orderAmount: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },
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
