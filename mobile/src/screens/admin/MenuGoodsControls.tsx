import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { Button, Toggle } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { WarehouseMultiSelect } from './WarehouseMultiSelect';

export const menuColumns = {
  name: { label: 'Название', width: 250 },
  category: { label: 'Категория', width: 130 },
  price: { label: 'Цена', width: 120, right: true },
  station: { label: 'Цех', width: 140 },
  unit: { label: 'Ед. измерения', width: 130 },
  weighted: { label: 'Весовой товар', width: 142 },
  availability: { label: 'Доступность', width: 150 },
  tax: { label: 'Налог', width: 165 },
  stock: { label: 'Остаток', width: 110, right: true },
  actions: { label: 'Действия', width: 100, right: true },
};
export type MenuColumn = keyof typeof menuColumns;
const goodsColumns: MenuColumn[] = ['category', 'price', 'station', 'unit', 'weighted', 'availability', 'tax'];
const defaultColumns: MenuColumn[] = ['category', 'price'];

export function useGoodsColumns() {
  const [columns, apply] = useColumnPreference('menu-goods', defaultColumns);
  return { columns: goodsColumns.filter((column) => columns.includes(column)), apply };
}

export function GoodsColumnsEditor({ columns, onApply, onClose }: {
  columns: MenuColumn[]; onApply: (columns: MenuColumn[]) => void; onClose: () => void;
}) {
  const [shown, setShown] = useState(columns);
  return <BottomSheet visible onClose={onClose} title="Столбцы" footer={<View style={styles.buttons}>
    <Button title="Сбросить" variant="secondary" size="md" onPress={() => setShown(defaultColumns)} />
    <Button title="Применить" size="md" onPress={() => { onApply(shown); onClose(); }} />
  </View>}>
    {goodsColumns.map((column) => <View key={column} style={styles.option}>
      <Text style={styles.label} translate>{menuColumns[column].label}</Text>
      <Toggle accessibilityLabel={menuColumns[column].label} checked={shown.includes(column)}
        onChange={(checked) => setShown((current) => checked ? [...current, column] : current.filter((key) => key !== column))} />
    </View>)}
  </BottomSheet>;
}

export const initialMenuFilters = {
  name: '', availability: '', tax: '', weighted: '', units: [] as string[], categories: [] as string[], stations: [] as string[],
};
export type MenuFilters = typeof initialMenuFilters;

export function goodsWorkbookUrl(columns: MenuColumn[], search: string, filters: MenuFilters, sort: 'asc' | 'desc') {
  const params = new URLSearchParams({ columns: ['name', ...columns].join(','), sort });
  for (const [key, value] of Object.entries({ search, name: filters.name, weighted: filters.weighted, availability: filters.availability, tax: filters.tax })) {
    if (value.trim()) params.set(key, value.trim());
  }
  for (const [key, values] of Object.entries({ categories: filters.categories, stations: filters.stations, units: filters.units })) {
    for (const value of values) params.append(key, value);
  }
  return '/admin/menu/goods/export.xlsx?' + params.toString();
}

type AdditionalField = 'name' | 'availability' | 'tax' | 'weighted' | 'units';
const fieldLabels: Record<AdditionalField, string> = {
  name: 'Название', availability: 'Доступность', tax: 'Налог', weighted: 'Весовой товар', units: 'Ед. измерения',
};
const fields: AdditionalField[] = ['name', 'availability', 'tax', 'weighted', 'units'];
type Option = { value: string; label: string; translate?: boolean };

export function MenuAdditionalFilters({ filters, update, goods, units, taxes }: {
  filters: MenuFilters; update: (patch: Partial<MenuFilters>) => void; goods: boolean; units: Option[]; taxes: Option[];
}) {
  const [editing, setEditing] = useState(false);
  const [field, setField] = useState<AdditionalField | ''>('');
  const allowed = goods ? fields : fields.filter((key) => key === 'availability' || key === 'tax');
  const options: Partial<Record<AdditionalField, Option[]>> = {
    availability: [{ value: 'visible', label: 'Доступен в меню' }, { value: 'hidden', label: 'Скрыт' }],
    tax: taxes,
    weighted: [{ value: 'yes', label: 'Да' }, { value: 'no', label: 'Нет' }],
  };
  return <>
    <View style={styles.buttons}>
      {allowed.filter((key) => key === 'units' ? filters.units.length > 0 : !!filters[key]).map((key) => {
        const raw = filters[key];
        const value = typeof raw === 'string' ? options[key]?.find((entry) => entry.value === raw)?.label ?? raw : raw.join(', ');
        return <View key={key} style={styles.chip}>
          <FastPressable onPress={() => { setField(key); setEditing(true); }}>
            <Text style={styles.chipText} numberOfLines={1}>{fieldLabels[key]}: {value}</Text>
          </FastPressable>
          <FastPressable accessibilityRole="button" accessibilityLabel={'Очистить фильтр ' + fieldLabels[key]}
            onPress={() => update(key === 'units' ? { units: [] } : { [key]: '' })} hitSlop={8}>
            <Text style={styles.chipText}>×</Text>
          </FastPressable>
        </View>;
      })}
      <Button title="+ Фильтр" variant="secondary" size="md" onPress={() => { setField(''); setEditing(true); }} />
    </View>
    {editing ? <BottomSheet visible title="Дополнительный фильтр" onClose={() => setEditing(false)}
      footer={<Button title="Готово" size="md" onPress={() => setEditing(false)} />}>
      <View style={styles.fields}>
        <AnchoredSelectScope>
          <Select value={field} onChange={setField} title="Поле фильтра" placeholder="Выберите поле"
            options={allowed.map((value) => ({ value, label: fieldLabels[value] }))} />
          {field === 'name' ? <TextInput style={styles.input} value={filters.name} accessibilityLabel="Название"
            placeholder="Название" onChangeText={(name) => update({ name })} maxLength={160} /> : null}
          {field === 'units' ? <WarehouseMultiSelect label="Ед. измерения" options={units} value={filters.units}
            onChange={(selected) => update({ units: selected })} /> : null}
          {field === 'availability' || field === 'tax' || field === 'weighted' ? <Select
            value={filters[field]} title={fieldLabels[field]} onChange={(value) => update({ [field]: value })}
            options={[{ value: '', label: 'Все' }, ...(options[field] ?? [])]} /> : null}
        </AnchoredSelectScope>
      </View>
    </BottomSheet> : null}
  </>;
}

const styles = StyleSheet.create({
  fields: { gap: spacing.md },
  buttons: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  option: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  label: { flex: 1, fontSize: 14, color: colors.textPrimary },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, paddingHorizontal: 8, height: 34, borderRadius: 8, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 13, color: colors.primary, maxWidth: 180 },
  input: { minHeight: 42, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, color: colors.textPrimary },
});
