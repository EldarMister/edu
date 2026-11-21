import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text, TextInput } from '@/components/typography';
import { View } from '@/components/themed';
import { Button, Card } from '@/components/ui';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useIngredients, useWarehouseLocations, type Ingredient, type PreparationProcessingMethod } from '@/services/api/warehouse';
import type { MenuRecipeInput, MenuRecipeItem, MenuRecipeMetadata } from '@/services/api/menuEntries';
import { ALL_UNITS, unitsForType, type UnitCode, type UnitType } from '@/services/api/warehouseUnits';
import { colors, spacing } from '@/theme';
import { money } from '@/utils/format';

type RecipeLine = {
  ingredientId: string;
  name: string;
  unit: UnitCode;
  unitType: UnitType;
  gross: string;
  net: string | null;
  lossPercent?: number;
  method?: PreparationProcessingMethod | null;
  fromCommonWarehouse?: boolean;
  warehouseId?: string | null;
  variantAmounts: Record<string, string>;
  unitCost?: number | null;
};

export type DishRecipeDraft = {
  lines: RecipeLine[];
  instructions: string;
  outputQuantity: string;
  outputUnit: string;
  photoUrl?: string;
};
type Variant = { id: string; name: string };

const METHODS: { value: PreparationProcessingMethod | ''; label: string }[] = [
  { value: '', label: 'Без обработки' }, { value: 'cleaning', label: 'Очистка' }, { value: 'boiling', label: 'Варка' },
  { value: 'frying', label: 'Жарка' }, { value: 'stewing', label: 'Тушение' }, { value: 'baking', label: 'Запекание' },
];
const parseNumber = (value: string) => value.trim() ? Number(value.trim().replace(',', '.')) : NaN;
const shown = (value: number) => String(Number(value.toFixed(9)));
const RECIPES_LIMIT = 200;

export function initialDishRecipe(items: MenuRecipeItem[], metadata?: MenuRecipeMetadata | null): DishRecipeDraft {
  return {
    instructions: metadata?.instructions ?? '',
    outputQuantity: metadata?.outputQuantity == null ? '' : String(metadata.outputQuantity),
    outputUnit: metadata?.outputUnit ?? '',
    photoUrl: metadata?.photoUrl,
    lines: items.map((item) => ({
      ingredientId: item.ingredientId, name: item.name, unit: item.amountUnit, unitType: item.unitType,
      gross: String(item.baseAmount ?? item.amount),
      net: item.netAmount == null ? null : String(item.netAmount),
      lossPercent: item.lossPercent, method: item.processingMethod,
      fromCommonWarehouse: item.fromCommonWarehouse, warehouseId: item.warehouseId,
      variantAmounts: Object.fromEntries(Object.entries(item.variantAmounts ?? {}).map(([id, value]) => [id, String(value)])),
      unitCost: item.costKnown === false ? null : item.avgCost,
    })),
  };
}

export function dishRecipePayload(draft: DishRecipeDraft, variantIds: string[]):
  { payload: MenuRecipeInput } | { error: string } {
  const active = new Set(variantIds);
  const items: MenuRecipeInput['items'] = [];

  for (const row of draft.lines) {
    const amount = parseNumber(row.gross);
    const netAmount = row.net == null ? null : row.net.trim() ? parseNumber(row.net) : undefined;
    const variantAmounts: Record<string, number> = {};
    for (const [id, raw] of Object.entries(row.variantAmounts)) {
      if (!active.has(id) || !raw.trim()) continue;
      const quantity = parseNumber(raw);
      if (!Number.isFinite(quantity) || quantity < 0) return { error: row.name + ' — проверьте расход по вариантам.' };
      variantAmounts[id] = quantity;
    }
    if (!Number.isFinite(amount) || amount < 0 || (amount === 0 && !Object.values(variantAmounts).some((value) => value > 0))) {
      return { error: row.name + ' — укажите брутто больше нуля или задайте расход для варианта.' };
    }
    if (netAmount != null && (!Number.isFinite(netAmount) || netAmount < 0 || netAmount > amount)) {
      return { error: row.name + ' — нетто должно быть от 0 до брутто.' };
    }
    items.push({
      ingredientId: row.ingredientId, amount, unit: row.unit, netAmount,
      lossPercent: row.lossPercent, processingMethod: row.method,
      fromCommonWarehouse: row.fromCommonWarehouse, warehouseId: row.warehouseId, variantAmounts,
    });
  }
  const outputQuantity = draft.outputQuantity.trim() ? parseNumber(draft.outputQuantity) : undefined;
  if (outputQuantity !== undefined && (!Number.isFinite(outputQuantity) || outputQuantity < 0.001)) {
    return { error: 'Укажите выход блюда не меньше 0,001.' };
  }
  return { payload: { items, metadata: {
    instructions: draft.instructions, outputQuantity, outputUnit: draft.outputUnit.trim() || undefined, photoUrl: draft.photoUrl,
  } } };
}

export function hasRemovedVariantAmounts(draft: DishRecipeDraft, variantIds: string[]) {
  const active = new Set(variantIds);
  return draft.lines.some((row) => Object.keys(row.variantAmounts).some((id) => !active.has(id)));
}

function convertUnit(row: RecipeLine, unit: UnitCode): RecipeLine {
  if (unit === row.unit) return row;
  const current = ALL_UNITS.find((definition) => definition.code === row.unit)?.factor ?? 1;
  const next = ALL_UNITS.find((definition) => definition.code === unit)?.factor ?? 1;
  const factor = current / next;
  const convert = (input: string) => {
    const number = parseNumber(input);
    return Number.isFinite(number) ? shown(number * factor) : input;
  };
  return {
    ...row, unit, gross: convert(row.gross), net: row.net == null ? null : convert(row.net),
    variantAmounts: Object.fromEntries(Object.entries(row.variantAmounts).map(([id, value]) => [id, convert(value)])),
    unitCost: row.unitCost == null ? row.unitCost : row.unitCost / factor,
  };
}

function recalculateNet(gross: string, lossPercent: number | undefined) {
  const current = parseNumber(gross);
  return Number.isFinite(current) ? shown(current * (1 - (lossPercent ?? 0) / 100)) : '';
}

export function DishRecipeFields({ draft, onChange, variants, disabled }: {
  draft: DishRecipeDraft; onChange: React.Dispatch<React.SetStateAction<DishRecipeDraft>>;
  variants: Variant[]; disabled: boolean;
}) {
  const ingredients = useIngredients('');
  const locations = useWarehouseLocations();
  const { canAction } = usePermissions();
  const [variantRow, setVariantRow] = useState<string | null>(null);
  const byId = new Map((ingredients.data ?? []).map((item) => [item.id, item]));
  const selected = new Set(draft.lines.map((row) => row.ingredientId));
  const options = (ingredients.data ?? []).filter((item) => !selected.has(item.id) && item.isActive)
    .map((item) => ({ value: item.id, label: item.name, translate: false }));
  const cost = draft.lines.length && draft.lines.every((row) => row.unitCost != null && Number.isFinite(parseNumber(row.gross)))
    ? draft.lines.reduce((sum, row) => sum + parseNumber(row.gross) * (row.unitCost ?? 0), 0) : null;

  function patch(id: string, update: Partial<RecipeLine>) {
    onChange((current) => ({ ...current, lines: current.lines.map((row) => row.ingredientId === id ? { ...row, ...update } : row) }));
  }
  function add(ingredient: Ingredient) {
    onChange((current) => ({
      ...current,
      lines: current.lines.some((line) => line.ingredientId === ingredient.id) || current.lines.length >= RECIPES_LIMIT ? current.lines : [
        ...current.lines,
        {
          ingredientId: ingredient.id, name: ingredient.name, unit: ingredient.displayUnit, unitType: ingredient.unitType,
          gross: '', net: '', variantAmounts: {},
          unitCost: ingredient.isPrepared && ingredient.preparationMode === 'virtual' ? ingredient.recipeUnitCost : ingredient.avgCost,
        },
      ],
    }));
  }

  return <View style={styles.stack}>
    <View style={styles.row}>
      <View style={styles.flex}>
        <RecipeField label="Выход" value={draft.outputQuantity} disabled={disabled} keyboardType="decimal-pad"
          onChange={(outputQuantity) => onChange((current) => ({ ...current, outputQuantity }))} />
      </View>
      <View style={styles.flex}>
        <RecipeField label="Единица выхода" value={draft.outputUnit} disabled={disabled} maxLength={16}
          onChange={(outputUnit) => onChange((current) => ({ ...current, outputUnit }))} />
      </View>
    </View>
    <RecipeField label="Технология приготовления" value={draft.instructions} disabled={disabled} multiline maxLength={12000}
      onChange={(instructions) => onChange((current) => ({ ...current, instructions }))} />
    <Text style={styles.heading} translate>Состав техкарты</Text>
    {draft.lines.map((row) => {
      const id = row.ingredientId;
      const warehouse = row.warehouseId ? 'warehouse:' + row.warehouseId : row.fromCommonWarehouse ? 'common' : '';
      const warehouses = (locations.data?.locations ?? []).map((location) => ({
        value: 'warehouse:' + location.id, label: location.name, translate: false,
      }));
      if (row.warehouseId && !warehouses.some((item) => item.value === warehouse)) {
        warehouses.push({ value: warehouse, label: 'Склад', translate: true });
      }
      return <Card key={id} style={styles.stack}>
        <Text style={styles.heading}>{row.name}</Text>
        <Select title="Обработка" value={row.method ?? ''} options={METHODS} disabled={disabled}
          onChange={(value) => {
            const lossPercent = value ? byId.get(id)?.processingLosses?.[value] ?? 0 : 0;
            patch(id, { method: value || null, lossPercent, net: recalculateNet(row.gross, lossPercent) });
          }} />
        <View style={styles.row}>
          <View style={styles.flex}>
            <RecipeField label="Брутто" value={row.gross} disabled={disabled} keyboardType="decimal-pad" onChange={(gross) =>
              patch(id, { gross, net: recalculateNet(gross, row.lossPercent) })} />
          </View>
          <View style={styles.flex}>
            <RecipeField label="Нетто" value={row.net ?? ''} disabled={disabled} keyboardType="decimal-pad" onChange={(net) => {
              const gross = parseNumber(row.gross);
              const netValue = parseNumber(net);
              patch(id, { net, lossPercent: gross > 0 && Number.isFinite(netValue) ? Math.max(0, Math.min(100, 100 * (1 - netValue / gross))) : row.lossPercent });
            }} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.label} translate>Ед.</Text>
            <Select title="Единица количества" value={row.unit} options={unitsForType(row.unitType)} disabled={disabled}
              onChange={(unit) => patch(id, convertUnit(row, unit))} />
          </View>
        </View>
        <Select title="Склад списания" value={warehouse} options={[{ value: '', label: 'Склад цеха' },
          { value: 'common', label: 'Основной склад' }, ...warehouses]} disabled={disabled}
          onChange={(value) => patch(id, { fromCommonWarehouse: value === 'common', warehouseId: value.startsWith('warehouse:') ? value.slice('warehouse:'.length) : null })} />
        {variants.length > 0 && <Button title="Нормы по вариантам" size="md" variant="secondary"
          onPress={() => setVariantRow((current) => current === id ? null : id)} />}
        {variantRow === id && variants.map((variant) => <RecipeField key={variant.id} label={variant.name}
          value={row.variantAmounts[variant.id] ?? ''} disabled={disabled} keyboardType="decimal-pad"
          onChange={(value) => patch(id, { variantAmounts: { ...row.variantAmounts, [variant.id]: value } })} />)}
        <Button title="Убрать ингредиент" size="md" variant="secondary" disabled={disabled}
          onPress={() => onChange((current) => ({ ...current, lines: current.lines.filter((line) => line.ingredientId !== id) }))} />
      </Card>;
    })}
    {canAction('warehouseCosts') && draft.lines.length > 0 && <Text style={styles.label}>Себестоимость: {cost == null ? '—' : money(cost)}</Text>}
    <Select title="Добавить ингредиент" value="" placeholder="Добавить ингредиент" options={options}
      disabled={disabled || !options.length || draft.lines.length >= RECIPES_LIMIT} onChange={(id) => {
        const ingredient = byId.get(id);
        if (ingredient) add(ingredient);
      }} />
    {ingredients.isError && <Text style={styles.error}>{apiError(ingredients.error)}</Text>}
  </View>;
}

function RecipeField({ label, onChange, disabled, ...input }: {
  label: string; value: string; onChange: (value: string) => void; disabled: boolean;
  keyboardType?: 'decimal-pad'; multiline?: boolean; maxLength?: number;
}) {
  return <View style={styles.flex}>
    <Text style={styles.label} translate>{label}</Text>
    <TextInput {...input} style={[styles.input, input.multiline && styles.multiline]} accessibilityLabel={label}
      editable={!disabled} onChangeText={onChange} placeholder={input.keyboardType ? '0' : undefined} placeholderTextColor={colors.textLight} />
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm }, row: { flexDirection: 'row', gap: spacing.sm }, flex: { flex: 1, minWidth: 0 },
  label: { color: colors.textSecondary, fontSize: 13, marginBottom: 4 },
  heading: { color: colors.textPrimary, fontWeight: '600', fontSize: 16 },
  input: { minHeight: 42, paddingHorizontal: spacing.sm, borderWidth: 1, borderRadius: 8, borderColor: colors.border, backgroundColor: colors.card, color: colors.textPrimary },
  multiline: { minHeight: 80, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  error: { color: colors.danger },
});
