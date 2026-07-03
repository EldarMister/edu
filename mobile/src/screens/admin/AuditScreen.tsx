import React, { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Select } from '@/components/Select';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import { timeHM } from '@/utils/format';
import { useAuditFilters, useAuditLogs, type AuditLogEntry } from '@/services/api/admin';

const ACTION_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Создание заказа',
  ORDER_CANCELLED: 'Отмена заказа',
  ORDER_UPDATED: 'Изменение заказа',
  ORDER_PAID: 'Оплата',
  ORDER_PAYMENT_METHOD_CHANGED: 'Смена способа оплаты',
  ORDER_ITEM_ADDED: 'Добавление блюда',
  ORDER_ITEM_REMOVED: 'Удаление блюда',
  ORDER_ITEM_QUANTITY_CHANGED: 'Изменение количества',
  TABLE_CLOSED: 'Закрытие стола',
  TABLE_MOVED: 'Перенос стола',
  TABLE_TRANSFERRED: 'Передача стола',
  MENU_ITEM_CREATED: 'Добавление блюда (меню)',
  MENU_ITEM_UPDATED: 'Изменение меню',
  MENU_ITEM_DELETED: 'Удаление блюда (меню)',
  MENU_ITEM_PRICE_CHANGED: 'Изменение цены',
  CATEGORY_CREATED: 'Добавление категории',
  CATEGORY_UPDATED: 'Изменение категории',
  CATEGORY_DELETED: 'Удаление категории',
  STAFF_CREATED: 'Добавление сотрудника',
  STAFF_UPDATED: 'Изменение сотрудника',
  STAFF_DELETED: 'Удаление сотрудника',
  SETTINGS_UPDATED: 'Изменение настроек',
};

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  WAITER: 'Официант',
  KITCHEN: 'Кухня',
  BAR: 'Бар',
};

function actionTone(action: string): { bg: string; fg: string } {
  if (action.includes('CANCELLED') || action.includes('DELETED') || action.includes('REMOVED'))
    return { bg: colors.dangerSoft, fg: colors.danger };
  if (action.includes('PAID')) return { bg: colors.successSoft, fg: colors.success };
  if (action.includes('PRICE') || action.includes('TRANSFERRED') || action.includes('MOVED'))
    return { bg: colors.warningSoft, fg: colors.warning };
  if (action.includes('CREATED')) return { bg: colors.primarySoft, fg: colors.primary };
  return { bg: colors.background, fg: colors.textSecondary };
}

/** Журнал действий (владелец) — порт PWA AuditPage (фильтры дат опущены — нужен date-picker). */
export function AuditScreen() {
  const [userId, setUserId] = useState('');
  const [actionType, setActionType] = useState('');
  const [page, setPage] = useState(1);

  const filtersQ = useAuditFilters();
  const logsQ = useAuditLogs({ userId, actionType, page });
  const data = logsQ.data;

  const userOptions = [
    { value: '', label: 'Все' },
    ...(filtersQ.data?.users ?? []).map((u) => ({ value: u.id, label: u.name })),
  ];
  const actionOptions = [
    { value: '', label: 'Все' },
    ...(filtersQ.data?.actionTypes ?? []).map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a })),
  ];

  const header = (
    <View style={styles.filters}>
      <Field label="Сотрудник">
        <Select value={userId} onChange={(v) => { setUserId(v); setPage(1); }} options={userOptions} title="Сотрудник" />
      </Field>
      <Field label="Тип действия">
        <Select value={actionType} onChange={(v) => { setActionType(v); setPage(1); }} options={actionOptions} title="Тип действия" />
      </Field>
    </View>
  );

  return (
    <FlatList
      data={data?.items ?? []}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      renderItem={({ item }) => <AuditRow log={item} />}
      ListEmptyComponent={
        logsQ.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <Text style={styles.empty}>Записей не найдено</Text>
        )
      }
      ListFooterComponent={
        data && data.items.length > 0 ? (
          <View style={styles.pager}>
            <Text style={styles.pagerInfo}>
              Всего: {data.total} · {data.page} / {data.pages}
            </Text>
            <View style={styles.pagerBtns}>
              <FastPressable
                disabled={page <= 1}
                onPress={() => setPage((p) => p - 1)}
                style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
              >
                <PwaIcon name="chevronLeft" size={16} color={colors.textSecondary} />
              </FastPressable>
              <FastPressable
                disabled={page >= data.pages}
                onPress={() => setPage((p) => p + 1)}
                style={[styles.pageBtn, page >= data.pages && styles.pageBtnDisabled]}
              >
                <PwaIcon name="chevronRight" size={16} color={colors.textSecondary} />
              </FastPressable>
            </View>
          </View>
        ) : null
      }
    />
  );
}

function AuditRow({ log }: { log: AuditLogEntry }) {
  const date = new Date(log.createdAt);
  const amount = typeof log.metadata?.amount === 'number' ? (log.metadata.amount as number) : null;
  const tone = actionTone(log.actionType);

  return (
    <View style={styles.row}>
      <View style={styles.rowTime}>
        <Text style={styles.dateText}>{date.toLocaleDateString('ru-RU')}</Text>
        <Text style={styles.timeText}>{timeHM(log.createdAt)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.badgeRow}>
          <View style={[styles.actionBadge, { backgroundColor: tone.bg }]}>
            <Text style={[styles.actionText, { color: tone.fg }]}>{ACTION_LABELS[log.actionType] ?? log.actionType}</Text>
          </View>
          <Text style={styles.userName}>{log.userName ?? '—'}</Text>
          {log.userRole ? <Text style={styles.userRole}>{ROLE_LABELS[log.userRole] ?? log.userRole}</Text> : null}
        </View>
        <Text style={styles.desc}>{log.description ?? '—'}</Text>
      </View>
      {amount !== null ? <Text style={styles.amount}>{amount} с</Text> : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, minWidth: 150 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  fieldLabel: { marginBottom: 4, fontSize: fontSize.xs, color: colors.textMuted },
  center: { paddingVertical: 60, alignItems: 'center' },
  empty: { paddingVertical: 60, textAlign: 'center', color: colors.textMuted },

  row: {
    flexDirection: 'row',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  rowTime: { width: 76 },
  dateText: { fontSize: fontSize.xs, color: colors.textMuted },
  timeText: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textSecondary },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  actionBadge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 2 },
  actionText: { fontSize: fontSize.xs, fontWeight: '500' },
  userName: { fontSize: fontSize.sm, fontWeight: '500', color: colors.textPrimary },
  userRole: { fontSize: fontSize.xs, color: colors.textMuted },
  desc: { marginTop: 4, fontSize: fontSize.sm, color: colors.textSecondary },
  amount: { fontSize: fontSize.sm, fontWeight: '600', color: colors.textPrimary },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  pagerInfo: { fontSize: fontSize.sm, color: colors.textMuted },
  pagerBtns: { flexDirection: 'row', gap: spacing.sm },
  pageBtn: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  pageBtnDisabled: { opacity: 0.4 },
});
