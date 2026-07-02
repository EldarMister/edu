import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Button, Toggle } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import {
  useAdminHalls,
  useHallMutations,
  useTableMutations,
  useTablesOverview,
  type AdminHall,
  type AdminTableItem,
} from '@/services/api/admin';
import type { TableStatus } from '@/types';
import { TableQrModal } from './TableQrModal';

/** Столы и залы (порт PWA TablesPage): аккордеон залов + CRUD. */
export function TablesScreen() {
  const overview = useTablesOverview();
  const hallsQ = useAdminHalls();
  const { remove: removeHall } = useHallMutations();
  const { remove: removeTable } = useTableMutations();
  const push = useNotifications((s) => s.push);

  const [hallModal, setHallModal] = useState<AdminHall | null | 'new'>(null);
  const [tableModal, setTableModal] = useState<{ hall: AdminHall; table: AdminTableItem | null } | null>(null);
  const [qrModal, setQrModal] = useState<{ table: AdminTableItem; hallName: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [accordionReady, setAccordionReady] = useState(false);

  const o = overview.data;
  const halls = hallsQ.data ?? [];

  useEffect(() => {
    if (accordionReady || halls.length === 0) return;
    setCollapsed(new Set(halls.slice(1).map((h) => h.id)));
    setAccordionReady(true);
  }, [accordionReady, halls]);

  const toggleHall = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const delHall = (h: AdminHall) =>
    Alert.alert('Удалить зал?', `Зал «${h.name}» будет удалён.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          removeHall
            .mutateAsync(h.id)
            .catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() })),
      },
    ]);

  const delTable = (t: AdminTableItem) =>
    Alert.alert('Удалить стол?', `Стол №${t.number} будет удалён.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          removeTable
            .mutateAsync(t.id)
            .catch((err) => push({ message: apiError(err), type: 'error', at: new Date().toISOString() })),
      },
    ]);

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <View style={styles.summary}>
            <Sum label="Залов" value={o ? String(o.hallsCount) : '—'} />
            <Sep />
            <Sum label="Столов" value={o ? String(o.tablesCount) : '—'} />
            <Sep />
            <Sum label="Активных" value={o ? String(o.activeTablesCount) : '—'} />
            <Sep />
            <Sum label="Занятых" value={o ? String(o.occupiedCount) : '—'} />
          </View>
        </View>
        <Button title="+ Добавить зал" variant="secondary" size="md" onPress={() => setHallModal('new')} />

        {hallsQ.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          halls.map((hall) => {
            const isCollapsed = collapsed.has(hall.id);
            return (
              <View key={hall.id} style={styles.hallCard}>
                <View style={[styles.hallHead, !isCollapsed && styles.hallHeadBorder]}>
                  <FastPressable style={styles.hallTitleBtn} onPress={() => toggleHall(hall.id)}>
                    <View style={isCollapsed ? undefined : styles.chevronUp}>
                      <PwaIcon name="chevronDown" size={16} color={colors.textSecondary} strokeWidth={2} />
                    </View>
                    <View style={{ minWidth: 0, flex: 1 }}>
                      <Text style={styles.hallName} numberOfLines={1}>
                        {hall.name}
                      </Text>
                      <Text style={styles.hallSub}>{hall.tables.length} столов</Text>
                    </View>
                  </FastPressable>
                  {!hall.isActive ? (
                    <View style={styles.offBadge}>
                      <Text style={styles.offBadgeText}>отключён</Text>
                    </View>
                  ) : null}
                  <View style={styles.hallActions}>
                    <FastPressable onPress={() => setTableModal({ hall, table: null })} style={styles.addTableBtn}>
                      <PwaIcon name="plus" size={14} color={colors.textPrimary} />
                      <Text style={styles.addTableText}>Стол</Text>
                    </FastPressable>
                    <IconBtn icon="pencil" onPress={() => setHallModal(hall)} />
                    <IconBtn icon="trash" danger onPress={() => delHall(hall)} />
                  </View>
                </View>

                {!isCollapsed ? (
                  hall.tables.length === 0 ? (
                    <Text style={styles.emptyTables}>В зале пока нет столов</Text>
                  ) : (
                    hall.tables.map((t, i) => (
                      <View key={t.id} style={[styles.tableRow, i > 0 && styles.tableRowBorder]}>
                        <View style={styles.tableLeft}>
                          <View style={styles.numBadge}>
                            <Text style={styles.numBadgeText}>{t.number}</Text>
                          </View>
                          <View style={{ minWidth: 0 }}>
                            <Text style={styles.tableName}>Стол {t.number}</Text>
                            <Text style={styles.tableSeats}>{t.seats} мест</Text>
                          </View>
                        </View>
                        <View style={styles.tableActions}>
                          <TableBadge status={t.status} />
                          <IconBtn icon="qr" onPress={() => setQrModal({ table: t, hallName: hall.name })} />
                          <IconBtn icon="pencil" onPress={() => setTableModal({ hall, table: t })} />
                          <IconBtn icon="trash" danger onPress={() => delTable(t)} />
                        </View>
                      </View>
                    ))
                  )
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {hallModal !== null ? (
        <HallModal hall={hallModal === 'new' ? null : hallModal} onClose={() => setHallModal(null)} />
      ) : null}
      {tableModal ? (
        <TableModal hall={tableModal.hall} table={tableModal.table} onClose={() => setTableModal(null)} />
      ) : null}
      {qrModal ? <TableQrModal table={qrModal.table} hallName={qrModal.hallName} onClose={() => setQrModal(null)} /> : null}
    </>
  );
}

function TableBadge({ status }: { status: TableStatus }) {
  const meta =
    status === 'free'
      ? { label: 'Свободен', bg: colors.successSoft, fg: colors.success }
      : status === 'ready'
        ? { label: 'Готов', bg: colors.primarySoft, fg: colors.primary }
        : { label: 'Готовится', bg: colors.orange100, fg: colors.orange600 };
  return (
    <View style={[styles.tableBadge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.tableBadgeText, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
}

function HallModal({ hall, onClose }: { hall: AdminHall | null; onClose: () => void }) {
  const isEdit = !!hall;
  const { create, update } = useHallMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(hall?.name ?? '');
  const [isActive, setIsActive] = useState(hall?.isActive ?? true);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  const onSubmit = async () => {
    setError('');
    if (!name.trim()) {
      setError('Укажите название');
      return;
    }
    try {
      if (isEdit) await update.mutateAsync({ id: hall!.id, name: name.trim(), isActive });
      else await create.mutateAsync({ name: name.trim() });
      push({ message: isEdit ? 'Зал обновлён' : 'Зал добавлен', at: new Date().toISOString() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={isEdit ? 'Изменить зал' : 'Новый зал'}
      footer={<Button title={isEdit ? 'Сохранить' : 'Добавить'} size="lg" loading={pending} onPress={onSubmit} />}
    >
      <Field label="Название зала">
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Основной зал" placeholderTextColor={colors.textLight} />
      </Field>
      {isEdit ? (
        <View style={styles.checkRow}>
          <Text style={styles.checkLabel}>Зал активен</Text>
          <Toggle checked={isActive} onChange={setIsActive} />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

function TableModal({ hall, table, onClose }: { hall: AdminHall; table: AdminTableItem | null; onClose: () => void }) {
  const isEdit = !!table;
  const { create, update } = useTableMutations();
  const push = useNotifications((s) => s.push);
  const [number, setNumber] = useState(table ? String(table.number) : '');
  const [seats, setSeats] = useState(table ? String(table.seats) : '2');
  const [isActive, setIsActive] = useState(table?.isActive ?? true);
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  const onSubmit = async () => {
    setError('');
    if (!number || !seats) {
      setError('Укажите номер и количество мест');
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: table!.id, number: Number(number), seats: Number(seats), isActive });
        push({ message: 'Стол обновлён', at: new Date().toISOString() });
      } else {
        await create.mutateAsync({ hallId: hall.id, number: Number(number), seats: Number(seats) });
        push({ message: 'Стол добавлен', at: new Date().toISOString() });
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
      title={isEdit ? `Стол №${table!.number}` : `Новый стол · ${hall.name}`}
      footer={<Button title={isEdit ? 'Сохранить' : 'Добавить'} size="lg" loading={pending} onPress={onSubmit} />}
    >
      <View style={styles.grid2}>
        <Field label="Номер стола" style={{ flex: 1 }}>
          <TextInput style={styles.input} value={number} onChangeText={setNumber} keyboardType="number-pad" />
        </Field>
        <Field label="Мест" style={{ flex: 1 }}>
          <TextInput style={styles.input} value={seats} onChangeText={setSeats} keyboardType="number-pad" />
        </Field>
      </View>
      {isEdit ? (
        <View style={styles.checkRow}>
          <Text style={styles.checkLabel}>Стол активен</Text>
          <Toggle checked={isActive} onChange={setIsActive} />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={style}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function IconBtn({ icon, onPress, danger }: { icon: 'pencil' | 'trash' | 'qr'; onPress: () => void; danger?: boolean }) {
  return (
    <FastPressable onPress={onPress} hitSlop={6} style={styles.iconBtn}>
      <PwaIcon name={icon} size={16} color={danger ? colors.danger : colors.textMuted} strokeWidth={2} />
    </FastPressable>
  );
}

function Sum({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.sumText}>
      {label}: <Text style={styles.sumValue}>{value}</Text>
    </Text>
  );
}
function Sep() {
  return <Text style={styles.sumSep}>|</Text>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  sumText: { fontSize: fontSize.sm, color: colors.textSecondary },
  sumValue: { fontWeight: '500', color: colors.textPrimary },
  sumSep: { fontSize: fontSize.sm, color: colors.textLight },
  center: { paddingVertical: 60, alignItems: 'center' },

  hallCard: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, borderRadius: radius.md, overflow: 'hidden' },
  hallHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 12 },
  hallHeadBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  hallTitleBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
  chevronUp: { transform: [{ rotate: '180deg' }] },
  hallName: { fontSize: fontSize.base, fontWeight: '600', color: colors.textPrimary },
  hallSub: { fontSize: fontSize.xs, color: colors.textMuted },
  offBadge: { borderRadius: radius.sm, backgroundColor: colors.slate100, paddingHorizontal: 8, paddingVertical: 2 },
  offBadgeText: { fontSize: fontSize.xs, color: colors.textMuted },
  hallActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  addTableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    height: 32,
  },
  addTableText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  iconBtn: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },

  emptyTables: { paddingHorizontal: spacing.md, paddingVertical: spacing.lg, textAlign: 'center', fontSize: fontSize.sm, color: colors.textMuted },
  tableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  tableRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  tableLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0, flex: 1 },
  numBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBadgeText: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  tableName: { fontSize: fontSize.base, fontWeight: '500', color: colors.textPrimary },
  tableSeats: { fontSize: fontSize.xs, color: colors.textMuted },
  tableActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tableBadge: { borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 2 },
  tableBadgeText: { fontSize: fontSize.xs, fontWeight: '500' },

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
  grid2: { flexDirection: 'row', gap: spacing.md },
  checkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  checkLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  error: { marginTop: spacing.sm, fontSize: fontSize.sm, color: colors.danger },
});
