import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { printAsync } from 'expo-print';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { Select } from '@/components/Select';
import { Button, EmptyState, Field, Loading } from '@/components/ui';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { apiError } from '@/lib/api';
import { useNotifications } from '@/store/notifications';
import { colors, spacing } from '@/theme';
import { shareCsv } from '@/screens/admin/print';
import { WarehouseMultiSelect } from '@/screens/admin/WarehouseMultiSelect';
import { useTrashedFinanceAccounts, useFinanceWrites, type FinanceAccount, type FinanceCategory, type FinanceData, type FinanceEntry } from './api';
import { AccountForm, ArchiveAccountForm, CategoryForm, RemoveCategoryForm, ReverseTransactionForm,
  TransactionCommentForm, TransactionForm, accountTypes, categoryKinds } from './Forms';
import { FinanceForm, FinanceLine, FinanceQueryError, SwitchField, financeStyles } from './components';
import { entryCategoryLabel, entryLabel, entryLabels, financeDateTime, financeDay, financeLocalTime, financeMoney } from './format';
import { categoryChoices, choice } from './rules';

const COLUMN_SPECS = [
  { key: 'date', label: 'Дата', width: 136 },
  { key: 'time', label: 'Время', width: 92 },
  { key: 'category', label: 'Категория', width: 166 },
  { key: 'note', label: 'Комментарий', width: 160 },
  { key: 'amount', label: 'Сумма', width: 114 },
  { key: 'account', label: 'Счёт', width: 142 },
  { key: 'balance', label: 'Баланс', width: 106 },
  { key: 'kind', label: 'Тип', width: 116 },
  { key: 'employee', label: 'Сотрудник', width: 134 },
] as const;
type Column = typeof COLUMN_SPECS[number]['key'];
const DEFAULT_COLUMNS: Column[] = ['date', 'category', 'note', 'amount', 'account', 'balance'];
const escapeHtml = (text: unknown) => String(text ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

export function TransactionRegister({ data, allowExport }: { data: FinanceData; allowExport: boolean }) {
  const [search, setSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState<'create' | 'edit' | 'reverse' | null>(null);
  const [columns, saveColumns] = useColumnPreference<Column>('finance-transactions', DEFAULT_COLUMNS);
  const [exporting, setExporting] = useState<'csv' | 'print' | null>(null);
  const push = useNotifications((state) => state.push);

  function changeColumns(next: Column[]) {
    if (!next.length) return;
    saveColumns(next);
  }

  const accounts = new Map(data.accounts.map((account) => [account.id, account.name]));
  const categories = new Map(data.categories.map((category) => [category.id, category.name]));
  const categoryIds = new Map(data.categories.map((category) => [category.id, category.parentId]));
  const permittedColumns = COLUMN_SPECS.filter(({ key }) => key !== 'balance' || data.canViewAll);
  const selectedColumns = permittedColumns.filter(({ key }) => columns.includes(key));
  const visibleColumns = selectedColumns.length ? selectedColumns : permittedColumns.filter(({ key }) => DEFAULT_COLUMNS.includes(key));
  const term = search.trim().toLocaleLowerCase('ru-RU');
  const showDeleted = kind === 'reversal';
  function categoryMatches(id?: string) {
    if (!categoryId) return true;
    const visited = new Set<string>();
    for (let parent = id; parent && !visited.has(parent); parent = categoryIds.get(parent) ?? undefined) {
      if (parent === categoryId) return true;
      visited.add(parent);
    }
    return false;
  }
  const rows = data.entries.filter((entry) => {
    const deduplicated = accountId || entry.kind !== 'transfer' || !entry.counterpartyAccountId || entry.counterpartyArchived || entry.amount < 0;
    const deleted = !!(entry.reversalOf || entry.reversedAt);
    return deduplicated && (!accountId || entry.accountId === accountId) && categoryMatches(entry.categoryId)
      && (showDeleted ? deleted : !deleted && (!kind || entry.kind === kind))
      && (!term || [entry.note, entry.actorName, entryCategoryLabel(entry, categories.get(entry.categoryId ?? '')), accounts.get(entry.accountId),
        entry.counterpartyName, accounts.get(entry.counterpartyAccountId ?? '')].some((text) => text?.toLocaleLowerCase('ru-RU').includes(term)));
  }).sort((left, right) => (sortAsc ? 1 : -1) * (left.occurredAt.localeCompare(right.occurredAt)
    || (left.createdAt ?? '').localeCompare(right.createdAt ?? '') || left.id.localeCompare(right.id)));
  const entry = data.entries.find(({ id }) => selected === id);
  const canCreate = data.accounts.length > 0 && (data.canManage || (!data.canViewAll && data.categories.length > 0));
  const total = rows.reduce((sum, row) => sum + (!accountId && row.kind === 'transfer' ? 0 : Math.round(row.amount * 100)), 0) / 100;

  function cells(row: FinanceEntry): Record<Column, string> {
    const amount = !accountId && row.kind === 'transfer' ? Math.abs(row.amount) : row.amount;
    return {
      date: financeDay(new Date(row.occurredAt)).split('-').reverse().join('.'),
      time: financeLocalTime(new Date(row.occurredAt)).slice(11),
      category: entryCategoryLabel(row, categories.get(row.categoryId ?? '')),
      note: row.note || '—',
      amount: financeMoney(amount),
      account: accounts.get(row.accountId) ?? '—',
      balance: financeMoney(row.balanceAfter),
      kind: entryLabel(row),
      employee: row.actorName || '—',
    };
  }

  async function output(action: 'csv' | 'print') {
    setExporting(action);
    try {
      const header = visibleColumns.map(({ label }) => label);
      const body = rows.map((row) => {
        const values = cells(row);
        return visibleColumns.map(({ key }) => values[key]);
      });
      if (action === 'csv') {
        const safe = rows.map((row) => {
          const values = cells(row);
          return visibleColumns.map(({ key }) => {
            if (key === 'amount') return !accountId && row.kind === 'transfer' ? Math.abs(row.amount) : row.amount;
            if (key === 'balance') return row.balanceAfter ?? '';
            return /^\s*[=+@\-]/.test(values[key]) ? "'" + values[key] : values[key];
          });
        });
        await shareCsv('Транзакции', [header, ...safe]);
      } else {
        const table = '<table border="1" cellspacing="0" cellpadding="6"><thead><tr>'
          + header.map((cell) => '<th>' + escapeHtml(cell) + '</th>').join('') + '</tr></thead><tbody>'
          + body.map((row) => '<tr>' + row.map((cell) => '<td>' + escapeHtml(cell) + '</td>').join('') + '</tr>').join('')
          + '</tbody></table>';
        await printAsync({ html: '<meta charset="utf-8"><h1>Транзакции</h1>' + table });
      }
    } catch (error) {
      push({ message: apiError(error), type: 'error', at: new Date().toISOString() });
    } finally {
      setExporting(null);
    }
  }

  return (
    <View style={financeStyles.stack}>
      <View style={financeStyles.toolbar}>
        <Field accessibilityLabel="Быстрый поиск" placeholder="Быстрый поиск" value={search} onChangeText={setSearch}
          containerStyle={styles.search} />
        <Select title="Счёт" value={accountId} onChange={setAccountId} options={[{ value: '', label: 'Все счета' }, ...data.accounts.map(choice)]} />
        <Select title="Категория" value={categoryId} onChange={setCategoryId} options={[{ value: '', label: 'Все категории' }, ...categoryChoices(data.categories)]} />
        <Select title="Тип транзакции" value={kind} onChange={setKind} options={[{ value: '', label: 'Все типы' },
          ...Object.entries(entryLabels).map(([value, label]) => ({ value, label })), { value: 'reversal', label: 'Удалённые' }]} />
        {accountId || categoryId || kind || search ? <Button title="Сбросить" variant="secondary" size="md"
          onPress={() => { setAccountId(''); setCategoryId(''); setKind(''); setSearch(''); }} /> : null}
      </View>
      <View style={financeStyles.toolbar}>
        <WarehouseMultiSelect label="Столбцы" value={visibleColumns.map(({ key }) => key)} onChange={changeColumns}
          options={permittedColumns.map(({ key, label }) => ({ value: key, label }))} />
        {allowExport ? <Button icon="export" title="Экспорт" size="md" variant="secondary" disabled={!rows.length || !!exporting} loading={exporting === 'csv'} onPress={() => void output('csv')} /> : null}
        {allowExport ? <Button icon="adminPrinter" title="Печать" size="md" variant="secondary" disabled={!rows.length || !!exporting} loading={exporting === 'print'} onPress={() => void output('print')} /> : null}
        {canCreate ? <Button title="Добавить транзакцию" size="md" onPress={() => setEditing('create')} /> : null}
      </View>
      {rows.length ? (
        <View style={financeStyles.card}>
          <SheetScrollView horizontal>
            <View>
              <View style={styles.tableRow}>
                {visibleColumns.map(({ key, label, width }) => key === 'date' ? (
                  <FastPressable key={key} accessibilityRole="button" onPress={() => setSortAsc((value) => !value)} style={[styles.cell, { width }]}>
                    <Text style={financeStyles.muted} translate>{label}{sortAsc ? ' ↑' : ' ↓'}</Text>
                  </FastPressable>
                ) : <Text key={key} style={[styles.cell, financeStyles.muted, { width }]} translate>{label}</Text>)}
              </View>
              {rows.map((row) => {
                const values = cells(row);
                return (
                  <FastPressable accessibilityRole="button" onPress={() => setSelected(row.id)} key={row.id} style={styles.tableRow}>
                    {visibleColumns.map(({ key, width }) => (
                      <Text key={key} style={[styles.cell, key === 'amount' ? financeStyles.label : financeStyles.muted, { width }]} numberOfLines={2}>
                        {values[key]}
                      </Text>
                    ))}
                  </FastPressable>
                );
              })}
            </View>
          </SheetScrollView>
          {!showDeleted ? <FinanceLine label="Итого" value={financeMoney(total)} /> : null}
        </View>
      ) : <EmptyState text="Транзакций нет" />}
      <BottomSheet visible={!!entry} title="Транзакция" maxHeight="90%" onClose={() => setSelected('')}>
        {entry ? (
          <SheetScrollView contentContainerStyle={financeStyles.body}>
            {COLUMN_SPECS.filter(({ key }) => key !== 'balance' || data.canViewAll).map(({ key, label }) => (
              <FinanceLine label={label} value={cells(entry)[key]} key={key} />
            ))}
            {entry.counterpartyName ? <FinanceLine label="Второй счёт" value={entry.counterpartyName} /> : null}
            {entry.reversedAt ? <FinanceLine label="Сторнирована" value={financeDateTime(entry.reversedAt)} /> : null}
            {entry.editable || entry.detailsEditable ? <Button title="Редактировать" variant="secondary" onPress={() => setEditing('edit')} /> : null}
            {entry.reversible ? <Button title="Сторнировать" variant="secondary" danger onPress={() => setEditing('reverse')} /> : null}
            {editing === 'edit' && entry.detailsEditable ? <TransactionForm entry={entry} data={data} onClose={() => setEditing(null)} /> : null}
            {editing === 'edit' && !entry.detailsEditable && entry.editable ? (
              <TransactionCommentForm entry={entry} categories={data.categories} onClose={() => setEditing(null)} />
            ) : null}
            {editing === 'reverse' ? <ReverseTransactionForm entry={entry} onClose={() => setEditing(null)} /> : null}
          </SheetScrollView>
        ) : null}
      </BottomSheet>
      {editing === 'create' ? <TransactionForm data={data} initialAccountId={accountId} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

export function AccountDirectory({ data }: { data: FinanceData }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [editor, setEditor] = useState<FinanceAccount | 'new' | null>(null);
  const [archive, setArchive] = useState<FinanceAccount>();
  const [trashOpen, setTrashOpen] = useState(false);
  const term = search.trim().toLocaleLowerCase('ru-RU');
  const accounts = data.accounts.filter((account) => (!type || account.type === type) && account.name.toLocaleLowerCase('ru-RU').includes(term));
  return (
    <View style={financeStyles.stack}>
      <View style={financeStyles.toolbar}>
        <Field accessibilityLabel="Быстрый поиск" placeholder="Быстрый поиск" value={search} onChangeText={setSearch} containerStyle={financeStyles.grow} />
        <Select title="Тип счёта" value={type} onChange={setType} options={[{ value: '', label: 'Все счета' }, ...accountTypes]} />
      </View>
      {data.canManage ? <View style={financeStyles.toolbar}>
        <Button title="Добавить счёт" size="md" onPress={() => setEditor('new')} />
        <Button title="Корзина" size="md" variant="secondary" onPress={() => setTrashOpen(true)} />
      </View> : null}
      {accounts.length ? accounts.map((account) => (
        <View style={financeStyles.card} key={account.id}>
          <View style={financeStyles.row}>
            <Text style={financeStyles.label}>{account.name}</Text>
            {data.canViewAll ? <Text style={financeStyles.label}>{financeMoney(account.balance)}</Text> : null}
          </View>
          <Text style={financeStyles.muted} translate>{accountTypes.find(({ value }) => value === account.type)?.label ?? account.type}</Text>
          {account.isDefault ? <Text style={financeStyles.muted} translate>Счёт по умолчанию</Text> : null}
          {account.isCollection ? <Text style={financeStyles.muted} translate>Для инкассации</Text> : null}
          {data.canManage ? <View style={financeStyles.toolbar}>
            <Button title="Редактировать" size="md" variant="secondary" onPress={() => setEditor(account)} />
            {!account.isDefault && !account.isCollection ? (
              <Button title="Удалить" size="md" variant="secondary" danger onPress={() => setArchive(account)} />
            ) : null}
          </View> : null}
        </View>
      )) : <EmptyState text="Счета не найдены" />}
      {editor ? <AccountForm account={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} /> : null}
      {archive ? <ArchiveAccountForm account={archive} onClose={() => setArchive(undefined)} /> : null}
      {trashOpen ? <AccountTrash onClose={() => setTrashOpen(false)} /> : null}
    </View>
  );
}

function AccountTrash({ onClose }: { onClose: () => void }) {
  const trash = useTrashedFinanceAccounts();
  const { restoreAccount } = useFinanceWrites();
  const [restoreId, setRestoreId] = useState('');
  const selected = trash.data?.find(({ id }) => id === restoreId);
  return (
    <BottomSheet visible title="Корзина счетов" maxHeight="92%" onClose={onClose}>
      <SheetScrollView contentContainerStyle={financeStyles.body}>
        {trash.isPending ? <Loading /> : null}
        {trash.isError ? <FinanceQueryError error={trash.error} retry={() => void trash.refetch()} /> : null}
        {trash.isSuccess && !trash.data.length ? <EmptyState text="Корзина пуста" /> : null}
        {trash.data?.map((account) => (
          <View style={financeStyles.card} key={account.id}>
            <FinanceLine label={account.name} value={financeMoney(account.balance)} />
            <Text style={financeStyles.muted}>{financeDateTime(account.archivedAt)}</Text>
            <Button size="md" title="Восстановить" variant="secondary" onPress={() => setRestoreId(account.id)} />
          </View>
        ))}
        {selected ? (
          <FinanceForm title="Восстановить счёт?" submitLabel="Восстановить" onClose={() => setRestoreId('')} submit={() => restoreAccount.mutateAsync(selected.id)}>
            <Text style={financeStyles.label}>{selected.name}</Text>
          </FinanceForm>
        ) : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

export function CategoryDirectory({ data }: { data: FinanceData }) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [editor, setEditor] = useState<FinanceCategory | 'new' | null>(null);
  const [remove, setRemove] = useState<FinanceCategory>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const { setCategoryVisibility } = useFinanceWrites();
  const term = search.trim().toLocaleLowerCase('ru-RU');
  const options = new Map(categoryChoices(data.categories).map(({ value, label }) => [value, label]));
  const people = new Map(data.employees.map(({ id, name }) => [id, name]));
  const positions = new Map(data.positions.map(({ id, name }) => [id, name]));
  const filtered = !!(kind || term);
  const matches = data.categories.filter((category) => (!kind || category.kind === kind)
    && options.get(category.id)?.toLocaleLowerCase('ru-RU').includes(term));
  const roots = new Map<string | null, FinanceCategory[]>();
  for (const category of matches) {
    const parent = !filtered && category.parentId && options.has(category.parentId) ? category.parentId : null;
    const siblings = roots.get(parent) ?? [];
    siblings.push(category);
    roots.set(parent, siblings);
  }
  function flatten(parent: string | null, depth: number): { category: FinanceCategory; depth: number }[] {
    return (roots.get(parent) ?? []).flatMap((category) => [
      { category, depth },
      ...(expanded.includes(category.id) ? flatten(category.id, depth + 1) : []),
    ]);
  }
  const rows = flatten(null, 0);
  return (
    <View style={financeStyles.stack}>
      <View style={financeStyles.toolbar}>
        <Field accessibilityLabel="Быстрый поиск" placeholder="Быстрый поиск" value={search} onChangeText={setSearch} containerStyle={financeStyles.grow} />
        <Select title="Тип категории" value={kind} onChange={setKind} options={[{ value: '', label: 'Все категории' }, ...categoryKinds]} />
        {data.canManage ? <Button title="Добавить категорию" size="md" onPress={() => setEditor('new')} /> : null}
      </View>
      {rows.length ? rows.map(({ category, depth }) => (
        <View style={financeStyles.card} key={category.id}>
          <View style={[financeStyles.row, { paddingLeft: Math.min(depth, 4) * spacing.sm }]}>
            <Text style={[financeStyles.label, financeStyles.grow]}>{filtered ? options.get(category.id) : category.name}</Text>
            {roots.has(category.id) ? (
              <FastPressable accessibilityRole="button" accessibilityLabel={category.name}
                accessibilityState={{ expanded: expanded.includes(category.id) }}
                onPress={() => setExpanded((items) => items.includes(category.id)
                  ? items.filter((item) => item !== category.id) : [...items, category.id])}
                hitSlop={8} style={styles.categoryButton}>
                <PwaIcon name={expanded.includes(category.id) ? 'chevronDown' : 'chevronRight'} size={16} color={colors.textMuted} />
              </FastPressable>
            ) : null}
          </View>
          <Text style={financeStyles.muted} translate>{categoryKinds.find(({ value }) => value === category.kind)?.label ?? category.kind}</Text>
          {category.userIds.length || category.positionIds.length ? (
            <FinanceLine label="Дополнительный доступ"
              value={[...category.userIds.map((id) => people.get(id)), ...category.positionIds.map((id) => positions.get(id))].filter(Boolean).join(', ') || '—'} />
          ) : null}
          {data.canManage ? <SwitchField label="Показывать на кассе" checked={category.showOnPos ?? false}
            disabled={setCategoryVisibility.isPending} onChange={(showOnPos) => setCategoryVisibility.mutate({ id: category.id, showOnPos })} />
            : category.showOnPos ? <Text style={financeStyles.muted} translate>Показывается на кассе</Text> : null}
          {data.canManage ? <View style={financeStyles.toolbar}>
            <Button title="Редактировать" size="md" variant="secondary" onPress={() => setEditor(category)} />
            <Button title="Удалить" size="md" variant="secondary" danger onPress={() => setRemove(category)} />
          </View> : null}
        </View>
      )) : <EmptyState text="Категории не найдены" />}
      {setCategoryVisibility.isError ? <Text accessibilityRole="alert" style={financeStyles.error}>{apiError(setCategoryVisibility.error)}</Text> : null}
      {editor ? <CategoryForm data={data} category={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} /> : null}
      {remove ? <RemoveCategoryForm category={remove} categories={data.categories} onClose={() => setRemove(undefined)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flex: 1, minWidth: 160 },
  categoryButton: { padding: spacing.sm },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 46 },
  cell: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
});
