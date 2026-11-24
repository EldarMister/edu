import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { EditorPage, useEditorDirty } from './EditorPage';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { DocumentProductPicker } from './DocumentProductPicker';
import { focusDocumentInput } from './document-focus';
import './document-workspace.css';
import './inventory-workspace.css';
import { inventoryCountMatches, inventoryCountSummary, inventoryQuantity, type InventoryCountFilter } from './inventory-workflow';
import { InventoryCountSheet } from './InventoryCountSheet';
import { InventoryTimingFields } from './InventoryTimingFields';
import { StockOperationDateField } from './StockOperationDateField';
import { inventoryTimingFor, inventoryTimingValue, inventoryTimingError, inventoryTimeDisplay } from './inventory-time';
import { InventoryFlowDetails } from './InventoryFlowDetails';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { balanceMoney, balanceQuantity } from './balance-format';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { DocumentField, DocumentFooter } from './WarehouseUi';
import { qty, purchaseNumber, usePurchase, useIngredients, useWarehouseLocations, type Ingredient, type WarehouseLocation } from './api';
import { documentQuantityError, documentQuantityFromBase, documentQuantityValue, documentStockShortages, documentUnitCost, returnableQuantityInUnit } from './stock-document-form';
import { DocumentStockWarnings } from './DocumentStockWarnings';
import { StockDocumentExportButton } from './StockDocumentExportButton';
import { WriteoffLines, useWriteoffLines } from './WriteoffLines';
import {
  useStockDocument,
  useStockDocumentMutations,
  type StockDocumentDetails,
  type StockDocumentItem,
  type WriteoffReason,
} from './stock-documents-api';
import {
  documentDisplayStatus,
  documentLabel,
  documentStatus,
  formatDocumentDate,
  formatVariance,
  WRITEOFF_REASONS,
} from './stock-document-format';

export function StockDocumentModal({
  id,
  warehouse,
  isOwner,
  onClose,
  onCopyTransfer,
}: {
  id: string;
  warehouse: WarehouseLocation;
  isOwner: boolean;
  onClose: () => void;
  onCopyTransfer?: (id: string) => void;
}) {
  const query = useStockDocument(id);
  const locations = useWarehouseLocations();
  const { can } = usePermissions();
  const document = query.data;
  const reopened = document && documentDisplayStatus(document) === 'reopened';
  const canApproveInventory = can('actions.warehouseApprove');
  const canEditDocument = !!document && can(`actions.${document.kind === 'inventory' ? 'warehouseCount' : document.kind === 'writeoff' ? 'warehouseWriteoff' : document.kind === 'transfer' ? 'warehouseTransfer' : 'warehouseReceive'}`);
  const canEditDraft = canEditDocument && (!reopened || canApproveInventory);
  const documentWarehouse =
    locations.data?.locations.find((l) => l.id === document?.warehouseId) ?? warehouse;
  const canApprove =
    document?.kind === 'transfer'
      ? can('actions.warehouseTransfer')
      : document?.kind === 'supplier_return'
        ? can('actions.warehouseReceive') && can('actions.warehouseCosts')
        : document?.kind === 'inventory' ? canApproveInventory : isOwner;
  return (
    <EditorPage
      open
      title={document ? documentLabel(document) : 'Складской документ'}
      panelClassName="max-w-4xl"
      onClose={onClose}
    >
      {query.isPending && (
        <div className="flex justify-center py-8 text-primary">
          <Spinner />
        </div>
      )}
      {query.isError && !document && (
        <p role="alert" className="text-sm text-danger">
          {apiError(query.error)}
        </p>
      )}
      {document?.kind === 'transfer' && (document.status === 'posted' || document.status === 'reversed') && (
          <WorkspaceHeaderActions>
            {can('actions.exportReports') && <StockDocumentExportButton key={document.id} id={document.id} kind="transfer" />}
            {can('actions.warehouseTransfer') && onCopyTransfer && <button type="button" className="btn-ghost btn-md text-primary"
              onClick={() => onCopyTransfer(document.id)}>Копировать</button>}
          </WorkspaceHeaderActions>
        )}
      {document?.status === 'draft' && canEditDraft && (
        <StockDocumentDraft
          document={document}
          warehouse={documentWarehouse}
          onReload={() => query.refetch({ throwOnError: true })}
          canApprove={canApprove}
          onClose={onClose}
        />
      )}
      {document && (document.status !== 'draft' || !canEditDraft) && (
        <StockDocumentReview document={document} warehouse={documentWarehouse} canApprove={canApprove}
          canReopenInventory={canEditDocument && canApproveInventory} onReload={() => { void query.refetch(); }} />
      )}
    </EditorPage>
  );
}

interface DraftItem {
  item: StockDocumentItem;
  input: string;
}

function draftItems(document: StockDocumentDetails): DraftItem[] {
  return document.items.map((item) => ({ item, input: item.quantity === null ? '' : String(item.quantity) }));
}

function draftValues(items: DraftItem[], reason: string, note: string, countedAt?: string | null) {
  return JSON.stringify({ items: items.map(({ item, input }) => [item.ingredientId, input.trim() && !Number.isFinite(Number(input)) ? input : documentQuantityValue(input)]), reason, note: note.trim(), countedAt: countedAt ?? null });
}

function StockDocumentDraft({
  document,
  warehouse,
  onReload,
  canApprove,
  onClose,
}: {
  document: StockDocumentDetails;
  warehouse: WarehouseLocation;
  onReload: () => Promise<{ data?: StockDocumentDetails }>;
  canApprove: boolean;
  onClose: () => void;
}) {
  const { update } = useStockDocumentMutations();
  const { can } = usePermissions();
  const reopened = documentDisplayStatus(document) === 'reopened';
  const editable = can(
    `actions.${document.kind === 'inventory' ? 'warehouseCount' : document.kind === 'writeoff' ? 'warehouseWriteoff' : document.kind === 'transfer' ? 'warehouseTransfer' : 'warehouseReceive'}`,
  );
  const ingredients = useIngredients('', warehouse.id);
  const writeoffLines = useWriteoffLines(document.kind === 'writeoff', warehouse.id, document);
  const sourcePurchase = usePurchase(document.kind === 'supplier_return' ? document.sourcePurchaseId ?? null : null);
  const returnable = new Map(sourcePurchase.data?.returnableItems?.map((item) => [item.ingredientId, item]));
  const push = useNotifications((state) => state.push);
  const [baseRevision, setBaseRevision] = useState(document.revision);
  const [items, setItems] = useState(() => draftItems(document));
  const [reason, setReason] = useState<WriteoffReason | ''>(document.reason ?? '');
  const [note, setNote] = useState(document.note ?? '');
  const supportsStockDate = document.kind === 'writeoff' || document.kind === 'transfer';
  const [timing, setTiming] = useState(() => inventoryTimingFor(supportsStockDate ? document.effectiveAt : document.countedAt));
  const [timingValid, setTimingValid] = useState(true);
  const [savedCountedAt, setSavedCountedAt] = useState(document.countedAt ?? null);
  const [timingApplied, setTimingApplied] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const trackedCountedAt = reopened ? savedCountedAt : inventoryTimingValue(timing, savedCountedAt);
  const countedAt = document.kind === 'inventory' ? trackedCountedAt : undefined;
  const [savedEffectiveAt, setSavedEffectiveAt] = useState(document.effectiveAt ?? null);
  const effectiveAt = supportsStockDate ? inventoryTimingValue(timing, savedEffectiveAt) : undefined;
  const historical = supportsStockDate && timing.mode === 'past';
  const timingChanged = document.kind === 'inventory' && countedAt !== savedCountedAt;
  const historicalScopeChanged = document.kind === 'inventory' && !!countedAt && items.some(({ item }) => !document.items.some((saved) => saved.ingredientId === item.ingredientId));
  const previewNeedsSave = timingChanged || historicalScopeChanged;
  useEffect(() => { if (previewNeedsSave) setParametersOpen(true); }, [previewNeedsSave]);
  const timingReady = reopened || (document.kind !== 'inventory' && !supportsStockDate) ||
    (timingValid && !inventoryTimingError(timing) && (supportsStockDate ? effectiveAt !== undefined : countedAt !== undefined));
  const [savedValues, setSavedValues] = useState(() => draftValues(draftItems(document), document.reason ?? '', document.note ?? '', document.countedAt));
  const hasUnsavedValues = draftValues(items, reason, note, countedAt) !== savedValues;
  const { markSaved } = useEditorDirty(hasUnsavedValues ||
    (supportsStockDate && effectiveAt !== savedEffectiveAt) || !timingReady || (document.kind === 'writeoff' && writeoffLines.dirty));
  const [error, setError] = useState('');
  const [reloadError, setReloadError] = useState('');
  const [reloading, setReloading] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [submitAttempt, setSubmitAttempt] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const writeoff = document.kind !== 'inventory';
  const needsReason = document.kind === 'writeoff';
  const full = document.mode === 'full';
  const stale = baseRevision !== document.revision;
  const pending = update.isPending || reloading || !editable;
  const sourceReady = document.kind !== 'supplier_return' || sourcePurchase.isSuccess;
  const usedIds = new Set(items.map(({ item }) => item.ingredientId));
  const byId = new Map(ingredients.data?.map((ingredient) => [ingredient.id, ingredient]));
  const available = (ingredients.data ?? []).filter(
    ({ id, preparationMode }) => !usedIds.has(id) && preparationMode !== 'virtual' &&
      (document.kind !== 'supplier_return' || (returnable.get(id)?.remainingQuantityBase ?? 0) > 0),
  );
  function remainingFor(item: StockDocumentItem) {
    return document.kind === 'supplier_return' && sourceReady
      ? returnableQuantityInUnit(returnable.get(item.ingredientId)?.remainingQuantityBase ?? 0, item.unit)
      : undefined;
  }
  const counted = items.filter(({ input }) => input.trim() !== '');
  const quantityError = document.kind === 'writeoff' ? writeoffLines.firstError : items.map(({ item, input }) => documentQuantityError(input, !writeoff, remainingFor(item))).find(Boolean);
  const invalidCount = !!quantityError;
  const allCounted = counted.length === items.length;
  const canSubmit =
    (document.kind === 'writeoff' ? writeoffLines.enteredCount > 0 && writeoffLines.ready : counted.length > 0 && allCounted) &&
    (!needsReason || (reason && (reason !== 'other' || note.trim())));
  const reasonError = validationAttempt && submitAttempt && needsReason && !reason ? 'Выберите причину списания.' : '';
  const noteError = validationAttempt && submitAttempt && needsReason && reason === 'other' && !note.trim() ? 'Уточните причину списания.' : '';
  useEffect(() => {
    if (validationAttempt) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [validationAttempt]);

  function adopt(saved: StockDocumentDetails) {
    setBaseRevision(saved.revision);
    setItems(draftItems(saved));
    setReason(saved.reason ?? '');
    setNote(saved.note ?? '');
    setTiming(inventoryTimingFor(supportsStockDate ? saved.effectiveAt : saved.countedAt));
    setSavedEffectiveAt(saved.effectiveAt ?? null);
    setSavedCountedAt(saved.countedAt ?? null);
    setSavedValues(draftValues(draftItems(saved), saved.reason ?? '', saved.note ?? '', saved.countedAt));
    if (document.kind === 'writeoff') writeoffLines.adopt(saved);
  }

  function addIngredient(ingredientId: string) {
    const ingredient = byId.get(ingredientId);
    if (!ingredient) return;
    setItems((current) => [
      ...current,
      {
        item: {
          ingredientId,
          name: ingredient.name,
          unit: ingredient.unit,
          expected: ingredient.stock,
          quantity: null,
          difference: null,
          value: null,
          unitCost: ingredient.avgCost,
          costKnown: ingredient.valuationKnown,
        },
        input: '',
      },
    ]);
  }

  function replaceIngredient(previousId: string, ingredientId: string) {
    if (previousId === ingredientId) return;
    const ingredient = byId.get(ingredientId);
    if (!ingredient || usedIds.has(ingredientId)) return;
    setItems((current) => current.map((row) => row.item.ingredientId !== previousId ? row : {
      item: { ingredientId, name: ingredient.name, unit: ingredient.unit, expected: ingredient.stock,
        quantity: null, difference: null, value: null, unitCost: ingredient.avgCost, costKnown: ingredient.valuationKnown },
      input: '',
    }));
  }

  async function save(action: 'save' | 'submit' | 'recount' | 'apply-time') {
    if (pending || stale || !sourceReady || !timingReady || ((action === 'submit' || action === 'save') && previewNeedsSave)) return;
    setError('');
    setValidationAttempt((attempt) => attempt + 1);
    setSubmitAttempt(action === 'submit');
    if (invalidCount || (action === 'submit' && !canSubmit)) return;
    if (document.kind === 'writeoff' && !writeoffLines.ready) {
      setError('Дождитесь расчёта состава или обновите предварительный расчёт.');
      return;
    }
    try {
      const saved = await update.mutateAsync({
        id: document.id,
        revision: baseRevision,
        finalize: action === 'submit' ? (canApprove ? 'post' : 'submit') : undefined,
        reason: needsReason ? reason || null : undefined,
        note: note.trim(),
        recount: action === 'recount' || undefined,
        countedAt: document.kind === 'inventory' && !reopened ? countedAt : undefined,
        effectiveAt,
        sourceLines: document.kind === 'writeoff' ? writeoffLines.input() : undefined,
        items: document.kind === 'writeoff' ? undefined : items.map(({ item, input }) => ({
          ingredientId: item.ingredientId,
          quantity: documentQuantityValue(input),
        })),
      });
      if (previewNeedsSave) setTimingApplied(true);
      adopt(saved);
      if (action === 'apply-time') setParametersOpen(false);
      markSaved();
      if (action === 'submit') {
        push({
          message: reopened ? 'Инвентаризация проведена повторно' : canApprove ? 'Документ проведён' : 'Документ отправлен на утверждение',
          at: new Date().toISOString(),
        });
      } else {
        push({ message: reopened ? 'Изменения сохранены' : timingChanged ? 'Время проверки применено. Фактические количества сохранены.' : historicalScopeChanged ? 'Учётные остатки пересчитаны. Фактические количества сохранены.' : 'Черновик сохранён', at: new Date().toISOString() });
      }
      if (action === 'submit' || writeoff) onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function reload() {
    setReloading(true);
    setReloadError('');
    try {
      const result = await onReload();
      if (result.data) adopt(result.data);
      setError('');
    } catch (err) {
      setReloadError(apiError(err));
    } finally {
      setReloading(false);
    }
  }

  const demands = !writeoff ? [] : document.kind === 'writeoff'
    ? writeoffLines.ready ? writeoffLines.lines.flatMap((line) => line.parts) : []
    : items.map(({ item, input }) => ({
      ingredientId: item.ingredientId, quantity: documentQuantityValue(input), unit: item.unit,
    }));
  const shortages = historical ? [] : documentStockShortages(ingredients.data ?? [], demands);
  const deficient = new Set(shortages.map(({ ingredientId }) => ingredientId));
  const rows = items.map(({ item, input }) => {
    const ingredient = byId.get(item.ingredientId);
    const preview = document.items.find((row) => row.ingredientId === item.ingredientId) ?? item;
    const quantity = input.trim() === '' ? null : Number(input);
    const validQuantity = quantity !== null && Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
    const fallbackStock = reopened ? null : ingredient?.stock ?? null;
    const fallbackCost = reopened ? null : ingredient?.avgCost ?? null;
    const expected = timingChanged || (historicalScopeChanged && !document.items.some((saved) => saved.ingredientId === item.ingredientId)) ? null : preview.expected ?? fallbackStock;
    const unitCost = writeoff
      ? deficient.has(item.ingredientId) ? null : documentUnitCost(item.unit, ingredient?.avgCostBase)
      : preview.costKnown === false ? null : preview.unitCost ?? fallbackCost;
    const difference =
      validQuantity === null
        ? null
        : writeoff
          ? -validQuantity
          : expected === null
            ? null
            : validQuantity - expected;
    const value =
      difference === null || unitCost === null ? null : Math.round(difference * unitCost * 100) / 100;
    return {
      ...item,
      expected,
      quantity: validQuantity,
      difference,
      value,
      input,
      error: validationAttempt ? documentQuantityError(input, !writeoff, remainingFor(item)) : undefined,
      remaining: remainingFor(item),
      stock: document.kind === 'transfer' && !historical && ingredient ? documentQuantityFromBase(ingredient.stockBase, item.unit) : undefined,
      category: ingredient?.category ?? undefined,
    };
  });
  const totals = rows.filter((row) => row.quantity !== null);
  const unknownValue = totals.some((row) => row.value === null && row.difference !== 0);
  const total = totals.length && !unknownValue ? totals.reduce((sum, row) => sum + (row.value ?? 0), 0) : null;
  const submitHint = quantityError
    ? quantityError
    : document.kind === 'writeoff' && !writeoffLines.enteredCount
      ? 'Добавьте продукт или блюдо и укажите количество.'
    : document.kind !== 'writeoff' && !counted.length
      ? writeoff ? 'Добавьте продукт и укажите количество.' : 'Внесите фактический остаток хотя бы одного продукта.'
      : !allCounted
        ? `Осталось посчитать: ${items.length - counted.length}. Для отсутствующего продукта укажите 0.`
        : needsReason && !reason
          ? 'Выберите причину списания.'
          : needsReason && reason === 'other' && !note.trim()
            ? 'Уточните причину списания в комментарии.'
            : '';

  return (
    <div
      ref={formRef}
      className={`poster-form poster-form--document space-y-6 ${writeoff ? 'poster-document--modern' : 'poster-document--inventory'}`}
    >
      {!writeoff && <>
        <InventoryCountSheet document={document} warehouseName={warehouse.name} rows={rows} />
        <WorkspaceHeaderActions>
          {can('actions.exportReports') && <StockDocumentExportButton id={document.id} kind="inventory"
            disabled={hasUnsavedValues || !timingReady || pending || stale} />}
          <button type="button" className="btn-ghost btn-md text-primary" disabled={previewNeedsSave || !timingReady} onClick={() => window.print()}>Печать списка</button>
        </WorkspaceHeaderActions>
      </>}
      <div className="poster-document-panel poster-document-fields space-y-3">
        <DocumentHeader document={document} warehouse={warehouse} editingStockDate={supportsStockDate} />
        {!writeoff && !reopened && <div className="border-t border-border pt-3">
          <button type="button" className="text-sm text-primary" aria-expanded={parametersOpen}
            onClick={() => setParametersOpen((open) => !open)}>Изменить параметры</button>
          {parametersOpen && <div className="mt-4 space-y-3">
            <InventoryTimingFields value={timing} onChange={setTiming} onValidityChange={setTimingValid} disabled={pending || stale} />
            <button type="button" className="btn-secondary btn-md" disabled={pending || stale || !timingReady || invalidCount || !previewNeedsSave}
              onClick={() => void save('apply-time')}>Применить параметры</button>
            <p className="text-xs text-text-muted">Учётные остатки пересчитаются. Введённые фактические количества сохранятся.</p>
          </div>}
        </div>}
        {supportsStockDate && <StockOperationDateField value={timing} onChange={setTiming}
          onValidityChange={setTimingValid} disabled={pending || stale}
          label={document.kind === 'transfer' ? 'Дата и время перемещения' : 'Дата и время списания'} />}
        {needsReason && (
          <DocumentField label="Причина списания">
            <Select
              ariaLabel="Причина списания"
              ariaInvalid={!!reasonError || undefined}
              ariaDescribedBy={reasonError ? `${formId}-reason-error` : undefined}
              disabled={pending || stale}
              className="h-10 w-full"
              value={reason}
              onChange={(value) => setReason(value as WriteoffReason)}
              options={WRITEOFF_REASONS}
            />
            {reasonError && <p id={`${formId}-reason-error`} className="mt-1 text-xs text-danger">{reasonError}</p>}
          </DocumentField>
        )}
        <DocumentField label={reason === 'other' ? 'Уточните причину' : 'Комментарий'}>
          <textarea
            className="input h-14 w-full"
            aria-label={reason === 'other' ? 'Уточните причину' : 'Комментарий'}
            aria-invalid={!!noteError || undefined}
            aria-describedby={noteError ? `${formId}-note-error` : undefined}
            value={note}
            maxLength={1000}
            disabled={pending || stale}
            onChange={(event) => setNote(event.target.value)}
          />
          {noteError && <p id={`${formId}-note-error`} className="mt-1 text-xs text-danger">{noteError}</p>}
        </DocumentField>
      </div>
      {!writeoff && (previewNeedsSave || timingApplied) && <div role="status" className="inventory-timing-notice">
        {timingChanged
          ? 'Время проверки ещё не применено. Примените его, чтобы пересчитать учётные остатки. Все введённые фактические количества сохранятся.'
          : historicalScopeChanged ? 'Для новых продуктов ещё нет учётного остатка на выбранное время. Обновите расчёт; введённые фактические количества сохранятся.'
          : `Учётные остатки пересчитаны ${savedCountedAt ? `на ${inventoryTimeDisplay(savedCountedAt)} по времени Бишкека` : 'на текущий момент'}. Проверьте, что фактические количества соответствуют этому времени, затем проведите инвентаризацию.`}
      </div>}
      {ingredients.isError && (
        <p role="alert" className="text-sm text-danger">
          {apiError(ingredients.error)}
        </p>
      )}
      {document.kind === 'writeoff' ? <WriteoffLines editor={writeoffLines} disabled={pending || stale} showErrors={!!validationAttempt} requireRows={submitAttempt} showCost={!historical} /> : <DocumentItems
        writeoff={writeoff}
        rows={rows}
        total={total}
        showCost={!historical}
        inventoryId={writeoff || timingChanged ? undefined : document.id}
        previewPending={!writeoff && previewNeedsSave}
        addProducts={!full && !reopened ? {
          options: available,
          onSelect: addIngredient,
          loading: ingredients.isPending || (document.kind === 'supplier_return' && sourcePurchase.isPending),
          error: ingredients.isError || (document.kind === 'supplier_return' && sourcePurchase.isError) ? 'Не удалось загрузить продукты.' : undefined,
          validationError: validationAttempt && submitAttempt && !items.length ? 'Добавьте хотя бы один продукт.' : undefined,
          onRetry: () => { void ingredients.refetch(); if (document.kind === 'supplier_return') void sourcePurchase.refetch(); },
        } : undefined}
        editable={{
          onSelectProduct: writeoff ? replaceIngredient : undefined,
          onChange: (ingredientId, input) =>
            setItems((current) =>
              current.map((row) => (row.item.ingredientId === ingredientId ? { ...row, input } : row)),
            ),
          onRemove: full || reopened
            ? undefined
            : (ingredientId) =>
                setItems((current) => current.filter(({ item }) => item.ingredientId !== ingredientId)),
          disabled: pending || stale,
        }}
      />}
      {!writeoff && (
        <p className="text-xs text-text-muted">
          Пустые поля сохраняются как «не посчитано». Для отсутствующего товара укажите 0.
        </p>
      )}
      {document.kind !== 'writeoff' && !historical && !previewNeedsSave && unknownValue && can('actions.warehouseCosts') && <p className="text-xs text-text-muted">Стоимость части посчитанных позиций неизвестна, итоговая сумма пока не определена.</p>}
      {submitHint && (writeoff || invalidCount || !items.length) && <p className="poster-document-validation text-sm text-text-muted" role={invalidCount ? 'alert' : 'status'}>{submitHint}</p>}
      {(stale || reloadError) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 p-3 text-sm text-text-primary"
        >
          {reloadError || 'Документ изменился. Загрузите актуальную версию перед сохранением.'}
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={pending}
            onClick={() => void reload()}
          >
            Загрузить изменения
          </button>
        </div>
      )}
      {writeoff && <DocumentStockWarnings shortages={shortages} isTransfer={document.kind === 'transfer'} />}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          {error}
          {document.kind === 'writeoff' && error.includes('Состав изменился') ? (
            <button type="button" className="btn-secondary btn-md" disabled={pending} onClick={() => { setError(''); writeoffLines.refresh(); }}>Обновить расчёт</button>
          ) : !stale && !reloadError && (writeoff || error.includes('Документ уже изменился')) ? (
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={pending}
            onClick={() => void reload()}
          >
            Загрузить изменения
          </button>
          ) : null}
        </div>
      )}
      <p className="text-sm text-text-muted">{reopened
        ? 'Исправленные количества применятся при повторном проведении. Дата проверки, склад и список позиций зафиксированы.'
        : writeoff
        ? canApprove ? '«Сохранить» проведёт документ и изменит остатки. Черновик сохраняет данные без изменения остатков.' : 'Черновик не меняет остатки. Они изменятся после утверждения документа.'
        : savedCountedAt ? `Черновик не меняет остатки. Учётные и фактические количества сравниваются на ${inventoryTimeDisplay(savedCountedAt)} по времени Бишкека. Более поздние движения сохраняются.`
          : 'Черновик не меняет остатки. Учётные остатки показываются на текущий момент; перед проведением проверьте, что введённые фактические количества актуальны.'}</p>
      {!writeoff && !reopened && error.includes('проведена другая инвентаризация') && (
        <details className="poster-advanced">
          <summary className="cursor-pointer text-sm text-primary">Повторный подсчёт после другой инвентаризации</summary>
          <p className="mt-3 max-w-2xl text-sm text-text-secondary">Если эти продукты уже проверили другой инвентаризацией, пересчитайте их и внесите свежие фактические остатки. Затем сохраните повторный подсчёт. Это обновит черновик; остатки изменятся только при завершении.</p>
          <button type="button" className="btn-secondary btn-md mt-3" disabled={pending || stale || invalidCount || !timingReady || previewNeedsSave} onClick={() => void save('recount')}>Сохранить повторный подсчёт</button>
        </details>
      )}
      <DocumentFooter total={writeoff && can('actions.warehouseCosts') ? historical ? 'Стоимость после проведения' : document.kind === 'writeoff'
        ? writeoffLines.calculating ? 'Итого: расчёт…' : writeoffLines.total == null ? 'Итого: стоимость неполная' : `Итого: ${balanceMoney(writeoffLines.total)}`
        : total == null ? 'Итого: стоимость неполная' : `Итого: ${balanceMoney(Math.abs(total))}` : !writeoff ? `Посчитано: ${rows.filter((row) => row.quantity !== null).length} из ${items.length}` : undefined}>
        {previewNeedsSave && <span role="status" className="self-center text-sm text-text-muted">Примените параметры</span>}
        <button
          type="button"
          className="btn-primary btn-md"
          disabled={pending || stale || !sourceReady || !timingReady || previewNeedsSave || (document.kind === 'writeoff' && (writeoffLines.calculating || !writeoffLines.options.isSuccess)) || (!writeoff && (invalidCount || !canSubmit))}
          onClick={() => void save('submit')}
        >
          {canApprove
            ? document.kind === 'inventory'
              ? 'Провести инвентаризацию'
              : 'Сохранить'
            : 'Отправить на утверждение'}
        </button>
        <button
          type="button"
          className="btn-secondary btn-md"
          disabled={pending || stale || !sourceReady || !timingReady || previewNeedsSave || (document.kind === 'writeoff' && (writeoffLines.calculating || !writeoffLines.options.isSuccess))}
          onClick={() => void save('save')}
        >
          {reopened ? 'Сохранить изменения' : 'Сохранить черновик'}
        </button>
      </DocumentFooter>
    </div>
  );
}

function StockDocumentReview({
  document,
  warehouse,
  canApprove,
  canReopenInventory,
  onReload,
}: {
  document: StockDocumentDetails;
  warehouse: WarehouseLocation;
  canApprove: boolean;
  canReopenInventory: boolean;
  onReload: () => void;
}) {
  const { transition } = useStockDocumentMutations();
  const { can } = usePermissions();
  const [error, setError] = useState('');
  const [confirmReopen, setConfirmReopen] = useState(false);
  const push = useNotifications((state) => state.push);
  const pending = transition.isPending;
  const needsApproval = document.status === 'submitted';
  const canReopenPosted = document.kind === 'inventory' && document.status === 'posted' && canReopenInventory;
  const canReverse = document.status === 'posted' && can('actions.warehouseApprove');
  const pendingHistorical = !!document.effectiveAt && document.status === 'submitted';
  const showAvailability = needsApproval && document.kind !== 'inventory' && !pendingHistorical;
  const approvalCatalog = useIngredients('', warehouse.id, showAvailability);
  const approvalDemands = document.kind === 'writeoff' && document.sourceLines?.length
    ? document.sourceLines.flatMap((line) => line.parts) : document.items;
  const shortages = showAvailability ? documentStockShortages(approvalCatalog.data ?? [], approvalDemands) : [];
  const reason = WRITEOFF_REASONS.find(({ value }) => value === document.reason)?.label;

  async function change(action: 'approve' | 'reopen' | 'reverse') {
    if (pending) return;
    const note =
      action === 'reverse' ? window.prompt('Укажите причину отмены проведения')?.trim() : undefined;
    if (action === 'reverse' && !note) return;
    setError('');
    try {
      await transition.mutateAsync({ id: document.id, action, revision: document.revision, note });
      setConfirmReopen(false);
      push({
        message:
          action === 'approve'
            ? 'Документ проведён'
            : action === 'reverse'
              ? 'Проведение отменено'
              : canReopenPosted ? 'Инвентаризация открыта для редактирования' : 'Документ возвращён в черновик',
        at: new Date().toISOString(),
      });
    } catch (err) {
      setError(apiError(err));
      if (canReopenPosted && action === 'reopen') {
        setConfirmReopen(false);
        onReload();
      }
    }
  }

  return (
    <div
      className={`poster-form poster-form--document space-y-6 ${document.kind === 'inventory' ? 'poster-document--inventory' : 'poster-document--modern'}`}
    >
      {document.kind === 'inventory' && <InventoryCountSheet document={document} warehouseName={warehouse.name} rows={document.items} />}
      <div className="poster-document-panel poster-document-fields space-y-3">
        <DocumentHeader document={document} warehouse={warehouse} />
        {reason && (
          <DocumentField label="Причина">
            <span className="poster-readonly">{reason}</span>
          </DocumentField>
        )}
        <DocumentField label="Комментарий">
          <span className="poster-readonly whitespace-pre-wrap break-words">{document.note || '—'}</span>
        </DocumentField>
      </div>
      {document.kind === 'inventory' && document.countedAt && <p className="inventory-timing-notice">
        Расхождение рассчитано на {inventoryTimeDisplay(document.countedAt)} по времени Бишкека.
        {document.postedAt ? ` Документ проведён ${inventoryTimeDisplay(document.postedAt)}. Последующие движения сохранены.` : ' Остатки изменятся после проведения.'}
        {can('actions.warehouseCosts') && ' Стоимость корректировки определяется на момент проведения.'}
      </p>}
      {pendingHistorical && can('actions.warehouseCosts') && <p className="inventory-timing-notice">
        Себестоимость будет рассчитана на складскую дату при проведении.
      </p>}
      {document.kind === 'writeoff' && !!document.sourceLines?.length ? <WriteoffLines sourceLines={document.sourceLines} total={document.sourceTotal} showCost={!pendingHistorical} /> : <DocumentItems
        writeoff={document.kind !== 'inventory'}
        rows={document.items}
        total={document.varianceValue}
        showCost={!pendingHistorical}
        inventoryId={document.kind === 'inventory' ? document.id : undefined}
      />}
      {showAvailability && <DocumentStockWarnings shortages={shortages} isTransfer={document.kind === 'transfer'} />}
      {canReverse && document.reversalBlockedReason && <p role="status" className="rounded-lg bg-background p-3 text-sm text-text-secondary">Отмена проведения недоступна. {document.reversalBlockedReason}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <WorkspaceHeaderActions>
        {document.kind === 'inventory' && can('actions.exportReports') &&
          <StockDocumentExportButton id={document.id} kind="inventory" disabled={pending} />}
        <button
          type="button"
          className="btn-ghost btn-md print:hidden text-primary"
          onClick={() => window.print()}
        >
          Печать
        </button>
      </WorkspaceHeaderActions>
      {((needsApproval && canApprove) || canReverse || canReopenPosted) && (
        <DocumentFooter>
          {needsApproval && canApprove && (
            <>
              <button
                type="button"
                className="btn-primary btn-md"
                disabled={pending}
                onClick={() => void change('approve')}
              >
                Утвердить и провести
              </button>
              {can('actions.warehouseApprove') && <button
                type="button"
                className="btn-secondary btn-md"
                disabled={pending}
                onClick={() => void change('reopen')}
              >
                Вернуть в черновик
              </button>}
            </>
          )}
          {canReopenPosted && (
            <button type="button" className="btn-primary btn-md" disabled={pending}
              onClick={() => { setError(''); setConfirmReopen(true); }}>
              Открыть период и редактировать
            </button>
          )}
          {canReverse && (
            <button
              type="button"
              className="btn-secondary btn-md"
              disabled={pending || !!document.reversalBlockedReason}
              onClick={() => void change('reverse')}
            >
              Отменить проведение
            </button>
          )}
        </DocumentFooter>
      )}
      {confirmReopen && canReopenPosted && <Modal open title="Открыть период инвентаризации" onClose={() => { if (!pending) setConfirmReopen(false); }}
        footer={<div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary btn-md" disabled={pending} onClick={() => setConfirmReopen(false)}>Отмена</button>
          <button type="button" className="btn-primary btn-md" disabled={pending} onClick={() => void change('reopen')}>Открыть период</button>
        </div>}>
        <p className="text-sm text-text-secondary">Уточните фактические остатки на исходную дату. Исправленные количества применятся при повторном проведении.</p>
      </Modal>}
    </div>
  );
}

function DocumentHeader({
  document,
  warehouse,
  editingStockDate = false,
}: {
  document: StockDocumentDetails;
  warehouse: WarehouseLocation;
  editingStockDate?: boolean;
}) {
  const locations = useWarehouseLocations();
  const sourcePurchase = usePurchase(document.kind === 'supplier_return' ? document.sourcePurchaseId ?? null : null);
  const destination = locations.data?.locations.find((l) => l.id === document.destinationWarehouseId);
  const inventory = document.kind === 'inventory';
  const status = documentDisplayStatus(document);
  const operationDate = inventory ? document.createdAt : (document.effectiveAt ?? document.postedAt ?? document.createdAt);
  const operator = !inventory && document.postedAt ? document.postedByName : document.createdByName;
  return (
    <dl className="space-y-3 text-sm">
      {!editingStockDate && <Meta label={inventory ? 'Начало инвентаризации' : document.effectiveAt ? 'Складская дата' : 'Дата и время'}>
        {inventory || document.effectiveAt ? inventoryTimeDisplay(operationDate) : formatDocumentDate(operationDate)}
        {!document.effectiveAt && operator && ` · ${operator}`}
      </Meta>}
      <Meta label={document.kind === 'transfer' ? 'Со склада' : 'Склад'}>{warehouse.name}</Meta>
      {destination && <Meta label="На склад">{destination.name}</Meta>}
      {document.kind === 'supplier_return' && (
        <Meta label="Исходная поставка">
          {sourcePurchase.data ? <>{purchaseNumber(sourcePurchase.data.number)} · {sourcePurchase.data.supplier} · {formatDocumentDate(sourcePurchase.data.date)}</>
            : sourcePurchase.isPending ? <span role="status">Загрузка поставки…</span>
              : <span role="alert" className="text-danger">Не удалось загрузить поставку. <button type="button" className="text-primary" onClick={() => void sourcePurchase.refetch()}>Повторить загрузку</button></span>}
          {sourcePurchase.data && sourcePurchase.data.status !== 'completed' && <p className="mt-1 text-danger">Исходная поставка отменена. Возврат по ней провести нельзя.</p>}
        </Meta>
      )}
      {inventory && (
        <Meta label="Тип инвентаризации">{document.mode === 'full' ? 'Полная' : 'Частичная'}</Meta>
      )}
      {inventory && status !== 'draft' && <Meta label="Остатки проверены на">
        {document.countedAt || document.postedAt ? `${inventoryTimeDisplay(document.countedAt ?? document.postedAt!)} · Бишкек` : 'Момент проведения'}
      </Meta>}
      <Meta label="Статус">
        <span className="document-status" data-status={status}>
          {documentStatus(status)}
        </span>
      </Meta>
      {document.postedAt && (inventory || document.effectiveAt) ? (
        <Meta label={inventory ? 'Проведена' : 'Проведён'}>
          {inventoryTimeDisplay(document.postedAt)} · Бишкек
          {document.postedByName && ` · ${document.postedByName}`}
        </Meta>
      ) : document.postedAt ? (
        <Meta label="Создан">
          {formatDocumentDate(document.createdAt)}
          {document.createdByName && ` · ${document.createdByName}`}
        </Meta>
      ) : (
        document.submittedAt && <Meta label="Отправлен">{formatDocumentDate(document.submittedAt)}</Meta>
      )}
    </dl>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="document-field poster-document-meta grid min-h-9 items-center text-sm">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="break-words text-text-primary">{children}</dd>
    </div>
  );
}

function DocumentItems({
  rows,
  total,
  writeoff,
  editable,
  addProducts,
  inventoryId,
  previewPending = false,
  showCost = true,
}: {
  rows: (StockDocumentItem & { input?: string; error?: string; remaining?: number; stock?: number; category?: string })[];
  total: number | null;
  writeoff: boolean;
  inventoryId?: string;
  previewPending?: boolean;
  showCost?: boolean;
  editable?: {
    onSelectProduct?: (previousId: string, id: string) => void;
    onChange: (id: string, value: string) => void;
    onRemove?: (id: string) => void;
    disabled: boolean;
  };
  addProducts?: { options: Ingredient[]; onSelect: (id: string) => void; loading?: boolean; error?: string; validationError?: string; onRetry?: () => void };
}) {
  const { can } = usePermissions();
  const costs = showCost && can('actions.warehouseCosts');
  const columns = writeoff ? 4 : 6;
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [countFilter, setCountFilter] = useState<InventoryCountFilter>('');
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  const [flowItemId, setFlowItemId] = useState<string | null>(null);
  const formId = useId();
  const searchText = search.trim().toLocaleLowerCase();
  const summary = inventoryCountSummary(rows);
  const visibleRows = writeoff ? rows : rows.filter((row) =>
    (!searchText || `${row.name} ${row.category ?? ''}`.toLocaleLowerCase().includes(searchText)) &&
    ((previewPending && countFilter !== 'uncounted') || inventoryCountMatches(row, countFilter) || focusedRow === row.ingredientId),
  );
  function focusUncounted() {
    const row = rows.find((item) => item.quantity === null);
    if (!row) return;
    setSearch('');
    setCountFilter('uncounted');
    setFocusedRow(row.ingredientId);
    focusDocumentInput(`${formId}-${row.ingredientId}-quantity-input`);
  }
  const amount = (value: number | null) =>
    writeoff ? (value === null ? '—' : balanceMoney(Math.abs(value))) : formatVariance(value);
  return (
    <section className={`poster-document-panel poster-document-products ${!writeoff ? 'poster-inventory-count' : ''}`}>
    {!writeoff && rows.length > 0 && (
      <>
      <div className="poster-inventory-progress">
        <span><strong>{summary.counted}</strong> из {summary.total} посчитано</span>
        <span className="text-text-muted">Не посчитано: {summary.uncounted}</span>
        {previewPending ? <span className="text-text-muted">Обновите учётные остатки для расчёта расхождений.</span> : <>
          <button type="button" className="text-primary" onClick={() => { setCountFilter('shortage'); setFocusedRow(null); }}>Недостача: {summary.shortage}{costs && summary.shortage > 0 ? ` · ${summary.shortageValue === null ? 'стоимость неизвестна' : `−${balanceMoney(summary.shortageValue)}`}` : ''}</button>
          <button type="button" className="text-primary" onClick={() => { setCountFilter('surplus'); setFocusedRow(null); }}>Излишек: {summary.surplus}{costs && summary.surplus > 0 ? ` · ${summary.surplusValue === null ? 'стоимость неизвестна' : `+${balanceMoney(summary.surplusValue)}`}` : ''}</button>
        </>}
        {editable && summary.uncounted > 0 && <button type="button" className="ml-auto text-primary" disabled={editable.disabled} onClick={focusUncounted}>К непосчитанному</button>}
      </div>
      <div className="poster-count-toolbar mb-4 flex flex-wrap items-center gap-3">
        <WorkspaceSearch label="Поиск продуктов и категорий инвентаризации" value={search} onChange={setSearch} />
        <Select ariaLabel="Позиции инвентаризации" value={countFilter} disabled={previewPending} onChange={(value) => { setCountFilter(value as InventoryCountFilter); setFocusedRow(null); }}
          className="w-52" options={[{ value: '', label: `Все продукты · ${summary.total}` }, ...(editable ? [{ value: 'uncounted', label: `Не посчитано · ${summary.uncounted}` }] : []), { value: 'differences', label: `С расхождением · ${summary.shortage + summary.surplus}` }, { value: 'shortage', label: `Недостача · ${summary.shortage}` }, { value: 'surplus', label: `Излишек · ${summary.surplus}` }]} />
        {(searchText || countFilter) ? <button type="button" className="text-xs text-primary" onClick={() => { setSearch(''); setCountFilter(''); }}>Сбросить фильтры · показано {visibleRows.length}</button> : editable && <span className="text-xs text-text-muted">Enter — следующий продукт · Shift+Enter — предыдущий</span>}
      </div>
      </>
    )}
    <div className="overflow-x-auto">
      <table className={`poster-table poster-document-table w-full table-fixed text-sm ${writeoff ? 'poster-document-table--compact min-w-[650px]' : 'poster-inventory-count-table min-w-[700px]'}`}>
        <colgroup>
          {writeoff ? (
            <>
              <col className="poster-col-product" />
              <col className="poster-col-quantity" style={{ width: 180 }} />
              <col className="poster-col-amount" style={{ width: 150 }} />
              <col className="poster-col-remove" style={{ width: 40 }} />
            </>
          ) : (
            <>
              <col />
              <col style={{ width: '15%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: 48 }} />
            </>
          )}
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="py-3 pr-3 font-normal">Наименование</th>
            {!writeoff && <th className="px-3 py-3 text-right font-normal">Плановый остаток</th>}
            <th className="px-3 py-3 text-right font-normal">{writeoff ? 'Количество' : 'Фактический остаток'}</th>
            {!writeoff && <th className="px-3 py-3 text-right font-normal">Разница</th>}
            <th className="px-3 py-3 text-right font-normal">{costs ? writeoff ? 'Сумма' : 'Разница в деньгах' : ''}</th>
            <th />
          </tr>
        </thead>
        <tbody className={writeoff ? 'poster-document-rows' : undefined}>
          {visibleRows.map((row) => (
            <Fragment key={row.ingredientId}>
            <tr className="border-b border-border">
              <td className={`py-3 pr-3 ${writeoff ? 'poster-product-cell' : ''}`}>
                {writeoff && editable?.onSelectProduct && addProducts ? <div className="poster-inline-product"><DocumentProductPicker
                  value={row.ingredientId}
                  options={[{ id: row.ingredientId, name: row.name, unit: row.unit }, ...addProducts.options.map((option) => ({ ...option, detail: option.category ?? undefined }))]}
                  label={`Продукт · ${row.name}`}
                  disabled={editable.disabled}
                  loading={addProducts.loading}
                  loadError={addProducts.error}
                  onRetry={addProducts.onRetry}
                  fallbackName={row.name}
                  onChange={(ingredientId) => {
                    editable.onSelectProduct?.(row.ingredientId, ingredientId);
                    focusDocumentInput(`${formId}-${ingredientId}-quantity-input`);
                  }}
                  onSelected={() => focusDocumentInput(`${formId}-${row.ingredientId}-quantity-input`)}
                /></div> : inventoryId ? (
                  <button type="button" className="inventory-flow-toggle" title={row.name}
                    aria-label={`Движение к плановому остатку: ${row.name}`}
                    aria-expanded={flowItemId === row.ingredientId}
                    onClick={() => setFlowItemId(flowItemId === row.ingredientId ? null : row.ingredientId)}>
                    <span aria-hidden="true">{flowItemId === row.ingredientId ? '⌄' : '›'}</span>
                    <span className="truncate">{row.name}</span>
                  </button>
                ) : <span className="block truncate" title={row.name}>{row.name}</span>}
              </td>
              {!writeoff && (
                <td className="px-3 py-3 text-right text-text-secondary">
                  {row.expected === null ? '—' : inventoryQuantity(row.expected, row.unit)}
                </td>
              )}
              <td className="px-3 py-2 text-right">
                {editable ? (
                  <>
                  <label className={`poster-number-unit ml-auto flex items-center justify-end gap-2 ${writeoff ? 'poster-inline-number' : ''}`}>
                    <input
                      id={`${formId}-${row.ingredientId}-quantity-input`}
                      className={`input h-9 min-w-0 w-full text-right ${writeoff ? 'poster-document-number' : ''}`}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      aria-label={`${writeoff ? 'Количество' : 'Фактический остаток'} · ${row.name}`}
                      aria-invalid={!!row.error || undefined}
                      aria-describedby={row.error ? `${formId}-${row.ingredientId}-error` : row.remaining !== undefined ? `${formId}-${row.ingredientId}-limit` : undefined}
                      max={row.remaining}
                      disabled={editable.disabled}
                      value={row.input ?? ''}
                      placeholder={!writeoff ? 'Не посчитано' : undefined}
                      onFocus={() => setFocusedRow(row.ingredientId)}
                      onBlur={() => setFocusedRow(null)}
                      onChange={(event) => editable.onChange(row.ingredientId, event.target.value)}
                      onKeyDown={(event) => {
                        if (writeoff || event.key !== 'Enter') return;
                        event.preventDefault();
                        const index = visibleRows.findIndex((item) => item.ingredientId === row.ingredientId);
                        const next = visibleRows[index + (event.shiftKey ? -1 : 1)];
                        if (next) focusDocumentInput(`${formId}-${next.ingredientId}-quantity-input`);
                      }}
                    />
                    <span className="whitespace-nowrap text-text-muted">{row.unit}</span>
                  </label>
                  {row.remaining !== undefined && <p id={`${formId}-${row.ingredientId}-limit`} className="mt-1 text-left text-xs text-text-muted">К возврату: {qty(row.remaining, row.unit)}</p>}
                  {row.stock !== undefined && <p className="mt-1 text-right text-xs text-text-muted">На складе {row.stock.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {row.unit}</p>}
                  {row.error && <p id={`${formId}-${row.ingredientId}-error`} className="mt-1 text-left text-xs text-danger">{row.error}</p>}
                  </>
                ) : row.quantity === null ? (
                  '—'
                ) : (
                  writeoff ? balanceQuantity(row.quantity, row.unit) : inventoryQuantity(row.quantity, row.unit)
                )}
              </td>
              {!writeoff && (
                <td className="px-3 py-3 text-right text-text-secondary" data-inventory-variance={inventoryCountMatches(row, 'shortage') ? 'shortage' : inventoryCountMatches(row, 'surplus') ? 'surplus' : undefined}>
                  {row.difference === null ? '—' : inventoryQuantity(row.difference, row.unit, true)}
                </td>
              )}
              <td className={`px-3 py-3 text-right ${writeoff ? 'whitespace-nowrap tabular-nums' : ''}`} data-inventory-variance={!writeoff && inventoryCountMatches(row, 'shortage') ? 'shortage' : !writeoff && inventoryCountMatches(row, 'surplus') ? 'surplus' : undefined}>{costs ? amount(row.value) : ''}</td>
              <td>
                {editable?.onRemove && (
                  <button
                    type="button"
                    className="btn-ghost h-8 w-8 text-text-muted hover:text-danger"
                    disabled={editable.disabled}
                    aria-label={`Убрать ${row.name}`}
                    onClick={() => editable.onRemove?.(row.ingredientId)}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
            {inventoryId && flowItemId === row.ingredientId && <tr className="inventory-flow-row">
              <td colSpan={columns}><InventoryFlowDetails documentId={inventoryId} item={row} /></td>
            </tr>}
            </Fragment>
          ))}
          {!visibleRows.length && !(writeoff && addProducts) && (
            <tr>
              <td colSpan={columns} className="py-12 text-center text-text-muted">
                {rows.length
                  ? countFilter === 'uncounted' && !searchText ? 'Все продукты посчитаны.' : countFilter && !searchText ? 'Нет продуктов с таким расхождением.' : 'Продукты не найдены. Измените поиск или фильтр.'
                  : addProducts ? writeoff ? 'Добавьте продукт в документ.' : 'Выберите ниже продукты, которые нужно проверить.' : 'В документе нет позиций.'}
              </td>
            </tr>
          )}
          {writeoff && addProducts && (adding || !rows.length) && <tr className="poster-document-entry-row">
            <td className="poster-product-cell"><div className="poster-inline-product"><DocumentProductPicker
              value=""
              label="Добавить продукт"
              autoFocus={adding}
              options={addProducts.options.map((option) => ({ ...option, detail: option.category ?? undefined }))}
              disabled={editable?.disabled}
              loading={addProducts.loading}
              loadError={addProducts.error}
              error={addProducts.validationError}
              onRetry={addProducts.onRetry}
              onChange={(ingredientId) => { addProducts.onSelect(ingredientId); setAdding(false); focusDocumentInput(`${formId}-${ingredientId}-quantity-input`); }}
            /></div></td><td className="text-right text-text-muted">—</td><td className="text-right text-text-muted">{costs ? balanceMoney(0) : ''}</td><td />
          </tr>}
        </tbody>
        {(!writeoff || !editable) && <tfoot>
          <tr className={`border-t border-border bg-background/30 ${writeoff ? 'poster-document-table-total' : ''}`}>
            <td colSpan={columns - 2} className="py-3 pr-3 font-medium">
              {writeoff ? 'Итого' : 'Итого расхождение'}
            </td>
            <td className={`px-3 py-3 text-right font-medium ${writeoff ? 'whitespace-nowrap tabular-nums' : ''}`}>{costs ? amount(total) : ''}</td>
            <td />
          </tr>
        </tfoot>}
      </table>
    </div>
    {addProducts && (
      <div className={`poster-document-add max-w-md py-3 ${writeoff ? 'poster-inline-product' : ''}`}>
        {!writeoff && (adding || !rows.length) ? (
          <DocumentProductPicker
            key={rows.length}
            value=""
            label="Добавить продукт"
            autoFocus={adding}
            options={addProducts.options}
            disabled={editable?.disabled}
            loading={addProducts.loading}
            loadError={addProducts.error}
            error={addProducts.validationError}
            onRetry={addProducts.onRetry}
            onChange={(id) => {
              addProducts.onSelect(id);
              setAdding(false);
              setSearch('');
              focusDocumentInput(`${formId}-${id}-quantity-input`);
            }}
          />
        ) : (
          <button
            type="button"
            className="text-sm text-primary"
            disabled={editable?.disabled}
            onClick={() => setAdding(true)}
          >
            + Добавить
          </button>
        )}
      </div>
    )}
    </section>
  );
}
