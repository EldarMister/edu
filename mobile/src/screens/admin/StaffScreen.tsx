import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, type View as NativeView } from 'react-native';
import { useDeletionParticles } from '@/components/DeletionParticles';
import { Alert, Text, TextInput } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { DateField } from '@/components/DateField';
import { Button, Toggle } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { usePrepStations } from '@/services/api/prepStations';
import { displayOrderNumber, money, timeHM } from '@/utils/format';
import { financeMoney } from '@/features/finance/format';
import {
  useReportEmployees,
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
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/store/auth';
import { AdminLoadingSkeleton } from './AdminLoadingSkeleton';
import { WarehouseDirectorySearch } from './WarehouseDirectoryTable';
import { useAssignableStaffPositions } from '@/services/api/positions';
import { WaiterOrdersReport } from './WaiterOrdersReport';
import { shareCsv } from './print';
import { ShiftDateTimeField } from './ShiftDateTimeField';

const ROLE_LABEL: Record<Role, string> = {
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
  ADMIN: 'Администратор',
  OWNER: 'Владелец',
};

type StaffTab = 'current' | 'history' | 'waiter';
type StaffStatus = '' | 'active' | 'inactive';
const STATUS_OPTIONS: { value: StaffStatus; label: string }[] = [
  { value: '', label: 'Все статусы' },
  { value: 'active', label: 'Активные' },
  { value: 'inactive', label: 'Неактивные' },
];
const positionKey = (member: StaffMember) => member.positionId ?? member.role;

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
export function StaffScreen({ initialTab = 'current', onOpenCashHandover }: {
  initialTab?: StaffTab;
  onOpenCashHandover?: (date: string, employeeId: string) => void;
} = {}) {
  const { width } = useWindowDimensions();
  const { stations } = usePrepStations();
  const stationNames = useMemo(() => new Map(stations.map(({ id, name }) => [id, name])), [stations]);
  const [date, setDate] = useState(todayYmd());
  const [tab, setTab] = useState<StaffTab>(initialTab);
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState('');
  const [status, setStatus] = useState<StaffStatus>('');
  const [deleting, setDeleting] = useState<{ id: string; name: string; play?: () => void } | null>(null);
  const [deleteName, setDeleteName] = useState('');
  const [historyFilters, setHistoryFilters] = useState<ShiftHistoryFilters>({ period: 'today' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState<string | null>(null);
  const [editingShift, setEditingShift] = useState<ShiftHistoryRow | null>(null);
  const [editing, setEditing] = useState<StaffMember | null | 'new'>(null);
  const [exporting, setExporting] = useState(false);
  const particles = useDeletionParticles();
  const currentUserId = useAuth((state) => state.user?.id);
  const { isOwner, canAction, canEditSection, canSection } = usePermissions();
  const mayManageStaff = canEditSection('staff') && canAction('manageStaff');
  const mayCloseShift = canEditSection('staff') && canAction('closeShift');

  const reportQ = useShiftReport(date, tab === 'current');
  const historyQ = useShiftHistory(historyFilters, tab === 'history');
  const shiftActions = useShiftHistoryActions();
  const staffQ = useStaff('', '');
  const reportEmployees = useReportEmployees(tab !== 'current');
  const { remove } = useStaffMutations();
  const push = useNotifications((s) => s.push);
  const memberById = useMemo(() => new Map((staffQ.data ?? []).map((member) => [member.id, member])), [staffQ.data]);
  const positions = useMemo(() => {
    const options = new Map((staffQ.data ?? []).map((member) => [
      positionKey(member), member.positionName ?? ROLE_LABEL[member.role],
    ]));
    return [{ value: '', label: 'Все должности' }, ...Array.from(options, ([value, label]) => ({
      value, label, translate: false,
    })).sort((a, b) => a.label.localeCompare(b.label, 'ru'))];
  }, [staffQ.data]);
  const query = search.trim().toLocaleLowerCase('ru');
  const phoneQuery = query.replace(/[^\d]/g, '');
  const looksLikePhone = phoneQuery && /^[+\d ()-]+$/.test(query);
  const rows = (reportQ.data ?? []).filter((row) => {
    const member = memberById.get(row.waiterId);
    return (!position || !!member && positionKey(member) === position)
      && (!status || member?.isActive === (status === 'active'))
      && (!query || row.name.toLocaleLowerCase('ru').includes(query)
        || !!looksLikePhone && !!member?.phone.replace(/[^\d]/g, '').includes(phoneQuery));
  }).sort((a, b) => Number(b.role === 'WAITER') - Number(a.role === 'WAITER') || a.name.localeCompare(b.name, 'ru'));
  const positionName = (member: StaffMember | undefined, role: Role) => member?.positionName
    ?? stationNames.get(member?.prepStation ?? (role === 'KITCHEN' ? 'kitchen' : role === 'BAR' ? 'bar' : ''))
    ?? ROLE_LABEL[role];
  const exportReport = async () => {
    setExporting(true);
    try {
      if (tab === 'current') await shareCsv(`shift-report-${date}`, [
        ['Сотрудник', 'Должность', 'Смена', 'Оборот', 'Касса (должен)', 'Касса (сдал)', 'Разница'],
        ...rows.map((row) => [row.name, positionName(memberById.get(row.waiterId), row.role), ...(row.isWaiter ? [shiftLabel(row), row.turnover, row.cashDue, row.cashHanded, row.difference] : ['—', '—', '—', '—', '—'])]),
      ]);
      else await shareCsv(`shift-history-${historyFilters.period}-${todayYmd()}`, [
        ['Сотрудник', 'Роль', 'Дата', 'Пришел', 'Ушел', 'Отработал', 'Статус'],
        ...(historyQ.data?.items ?? []).map((row) => [row.employeeName, ROLE_LABEL[row.role], dateDMY(row.startedAt), timeHM(row.startedAt), row.endedAt ? timeHM(row.endedAt) : '—', durationLabel(row.durationMin), row.status === 'active' ? 'В смене' : row.status === 'unclosed' ? 'Не закрыта' : 'Завершена']),
      ]);
    } catch (error) { push({ message: apiError(error), type: 'error', at: new Date().toISOString() }); }
    finally { setExporting(false); }
  };
  const staffOptions = useMemo(
    () => [
      { value: '', label: 'Все сотрудники' },
      ...(reportEmployees.data ?? staffQ.data ?? []).map((m) => ({ value: m.id, label: m.name })),
    ],
    [reportEmployees.data, staffQ.data],
  );

  const delMember = (id: string, name: string) => {
    setDeleteName('');
    setDeleting({ id, name, play: particles.capture(id) });
  };

  async function confirmDelete() {
    if (!deleting || !mayManageStaff || remove.isPending || deleteName.trim() !== deleting.name.trim()) return;
    try {
      await remove.mutateAsync(deleting.id);
      deleting.play?.();
      setDeleting(null);
      push({ message: 'Сотрудник удалён', at: new Date().toISOString() });
    } catch (error) {
      push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
    }
  }

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
    <View style={styles.particleFrame}>
      <SheetScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'current' || tab === 'history' ? <View style={styles.staffToolbar}>
          <Text style={styles.staffTitle} translate>Персонал и отчет по сменам</Text>
          <View style={styles.staffToolbarActions}>
            {tab === 'current' ? <>
              <Text style={styles.toolbarLabel} translate>Дата смены:</Text>
              <View style={{ width: 152 }}><DateField style={{ height: 36 }} value={date} onChangeText={setDate} maximumDate={new Date()} accessibilityLabel="Дата смены" /></View>
              <Button title="Обновить" size="md" style={styles.toolbarButton} variant="secondary" loading={reportQ.isFetching || staffQ.isFetching} onPress={() => { void reportQ.refetch(); void staffQ.refetch(); }} />
              {canAction('exportReports') ? <Button title="Экспорт" size="md" style={styles.toolbarButton} variant="secondary" disabled={!rows.length} loading={exporting} onPress={() => void exportReport()} /> : null}
            </> : null}
            {mayManageStaff ? <FastPressable style={styles.addStaff} onPress={() => setEditing('new')}><PwaIcon name="plus" size={16} color={colors.white} /><Text style={styles.addStaffText} translate>Добавить сотрудника</Text></FastPressable> : null}
          </View>
        </View> : null}

        <SheetScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          <TabBtn active={tab === 'current'} label="Текущая смена" onPress={() => setTab('current')} />
          <TabBtn active={tab === 'history'} label="История смен" onPress={() => setTab('history')} />
          <TabBtn active={tab === 'waiter'} label="Отчёт официанта" onPress={() => setTab('waiter')} />
        </SheetScrollView>

        {tab === 'current' ? (
          <>
            <AnchoredSelectScope>
              <View style={styles.staffFilters}>
                <WarehouseDirectorySearch label="Поиск сотрудника" value={search} onChange={setSearch} />
                <Select value={position} options={positions} onChange={setPosition} title="Должность" searchable style={styles.filterField} />
                <Select value={status} options={STATUS_OPTIONS} onChange={setStatus} title="Статус" style={styles.filterField} />
              </View>
            </AnchoredSelectScope>
            {reportQ.isLoading || staffQ.isLoading ? (
              <AdminLoadingSkeleton />
            ) : reportQ.isError || staffQ.isError ? (
              <Text style={styles.error} accessibilityRole="alert">{apiError(reportQ.error ?? staffQ.error)}</Text>
            ) : rows.length === 0 ? (
              <Text style={styles.empty} translate>{query || position || status ? 'Сотрудники не найдены' : 'Нет данных за выбранную дату'}</Text>
            ) : (
              <View style={styles.staffTableCard}><SheetScrollView horizontal showsHorizontalScrollIndicator><View style={{ width: STAFF_TABLE_WIDTH }}>
              <View style={styles.staffTableHead}>{STAFF_COLUMNS.map((column, index) => <Text key={index} style={[styles.staffTableHeading, { width: column.width, textAlign: column.right ? 'right' : 'left' }]} translate>{column.label}</Text>)}</View>
              {rows.map((row) => {
                const member = memberById.get(row.waiterId);
                const canManage = mayManageStaff && member && (member.canManage ?? isOwner);
                return <ShiftRow
                  key={row.waiterId}
                  rowRef={(view) => particles.register(row.waiterId, view)}
                  row={row}
                  positionName={positionName(member, row.role)}
                  inactive={member?.isActive === false}
                  date={date}
                  onOpenCashHandover={canSection('finance') && onOpenCashHandover
                    ? () => onOpenCashHandover(date, row.waiterId) : undefined}
                  open={expanded === row.waiterId}
                  onToggle={() => setExpanded((cur) => (cur === row.waiterId ? null : row.waiterId))}
                  onEdit={canManage ? () => setEditing(member) : undefined}
                  onDelete={canManage && row.role !== 'OWNER' && row.waiterId !== currentUserId ? () => delMember(row.waiterId, row.name) : undefined}
                />;
              })}</View></SheetScrollView></View>
            )}
          </>
        ) : tab === 'waiter' ? <WaiterOrdersReport staff={reportEmployees.data ?? staffQ.data ?? []} staffLoading={reportEmployees.isLoading && staffQ.isLoading} /> : (
          <>
            <HistoryFilters
              filters={historyFilters}
              setFilters={setHistoryFilters}
              staffOptions={staffOptions}
              loading={historyQ.isFetching}
              onRefresh={() => historyQ.refetch()}
            />
            {canAction('exportReports') ? <Button title="Экспорт CSV" variant="secondary" disabled={!historyQ.data?.items.length} loading={exporting} onPress={() => void exportReport()} /> : null}
            {historyQ.isError ? <Text style={{ color: colors.danger }}>{apiError(historyQ.error)}</Text> : null}
            <ShiftHistoryList
              data={historyQ.data}
              isLoading={historyQ.isLoading}
              expanded={historyExpanded}
              onToggle={(id) => setHistoryExpanded((current) => (current === id ? null : id))}
              onEdit={mayManageStaff ? setEditingShift : undefined}
              onClose={mayCloseShift ? closeShift : undefined}
            />
          </>
        )}
      </SheetScrollView>

      {deleting && (
        <BottomSheet visible title="Удаление сотрудника" presentation={width >= 768 ? 'dialog' : 'bottom'}
          dismissible={!remove.isPending} onClose={() => setDeleting(null)}
          footer={<View style={styles.deleteActions}>
            <Button title="Отмена" variant="secondary" onPress={() => setDeleting(null)} disabled={remove.isPending} />
            <Button title="Удалить" variant="danger" onPress={() => void confirmDelete()} loading={remove.isPending}
              disabled={!mayManageStaff || deleteName.trim() !== deleting.name.trim()} />
          </View>}
        >
          <View style={styles.content}>
            <Text translate>Введите имя сотрудника для подтверждения удаления.</Text>
            <Text style={styles.staffName}>{deleting.name}</Text>
            <TextInput accessibilityLabel="Имя сотрудника для подтверждения" autoCorrect={false}
              value={deleteName} onChangeText={setDeleteName} editable={!remove.isPending} style={styles.input} />
          </View>
        </BottomSheet>
      )}
      {editing !== null ? (
        <StaffModal member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
      {editingShift ? <ShiftEditModal row={editingShift} onClose={() => setEditingShift(null)} /> : null}
      {particles.overlay}
    </View>
  );
}

const STAFF_COLUMNS = [{ label: '', width: 36 }, { label: 'Сотрудник / Роль', width: 180 }, { label: 'Смена', width: 130 }, { label: 'Оборот', width: 110, right: true }, { label: 'Касса (должен)', width: 130, right: true }, { label: 'Касса (сдал)', width: 130, right: true }, { label: 'Разница', width: 110, right: true }, { label: 'Действия', width: 90, right: true }];
const STAFF_TABLE_WIDTH = STAFF_COLUMNS.reduce((total, column) => total + column.width, 0);

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
            <DateField label="С даты" value={filters.from ?? ''} onChangeText={(from) => setFilters((current) => ({ ...current, from }))} />
          </View>
          <View style={styles.customDateField}>
            <DateField label="По дату" value={filters.to ?? ''} onChangeText={(to) => setFilters((current) => ({ ...current, to }))} />
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
        <Text style={styles.refreshText} translate>Обновить</Text>
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
  onEdit?: (row: ShiftHistoryRow) => void;
  onClose?: (row: ShiftHistoryRow) => void;
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
    return <Text style={styles.empty} translate>Нет смен за выбранный период</Text>;
  }
  return (
    <View style={styles.staffTableCard}>
      <SheetScrollView horizontal showsHorizontalScrollIndicator><View style={{ width: HISTORY_TABLE_WIDTH }}>
      <View style={styles.staffTableHead}>{HISTORY_COLUMNS.map((column, index) => <Text key={index} style={[styles.staffTableHeading, { width: column.width, textAlign: index === HISTORY_COLUMNS.length - 1 ? 'right' : 'left' }]} translate>{column.label}</Text>)}</View>
      {rows.map((row) => (
        <ShiftHistoryCard
          key={row.id}
          row={row}
          open={expanded === row.id}
          onToggle={() => onToggle(row.id)}
          onEdit={onEdit ? () => onEdit(row) : undefined}
          onClose={onClose ? () => onClose(row) : undefined}
        />
      ))}
      </View></SheetScrollView><View style={styles.historySummary}>
        <Text style={styles.summaryText} translate>Всего смен: <Text style={styles.summaryValue}>{data?.summary.shiftsCount ?? 0}</Text></Text>
        <Text style={styles.summaryText} translate>Общая выработка: <Text style={styles.summaryValue}>{durationLabel(data?.summary.totalDurationMin ?? 0)}</Text></Text>
        <Text style={styles.summaryText} translate>В смене сейчас: <Text style={styles.summaryValue}>{data?.summary.activeCount ?? 0}</Text></Text>
      </View>
    </View>
  );
}

const HISTORY_COLUMNS = [{ label: '', width: 36 }, { label: 'Сотрудник / роль', width: 200 }, { label: 'Дата', width: 120 }, { label: 'Пришел', width: 90 }, { label: 'Ушел', width: 90 }, { label: 'Отработал', width: 120 }, { label: 'Статус', width: 130 }, { label: 'Действия', width: 130 }];
const HISTORY_TABLE_WIDTH = HISTORY_COLUMNS.reduce((total, column) => total + column.width, 0);

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
  onEdit?: () => void;
  onClose?: () => void;
}) {
  return (
    <View>
      <FastPressable onPress={onToggle} style={styles.staffTableRow}>
        <View style={[styles.staffCell, { width: 36, paddingHorizontal: 8 }]}>
        <View style={open ? styles.chevronUp : undefined}>
          <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
        </View>
        </View><View style={[styles.staffCell, { width: 200 }]}>
          <Text style={styles.staffName} numberOfLines={1}>{row.employeeName}</Text>
          <Text style={styles.staffRole}>{ROLE_LABEL[row.role]}</Text>
        </View>
        <Text style={[styles.staffCellText, { width: 120 }]}>{dateDMY(row.startedAt)}</Text>
        <Text style={[styles.staffCellText, { width: 90 }]}>{timeHM(row.startedAt)}</Text>
        <Text style={[styles.staffCellText, { width: 90 }]}>{row.endedAt ? timeHM(row.endedAt) : '—'}</Text>
        <Text style={[styles.staffCellText, styles.staffCellStrong, { width: 120 }]}>{durationLabel(row.durationMin)}</Text>
        <View style={[styles.staffCell, { width: 130 }]}><ShiftStatusBadge status={row.status} /></View>
      <View style={[styles.actions, { width: 130, justifyContent: 'flex-end', paddingHorizontal: 12 }]}>
        {onEdit && <FastPressable onPress={onEdit} style={styles.iconBtn} accessibilityLabel="Редактировать время смены">
          <PwaIcon name="pencil" size={15} color={colors.textSecondary} strokeWidth={2} />
        </FastPressable>}
        {onClose && row.status !== 'closed' ? (
          <FastPressable onPress={onClose} style={[styles.smallAction, styles.warningAction]}>
            <Text style={styles.warningActionText} translate>Закрыть</Text>
          </FastPressable>
        ) : null}
      </View></FastPressable>
      {open ? <View style={styles.staffExpanded}><ShiftHistoryDetails row={row} /></View> : null}
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
      <Text style={[styles.statusText, { color: tone.color }]} translate>{label}</Text>
    </View>
  );
}

function ShiftHistoryDetails({ row }: { row: ShiftHistoryRow }) {
  return (
    <View style={styles.details}>
      <Text style={styles.detailsTitle} translate>Детали смены:</Text>
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
      <Text style={styles.detailLabel} translate>{label}</Text>
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
        <ShiftDateTimeField label="Начало смены" value={startedAt} onChange={setStartedAt} />
        <View style={styles.checkRow}>
          <Text style={styles.checkLabel} translate>Смена ещё открыта</Text>
          <Toggle checked={openShift} onChange={setOpenShift} />
        </View>
        {!openShift ? (
          <ShiftDateTimeField label="Окончание смены" value={endedAt} onChange={setEndedAt} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

function ShiftRow({
  rowRef,
  row,
  positionName,
  inactive,
  date,
  onOpenCashHandover,
  open,
  onToggle,
  onEdit,
  onDelete,
}: {
  rowRef: (view: NativeView | null) => void;
  row: ShiftReportRow;
  positionName: string;
  inactive: boolean;
  date: string;
  onOpenCashHandover?: () => void;
  open: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const isWaiter = row.isWaiter;
  const diffColor =
    Math.round(row.difference) === 0 ? colors.textSecondary : row.difference > 0 ? colors.success : colors.danger;

  return (
    <View ref={rowRef} collapsable={false}>
      <FastPressable onPress={isWaiter ? onToggle : undefined} style={styles.staffTableRow}>
        <View style={[styles.staffCell, { width: 36, paddingHorizontal: 8 }]}>
          {isWaiter ? (
              <View style={open ? styles.chevronUp : undefined}>
                <PwaIcon name="chevronDown" size={14} color={colors.textMuted} strokeWidth={2} />
              </View>
            ) : null}
        </View>
        <View style={[styles.staffCell, { width: 180 }]}>
            <Text style={styles.staffName} numberOfLines={1}>
              {row.name}
            </Text>
          <Text style={styles.staffRole} numberOfLines={1}>{positionName}</Text>
          {inactive && <Text style={styles.staffRole} translate>Неактивен</Text>}
        </View>
        {isWaiter ? <>
          <Text style={[styles.staffCellText, { width: 130 }]}>{shiftLabel(row)}</Text>
          <Text style={[styles.staffCellText, styles.staffCellStrong, { width: 110, textAlign: 'right' }]}>{money(row.turnover)}</Text>
          <Text style={[styles.staffCellText, { width: 130, textAlign: 'right' }]}>{money(row.cashDue)}</Text>
          <View style={[styles.staffCell, { width: 130, alignItems: 'flex-end' }]}><CashHandedCell row={row} date={date} onOpenCashHandover={onOpenCashHandover} /></View>
          <Text style={[styles.staffCellText, { width: 110, textAlign: 'right', color: diffColor }]}>{signedMoney(row.difference)}</Text>
        </> : <Text style={[styles.staffCellText, { width: 610, textAlign: 'center', color: colors.textLight }]}>—</Text>}
        <View style={[styles.actions, { width: 90, justifyContent: 'flex-end', paddingHorizontal: 12 }]}>
          {onEdit ? <FastPressable onPress={onEdit} hitSlop={6} style={styles.iconBtn} accessibilityLabel="Редактировать сотрудника">
            <PwaIcon name="pencil" size={16} color={colors.textMuted} strokeWidth={2} />
          </FastPressable> : null}
          {onDelete ? <FastPressable onPress={onDelete} hitSlop={6} style={styles.iconBtn} accessibilityLabel="Удалить сотрудника">
            <PwaIcon name="trash" size={16} color={colors.danger} strokeWidth={2} />
          </FastPressable> : null}
        </View>
      </FastPressable>
      {isWaiter && open ? <View style={styles.staffExpanded}><ShiftDetails row={row} /></View> : null}
    </View>
  );
}

function Fin({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.finItem}>
      <Text style={styles.finLabel} translate>{label}</Text>
      <Text style={[styles.finValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

function CashHandedCell({ row, date, onOpenCashHandover }: {
  row: ShiftReportRow;
  date: string;
  onOpenCashHandover?: () => void;
}) {
  const { canEditSection, canAction } = usePermissions();
  const canSetCash = canEditSection('staff') && canAction('closeShift');
  const setCash = useSetCashHanded();
  const push = useNotifications((s) => s.push);
  const [val, setVal] = useState(row.cashHanded ? String(row.cashHanded) : '');
  useEffect(() => {
    setVal(row.cashHanded ? String(row.cashHanded) : '');
  }, [row.cashHanded]);

  const commit = () => {
    if (!canSetCash) return;
    const num = Number(val.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) { push({ message: 'Сданная сумма должна быть неотрицательным числом', type: 'error', at: new Date().toISOString() }); return; }
    if (num === row.cashHanded) return;
    setCash.mutate({ waiterId: row.waiterId, date, cashHanded: num }, { onError: (error) => push({ message: apiError(error), type: 'error', at: new Date().toISOString() }) });
  };

  if (row.cashHandover) {
    const amount = financeMoney(row.cashReceivedAt || row.cashHanded ? row.cashHanded : null);
    return onOpenCashHandover
      ? <FastPressable onPress={onOpenCashHandover} accessibilityRole="button" accessibilityLabel="Открыть сдачу наличных">
        <Text style={[styles.staffCellText, { color: colors.primary }]} translate>{amount === '—' ? 'Сдача наличных' : amount}</Text>
      </FastPressable>
      : <Text style={styles.staffCellText}>{amount}</Text>;
  }
  if (!canSetCash) return <Text style={styles.staffCellText}>{money(row.cashHanded)}</Text>;

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
      <Text style={styles.detailsTitle} translate>Товарная разбивка:</Text>
      {row.categories.length === 0 ? (
        <Text style={styles.muted} translate>Продаж нет</Text>
      ) : (
        row.categories.map((cat) => <CategoryRow key={cat.categoryId} cat={cat} />)
      )}

      <Text style={[styles.detailsTitle, { marginTop: spacing.md }]} translate>
        Отменённые чеки ({row.cancellations.length}):
      </Text>
      {row.cancellations.length === 0 ? (
        <Text style={styles.muted} translate>Отмен нет</Text>
      ) : (
        row.cancellations.map((c, i) => (
          <Text key={i} style={styles.cancelLine} translate>
            <Text style={styles.muted}>{timeHM(c.time)}</Text> — {c.name}{' '}
            <Text style={styles.detailPrimary}>({money(c.amount)})</Text>
            <Text style={styles.muted} translate> — Причина: {c.reason}</Text>
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
        <Text style={styles.catQty} translate>
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
                <Text style={styles.catItemQty} translate>
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
                      <Text style={styles.compQty} translate>{c.qty} шт.</Text>
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
  const [positionId, setPositionId] = useState(member?.positionId ?? '');
  const [prepStation, setPrepStation] = useState(member?.prepStation ?? '');
  const currentUser = useAuth((state) => state.user);
  const canAssignPosition = member?.role !== 'OWNER' && (!member || member.id !== currentUser?.id);
  const positions = useAssignableStaffPositions(canAssignPosition);
  const { stations } = usePrepStations();
  const assignedPosition = positions.data?.find((position) => position.id === positionId);
  const role = assignedPosition?.role ?? member?.role;
  const hasStation = role === 'KITCHEN' || role === 'BAR';
  const positionOptions = (positions.data ?? []).map(({ id, name: label }) => ({ value: id, label, translate: false }));
  if (member?.positionId && !positionOptions.some(({ value }) => value === member.positionId)) {
    positionOptions.push({ value: member.positionId, label: member.positionName ?? ROLE_LABEL[member.role], translate: !member.positionName });
  }
  const hasValidAssignment = !canAssignPosition || (positions.isSuccess && !!assignedPosition);
  const stationOptions = [
    { value: '', label: role === 'BAR' ? 'Бар (по умолчанию)' : 'Кухня (по умолчанию)', translate: true },
    ...stations.filter((station) => (station.isActive || station.id === prepStation) && station.id !== (role === 'BAR' ? 'kitchen' : 'bar'))
      .map(({ id, name: label, isBuiltIn, isActive: active }) => ({ value: id, label: label + (active ? '' : ' · неактивен'), translate: isBuiltIn && active })),
  ];
  if (prepStation && !stationOptions.some(({ value }) => value === prepStation)) {
    stationOptions.push({ value: prepStation, label: 'Текущий цех недоступен', translate: true });
  }
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(member?.isActive ?? true);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  const onSubmit = async () => {
    setError('');
    if (!hasValidAssignment || pending) return;
    const assignment = { ...(canAssignPosition ? { positionId } : {}), ...(hasStation ? { prepStation: prepStation || null } : {}) };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: member!.id, name, ...(phone !== member!.phone ? { phone } : {}), isActive, ...assignment, ...(password ? { password } : {}) });
        push({ message: 'Сотрудник обновлён', at: new Date().toISOString() });
      } else {
        if (!password) {
          setError('Укажите пароль');
          return;
        }
        await create.mutateAsync({ name, phone, password, ...assignment, positionId });
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
      footer={<Button title={isEdit ? 'Сохранить' : 'Добавить'} size="lg" loading={pending} disabled={!hasValidAssignment} onPress={onSubmit} />}
    >
      <View style={{ gap: spacing.md }}>
        <Field label="Имя">
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={colors.textLight} />
        </Field>
        <Field label="Телефон">
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholderTextColor={colors.textLight} />
        </Field>
        {canAssignPosition ? <Field label="Должность">
          <Select value={positionId} onChange={(id) => { setPositionId(id); if (id !== member?.positionId) setPrepStation(''); }}
            options={positionOptions} title="Должность" placeholder="Выберите должность" disabled={positions.isLoading} />
          {positions.isError ? <Text style={styles.error}>{apiError(positions.error)}</Text> : null}
        </Field> : <Field label="Должность"><Text style={styles.checkLabel}>{member?.positionName ?? ROLE_LABEL[member?.role ?? 'OWNER']}</Text></Field>}
        {hasStation ? <Field label="Цех приготовления">
          <Select value={prepStation} onChange={setPrepStation} options={stationOptions} title="Цех приготовления" />
        </Field> : null}
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
            <Text style={styles.checkLabel} translate>Активен (может входить)</Text>
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
      <Text style={[styles.tabText, active && styles.tabTextActive]} translate>{label}</Text>
    </FastPressable>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.fieldLabel} translate>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  particleFrame: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  staffToolbar: { gap: 12 },
  staffFilters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  filterField: { minWidth: 140 },
  deleteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  staffTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
  staffToolbarActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  toolbarLabel: { fontSize: 14, color: colors.textSecondary },
  toolbarButton: { height: 36, borderRadius: 8, paddingHorizontal: 12 },
  addStaff: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.primary },
  addStaffText: { fontSize: 14, fontWeight: '500', color: colors.white },
  staffTableCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white, overflow: 'hidden' },
  staffTableHead: { flexDirection: 'row', backgroundColor: colors.background, borderBottomWidth: 1, borderColor: colors.border },
  staffTableHeading: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 12, fontWeight: '500', color: colors.textMuted },
  staffTableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border },
  staffCell: { paddingHorizontal: 12, paddingVertical: 10 },
  staffCellText: { paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.textSecondary },
  staffCellStrong: { fontWeight: '500', color: colors.textPrimary },
  staffExpanded: { paddingHorizontal: 12, paddingBottom: 12, backgroundColor: colors.background },
  historySummary: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.background },
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
  staffName: { fontSize: 14, fontWeight: '500', color: colors.textPrimary, flexShrink: 1 },
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
