import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { ActivityIndicator, ScrollView, View } from '@/components/themed';
import { FastPressable } from '@/components/FastPressable';
import { AnchoredSelectScope, Select } from '@/components/Select';
import { Alert, Text } from '@/components/typography';
import { Button, Card, Field } from '@/components/ui';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useStockDocument, useStockDocumentMutations, type StockDocument } from '@/services/api/stockDocuments';
import { qty, useIngredients, usePurchase, usePurchases, useWarehouseLocations, type Purchase, type WarehouseLocation } from '@/services/api/warehouse';
import { unitLabel } from '@/services/api/warehouseUnits';
import { useNotifications } from '@/store/notifications';
import { colors, spacing } from '@/theme';
import { balanceMoney } from '@/utils/warehouseBalance';
import { supplierReturnCandidates, supplierReturnDraftRows, supplierReturnRowsInput, type SupplierReturnRow } from '@/utils/warehouseSupplierReturnForm';
import { warehouseTimeDisplay } from '@/utils/warehouseTiming';
import { WarehouseWorkspace } from './WarehouseWorkspace';

export interface WarehouseSupplierReturnFormProps {
  documentId?: string;
  sourcePurchaseId?: string;
  warehouseId?: string;
  locations?: WarehouseLocation[];
  onClose: () => void;
}

const title = 'Возврат поставщику';
const statusLabels = { draft: 'Черновик', submitted: 'На утверждении', posted: 'Проведён', reversed: 'Сторнирован' } as const;
const emptyRow = (): SupplierReturnRow => ({ key: randomUUID(), ingredientId: '', name: '', quantity: '', unit: null });

function purchaseLabel(purchase: Purchase) {
  return `№${purchase.number} · ${purchase.supplier || '—'} · ${warehouseTimeDisplay(purchase.date)}`;
}

function initialRows(document?: StockDocument) {
  const rows = supplierReturnDraftRows(document?.items);
  return rows.length ? rows : [emptyRow()];
}

function formSignature(warehouseId: string, purchaseId: string, note: string, rows: SupplierReturnRow[]) {
  return JSON.stringify([warehouseId, purchaseId, note, rows.filter(({ ingredientId, quantity }) => ingredientId || quantity).map(({ ingredientId, unit, quantity }) => [ingredientId, unit, quantity])]);
}

export function WarehouseSupplierReturnForm(props: WarehouseSupplierReturnFormProps) {
  const { canAction } = usePermissions();
  const allowed = canAction('warehouseReceive') && canAction('warehouseCosts');
  const document = useStockDocument(props.documentId ?? '');
  const initialPurchase = usePurchase(allowed && !props.documentId && !props.warehouseId ? props.sourcePurchaseId ?? null : null);
  const initialWarehouse = props.warehouseId ?? initialPurchase.data?.warehouseId ?? undefined;
  const locationQuery = useWarehouseLocations(!props.locations?.length);
  const locations = props.locations?.length ? props.locations : locationQuery.data?.locations ?? [];
  const loading = props.documentId && document.isLoading || initialPurchase.isLoading ||
    !props.documentId && !props.locations?.length && locationQuery.isLoading;

  if (loading || props.documentId && !document.data) {
    return <WarehouseWorkspace title={title} onClose={props.onClose}>
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={colors.primary} /> : <QueryError error={document.error} onRetry={() => void document.refetch()} />}
      </View>
    </WarehouseWorkspace>;
  }
  if (document.data && document.data.kind !== 'supplier_return') {
    return <WarehouseWorkspace title={title} onClose={props.onClose}>
      <Text style={styles.error}>Документ не является возвратом поставщику.</Text>
    </WarehouseWorkspace>;
  }
  return <SupplierReturnFields
    key={props.documentId ?? props.sourcePurchaseId ?? 'new'}
    incoming={document.data}
    refreshDocument={() => void document.refetch()}
    locations={locations}
    initialWarehouse={initialWarehouse}
    initialPurchaseId={props.sourcePurchaseId}
    locationError={!props.locations?.length && locationQuery.isError ? locationQuery.error : null}
    refreshLocations={() => void locationQuery.refetch()}
    onClose={props.onClose}
  />;
}

function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <View style={styles.field}>
    <Text style={styles.error} accessibilityRole="alert">{apiError(error)}</Text>
    <Button title="Повторить" variant="secondary" onPress={onRetry} />
  </View>;
}

function ValueField({ label, value }: { label: string; value: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

interface SupplierReturnFieldsProps {
  incoming?: StockDocument;
  refreshDocument: () => void;
  locations: WarehouseLocation[];
  initialWarehouse?: string;
  initialPurchaseId?: string;
  locationError: unknown;
  refreshLocations: () => void;
  onClose: () => void;
}

function SupplierReturnFields({
  incoming, refreshDocument, locations, initialWarehouse, initialPurchaseId, locationError, refreshLocations, onClose,
}: SupplierReturnFieldsProps) {
  const { canAction } = usePermissions();
  const showCosts = canAction('warehouseCosts');
  const canReturn = showCosts && canAction('warehouseReceive');
  const canApprove = canAction('warehouseApprove');
  const notify = useNotifications((state) => state.push);
  const defaultWarehouse = locations.find((location) => location.isDefault);
  const [document, setDocument] = useState(incoming);
  const [warehouseId, setWarehouseId] = useState(incoming?.warehouseId ?? initialWarehouse ?? defaultWarehouse?.id ?? '');
  const [purchaseId, setPurchaseId] = useState(incoming?.sourcePurchaseId ?? initialPurchaseId ?? '');
  const [rows, setRows] = useState(() => initialRows(incoming));
  const [note, setNote] = useState(incoming?.note ?? '');
  const [savedSignature, setSavedSignature] = useState(() => formSignature(warehouseId, purchaseId, note, rows));
  const [requestKey] = useState(() => randomUUID());
  const [error, setError] = useState('');
  const [showReverse, setShowReverse] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const working = useRef(false);
  const mutations = useStockDocumentMutations();
  const busy = mutations.create.isPending || mutations.save.isPending || mutations.transition.isPending;
  const editable = canReturn && (!document || document.status === 'draft');
  const purchase = usePurchase(canReturn ? purchaseId || null : null);
  const purchases = usePurchases({ warehouseId, status: 'completed' }, editable && !document && !!warehouseId);
  const ingredients = useIngredients('', warehouseId, editable && !!warehouseId && !!purchaseId);
  const purchaseMatches = purchase.data?.status === 'completed' &&
    (purchase.data.warehouseId ?? defaultWarehouse?.id) === warehouseId;
  const candidates = supplierReturnCandidates(ingredients.data ?? [], purchaseMatches ? purchase.data?.returnableItems : undefined);
  const values = supplierReturnRowsInput(rows, candidates, document?.items);
  const selectedIds = new Set(rows.flatMap(({ ingredientId }) => ingredientId ? [ingredientId] : []));
  const openOptions = [...candidates.values()].filter(({ ingredient, remainingBase }) => remainingBase > 0 && !selectedIds.has(ingredient.id));
  const dirty = formSignature(warehouseId, purchaseId, note, rows) !== savedSignature;
  const stale = !!incoming && !!document && incoming.revision > document.revision;
  const formReady = !!warehouseId && purchaseMatches && ingredients.isSuccess && !ingredients.isError && !purchase.isError && values.errors.size === 0;
  const total = values.items.length === values.amounts.size && !values.errors.size
    ? balanceMoney([...values.amounts.values()].reduce((sum, amount) => sum + amount, 0))
    : 'стоимость неполная';

  const adopt = useCallback((saved: StockDocument) => {
    const source = saved.sourcePurchaseId ?? '';
    const comment = saved.note ?? '';
    const nextRows = initialRows(saved);
    setDocument(saved);
    setWarehouseId(saved.warehouseId);
    setPurchaseId(source);
    setRows(nextRows);
    setNote(comment);
    setSavedSignature(formSignature(saved.warehouseId, source, comment, nextRows));
    setError('');
  }, []);

  useEffect(() => {
    if (incoming && stale && !dirty && !busy) adopt(incoming);
  }, [adopt, incoming, stale, dirty, busy]);

  function close() {
    if (working.current) return;
    if (!dirty) return onClose();
    Alert.alert('Есть несохранённые изменения', 'Выйти без сохранения?', [
      { text: 'Продолжить', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: onClose },
    ]);
  }

  function changePurchase(id: string) {
    setPurchaseId(id);
    setRows([emptyRow()]);
    setError('');
  }

  function updateRow(key: string, patch: Partial<SupplierReturnRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function reloadDocument() {
    if (!incoming) return;
    Alert.alert('Заменить ваш ввод?', 'Будут загружены последние сохранённые значения.', [
      { text: 'Назад', style: 'cancel' },
      { text: 'Загрузить', onPress: () => adopt(incoming) },
    ]);
  }

  async function save(post: boolean) {
    if (working.current || !editable || !formReady || stale || (post && !values.items.length)) return;
    working.current = true;
    setError('');
    try {
      const input = { items: values.items, note: note.trim(), finalize: post ? 'post' as const : undefined };
      const saved = document ? await mutations.save.mutateAsync({ id: document.id, revision: document.revision, ...input })
        : await mutations.create.mutateAsync({ kind: 'supplier_return', warehouseId, sourcePurchaseId: purchaseId, requestKey, ...input });
      notify({ type: 'success', message: post ? 'Возврат проведён' : 'Черновик сохранён', at: new Date().toISOString() });
      if (post || !document) onClose();
      else adopt(saved);
    } catch (cause) {
      setError(apiError(cause));
      if (document) refreshDocument();
      void purchase.refetch();
      void ingredients.refetch();
    } finally {
      working.current = false;
    }
  }

  async function transition(action: 'approve' | 'reopen' | 'reverse') {
    if (!document || working.current || stale || (action === 'approve' ? !canReturn : !canApprove) || (action === 'reverse' && !reverseReason.trim())) return;
    working.current = true;
    setError('');
    try {
      const saved = await mutations.transition.mutateAsync({ id: document.id, revision: document.revision, action, note: action === 'reverse' ? reverseReason.trim() : undefined });
      adopt(saved);
      setShowReverse(false);
      setReverseReason('');
    } catch (cause) {
      setError(apiError(cause));
      refreshDocument();
    } finally {
      working.current = false;
    }
  }

  const footer = editable ? <View style={styles.actions}>
    <Button title="Сохранить" size="md" style={styles.action} disabled={!formReady || !values.items.length || busy || stale} onPress={() => void save(true)} />
    <Button title="Сохранить черновик" size="md" variant="secondary" style={styles.action}
      disabled={!formReady || busy || stale || (!!document && !dirty)} onPress={() => void save(false)} />
    {showCosts ? <Text style={styles.total}>Итого{': '}{total}</Text> : null}
  </View> : document?.status === 'submitted' && (canReturn || canApprove) ? <View style={styles.actions}>
    {canApprove ? <Button title="Вернуть в черновик" variant="secondary" size="md" style={styles.action} disabled={busy || stale} onPress={() => void transition('reopen')} /> : null}
    {canReturn ? <Button title="Провести возврат" size="md" style={styles.action} disabled={busy || stale} onPress={() => void transition('approve')} /> : null}
  </View> : undefined;

  const warehouseName = locations.find((location) => location.id === warehouseId)?.name ?? 'Недоступный склад';
  const purchaseChoices = (purchases.data ?? []).filter((item) => (item.warehouseId ?? defaultWarehouse?.id) === warehouseId);
  const purchaseOptions = purchaseChoices.map((item) => ({ value: item.id, label: purchaseLabel(item), translate: false }));
  if (purchaseMatches && purchase.data && !purchaseOptions.some(({ value }) => value === purchaseId)) {
    purchaseOptions.unshift({ value: purchaseId, label: purchaseLabel(purchase.data), translate: false });
  }
  const date = document?.effectiveAt ?? document?.postedAt ?? (!editable ? document?.createdAt : null);
  const showLineErrors = !!purchaseMatches && ingredients.isSuccess;

  return <WarehouseWorkspace title={title} onClose={close} footer={footer}>
    <AnchoredSelectScope>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.fields}>
          {document ? <Text style={styles.status}>{statusLabels[document.status]}</Text> : null}
          <ValueField label="Дата возврата" value={date ? warehouseTimeDisplay(date) : 'На момент проведения'} />
          {editable && !document ? <View style={styles.field}>
            <Text style={styles.label}>Склад</Text>
            <Select title="Склад" placeholder="Выберите склад" value={warehouseId}
              options={locations.map(({ id, name }) => ({ value: id, label: name, translate: false }))}
              disabled={busy} onChange={(id) => { if (id !== warehouseId) { setWarehouseId(id); changePurchase(''); } }} />
          </View> : <ValueField label="Склад" value={warehouseName} />}
          {editable && !document ? <View style={styles.field}>
            <Text style={styles.label}>Исходная поставка</Text>
            <Select title="Исходная поставка" placeholder="Выберите поставку" searchable value={purchaseId}
              options={purchaseOptions} disabled={busy || !warehouseId} onChange={(id) => { if (id !== purchaseId) changePurchase(id); }} />
          </View> : <ValueField label="Исходная поставка" value={purchase.data ? purchaseLabel(purchase.data) : '—'} />}
          {editable ? <Field label="Комментарий" multiline style={styles.note} value={note} onChangeText={setNote} maxLength={1000} editable={!busy && !stale} />
            : note ? <ValueField label="Комментарий" value={note} /> : null}
        </Card>
        {locationError != null ? <QueryError error={locationError} onRetry={refreshLocations} /> : null}
        {editable && (purchase.isLoading || purchases.isLoading && !purchaseId || ingredients.isLoading) ? <ActivityIndicator color={colors.primary} /> : null}
        {editable && !purchaseId && purchases.isError ? <QueryError error={purchases.error} onRetry={() => void purchases.refetch()} /> : null}
        {editable && purchase.isError ? <QueryError error={purchase.error} onRetry={() => void purchase.refetch()} /> : null}
        {editable && ingredients.isError ? <QueryError error={ingredients.error} onRetry={() => void ingredients.refetch()} /> : null}
        {editable && purchase.data && !purchaseMatches ? <Text style={styles.error}>Выберите проведённую поставку для этого склада.</Text> : null}
        {stale && dirty ? <Card style={styles.fields}>
          <Text style={styles.error}>Документ изменён другим сотрудником.</Text>
          <Button title="Загрузить актуальный документ" variant="secondary" disabled={busy} onPress={reloadDocument} />
        </Card> : null}
        <Card style={styles.linePanel}>
          <Text style={styles.lineHeading}>Наименование</Text>
          {editable ? rows.map((row) => {
            const current = candidates.get(row.ingredientId);
            const options = (current ? [current, ...openOptions] : openOptions).map(({ ingredient }) => ({
              value: ingredient.id, label: ingredient.name, searchText: ingredient.category ?? undefined, translate: false,
            }));
            if (row.ingredientId && !current) options.unshift({ value: row.ingredientId, label: row.name, searchText: '', translate: false });
            const units = row.unit ? unitLabel(row.unit) : '';
            const rowError = showLineErrors ? values.errors.get(row.key) : undefined;
            const limit = values.limits.get(row.key);
            const amount = values.amounts.get(row.key);
            return <View key={row.key} style={styles.line}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Select searchable title="Продукт возврата" placeholder="Выберите продукт" value={row.ingredientId} options={options}
                    disabled={busy || stale || !purchaseMatches || !ingredients.isSuccess} onChange={(id) => {
                      const candidate = candidates.get(id)?.ingredient;
                      if (id !== row.ingredientId && candidate) updateRow(row.key, {
                        ingredientId: id, name: candidate.name, unit: candidate.displayUnit, quantity: '',
                      });
                    }} />
                </View>
                <FastPressable accessibilityRole="button" accessibilityLabel={row.name ? `Убрать ${row.name}` : 'Убрать строку'}
                  style={styles.remove} disabled={busy || stale} onPress={() => setRows((currentRows) => currentRows.length > 1 ? currentRows.filter(({ key }) => key !== row.key) : [emptyRow()])}>
                  <Text style={styles.label}>×</Text>
                </FastPressable>
              </View>
              <View style={styles.row}>
                <Field label="Количество" placeholder="0" accessibilityLabel={row.name ? `Количество · ${row.name}` : 'Количество'}
                  containerStyle={styles.flex} value={row.quantity} onChangeText={(quantity) => updateRow(row.key, { quantity })}
                  keyboardType="decimal-pad" editable={!!row.ingredientId && !busy && !stale} />
                {units ? <Text style={styles.unit}>{units}</Text> : null}
                {showCosts ? <Text style={styles.lineAmount}>{amount == null ? '—' : balanceMoney(amount)}</Text> : null}
              </View>
              {limit != null ? <Text style={styles.label}>Можно вернуть{': '}{limit.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {units}</Text> : null}
              {current ? <Text style={values.shortages.has(row.key) ? styles.error : styles.label}>
                На складе {qty(current.ingredient.stock, current.ingredient.unit)}{values.shortages.has(row.key) ? ' · недостаточно остатков' : ''}
              </Text> : null}
              {rowError && row.quantity ? <Text style={styles.error}>{rowError}</Text> : null}
            </View>;
          }) : document?.items?.map((item) => <View key={item.ingredientId} style={[styles.line, styles.row]}>
            <Text style={[styles.value, styles.flex]}>{item.name}</Text>
            <Text style={styles.value}>{item.quantity == null ? '—' : qty(item.quantity, item.unit)}</Text>
            {showCosts ? <Text style={styles.lineAmount}>{item.value == null ? '—' : balanceMoney(Math.abs(item.value))}</Text> : null}
          </View>)}
          {editable ? <FastPressable accessibilityRole="button" accessibilityLabel="Добавить строку возврата" style={styles.addRow}
            disabled={busy || stale || !openOptions.length || rows.length >= 200} onPress={() => setRows((current) => [...current, emptyRow()])}>
            <Text style={openOptions.length ? styles.link : styles.label}>+ Добавить</Text>
          </FastPressable> : null}
        </Card>
        {editable && showLineErrors && !openOptions.length && !selectedIds.size ? <Text style={styles.label}>По этой поставке нет доступных продуктов для возврата.</Text> : null}
        {editable ? <Text style={styles.label}>«Сохранить» проведёт документ и уменьшит остаток. Черновик сохраняет данные без изменения остатков.</Text> : null}
        {!editable && showCosts && document ? <Text style={styles.total}>
          Итого{': '}{document.varianceValue == null ? 'стоимость неизвестна' : balanceMoney(Math.abs(document.varianceValue))}
        </Text> : null}
        {document?.status === 'posted' && canApprove ? <Card style={styles.fields}>
          {showReverse ? <>
            <Field label="Причина сторно" value={reverseReason} onChangeText={setReverseReason} editable={!busy} maxLength={1000} />
            <Button title="Подтвердить сторно" variant="danger" disabled={busy || stale || !reverseReason.trim()} onPress={() => void transition('reverse')} />
          </> : <Button title="Сторнировать" variant="secondary" disabled={busy || stale} onPress={() => setShowReverse(true)} />}
        </Card> : null}
        {document?.reversedAt ? <Text style={styles.label}>
          Сторнирован {warehouseTimeDisplay(document.reversedAt)}{document.reversedByName ? ` · ${document.reversedByName}` : ''}
          {document.reversalReason ? `\n${document.reversalReason}` : ''}
        </Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </AnchoredSelectScope>
  </WarehouseWorkspace>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  fields: { gap: spacing.md },
  field: { gap: spacing.xs },
  status: { color: colors.primary, fontWeight: '600' },
  label: { color: colors.textSecondary, fontSize: 13 },
  value: { color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
  error: { color: colors.danger, fontSize: 13 },
  note: { minHeight: 58, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flexGrow: 1 },
  total: { width: '100%', textAlign: 'right', fontWeight: '600', color: colors.textPrimary },
  linePanel: { padding: 0, overflow: 'hidden' },
  lineHeading: { padding: 12, color: colors.textMuted, fontSize: 13 },
  line: { padding: 12, gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  lineAmount: { alignSelf: 'flex-end', paddingBottom: 12, minWidth: 68, textAlign: 'right', color: colors.textSecondary, fontSize: 13 },
  unit: { alignSelf: 'flex-end', paddingBottom: 12, color: colors.textSecondary, fontSize: 13 },
  remove: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
  addRow: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  link: { color: colors.primary, fontSize: 14 },
});
