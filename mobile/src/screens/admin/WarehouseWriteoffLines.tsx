import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { ActivityIndicator, View } from '@/components/themed';
import { FastPressable } from '@/components/FastPressable';
import { Select } from '@/components/Select';
import { Text } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { apiError } from '@/lib/api';
import { useWriteoffOptions, useWriteoffPreview, type StockDocument, type WriteoffSourceInput, type WriteoffSourceLine } from '@/services/api/stockDocuments';
import { useWarehousePackages } from '@/services/api/warehouse';
import { unitLabel, unitTypeOf, unitsForType } from '@/services/api/warehouseUnits';
import { changeWriteoffPackage, changeWriteoffUnit, emptyWriteoffLine, sameWriteoffSource, writeoffDraftLines, writeoffFormKey, writeoffLineInput, writeoffPreviewPlan, type DraftWriteoffLine } from '@/utils/warehouseWriteoffForm';
import { colors, spacing } from '@/theme';
import { money } from '@/utils/format';

const choiceId = (row: Pick<DraftWriteoffLine, 'kind' | 'sourceId' | 'variantId'>) => `${row.kind}:${row.sourceId}:${row.variantId ?? ''}`;

export function useWarehouseWriteoffLines(enabled: boolean, warehouseId: string, document?: StockDocument) {
  const options = useWriteoffOptions(enabled);
  const packages = useWarehousePackages(enabled);
  const [rows, setRows] = useState(() => writeoffDraftLines(enabled ? document?.sourceLines : undefined, enabled ? document?.items : undefined));
  const [snapshots, setSnapshots] = useState(enabled ? document?.sourceLines ?? [] : []);
  const [savedKey, setSavedKey] = useState(() => writeoffFormKey(rows));
  const [refreshVersion, setRefreshVersion] = useState(0);
  const entered = rows.filter((row) => row.sourceId || row.quantity);
  const firstError = entered.some((row) => !row.sourceId) ? 'Выберите продукт для каждой строки.' : entered.some((row) =>
    !/^\d+(?:[.,]\d+)?$/.test(row.quantity.trim()) || !Number.isFinite(Number(row.quantity.replace(',', '.'))) || Number(row.quantity.replace(',', '.')) < 0.000001
  ) ? 'Укажите количество больше нуля для каждой строки.' : '';
  const plan = writeoffPreviewPlan(rows, snapshots, refreshVersion > 0);
  const serialized = JSON.stringify(plan.inputs);
  const [settled, setSettled] = useState(serialized);
  useEffect(() => { const timer = setTimeout(() => setSettled(serialized), 250); return () => clearTimeout(timer); }, [serialized]);
  const previewInputs: WriteoffSourceInput[] = JSON.parse(settled);
  const preview = useWriteoffPreview(warehouseId, previewInputs, enabled && !!warehouseId && !firstError && plan.needed && settled === serialized, refreshVersion, document?.id);
  const snapshotById = new Map(snapshots.map((line) => [line.sourceLineId, line]));
  const previewById = new Map((settled === serialized && !preview.isError ? preview.data?.sourceLines ?? [] : []).map((line) => [line.sourceLineId, line]));
  const lines = entered.flatMap((row) => {
    const snapshot = snapshotById.get(row.sourceLineId);
    const line = plan.needed && previewById.has(row.sourceLineId) ? previewById.get(row.sourceLineId)
      : refreshVersion === 0 && snapshot?.recipeSignature && sameWriteoffSource(row, snapshot) ? snapshot : undefined;
    return line ? [line] : [];
  });
  const calculating = enabled && !firstError && plan.needed && (settled !== serialized || preview.isFetching || preview.isPending);
  const ready = !firstError && options.isSuccess && !calculating && (!plan.needed || preview.isSuccess) && lines.length === entered.length;
  const total = entered.length === 0 ? 0 : plan.needed ? settled === serialized && preview.isSuccess && !preview.isFetching ? preview.data.total : null
    : document?.sourceTotal ?? (lines.some((line) => line.total == null) ? null : lines.reduce((sum, line) => sum + (line.total ?? 0), 0));
  const choices = [
    ...(options.data?.ingredients ?? []).map((item) => ({ id: choiceId({ kind: 'ingredient', sourceId: item.id }), kind: 'ingredient' as const, sourceId: item.id, variantId: undefined as string | undefined,
      name: item.name, unit: item.unitCode, label: `${item.kind === 'preparation' ? 'Полуфабрикат' : 'Ингредиент'} · ${item.name}` })),
    ...(options.data?.dishes ?? []).flatMap((dish) => (dish.variants.length ? dish.variants : [undefined]).map((variant) => ({
      id: choiceId({ kind: 'dish', sourceId: dish.id, variantId: variant?.id }), kind: 'dish' as const, sourceId: dish.id, variantId: variant?.id,
      name: variant ? `${dish.name} · ${variant.name}` : dish.name, unit: dish.unitCode, label: `Блюдо · ${dish.name}${variant ? ` · ${variant.name}` : ''}`,
    }))),
  ];
  function adopt(saved: StockDocument) {
    const next = writeoffDraftLines(saved.sourceLines, saved.items);
    setRows(next); setSnapshots(saved.sourceLines ?? []); setSavedKey(writeoffFormKey(next)); setRefreshVersion(0);
  }
  return { rows, setRows, options, packages, choices, firstError, enteredCount: entered.length, ready, calculating, total, lines, preview, adopt,
    dirty: writeoffFormKey(rows) !== savedKey || lines.some((line) => snapshotById.has(line.sourceLineId) && snapshotById.get(line.sourceLineId)?.recipeSignature !== line.recipeSignature),
    refresh: () => setRefreshVersion((value) => value + 1),
    input: () => entered.map((row) => ({ ...writeoffLineInput(row), recipeSignature: lines.find((line) => line.sourceLineId === row.sourceLineId)?.recipeSignature })),
  };
}

export function WarehouseWriteoffLines({ editor, sourceLines = [], disabled = false, showCost }: {
  editor?: ReturnType<typeof useWarehouseWriteoffLines>; sourceLines?: WriteoffSourceLine[]; disabled?: boolean; showCost: boolean;
}) {
  if (!editor) return <Card style={styles.panel}>{sourceLines.map((line) => <View key={line.sourceLineId} style={styles.item}>
    <View style={styles.row}><Text style={[styles.title, styles.flex]}>{line.name}</Text>
      <Text>{line.quantity} {line.packageName ?? line.unit}</Text>
      {showCost ? <Text>{line.total == null ? '—' : money(line.total)}</Text> : null}
    </View>
    {line.packageName ? <Text style={styles.muted}>1 {line.packageName} = {line.packageQuantity} {line.packageUnit ? unitLabel(line.packageUnit) : line.unit}</Text> : null}
    {line.details ? <Text style={styles.muted}>{line.details}</Text> : null}
    <RecipeParts line={line} />
  </View>)}</Card>;
  function update(row: DraftWriteoffLine, next: DraftWriteoffLine) { editor!.setRows((rows) => rows.map((value) => value.sourceLineId === row.sourceLineId ? next : value)); }
  return <Card style={styles.panel}>
    <Text style={styles.heading} translate>Наименование</Text>
    {editor.options.isPending ? <Text style={styles.loading} translate>Загрузка продуктов…</Text> : null}
    {editor.packages.isPending && !editor.options.isPending ? <Text style={styles.loading} translate>Загрузка фасовок…</Text> : null}
    {editor.rows.map((row) => {
      const packages = (editor.packages.data ?? []).filter((pack) => pack.isActive && unitTypeOf(pack.unit) === unitTypeOf(row.unit));
      const selected = choiceId(row);
      const choices = editor.choices.map((choice) => ({ value: choice.id, label: choice.label, translate: false }));
      if (row.sourceId && !choices.some((choice) => choice.value === selected)) choices.push({ value: selected, label: row.name ?? 'Сохранённая позиция', translate: false });
      const measures = unitsForType(unitTypeOf(row.unit)).map((unit) => ({ value: unit.value as string, label: unit.label, translate: false }));
      packages.forEach((pack) => measures.push({ value: `pack:${pack.id}`, label: `${pack.name} · ${pack.quantity} ${unitLabel(pack.unit)}`, translate: false }));
      if (row.packageId && !measures.some((unit) => unit.value === `pack:${row.packageId}`)) measures.push({ value: `pack:${row.packageId}`, label: `${row.packageName ?? 'Сохранённая фасовка'} · ${row.packageQuantity ?? ''} ${row.packageUnit ? unitLabel(row.packageUnit) : ''}`, translate: false });
      const line = editor.lines.find((value) => value.sourceLineId === row.sourceLineId);
      return <View key={row.sourceLineId} style={styles.item}>
        <View style={styles.row}>
        <View style={styles.flex}>
        <Select searchable title="Продукт списания" placeholder="Выберите продукт" value={row.sourceId ? selected : ''} options={choices} disabled={disabled || editor.options.isPending} onChange={(id) => {
          const choice = editor.choices.find((value) => value.id === id);
          if (choice && id !== selected) update(row, { sourceLineId: row.sourceLineId, kind: choice.kind, sourceId: choice.sourceId, variantId: choice.variantId, name: choice.name, unit: choice.unit, quantity: '1' });
        }} />
        </View>
        <FastPressable style={styles.remove} accessibilityRole="button" accessibilityLabel={`Убрать ${row.name ?? 'строку'}`} disabled={disabled}
          onPress={() => editor.setRows((rows) => rows.length === 1 ? [emptyWriteoffLine()] : rows.filter((value) => value.sourceLineId !== row.sourceLineId))}>
          <Text style={styles.muted}>×</Text>
        </FastPressable>
        </View>
        <View style={styles.row}><View style={styles.flex}><Field label="Количество" keyboardType="decimal-pad" value={row.quantity} editable={!disabled && !!row.sourceId} onChangeText={(quantity) => update(row, { ...row, quantity })} /></View>
          <View style={styles.flex}><Text style={styles.unitLabel} translate>{packages.length || row.packageId ? 'Фасовки / единица' : 'Единица'}</Text><Select searchable={packages.length > 5} title="Единица или фасовка" value={row.packageId ? `pack:${row.packageId}` : row.unit} options={measures} disabled={disabled || !row.sourceId} onChange={(unit) => {
            if (unit.startsWith('pack:')) { const pack = packages.find((value) => value.id === unit.slice(5)); if (pack && pack.id !== row.packageId) update(row, changeWriteoffPackage(row, pack)); }
            else update(row, changeWriteoffUnit(row, unit as DraftWriteoffLine['unit']));
          }} /></View></View>
        {row.sourceId && showCost ? <Text style={styles.amount}>Сумма: {line?.total == null ? '—' : money(line.total)}</Text> : null}
        <Field label="Детали" value={row.details ?? ''} maxLength={300} multiline editable={!disabled && !!row.sourceId}
          onChangeText={(details) => update(row, { ...row, details })} />
        <RecipeParts key={row.sourceId} line={line} />
      </View>;
    })}
    <View style={styles.tools}>
      <FastPressable accessibilityRole="button" disabled={disabled || editor.rows.length >= 200}
        style={styles.action} onPress={() => editor.setRows((rows) => [...rows, emptyWriteoffLine()])}>
        <Text style={styles.link} translate>+ Добавить</Text>
      </FastPressable>
      {editor.enteredCount > 0 && <FastPressable accessibilityRole="button" disabled={disabled || editor.calculating || !!editor.firstError}
        style={styles.action} onPress={editor.refresh}><Text style={styles.muted} translate>Обновить расчёт</Text></FastPressable>}
    </View>
    {editor.calculating ? <View style={[styles.row, styles.loading]}><ActivityIndicator color={colors.primary} /><Text style={styles.muted} translate>Расчёт состава…</Text></View> : null}
    {editor.firstError ? <Text style={[styles.loading, styles.error]} accessibilityRole="alert">{editor.firstError}</Text> : null}
    {editor.preview.isError ? <Text style={[styles.loading, styles.error]} accessibilityRole="alert">{apiError(editor.preview.error)}</Text> : null}
    {editor.options.isError || editor.packages.isError ? <View style={styles.loading}>
      <Text style={styles.error} accessibilityRole="alert">{apiError(editor.options.error ?? editor.packages.error)}</Text>
      <Button title="Повторить загрузку" variant="secondary" size="md" onPress={() => { void editor.options.refetch(); void editor.packages.refetch(); }} />
    </View> : null}
  </Card>;
}

function RecipeParts({ line }: { line?: WriteoffSourceLine }) {
  const [expanded, setExpanded] = useState(true);
  if (line?.kind !== 'dish' || !line.parts.length) return null;
  return <>
    <FastPressable accessibilityRole="button" accessibilityState={{ expanded }} style={styles.action} onPress={() => setExpanded(!expanded)}>
      <Text style={styles.link}>{expanded ? 'Скрыть состав' : 'Состав'} · {line.parts.length}</Text>
    </FastPressable>
    {expanded && <View style={styles.recipe}>{line.parts.map((part) => <View key={part.ingredientId} style={styles.row}>
      <Text style={[styles.muted, styles.flex]}>{part.name}</Text><Text style={styles.muted}>{part.quantity} {part.unit}</Text>
    </View>)}</View>}
  </>;
}

const styles = StyleSheet.create({
  panel: { padding: 0, overflow: 'hidden' },
  item: { padding: 12, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  heading: { padding: 12, fontSize: 13, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  title: { fontWeight: '600', color: colors.textPrimary },
  muted: { color: colors.textMuted, fontSize: 13 },
  unitLabel: { color: colors.textMuted, fontSize: 13, marginBottom: 6 },
  amount: { color: colors.textPrimary, textAlign: 'right', fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
  loading: { padding: 12, color: colors.textMuted },
  link: { color: colors.primary, fontSize: 14 },
  remove: { width: 30, height: 36, alignItems: 'center', justifyContent: 'center' },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  action: { minHeight: 34, justifyContent: 'center', alignSelf: 'flex-start' },
  recipe: { padding: 8, borderRadius: 8, backgroundColor: colors.background },
});
