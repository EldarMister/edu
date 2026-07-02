import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { colors, fontSize, radius, spacing } from '@/theme';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/** Выпадающий выбор — контрол открывает нижний лист с опциями (порт PWA Select). */
export function Select<T extends string>({
  value,
  options,
  onChange,
  title,
  placeholder,
  style,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  title?: string;
  placeholder?: string;
  style?: ViewStyle;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <FastPressable style={[styles.control, style]} onPress={() => setOpen(true)}>
        <Text style={[styles.value, !selected && styles.placeholder]} numberOfLines={1}>
          {selected?.label ?? placeholder ?? ''}
        </Text>
        <PwaIcon name="chevronDown" size={16} color={colors.textMuted} />
      </FastPressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} sheet title={title ?? placeholder} maxHeight="70%">
        <ScrollView showsVerticalScrollIndicator={false}>
          {options.map((o) => {
            const active = o.value === value;
            return (
              <FastPressable
                key={o.value}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                style={[styles.option, active && styles.optionActive]}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>{o.label}</Text>
                {active ? <PwaIcon name="check" size={18} color={colors.primary} /> : null}
              </FastPressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </>
  );
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
});
