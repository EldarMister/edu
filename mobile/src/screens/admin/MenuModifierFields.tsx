import React from 'react';
import { StyleSheet, type TextInputProps } from 'react-native';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { View } from '@/components/themed';
import { Text, TextInput } from '@/components/typography';
import { Button, Card, Toggle } from '@/components/ui';
import { usePermissions } from '@/hooks/usePermissions';
import { useIngredients } from '@/services/api/warehouse';
import { unitTypeOf, unitsForType } from '@/services/api/warehouseUnits';
import { colors, radius, spacing } from '@/theme';
import type { MenuModifiersDraft, ModifierGroupDraft, ModifierOptionDraft } from './menuModifiersDraft';

const emptyOption = (): ModifierOptionDraft => ({ name: '', price: '0', amount: '' });

export function MenuModifierFields({ draft, onChange, disabled }: {
  draft: MenuModifiersDraft; onChange: (value: MenuModifiersDraft) => void; disabled: boolean;
}) {
  const canViewWarehouse = usePermissions().canSection('warehouse');
  const catalog = useIngredients('', undefined, canViewWarehouse && draft.groups.length > 0);
  const ingredients = catalog.data ?? [];
  const activeIngredients = ingredients.filter((ingredient) => ingredient.isActive);
  const options = [
    { value: '', label: 'Без списания' },
    ...activeIngredients.map((ingredient) => ({ value: ingredient.id, label: ingredient.name, translate: false })),
  ];

  const updateGroup = (index: number, group: Partial<ModifierGroupDraft>) => onChange({
    ...draft, groups: draft.groups.map((item, i) => i === index ? { ...item, ...group } : item),
  });
  const updateOption = (index: number, row: number, patch: Partial<ModifierOptionDraft>) => updateGroup(index, {
    options: draft.groups[index].options.map((option, i) => i === row ? { ...option, ...patch } : option),
  });

  return <AnchoredSelectScope>
    <View style={styles.stack}>
      <Card style={styles.card}>
        <View style={styles.between}>
          <Text style={styles.label} translate>Разрешить исключать ингредиенты</Text>
          <Toggle accessibilityLabel="Разрешить исключать ингредиенты" checked={draft.allowIngredientExclusions} disabled={disabled}
            onChange={(allowIngredientExclusions) => onChange({ ...draft, allowIngredientExclusions })} />
        </View>
        <Button title="Добавить набор" size="md" variant="secondary" disabled={disabled || draft.groups.length >= 30}
          onPress={() => onChange({ ...draft, groups: [...draft.groups, { name: '', minSelections: '1', maxSelections: '1', options: [emptyOption()] }] })} />
      </Card>
      {draft.groups.map((group, index) => (
        <Card style={styles.card} key={group.id ?? index}>
          <Field label="Название набора" value={group.name} editable={!disabled} maxLength={120} onChangeText={(name) => updateGroup(index, { name })} />
          <View style={styles.row}>
            <Field label="Минимум" value={group.minSelections} editable={!disabled} maxLength={3}
              keyboardType="number-pad" onChangeText={(minSelections) => updateGroup(index, { minSelections })} />
            <Field label="Максимум" value={group.maxSelections} editable={!disabled} maxLength={3} placeholder="Без ограничения"
              keyboardType="number-pad" onChangeText={(maxSelections) => updateGroup(index, { maxSelections })} />
          </View>
          {group.options.map((option, row) => {
            const ingredient = ingredients.find(({ id }) => id === option.ingredientId);
            const missingIngredient = option.ingredientId && !activeIngredients.some(({ id }) => id === option.ingredientId);
            const unit = option.unit;
            const adjust = (patch: Partial<ModifierOptionDraft>) => updateOption(index, row, patch);
            return (
              <View style={styles.option} key={option.id ?? row}>
                <Field label="Название модификатора" value={option.name} editable={!disabled} maxLength={120}
                  onChangeText={(name) => adjust({ name })} />
                <Field label="Доплата, с" value={option.price} editable={!disabled} keyboardType="decimal-pad"
                  onChangeText={(price) => adjust({ price })} />
                {canViewWarehouse && <Select title="Списывать со склада" value={option.ingredientId ?? ''} searchable
                  disabled={disabled || catalog.isPending}
                  options={missingIngredient ? [...options, {
                    value: option.ingredientId!, label: ingredient?.name ?? 'Текущая складская позиция',
                  }] : options}
                  onChange={(id) => {
                    const next = activeIngredients.find((item) => item.id === id);
                    if (next?.id === option.ingredientId) return;
                    adjust({ ingredientId: next?.id ?? null, unit: next?.displayUnit,
                      amount: next ? '1' : '', fromCommonWarehouse: false, warehouseId: null });
                  }} />}
                {option.ingredientId && canViewWarehouse && <View style={styles.row}>
                  <Field label="Расход" value={option.amount} editable={!disabled} keyboardType="decimal-pad"
                    onChangeText={(amount) => adjust({ amount })} />
                  <View style={styles.field}>
                    <Text style={styles.label} translate>Единица</Text>
                    <Select title="Единица расхода" value={unit ?? 'pcs'} disabled={disabled}
                      options={unitsForType(ingredient?.unitType ?? unitTypeOf(unit ?? 'pcs'))}
                      onChange={(value) => adjust({ unit: value })} />
                  </View>
                </View>}
                <Button title="Удалить модификатор" variant="secondary" danger size="md" disabled={disabled}
                  onPress={() => updateGroup(index, { options: group.options.filter((_, i) => i !== row) })} />
              </View>
            );
          })}
          <View style={styles.actions}>
            <Button title="Добавить модификатор" size="md" variant="secondary" disabled={disabled || group.options.length >= 100}
              onPress={() => updateGroup(index, { options: [...group.options, emptyOption()] })} />
            <Button title="Удалить набор" size="md" variant="secondary" danger disabled={disabled}
              onPress={() => onChange({ ...draft, groups: draft.groups.filter((_, i) => i !== index) })} />
          </View>
        </Card>
      ))}
    </View>
  </AnchoredSelectScope>;
}

function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={styles.field}>
    <Text style={styles.label} translate>{label}</Text>
    <TextInput accessibilityLabel={label} style={styles.input} {...props} />
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: { gap: spacing.md },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  field: { flex: 1, minWidth: 0, gap: spacing.xs },
  label: { color: colors.textSecondary, fontSize: 14 },
  input: { minHeight: 42, paddingHorizontal: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  option: { gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
