import React, { useState } from 'react';
import { FlatList, StyleSheet, type ViewStyle } from 'react-native';
import { AnchoredDropdown } from '@/components/AnchoredDropdown';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { colors, radius } from '@/theme';
import { selectSearchMatches } from '@/utils/anchoredSelect';

type Option<T extends string> = { value: T; label: string; translate?: boolean };

export function WarehouseMultiSelect<T extends string>({ label, value, options, onChange, style }: {
  label: string; value: T[]; options: Option<T>[]; onChange: (value: T[]) => void; style?: ViewStyle;
}) {
  return <AnchoredDropdown label={label} buttonStyle={[styles.control, value.length > 0 && styles.active, style]}
    width={280} height={Math.min(340, 88 + Math.max(1, options.length) * 34)}
    trigger={(isOpen) => <>
      <Text style={styles.title} numberOfLines={1} translate>{label}</Text>
      {value.length > 0 && <Text style={styles.count}>{value.length}</Text>}
      <View style={isOpen && styles.flipped}><PwaIcon name="chevronDown" size={13} color={colors.textMuted} /></View>
    </>}>
    {() => <FilterOptions label={label} value={value} options={options} onChange={onChange} />}
  </AnchoredDropdown>;
}

function FilterOptions<T extends string>({ label, value, options, onChange }: {
  label: string; value: T[]; options: Option<T>[]; onChange: (value: T[]) => void;
}) {
  const [search, setSearch] = useState('');
  const visible = options.filter((option) => selectSearchMatches(option, search));
  const checkedValues = new Set(value);
  return <>
    <View style={styles.commands}>
      <FastPressable accessibilityRole="button" onPress={() => onChange(options.map((option) => option.value))} style={styles.command}>
        <Text style={styles.link} translate>Выбрать все</Text>
      </FastPressable>
      <FastPressable accessibilityRole="button" onPress={() => onChange([])} style={styles.command}>
        <Text style={styles.link} translate>Очистить</Text>
      </FastPressable>
    </View>
    <TextInput placeholder="Поиск" accessibilityLabel={'Поиск: ' + label}
      value={search} onChangeText={setSearch} style={styles.search} autoCorrect={false} maxLength={160} />
    <FlatList keyboardShouldPersistTaps="handled" data={visible} keyExtractor={(option) => option.value}
      ListEmptyComponent={<Text style={styles.empty} translate>{search ? 'Ничего не найдено' : 'Нет вариантов'}</Text>}
      renderItem={({ item }) => {
        const checked = checkedValues.has(item.value);
        return <FastPressable style={[styles.option, checked && styles.selected]} accessibilityRole="checkbox"
          accessibilityLabel={item.label} accessibilityState={{ checked }}
          onPress={() => onChange(checked ? value.filter((entry) => entry !== item.value) : [...value, item.value])}>
          <View style={[styles.checkbox, checked && styles.checked]}>
            {checked && <PwaIcon name="check" size={12} color={colors.white} />}
          </View>
          <Text style={styles.optionLabel} numberOfLines={1} translate={item.translate !== false}>{item.label}</Text>
        </FastPressable>;
      }} />
  </>;
}

const styles = StyleSheet.create({
  control: { height: 36, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.card,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 9, gap: 6 },
  active: { borderColor: colors.primary },
  title: { flexShrink: 1, fontSize: 14, color: colors.textPrimary },
  flipped: { transform: [{ rotate: '180deg' }] },
  count: { paddingHorizontal: 5, color: colors.primary, fontSize: 12, borderRadius: 8, backgroundColor: colors.primarySoft },
  commands: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 5 },
  command: { minHeight: 33, justifyContent: 'center' },
  link: { fontSize: 13, color: colors.primary },
  search: { height: 34, marginHorizontal: 4, marginBottom: 5, paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, fontSize: 13 },
  option: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 7, borderRadius: radius.sm },
  selected: { backgroundColor: colors.primarySoft },
  optionLabel: { flexShrink: 1, color: colors.textPrimary, fontSize: 14 },
  checkbox: { width: 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: colors.textMuted,
    alignItems: 'center', justifyContent: 'center' },
  checked: { borderColor: colors.primary, backgroundColor: colors.primary },
  empty: { padding: 8, color: colors.textMuted, fontSize: 13 },
});
