import React, { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Select, type SelectOption } from '@/components/Select';
import { ScrollView, View } from '@/components/themed';
import { Alert, Text } from '@/components/typography';
import { Button, Card, EmptyState, Field, Loading } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import {
  useWarehousePackageMutations, useWarehousePackages, useWarehouseSupplierMutations, useWarehouseSuppliers,
  type WarehousePackage, type WarehouseSupplier,
} from '@/services/api/warehouse';
import { ALL_UNITS, UNIT_OPTIONS, unitTypeOf, type UnitCode } from '@/services/api/warehouseUnits';
import { colors, fontSize, radius, spacing } from '@/theme';
import { WarehouseWorkspace } from './WarehouseWorkspace';
import {
  WarehouseDirectoryField, WarehouseDirectoryLink, WarehouseDirectorySearch, WarehouseDirectorySection,
  WarehouseDirectorySort, WarehouseDirectoryTable, WarehouseDirectoryValue, type DirectoryColumn,
} from './WarehouseDirectoryTable';

type DirectoryItem = { id: string; name: string; isActive: boolean };

const filterUnits: SelectOption<UnitCode | ''>[] = [
  { value: '', label: 'Ед. измерения' },
  ...UNIT_OPTIONS,
];
const supplierFields = [
  { key: 'name', label: 'Название', maxLength: 160 },
  { key: 'taxId', label: 'ИНН', maxLength: 80 },
  { key: 'phone', label: 'Телефон', maxLength: 80, keyboardType: 'phone-pad' },
  { key: 'address', label: 'Адрес', maxLength: 500 },
  { key: 'note', label: 'Комментарий', maxLength: 2000 },
] as const;
type SupplierFields = Record<typeof supplierFields[number]['key'] | 'email', string>;

function useDirectoryFilters() {
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [ascending, setAscending] = useState(true);

  function rows<T extends DirectoryItem>(items: T[], text: (item: T) => string) {
    const term = search.trim().toLocaleLowerCase('ru');
    return items.filter((item) =>
      item.isActive !== archived && text(item).toLocaleLowerCase('ru').includes(term),
    ).sort((a, b) => (ascending ? 1 : -1) * a.name.localeCompare(b.name, 'ru'));
  }

  return { search, setSearch, archived, setArchived, ascending, setAscending, rows };
}

function useDirectoryAction<T extends DirectoryItem>(archive: (id: string) => Promise<unknown>, restore: (item: T) => Promise<unknown>, archiveMessage: string) {
  const locked = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function apply(item: T) {
    if (locked.current) return;
    locked.current = true;
    setBusyId(item.id);
    setError('');
    try {
      await (item.isActive ? archive(item.id) : restore(item));
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setBusyId(null);
      locked.current = false;
    }
  }

  function changeStatus(item: T) {
    if (item.isActive) {
      Alert.alert(`Архивировать «${item.name}»?`, archiveMessage, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'В архив', style: 'destructive', onPress: () => void apply(item) },
      ]);
    } else {
      void apply(item);
    }
  }

  return { busyId, error, changeStatus };
}

function Records<T extends DirectoryItem>({
  rows, title, hint, pending, queryError, retry, editable, action, open, columns,
}: {
  rows: T[];
  title: string;
  hint?: string;
  pending: boolean;
  queryError?: string;
  retry: () => void;
  editable: boolean;
  action: ReturnType<typeof useDirectoryAction<T>>;
  open: (item: T) => void;
  columns: DirectoryColumn<T>[];
}) {
  const actionColumn: DirectoryColumn<T> = {
    key: 'actions',
    width: 116,
    cell: (item) => <View style={styles.actions}>
      <WarehouseDirectoryLink label={editable ? 'Ред.' : 'Открыть'} accessibilityLabel={`Открыть: ${item.name}`}
        disabled={action.busyId !== null} onPress={() => open(item)} translate />
      {editable && (item.isActive ? <Select<'' | 'archive'> title={`Другие действия: ${item.name}`} placeholder="⋯"
        value="" options={[{ value: 'archive', label: 'В архив' }]} style={styles.more}
        disabled={action.busyId !== null} onChange={() => action.changeStatus(item)} />
        : <WarehouseDirectoryLink label="Восстановить" onPress={() => action.changeStatus(item)}
          disabled={action.busyId !== null} translate />)}
    </View>,
  };
  return <>
    {action.error ? <Text accessibilityRole="alert" style={styles.error}>{action.error}</Text> : null}
    {queryError ? <Card style={styles.stack}>
      <Text accessibilityRole="alert" style={styles.error}>{queryError}</Text>
      <Button title="Повторить" variant="secondary" size="md" onPress={retry} />
    </Card> : null}
    {pending ? <Loading /> : null}
    <WarehouseDirectoryTable columns={[...columns, actionColumn]} rows={rows} />
    {!pending && !queryError && !rows.length ? <>
      <EmptyState text={title} />
      {hint ? <Text style={styles.emptyHint} translate>{hint}</Text> : null}
    </> : null}
  </>;
}

export function WarehouseSuppliersTab() {
  const { canSection, canAction } = usePermissions();
  const readable = canSection('warehouse');
  const editable = readable && canAction('warehouseSettings');
  const filters = useDirectoryFilters();
  const query = useWarehouseSuppliers(readable, filters.archived);
  const { archive, save } = useWarehouseSupplierMutations();
  const [editor, setEditor] = useState<{ item?: WarehouseSupplier } | null>(null);
  const action = useDirectoryAction<WarehouseSupplier>(archive.mutateAsync, ({ id, name }) =>
    save.mutateAsync({ id, name, isActive: true }), 'История поставок сохранится.',
  );
  if (!readable) return null;
  const rows = filters.rows(query.data ?? [], (item) =>
    [item.name, item.phone, item.address, item.note].filter(Boolean).join(' '),
  );
  const open = (item: WarehouseSupplier) => setEditor({ item });
  const columns: DirectoryColumn<WarehouseSupplier>[] = [
    { key: 'name', title: <WarehouseDirectorySort name="Имя" ascending={filters.ascending}
      onToggle={() => filters.setAscending(!filters.ascending)} />, width: 178,
      cell: (item) => <WarehouseDirectoryLink label={item.name} onPress={() => open(item)} /> },
    { key: 'phone', title: 'Телефон', width: 125, cell: (item) => <WarehouseDirectoryValue>{item.phone || '—'}</WarehouseDirectoryValue> },
    { key: 'address', title: 'Адрес', width: 168, cell: (item) => <WarehouseDirectoryValue>{item.address || '—'}</WarehouseDirectoryValue> },
    { key: 'note', title: 'Комментарий', width: 175, cell: (item) => <WarehouseDirectoryValue>{item.note || '—'}</WarehouseDirectoryValue> },
  ];

  return <View style={styles.surface}>
    <View style={styles.toolbar}>
      <View style={styles.search}><WarehouseDirectorySearch label="Поиск поставщика" value={filters.search} onChange={filters.setSearch} /></View>
      {editable ? <Button title="Добавить" size="md" disabled={action.busyId !== null} onPress={() => setEditor({})} /> : null}
      {editable ? <WarehouseDirectoryLink label={filters.archived ? 'Активные' : 'Архив'}
        disabled={action.busyId !== null} onPress={() => filters.setArchived(!filters.archived)} translate /> : null}
    </View>
    <Records rows={rows} title={filters.archived || filters.search.trim() ? 'Поставщики не найдены' : 'Здесь будут ваши поставщики'}
      pending={query.isPending}
      queryError={query.isError ? apiError(query.error) : undefined} retry={() => void query.refetch()}
      editable={editable} action={action} open={open} columns={columns} />
    {editor ? <SupplierEditor key={editor.item?.id ?? 'new'} item={editor.item} editable={editable} onClose={() => setEditor(null)} /> : null}
  </View>;
}

function SupplierEditor({ item, editable, onClose }: { item?: WarehouseSupplier; editable: boolean; onClose: () => void }) {
  const { save } = useWarehouseSupplierMutations();
  const wide = useWindowDimensions().width >= 640;
  const [advanced, setAdvanced] = useState(false);
  const [initial] = useState<SupplierFields>({
    name: item?.name ?? '',
    phone: item?.phone ?? '',
    email: item?.email ?? '',
    address: item?.address ?? '',
    taxId: item?.taxId ?? '',
    note: item?.note ?? '',
  });
  const [form, setForm] = useState(initial);
  const name = form.name.trim();
  const email = form.email.trim();
  const emailError = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Укажите корректный адрес' : undefined;
  const dirty = supplierFields.some(({ key }) => form[key] !== initial[key]) || form.email !== initial.email;
  return <DirectoryEditor title={item ? 'Редактирование поставщика' : 'Новый поставщик'} editable={editable}
    valid={!!name && !emailError} dirty={dirty} onClose={onClose}
    onSave={() => save.mutateAsync({
      id: item?.id, name, email: email || null, phone: form.phone.trim() || null,
      address: form.address.trim() || null, taxId: form.taxId.trim() || null, note: form.note.trim() || null,
    })}>
    {supplierFields.map((field) => {
      const multiline = field.key === 'address' || field.key === 'note';
      return <WarehouseDirectoryField key={field.key} label={field.label} wide={wide}>
        <Field accessibilityLabel={field.label} value={form[field.key]} maxLength={field.maxLength} editable={editable}
          keyboardType={'keyboardType' in field ? field.keyboardType : undefined} multiline={multiline}
          style={multiline ? styles.multiline : undefined}
          onChangeText={(value) => setForm((current) => ({ ...current, [field.key]: value }))} />
      </WarehouseDirectoryField>;
    })}
    <WarehouseDirectorySection label="Дополнительно" expanded={advanced || !!emailError} onPress={() => setAdvanced(!advanced)} />
    {advanced || emailError ? <WarehouseDirectoryField label="Электронная почта" wide={wide}>
      <Field accessibilityLabel="Электронная почта" value={form.email} maxLength={254} editable={editable}
        keyboardType="email-address" autoCapitalize="none" error={editable ? emailError : undefined}
        onChangeText={(value) => setForm((current) => ({ ...current, email: value }))} />
    </WarehouseDirectoryField> : null}
  </DirectoryEditor>;
}

export function WarehousePackagesTab() {
  const { canSection, canAction } = usePermissions();
  const readable = canSection('warehouse');
  const editable = readable && canAction('warehouseSettings');
  const filters = useDirectoryFilters();
  const [unit, setUnit] = useState<UnitCode | ''>('');
  const query = useWarehousePackages(readable, { includeInactive: filters.archived, unitType: unit ? unitTypeOf(unit) : undefined });
  const { archive, save } = useWarehousePackageMutations();
  const [editor, setEditor] = useState<{ item?: WarehousePackage } | null>(null);
  const action = useDirectoryAction<WarehousePackage>(archive.mutateAsync, ({ id, name, unit, quantity }) =>
    save.mutateAsync({ id, name, unit, quantity, isActive: true }), 'Сохранённые поставки не изменятся.',
  );
  if (!readable) return null;
  const rows = filters.rows((query.data ?? []).filter((item) => !unit || item.unit === unit), (item) => item.name);

  const open = (item: WarehousePackage) => setEditor({ item });
  const filtered = filters.archived || !!filters.search.trim() || !!unit;
  const columns: DirectoryColumn<WarehousePackage>[] = [
    { key: 'name', title: <WarehouseDirectorySort ascending={filters.ascending}
      onToggle={() => filters.setAscending(!filters.ascending)} />, width: 176,
      cell: (item) => <WarehouseDirectoryLink label={item.name} onPress={() => open(item)} /> },
    { key: 'unit', title: 'Ед. измерения', width: 126, cell: (item) => <WarehouseDirectoryValue>{item.unitLabel}</WarehouseDirectoryValue> },
    { key: 'quantity', title: 'Количество', width: 116,
      cell: (item) => <WarehouseDirectoryValue>{item.quantity.toLocaleString('ru-RU', { maximumFractionDigits: 6 })}</WarehouseDirectoryValue> },
  ];
  return <View style={styles.surface}>
    <View style={styles.toolbar}>
      <View style={styles.search}><WarehouseDirectorySearch label="Поиск фасовок" value={filters.search} onChange={filters.setSearch} /></View>
      <Select title="Единица фасовки" value={unit} options={filterUnits} onChange={setUnit} style={styles.unitFilter} />
      {editable ? <Button title="Добавить" size="md" disabled={action.busyId !== null} onPress={() => setEditor({})} /> : null}
      {editable ? <WarehouseDirectoryLink label={filters.archived ? 'Активные' : 'Архив'}
        disabled={action.busyId !== null} onPress={() => filters.setArchived(!filters.archived)} translate /> : null}
    </View>
    <Records rows={rows} title={filtered ? 'Фасовки не найдены' : 'Здесь будут ваши фасовки'}
      hint={filtered ? undefined : 'Фасовки позволяют оформлять поставки упаковками, например коробками по 12 штук.'}
      pending={query.isPending}
      queryError={query.isError ? apiError(query.error) : undefined} retry={() => void query.refetch()}
      editable={editable} action={action} open={open} columns={columns} />
    {editor ? <PackageEditor key={editor.item?.id ?? 'new'} item={editor.item} editable={editable} onClose={() => setEditor(null)} /> : null}
  </View>;
}

function PackageEditor({ item, editable, onClose }: { item?: WarehousePackage; editable: boolean; onClose: () => void }) {
  const { save } = useWarehousePackageMutations();
  const wide = useWindowDimensions().width >= 640;
  const [name, setName] = useState(item?.name ?? '');
  const [unit, setUnit] = useState<UnitCode>(item?.unit ?? 'kg');
  const initialQuantity = item ? String(item.quantity) : '';
  const [quantityText, setQuantity] = useState(initialQuantity);
  const normalized = quantityText.trim().replace(',', '.');
  const quantity = /^\d+(\.\d{0,6})?$|^\.\d{1,6}$/.test(normalized) ? Number(normalized) : 0;
  const quantityBase = quantity * (ALL_UNITS.find((entry) => entry.code === unit)?.factor ?? 1);
  const validQuantity = quantity >= 0.000001 && quantity < 100000000 && quantityBase >= 0.0005 && quantityBase < 100000000;

  return <DirectoryEditor title={item ? 'Редактирование фасовки' : 'Новая фасовка'} editable={editable}
    valid={!!name.trim() && validQuantity} dirty={name !== (item?.name ?? '') || unit !== (item?.unit ?? 'kg') || quantityText !== initialQuantity}
    onSave={() => save.mutateAsync({ id: item?.id, name: name.trim(), unit, quantity })} onClose={onClose}>
    <WarehouseDirectoryField label="Название" wide={wide}>
      <Field accessibilityLabel="Название" value={name} maxLength={80} editable={editable}
        placeholder="Например, коробка 12 шт." onChangeText={setName} />
    </WarehouseDirectoryField>
    <WarehouseDirectoryField label="Единица измерения" wide={wide}>
      <Select title="Единица фасовки" value={unit} options={UNIT_OPTIONS} disabled={!editable} onChange={setUnit} />
    </WarehouseDirectoryField>
    <WarehouseDirectoryField label="Количество" wide={wide}>
      <Field accessibilityLabel="Количество" value={quantityText} keyboardType="decimal-pad" editable={editable}
        error={editable && !!quantityText.trim() && !validQuantity ? 'Укажите допустимое количество' : undefined} onChangeText={setQuantity} />
    </WarehouseDirectoryField>
  </DirectoryEditor>;
}

function DirectoryEditor({ title, editable, valid, dirty, onClose, onSave, children }: {
  title: string;
  editable: boolean;
  valid: boolean;
  dirty: boolean;
  onClose: () => void;
  onSave: () => Promise<unknown>;
  children: ReactNode;
}) {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!editable || !valid || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave();
      onClose();
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  function close() {
    if (locked.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    Alert.alert('Закрыть без сохранения?', 'Внесённые изменения будут потеряны.', [
      { text: 'Продолжить', style: 'cancel' },
      { text: 'Закрыть', style: 'destructive', onPress: onClose },
    ]);
  }

  return <WarehouseWorkspace title={title} onClose={close}
    footer={editable ? <Button title="Сохранить" loading={busy} disabled={!valid} onPress={() => void save()} /> : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
      <Card style={styles.stack}>{children}</Card>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </WarehouseWorkspace>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  surface: { borderRadius: radius.lg, backgroundColor: colors.card },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  search: { flexGrow: 1, flexBasis: 160, maxWidth: 300 },
  unitFilter: { minWidth: 126, height: 36, borderRadius: 6, paddingHorizontal: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  more: { width: 48, height: 36, borderWidth: 0, paddingHorizontal: 4, gap: 3 },
  multiline: { height: 68, paddingTop: spacing.sm, textAlignVertical: 'top' },
  emptyHint: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center', padding: spacing.md, marginTop: -12 },
  error: { color: colors.danger, fontSize: fontSize.sm },
  form: { padding: spacing.md, gap: spacing.md },
});
