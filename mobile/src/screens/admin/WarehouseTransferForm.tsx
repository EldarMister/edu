import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { FastPressable } from '@/components/FastPressable';
import { Select } from '@/components/Select';
import { Alert, Text } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useStockDocument, useStockDocumentMutations, type CreateStockDocumentInput, type StockDocument } from '@/services/api/stockDocuments';
import { qty, useIngredients, type Ingredient, type WarehouseLocation } from '@/services/api/warehouse';
import { ALL_UNITS, unitsForType, type UnitCode } from '@/services/api/warehouseUnits';
import { colors, fontSize, spacing } from '@/theme';
import { documentQuantities } from '@/utils/warehouseDocumentForm';
import { warehouseTimingError, warehouseTimingFor, warehouseTimingValue, warehouseTimeDisplay, type WarehouseTiming } from '@/utils/warehouseTiming';
import { changeTransferUnit, transferDraftRows, transferRowsInput, type TransferDraftRow } from '@/utils/warehouseTransferForm';
import { money } from '@/utils/format';
import { WarehouseTimingField } from './WarehouseTimingField';
import { WarehouseWorkspace } from './WarehouseWorkspace';

export function stockTransferInput({
  warehouseId, destinationWarehouseId, ingredientId, displayUnit, unit, quantity, requestKey, timing, note,
}: {
  warehouseId: string;
  destinationWarehouseId: string;
  ingredientId: string;
  displayUnit: UnitCode;
  unit: UnitCode;
  quantity: string;
  requestKey: string;
  timing: WarehouseTiming;
  note: string;
}): CreateStockDocumentInput | null {
  if (!warehouseId || !destinationWarehouseId || warehouseId === destinationWarehouseId || !ingredientId) return null;
  const parsed = documentQuantities([{ ingredientId, value: quantity }], false);
  const inputUnit = ALL_UNITS.find((entry) => entry.code === unit);
  const ingredientUnit = ALL_UNITS.find((entry) => entry.code === displayUnit);
  if (!parsed.canSubmit || !inputUnit || !ingredientUnit || inputUnit.type !== ingredientUnit.type) return null;
  const baseQuantity = (parsed.items[0].quantity ?? 0) * inputUnit.factor;
  if (baseQuantity < 0.0005 || baseQuantity > 99_999_999_999.999 || warehouseTimingError(timing)) return null;
  const effectiveAt = warehouseTimingValue(timing);
  if (effectiveAt === undefined) return null;
  return {
    kind: 'transfer', finalize: 'post', warehouseId, destinationWarehouseId, requestKey, effectiveAt,
    ...(note.trim() ? { note: note.trim() } : {}),
    items: [{ ingredientId, quantity: baseQuantity / ingredientUnit.factor }],
  };
}

export interface WarehouseTransferFormProps {
  documentId?: string;
  copyDocumentId?: string;
  initialIngredient?: Ingredient;
  source?: WarehouseLocation;
  locations: WarehouseLocation[];
  onClose: () => void;
  onSaved?: (document: StockDocument) => void;
  closeAfterPost?: boolean;
}

/** Compatibility entry used by the balance row. */
export function WarehouseTransferSheet({ ingredient, from, locations, onClose }: {
  ingredient: Ingredient; from?: WarehouseLocation; locations: WarehouseLocation[]; onClose: () => void;
}) {
  return <WarehouseTransferForm initialIngredient={ingredient} source={from} locations={locations} onClose={onClose} closeAfterPost />;
}

export function WarehouseTransferForm(props: WarehouseTransferFormProps) {
  const [activeId, setActiveId] = useState(props.documentId);
  const queryId = activeId ?? props.copyDocumentId;
  const query = useStockDocument(queryId ?? '');
  if (queryId && !query.data) return <WarehouseWorkspace title="Перемещение" onClose={props.onClose}>
    <View style={styles.content}>{query.isLoading ? <ActivityIndicator color={colors.primary} /> : <><Text style={styles.error}>{apiError(query.error)}</Text><Button title="Повторить" variant="secondary" onPress={() => void query.refetch()} /></>}</View>
  </WarehouseWorkspace>;
  if (query.data && query.data.kind !== 'transfer') return <WarehouseWorkspace title="Перемещение" onClose={props.onClose}><Text style={styles.error}>Документ не является перемещением.</Text></WarehouseWorkspace>;
  return <TransferDocumentFields {...props} incoming={activeId ? query.data : undefined} copy={activeId ? undefined : query.data}
    onSaved={(document) => { setActiveId(document.id); props.onSaved?.(document); }} />;
}

const statusLabels = { draft: 'Черновик', submitted: 'На утверждении', posted: 'Проведён', reversed: 'Сторнирован' } as const;
const emptyRow = (): TransferDraftRow => ({ key: randomUUID(), ingredientId: '', name: '', quantity: '', unit: 'pcs', documentUnit: 'pcs' });
const formKey = (source: string, destination: string, rows: TransferDraftRow[], note: string, effectiveAt: string | null | undefined) => JSON.stringify({ source, destination, rows, note, effectiveAt });

function TransferDocumentFields({ incoming, copy, source, initialIngredient, locations, onClose, onSaved, closeAfterPost }: WarehouseTransferFormProps & {
  incoming?: StockDocument; copy?: StockDocument;
}) {
  const { canAction } = usePermissions();
  const canTransfer = canAction('warehouseTransfer');
  const canApprove = canAction('warehouseApprove');
  const showCost = canAction('warehouseCosts');
  const [document, setDocument] = useState(incoming);
  const initial = incoming ?? copy;
  const [sourceId, setSourceId] = useState(initial?.warehouseId ?? source?.id ?? '');
  const [destinationId, setDestinationId] = useState(initial?.destinationWarehouseId ?? '');
  const [rows, setRows] = useState<TransferDraftRow[]>(() => initial ? transferDraftRows(initial.items) : initialIngredient ? [{ key: randomUUID(), ingredientId: initialIngredient.id, name: initialIngredient.name, quantity: '', unit: initialIngredient.displayUnit, documentUnit: initialIngredient.displayUnit }] : [emptyRow()]);
  const [note, setNote] = useState(initial?.note ?? '');
  const [timing, setTiming] = useState(() => warehouseTimingFor(incoming?.effectiveAt));
  const [savedKey, setSavedKey] = useState(() => formKey(sourceId, destinationId, rows, note, incoming?.effectiveAt ?? null));
  const [requestKey] = useState(() => randomUUID());
  const [reverseReason, setReverseReason] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mutations = useStockDocumentMutations();
  const pending = mutations.create.isPending || mutations.save.isPending || mutations.transition.isPending;
  const editable = (!document || document.status === 'draft') && canTransfer;
  const ingredients = useIngredients('', sourceId, editable && !!sourceId);
  const catalog = ingredients.data ?? [];
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const rowsForSave = document ? rows : rows.map((row) => ({
    ...row, documentUnit: byId.get(row.ingredientId)?.displayUnit ?? row.documentUnit,
  }));
  const values = transferRowsInput(rowsForSave);
  const unavailable = !document && ingredients.isSuccess && rows.find(({ ingredientId }) => ingredientId && !byId.has(ingredientId));
  const effectiveAt = warehouseTimingValue(timing, document?.effectiveAt);
  const timingError = warehouseTimingError(timing);
  const dirty = formKey(sourceId, destinationId, rows, note, effectiveAt) !== savedKey;
  const stale = !!incoming && !!document && incoming.revision > document.revision;
  const sourceName = locations.find((location) => location.id === sourceId)?.name ?? 'Недоступный склад';
  const destinationName = locations.find((location) => location.id === destinationId)?.name ?? 'Недоступный склад';
  const locationValid = !!sourceId && !!destinationId && sourceId !== destinationId && locations.some((location) => location.id === sourceId) && locations.some((location) => location.id === destinationId);
  const formValid = locationValid && !values.error && !unavailable && !timingError && effectiveAt !== undefined && (values.count === 0 || ingredients.isSuccess);
  const historical = timing.mode === 'past';
  const totals = rows.filter((row) => row.ingredientId).map((row) => {
    const item = byId.get(row.ingredientId);
    const factor = ALL_UNITS.find((unit) => unit.code === row.unit)?.factor ?? 1;
    const base = Number(row.quantity.replace(',', '.')) * factor;
    return !item || historical || item.avgCostBase == null || !row.quantity.trim() || !Number.isFinite(base) || base > item.stockBase + 0.0005 ? null : base * item.avgCostBase;
  });
  const forecast = values.count && !values.error && totals.every((value) => value != null) ? totals.reduce<number>((total, value) => total + (value ?? 0), 0) : null;

  function adopt(saved: StockDocument) {
    const nextRows = transferDraftRows(saved.items);
    setDocument(saved); setSourceId(saved.warehouseId); setDestinationId(saved.destinationWarehouseId ?? ''); setRows(nextRows); setNote(saved.note ?? '');
    setTiming(warehouseTimingFor(saved.effectiveAt)); setSavedKey(formKey(saved.warehouseId, saved.destinationWarehouseId ?? '', nextRows, saved.note ?? '', saved.effectiveAt ?? null)); setError('');
  }
  useEffect(() => { if (stale && !dirty && !pending && incoming) adopt(incoming); }, [incoming?.revision, stale, dirty, pending]);
  function close() {
    if (inFlight.current) return;
    if (!dirty) onClose();
    else Alert.alert('Есть несохранённые изменения', 'Выйти без сохранения?', [{ text: 'Продолжить', style: 'cancel' }, { text: 'Выйти', style: 'destructive', onPress: onClose }]);
  }
  async function save(post: boolean) {
    if (inFlight.current || !editable || stale || !formValid || (post && !values.canPost)) return;
    inFlight.current = true; setError('');
    try {
      const input = { items: values.items, note: note.trim(), effectiveAt, finalize: post ? 'post' as const : undefined };
      const saved = document ? await mutations.save.mutateAsync({ id: document.id, revision: document.revision, ...input })
        : await mutations.create.mutateAsync({ kind: 'transfer', warehouseId: sourceId, destinationWarehouseId: destinationId, requestKey, ...input });
      adopt(saved); onSaved?.(saved);
      if (post && closeAfterPost) onClose();
    } catch (cause) { setError(apiError(cause)); } finally { inFlight.current = false; }
  }
  async function transition(action: 'approve' | 'reopen' | 'reverse') {
    if (!document || inFlight.current || stale || (action === 'approve' ? !canTransfer : !canApprove) || (action === 'reverse' && !reverseReason.trim())) return;
    inFlight.current = true; setError('');
    try {
      const saved = await mutations.transition.mutateAsync({ id: document.id, revision: document.revision, action, note: action === 'reverse' ? reverseReason.trim() : undefined });
      adopt(saved); onSaved?.(saved);
    } catch (cause) { setError(apiError(cause)); } finally { inFlight.current = false; }
  }
  const footer = editable ? <View style={styles.actions}>
    <Button title="Сохранить" size="md" style={styles.action} disabled={!formValid || !values.canPost || pending || stale} onPress={() => Alert.alert('Провести перемещение?', `${sourceName} → ${destinationName}. Проверьте дату и количества.`, [{ text: 'Назад', style: 'cancel' }, { text: 'Провести', onPress: () => void save(true) }])} />
    <Button title="Сохранить черновик" variant="secondary" size="md" style={styles.action} disabled={!formValid || pending || stale || (!!document && !dirty)} onPress={() => void save(false)} />
    {showCost ? <Text style={styles.footerTotal}>{historical ? 'Стоимость после проведения' : 'Итого: ' + (!values.count && !values.error ? money(0) : forecast == null ? 'стоимость неполная' : money(forecast))}</Text> : null}
  </View> : document?.status === 'submitted' ? <View style={styles.actions}>
    {canApprove ? <Button title="Вернуть в черновик" variant="secondary" size="md" style={styles.action} disabled={pending || stale} onPress={() => void transition('reopen')} /> : null}
    {canTransfer ? <Button title="Провести перемещение" size="md" style={styles.action} disabled={pending || stale} onPress={() => Alert.alert('Провести перемещение?', `${sourceName} → ${destinationName}`, [{ text: 'Назад', style: 'cancel' }, { text: 'Провести', onPress: () => void transition('approve') }])} /> : null}
  </View> : undefined;

  return <WarehouseWorkspace title={document ? 'Перемещение' : 'Новое перемещение'} onClose={close} footer={footer}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card style={styles.fields}>
        {document ? <><Text style={styles.status}>{statusLabels[document.status]}</Text><Text style={styles.label}>Создан: {warehouseTimeDisplay(document.createdAt)}{document.createdByName ? ` · ${document.createdByName}` : ''}</Text></> : null}
        {editable ? <WarehouseTimingField label="Дата перемещения" value={timing} onChange={setTiming} disabled={pending || stale} /> : <Text style={styles.title}>Учётная дата: {document?.effectiveAt || document?.postedAt ? warehouseTimeDisplay(document.effectiveAt ?? document.postedAt!) : 'На момент проведения'}</Text>}
        <View style={styles.field}><Text style={styles.label}>Со склада</Text>{document ? <Text style={styles.title}>{sourceName}</Text> : <Select title="Со склада" placeholder="Выберите склад" value={sourceId} options={locations.map(({ id, name }) => ({ value: id, label: name, translate: false }))} disabled={pending} onChange={(value) => { setSourceId(value); if (destinationId === value) setDestinationId(''); }} />}</View>
        <View style={styles.field}><Text style={styles.label}>На склад</Text>{document ? <Text style={styles.title}>{destinationName}</Text> : <Select title="На склад" placeholder="Выберите склад" value={destinationId} options={locations.filter((location) => location.id !== sourceId).map(({ id, name }) => ({ value: id, label: name, translate: false }))} disabled={pending || !sourceId} onChange={setDestinationId} />}</View>
        {document && editable ? <Text style={styles.label}>Склады сохранённого документа не меняются. Для другого направления создайте новое перемещение.</Text> : null}
        {editable ? <Field label="Комментарий" multiline style={styles.note} value={note} onChangeText={setNote} maxLength={1000} editable={!pending && !stale} /> : note ? <Text>{note}</Text> : null}
      </Card>
      {stale && dirty ? <Card style={styles.fields}><Text style={styles.error}>Документ изменён другим сотрудником. Ваш ввод сохранён на экране; загрузите актуальную версию перед сохранением.</Text><Button title="Загрузить актуальный документ" variant="secondary" disabled={pending} onPress={() => Alert.alert('Заменить ваш ввод?', 'Будут загружены последние сохранённые значения.', [{ text: 'Назад', style: 'cancel' }, { text: 'Загрузить', onPress: () => incoming && adopt(incoming) }])} /></Card> : null}
      {editable && ingredients.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {editable && ingredients.isError ? <Card style={styles.fields}><Text style={styles.error}>{apiError(ingredients.error)}</Text><Button title="Повторить загрузку продуктов" variant="secondary" onPress={() => void ingredients.refetch()} /></Card> : null}
      <Card style={styles.linePanel}>
      <Text style={styles.lineHeading} translate>Наименование</Text>
      {rows.map((row) => {
        const item = byId.get(row.ingredientId);
        const baseQuantity = Number(row.quantity.replace(',', '.')) * (ALL_UNITS.find((unit) => unit.code === row.unit)?.factor ?? 1);
        const shortage = !historical && item && Number.isFinite(baseQuantity) && baseQuantity > item.stockBase + 0.0005;
        const selectedIds = new Set(rows.flatMap((other) => other.key === row.key ? [] : [other.ingredientId]));
        const choices = catalog.filter((candidate) => candidate.preparationMode !== 'virtual' && (candidate.isActive || candidate.stock !== 0 || candidate.id === row.ingredientId) && !selectedIds.has(candidate.id)).map((candidate) => ({ value: candidate.id, label: candidate.name, searchText: candidate.category ?? undefined, translate: false }));
        if (row.ingredientId && !choices.some((choice) => choice.value === row.ingredientId)) choices.unshift({ value: row.ingredientId, label: row.name, searchText: '', translate: false });
        const update = (next: TransferDraftRow) => setRows((current) => current.map((value) => value.key === row.key ? next : value));
        return <View key={row.key} style={styles.line}>
          {editable ? <View style={styles.row}><View style={styles.flex}><Select searchable title="Продукт перемещения" placeholder="Выберите продукт" value={row.ingredientId} options={choices} disabled={pending || stale || !sourceId} onChange={(id) => {
            const next = byId.get(id); if (!next || id === row.ingredientId) return;
            update({ key: row.key, ingredientId: id, name: next.name, quantity: row.quantity, unit: next.displayUnit, documentUnit: next.displayUnit });
          }} /></View><FastPressable accessibilityRole="button" accessibilityLabel={`Убрать ${row.name || 'строку'}`} disabled={pending || stale}
            style={styles.remove} onPress={() => setRows((current) => current.length === 1 ? [emptyRow()] : current.filter((value) => value.key !== row.key))}>
            <Text style={styles.label}>×</Text>
          </FastPressable></View> : <Text style={styles.title}>{row.name}</Text>}
          {editable ? <View style={styles.row}><View style={styles.flex}><Field label="Количество" value={row.quantity} onChangeText={(quantity) => update({ ...row, quantity })} keyboardType="decimal-pad" editable={!pending && !stale} /></View><View style={styles.flex}><Text style={styles.label}>Единица</Text><Select title="Единица" value={row.unit} options={unitsForType(ALL_UNITS.find((unit) => unit.code === row.unit)?.type ?? 'count')} disabled={pending || stale} onChange={(unit) => update(changeTransferUnit(row, unit))} /></View></View> : <Text>{qty(Number(row.quantity), row.unit)}</Text>}
          {editable && item && !historical ? <Text style={shortage ? styles.error : styles.label}>На складе {qty(item.stock, item.unit)}{shortage ? ' · недостаточно для указанного количества' : ''}</Text> : null}
          {editable && !historical && showCost && row.ingredientId ? <Text style={styles.lineAmount}>Сумма: {!item || item.avgCostBase == null || shortage || !row.quantity.trim() || !Number.isFinite(baseQuantity) ? '—' : money(baseQuantity * item.avgCostBase)}</Text> : null}
          {!editable && showCost ? <Text style={styles.label}>{document?.items?.find((line) => line.ingredientId === row.ingredientId)?.value == null ? 'Стоимость неизвестна' : money(Math.abs(document.items.find((line) => line.ingredientId === row.ingredientId)!.value!))}</Text> : null}
        </View>;
      })}
      {editable ? <FastPressable accessibilityRole="button" accessibilityLabel="Добавить строку перемещения" style={styles.addRow} disabled={pending || stale || rows.length >= 200 || !sourceId}
        onPress={() => setRows((current) => [...current, emptyRow()])}><Text style={styles.link} translate>+ Добавить</Text></FastPressable> : null}
      </Card>
      {editable && values.error ? <Text style={styles.error}>{values.error}</Text> : null}
      {editable && unavailable ? <Text style={styles.error}>Позиция «{unavailable.name}» больше недоступна для перемещения.</Text> : null}
      {editable ? <Text style={styles.label} translate>«Сохранить» проведёт документ и изменит остатки. Черновик сохраняет данные без изменения остатков.</Text> : null}
      {showCost && !editable ? <Text style={styles.title}>Итого: {document?.varianceValue == null ? 'Стоимость неизвестна' : money(Math.abs(document.varianceValue))}</Text> : null}
      {document?.postedAt ? <Text style={styles.label}>Проведён: {warehouseTimeDisplay(document.postedAt)}{document.postedByName ? ` · ${document.postedByName}` : ''}</Text> : null}
      {document?.status === 'posted' && canApprove ? <Card style={styles.fields}><Field label="Причина сторно" value={reverseReason} onChangeText={setReverseReason} maxLength={1000} editable={!pending} /><Button title="Сторнировать перемещение" variant="danger" disabled={pending || stale || !reverseReason.trim()} onPress={() => Alert.alert('Сторнировать перемещение?', 'Будет создано обратное перемещение. Операция возможна при достаточном остатке на складе назначения.', [{ text: 'Назад', style: 'cancel' }, { text: 'Сторнировать', style: 'destructive', onPress: () => void transition('reverse') }])} /></Card> : null}
      {document?.reversedAt ? <Text style={styles.label}>Сторнирован: {warehouseTimeDisplay(document.reversedAt)}{document.reversedByName ? ` · ${document.reversedByName}` : ''}{document.reversalReason ? `\n${document.reversalReason}` : ''}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </WarehouseWorkspace>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md }, fields: { gap: spacing.md }, field: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, flex: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: fontSize.base, fontWeight: '600' },
  label: { color: colors.textSecondary, fontSize: fontSize.sm }, status: { color: colors.primary, fontWeight: '600' },
  error: { color: colors.danger, fontSize: fontSize.sm }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, action: { flexGrow: 1 },
  footerTotal: { width: '100%', textAlign: 'right', fontWeight: '600', color: colors.textPrimary },
  note: { minHeight: 58, textAlignVertical: 'top' },
  linePanel: { padding: 0, overflow: 'hidden' },
  lineHeading: { padding: 12, color: colors.textMuted, fontSize: 13 },
  line: { padding: 12, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  lineAmount: { textAlign: 'right', color: colors.textSecondary, fontSize: 13 },
  remove: { width: 30, height: 36, alignItems: 'center', justifyContent: 'center' },
  addRow: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 12, justifyContent: 'center' },
  link: { color: colors.primary, fontSize: 14 },
});
