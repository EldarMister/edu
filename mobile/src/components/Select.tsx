import { ScrollView, View } from '@/components/themed';
import React, { createContext, useContext, useState } from 'react';
import { useBottomPanelController } from './BottomPanel';
import { FlatList, StyleSheet, type ViewStyle } from 'react-native';
import { Text, TextInput } from '@/components/typography';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';
import { selectSearchMatches } from '@/utils/anchoredSelect';
import { AnchoredDropdown } from './AnchoredDropdown';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  translate?: boolean;
  searchText?: string;
}

type SelectProps<T extends string> = {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  title?: string;
  placeholder?: string;
  style?: ViewStyle;
  disabled?: boolean;
  searchable?: boolean;
};

const AnchoredSelectContext = createContext(false);

export function AnchoredSelectScope({ children }: React.PropsWithChildren) {
  return <AnchoredSelectContext.Provider value>{children}</AnchoredSelectContext.Provider>;
}

export function Select<T extends string>(props: SelectProps<T>) {
  return useContext(AnchoredSelectContext) ? <PopupSelect {...props} /> : <SheetSelect {...props} />;
}

function SheetSelect<T extends string>({ value, options, onChange, title, placeholder, style, disabled = false }: SelectProps<T>) {
  const panel = useBottomPanelController();
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <FastPressable style={[styles.control, style, disabled && { opacity: 0.5 }]} disabled={disabled} accessibilityRole="button" accessibilityLabel={title ?? placeholder} accessibilityState={{ disabled }} onPress={panel.open}>
        <Text style={[styles.value, !selected && styles.placeholder]} numberOfLines={1} translate={selected?.translate !== false}>
          {selected?.label ?? placeholder ?? ''}
        </Text>
        <PwaIcon name="chevronDown" size={16} color={colors.textMuted} />
      </FastPressable>

      <BottomSheet {...panel.bind} sheet title={title ?? placeholder} maxHeight="70%">
        <SheetScrollView showsVerticalScrollIndicator={false}>
          {options.map((o) => {
            const active = o.value === value;
            return (
              <FastPressable
                key={o.value}
                disabled={disabled}
                onPress={() => {
                  onChange(o.value);
                  panel.close();
                }}
                style={[styles.option, active && styles.optionActive]}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]} translate={o.translate !== false}>{o.label}</Text>
                {active ? <PwaIcon name="check" size={18} color={colors.primary} /> : null}
              </FastPressable>
            );
          })}
        </SheetScrollView>
      </BottomSheet>
    </>
  );
}

function PopupSelect<T extends string>({ value, options, onChange, title, placeholder = 'Выберите', style, disabled, searchable }: SelectProps<T>) {
  const selected = options.find((option) => option.value === value);
  const search = searchable ?? options.length > 12;
  return <AnchoredDropdown label={title ?? placeholder} disabled={disabled} buttonStyle={[styles.control, style]}
    width={search ? 260 : 160} height={Math.min(search ? 290 : 256, (search ? 44 : 0) + Math.max(1, options.length) * 36 + 12)}
    trigger={(open) => <>
      <Text style={[styles.popupValue, !selected && styles.placeholder]} numberOfLines={1} translate={selected?.translate !== false}>
        {selected?.label ?? placeholder}
      </Text>
      <View style={open && styles.flipped}><PwaIcon name="chevronDown" size={14} color={colors.textMuted} /></View>
    </>}>
    {(close) => <SelectOptions value={value} options={options} search={search}
      onChoose={(next) => { onChange(next); close(); }} />}
  </AnchoredDropdown>;
}

function SelectOptions<T extends string>({ value, options, search, onChoose }: {
  value: T; options: SelectOption<T>[]; search: boolean; onChoose: (value: T) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = options.filter((option) => selectSearchMatches(option, query));
  return <>
    {search && <TextInput value={query} onChangeText={setQuery} style={styles.search}
      placeholder="Поиск" accessibilityLabel="Поиск в списке" autoCorrect={false} maxLength={160} />}
    <FlatList keyboardShouldPersistTaps="handled" data={visible}
      keyExtractor={(option) => option.value}
      ListEmptyComponent={<Text style={styles.empty} translate>{query ? 'Ничего не найдено' : 'Нет доступных вариантов'}</Text>}
      renderItem={({ item }) => {
        const selected = item.value === value;
        return <FastPressable accessibilityRole="button" accessibilityState={{ selected }}
          style={[styles.popupOption, selected && styles.optionActive]} onPress={() => onChoose(item.value)}>
          <Text numberOfLines={1} translate={item.translate !== false}
            style={[styles.popupOptionText, selected && styles.optionTextActive]}>{item.label}</Text>
          {selected && <PwaIcon name="check" size={16} color={colors.primary} />}
        </FastPressable>;
      }} />
  </>;
}

const styles = StyleSheet.create({
  control: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
  },
  value: { flex: 1, fontSize: fontSize.sm, color: colors.textPrimary },
  popupValue: { flexShrink: 1, fontSize: fontSize.sm, color: colors.textPrimary },
  placeholder: { color: colors.textLight },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  optionActive: { backgroundColor: colors.primarySoft },
  optionText: { fontSize: fontSize.base, color: colors.textSecondary },
  optionTextActive: { color: colors.primary, fontWeight: '600' },
  flipped: { transform: [{ rotate: '180deg' }] },
  search: {
    height: 36, margin: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, color: colors.textPrimary, fontSize: fontSize.sm,
  },
  popupOption: {
    height: 36, paddingHorizontal: 9, borderRadius: radius.sm, gap: spacing.xs, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  popupOptionText: { flexShrink: 1, color: colors.textPrimary, fontSize: fontSize.sm },
  empty: { padding: 8, color: colors.textMuted, fontSize: fontSize.sm },
});
