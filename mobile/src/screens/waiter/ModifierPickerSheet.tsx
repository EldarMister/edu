import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { BottomSheet, SheetScrollView } from '@/components/BottomSheet';
import { FastPressable } from '@/components/FastPressable';
import { PwaIcon } from '@/components/PwaIcon';
import { View } from '@/components/themed';
import { Text } from '@/components/typography';
import { Button, Loading } from '@/components/ui';
import { api, apiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { CartModifiers } from '@/store/cart';
import { colors, radius, spacing } from '@/theme';
import type { CartLine } from '@/types';
import { money } from '@/utils/format';

type Option = { id: string; name: string; price: number; maxQuantity: number };
type Group = { id: string; name: string; minSelections: number; maxSelections: number | null; options: Option[] };
type ModifierConfig = { groups: Group[]; excludableIngredients: { id: string; name: string }[] };

function countSelected(group: Group, quantities: Record<string, number>) {
  return group.options.reduce((sum, option) => sum + (quantities[option.id] ?? 0), 0);
}

export function ModifierPickerSheet({ line, editing = false, onClose, onConfirm }: {
  line: CartLine;
  editing?: boolean;
  onClose: () => void;
  onConfirm: (modifiers: CartModifiers) => void;
}) {
  const t = useT();
  const tablet = useWindowDimensions().width >= 768;
  const dishId = line.dish.id;
  const query = useQuery({
    queryKey: ['dishes', dishId, 'modifiers'],
    queryFn: async ({ signal }) => (await api.get<ModifierConfig>(`/dishes/${dishId}/modifiers`, { signal })).data,
  });
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(
    (line.modifierSelections ?? []).map(({ optionId, quantity }) => [optionId, quantity]),
  ));
  const [excluded, setExcluded] = useState<string[]>(line.excludedIngredientIds ?? []);
  const config = query.data;
  const ingredients = [...new Map(config?.excludableIngredients.map((ingredient) => [ingredient.id, ingredient])).values()];
  const valid = config?.groups.every((group) => {
    const count = countSelected(group, quantities);
    return count >= group.minSelections && (group.maxSelections == null || count <= group.maxSelections) &&
      group.options.every((option) => (quantities[option.id] ?? 0) <= option.maxQuantity);
  });
  const selection = config?.groups.flatMap(({ options }) => options.filter(({ id }) => quantities[id] > 0)
    .map(({ id, name, price }) => ({ optionId: id, name, price, quantity: quantities[id] }))) ?? [];
  const extra = selection.reduce((sum, option) => sum + option.price * option.quantity, 0);
  const canConfirm = !!config && valid && !query.isFetching && !query.isError;

  function changeQuantity(group: Group, option: Option, delta: number) {
    setQuantities((current) => {
      const next = (current[option.id] ?? 0) + delta;
      if (next < 0 || next > option.maxQuantity) return current;
      if (delta > 0 && group.maxSelections != null && countSelected(group, current) >= group.maxSelections) return current;
      return { ...current, [option.id]: next };
    });
  }

  return (
    <BottomSheet visible title={line.dish.name} onClose={onClose}
      presentation={tablet ? 'dialog' : 'bottom'} maxHeight="85%" hideHandle={tablet}
      footer={<Button title={`${t(editing ? 'Сохранить' : 'Добавить')}${extra > 0 ? ` · +${money(extra)}` : ''}`}
        disabled={!canConfirm} onPress={() => {
          if (!config || !canConfirm) return;
          const removed = ingredients.filter(({ id }) => excluded.includes(id));
          onConfirm({
            modifierSelections: selection,
            excludedIngredientIds: removed.map(({ id }) => id),
            excludedIngredientNames: removed.map(({ name }) => name),
          });
        }} />}>
      <SheetScrollView contentContainerStyle={styles.content}>
        {query.isPending ? <Loading text="Загружаем добавки…" /> : null}
        {query.isError ? (
          <View style={styles.content}>
            <Text accessibilityRole="alert" style={styles.error}>{apiError(query.error)}</Text>
            <Button title="Повторить" size="md" variant="secondary" onPress={() => void query.refetch()} />
          </View>
        ) : null}
        {config?.groups.map((group) => {
          const count = countSelected(group, quantities);
          return (
            <View key={group.id} style={styles.group}>
              <Text accessibilityRole="header" style={styles.title}>{group.name}</Text>
              <Text style={styles.hint}>
                {group.minSelections > 0 ? `${t('Минимум')} ${group.minSelections}` : t('По желанию')}
                {group.maxSelections != null ? ` · ${t('Максимум')} ${group.maxSelections}` : ''}
              </Text>
              {group.options.map((option) => {
                const quantity = quantities[option.id] ?? 0;
                return (
                  <View key={option.id} style={styles.option}>
                    <View style={styles.description}>
                      <Text style={styles.name}>{option.name}</Text>
                      {option.price > 0 ? <Text style={styles.hint}>+{money(option.price)}</Text> : null}
                    </View>
                    <QuantityButton icon="minus" label={`${t('Убрать')} ${option.name}`}
                      disabled={quantity === 0} onPress={() => changeQuantity(group, option, -1)} />
                    <Text style={styles.quantity} accessibilityLabel={`${option.name}, ${quantity}`}>{quantity}</Text>
                    <QuantityButton icon="plus" label={`${t('Добавить')} ${option.name}`}
                      disabled={quantity >= option.maxQuantity || (group.maxSelections != null && count >= group.maxSelections)}
                      onPress={() => changeQuantity(group, option, 1)} />
                  </View>
                );
              })}
            </View>
          );
        })}
        {ingredients.length ? (
          <View style={styles.group}>
            <Text accessibilityRole="header" style={styles.title} translate>Убрать из блюда</Text>
            {ingredients.map(({ id, name }) => {
              const checked = excluded.includes(id);
              return (
                <FastPressable key={id} accessibilityRole="checkbox" accessibilityState={{ checked }} style={styles.exclusion}
                  onPress={() => setExcluded((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])}>
                  <View style={[styles.checkbox, checked && styles.checked]}>
                    {checked ? <PwaIcon name="check" color={colors.white} size={15} /> : null}
                  </View>
                  <Text style={styles.name}><Text translate>Без</Text> {name}</Text>
                </FastPressable>
              );
            })}
          </View>
        ) : null}
      </SheetScrollView>
    </BottomSheet>
  );
}

function QuantityButton({ icon, label, disabled, onPress }: {
  icon: 'plus' | 'minus'; label: string; disabled: boolean; onPress: () => void;
}) {
  return (
    <FastPressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress} style={[styles.step, disabled && styles.disabled]}>
      <PwaIcon name={icon} color={colors.primary} size={16} strokeWidth={2.4} />
    </FastPressable>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  group: { gap: 4 },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  name: { color: colors.textPrimary, fontSize: 15 },
  hint: { color: colors.textMuted, fontSize: 13 },
  description: { flex: 1 },
  option: { minHeight: 54, gap: spacing.sm, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border },
  step: { minHeight: 42, minWidth: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: 0.35 },
  quantity: { minWidth: 18, textAlign: 'center', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  exclusion: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  checkbox: { height: 22, width: 22, borderRadius: 6, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checked: { borderColor: colors.primary, backgroundColor: colors.primary },
  error: { color: colors.danger },
});
