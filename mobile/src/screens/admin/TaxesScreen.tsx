import { useColumnPreference } from '@/hooks/useColumnPreference';
import React from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { ScrollView, View } from '@/components/themed';
import { Alert, Text, TextInput } from '@/components/typography';
import { Button, EmptyState, Loading } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { TAX_TYPE_LABELS, useTaxDirectory, useTaxMutations } from '@/services/api/taxes';
import { colors, radius, spacing } from '@/theme';
import type { MenuTax, MenuTaxType } from '@/types';
import { WarehouseDirectorySearch, WarehouseDirectorySort, WarehouseDirectoryTable, WarehouseDirectoryValue, type DirectoryColumn } from './WarehouseDirectoryTable';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';

const taxTypes = Object.entries(TAX_TYPE_LABELS).map(([value, label]) => ({ value: value as MenuTaxType, label }));
const optional = [{ value: 'rate', label: 'Процент' }, { value: 'type', label: 'Тип' }];
const defaultColumns = optional.map(({ value }) => value);

export function TaxesScreen() {
  const editable = usePermissions().canEditSection('settings');
  const [search, setSearch] = React.useState('');
  const [type, setType] = React.useState<'' | MenuTaxType>('');
  const [sort, setSort] = React.useState<'asc' | 'desc'>('asc');
  const [shown, setShown] = useColumnPreference('settings-taxes', defaultColumns);
  const [editor, setEditor] = React.useState<MenuTax | 'new' | null>(null);
  const [error, setError] = React.useState('');
  const list = useTaxDirectory({ search: search.trim() || undefined, type: type || undefined, sort });
  const { remove } = useTaxMutations();

  const columns: DirectoryColumn<MenuTax>[] = [
    { key: 'name', title: <WarehouseDirectorySort ascending={sort === 'asc'} onToggle={() => setSort(sort === 'asc' ? 'desc' : 'asc')} />,
      width: 208, cell: (tax) => <WarehouseDirectoryValue>{tax.name}</WarehouseDirectoryValue> },
  ];
  if (shown.includes('rate')) columns.push({ key: 'rate', title: 'Процент', width: 84,
    cell: (tax) => <WarehouseDirectoryValue>{`${String(tax.rate).replace('.', ',')} %`}</WarehouseDirectoryValue> });
  if (shown.includes('type')) columns.push({ key: 'type', title: 'Тип', width: 180,
    cell: (tax) => <WarehouseDirectoryValue>{TAX_TYPE_LABELS[tax.type]}</WarehouseDirectoryValue> });
  if (editable) columns.push({ key: 'actions', width: 96, cell: (tax) => (
    <View style={styles.actions}>
      <FastPressable accessibilityRole="button" accessibilityLabel={`Редактировать налог ${tax.name}`} onPress={() => setEditor(tax)} style={styles.icon}>
        <PwaIcon name="pencil" size={18} color={colors.textMuted} />
      </FastPressable>
      <FastPressable accessibilityRole="button" accessibilityLabel={`Удалить налог ${tax.name}`} disabled={remove.isPending}
        style={styles.icon} onPress={() => Alert.alert('Удаление налога', `Удалить налог «${tax.name}»?`, [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Удалить', style: 'destructive', onPress: () => {
            setError('');
            remove.mutate(tax.id, { onError: (failure) => setError(apiError(failure)) });
          } },
        ])}>
        <PwaIcon name="trash" size={18} color={colors.danger} />
      </FastPressable>
    </View>
  ) });

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <View style={styles.toolbar}>
        <WarehouseDirectorySearch label="Поиск налогов" value={search} onChange={(value) => setSearch(value.slice(0, 80))} />
        <AnchoredSelectScope>
          <Select value={type} title="Тип налога" options={[{ value: '', label: 'Тип' }, ...taxTypes]} onChange={setType} />
        </AnchoredSelectScope>
        <WarehouseMultiSelect label="Столбцы" value={shown} options={optional} onChange={setShown} />
        {editable && <Button title="Добавить налог" size="md" onPress={() => setEditor('new')} />}
      </View>
      {!!error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      {list.isPending ? <Loading /> : list.error ? (
        <><Text style={styles.error}>{apiError(list.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void list.refetch()} /></>
      ) : list.data?.length ? <WarehouseDirectoryTable rows={list.data} columns={columns} />
        : <EmptyState text={search || type ? 'Нет налогов по выбранным условиям' : 'Налоговых ставок пока нет'} />}
      {!!editor && <TaxEditor tax={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} />}
    </ScrollView>
  );
}

function TaxEditor({ tax, onClose }: { tax?: MenuTax; onClose: () => void }) {
  const [name, setName] = React.useState(tax?.name ?? '');
  const [rate, setRate] = React.useState(tax ? String(tax.rate) : '');
  const [type, setType] = React.useState<MenuTaxType>(tax?.type ?? 'turnover');
  const { save } = useTaxMutations();
  const normalized = rate.trim().replace(',', '.');
  const valid = !!name.trim() && /^\d+(\.\d{1,2})?$/.test(normalized) && Number(normalized) <= 100;

  return <BottomSheet visible title={tax ? 'Редактирование налога' : 'Добавление налога'}
    presentation="center" hideHandle onClose={() => { if (!save.isPending) onClose(); }}
    footer={<View style={styles.actions}>
      <Button title="Отмена" variant="secondary" size="md" onPress={onClose} disabled={save.isPending} />
      <Button title="Сохранить" size="md" loading={save.isPending} disabled={!valid} onPress={() => save.mutate(
        { id: tax?.id, name: name.trim(), rate: Number(normalized), type }, { onSuccess: onClose },
      )} />
    </View>}>
    <SheetScrollView contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled">
      <Text translate>Название</Text>
      <TextInput accessibilityLabel="Название" value={name} onChangeText={setName} maxLength={80} style={styles.input} />
      <Text translate>Процент</Text>
      <TextInput accessibilityLabel="Процент" value={rate} onChangeText={setRate} keyboardType="decimal-pad" style={styles.input} />
      <Text translate>Тип</Text>
      <AnchoredSelectScope><Select title="Тип налога" value={type} options={taxTypes} onChange={setType} /></AnchoredSelectScope>
      {save.error && <Text style={styles.error} accessibilityRole="alert">{apiError(save.error)}</Text>}
    </SheetScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.md },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  icon: { padding: 7 },
  error: { color: colors.danger },
  input: { minHeight: 42, borderWidth: 1, borderRadius: radius.sm, borderColor: colors.border, paddingHorizontal: spacing.md },
});
