import { IconExport } from '@/features/admin/components/icons';
import { useEffect, useId, useRef, useState } from 'react';
import { EditorPage, useEditorDirty } from './EditorPage';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { DocumentProductPicker } from './DocumentProductPicker';
import { focusDocumentInput } from './document-focus';
import './document-workspace.css';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { InventoryScopePicker } from './InventoryScopePicker';
import { InventoryTimingFields } from './InventoryTimingFields';
import { StockOperationDateField } from './StockOperationDateField';
import { inventoryTimingFor, inventoryTimingError, inventoryTimingValue } from './inventory-time';
import { apiError } from '@/lib/api';
import { balanceMoney } from './balance-format';
import { usePurchases, usePurchase, useIngredients, purchaseNumber, type WarehouseLocation } from './api';
import {
  useStockDocumentMutations,
  useStockDocument,
  useWriteoffReasons,
  type StockDocumentKind,
  type InventoryMode,
} from './stock-documents-api';
import { formatDocumentDate } from './stock-document-format';
import { WriteoffReasonField, writeoffReasonInput } from './WriteoffReasonField';
import { DocumentField, DocumentFooter } from './WarehouseUi';
import { documentQuantityError, documentQuantityInUnit, documentStockShortages, documentUnitCost, returnableQuantityInUnit } from './stock-document-form';
import { DocumentStockWarnings } from './DocumentStockWarnings';
import { WriteoffLines, useWriteoffLines } from './WriteoffLines';
import { exportWriteoffLines, WriteoffFileImport } from './WriteoffFileImport';
import { useWriteoffPackages } from './writeoff-api';
import { changeWriteoffUnit, writeoffDraftLines, type DraftWriteoffLine } from './writeoff-form-values';
type DraftRow = { key: string; id: string; quantity: string };
const emptyRow = (): DraftRow => ({ key: crypto.randomUUID(), id: '', quantity: '' });

interface StartDocumentProps {
  kind: StockDocumentKind;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
  onCreated: (id: string) => void;
  sourcePurchaseId?: string;
  copyDocumentId?: string;
}

type TransferFields = { destination: string; note: string; rows: Omit<DraftRow, 'key'>[] };
type ReturnFields = { number: number; supplier: string; rows: Omit<DraftRow, 'key'>[] };
type WriteoffFields = { note: string; reason: string; rows: DraftWriteoffLine[] };

export function StartDocumentModal({ copyDocumentId, ...props }: StartDocumentProps) {
  if (props.kind === 'supplier_return' && props.sourcePurchaseId) return <PurchaseReturn {...props} sourcePurchaseId={props.sourcePurchaseId} />;
  if (copyDocumentId && props.kind === 'transfer') return <CopyTransfer id={copyDocumentId} {...props} />;
  if (copyDocumentId && props.kind === 'writeoff') return <CopyWriteoff id={copyDocumentId} {...props} />;
  return <CreateDocument {...props} />;
}

function PurchaseReturn(props: StartDocumentProps & { sourcePurchaseId: string }) {
  const query = usePurchase(props.sourcePurchaseId);
  const source = query.data;
  const warehouseId = source?.warehouseId ?? props.warehouseId;
  const items = useIngredients('', warehouseId, !!source);
  if (source && items.isSuccess) {
    const available = new Set(items.data.map((item) => item.id));
    const rows = source.returnableItems?.filter((item) => item.remainingQuantityBase > 0 && available.has(item.ingredientId))
      .map((item) => ({ id: item.ingredientId, quantity: '0' })) ?? [];
    return <CreateDocument {...props} warehouseId={warehouseId} initialReturn={{ number: source.number, supplier: source.supplier, rows }} />;
  }
  return <EditorPage title="Возврат поставщику" onClose={props.onClose}>
    {(query.isPending || items.isPending) && <div className="flex justify-center p-6"><Spinner /></div>}
    {(query.error || items.error) && <p role="alert" className="text-sm text-danger">{apiError(query.error ?? items.error)}
      <button type="button" className="ml-2 text-primary" onClick={() => { void query.refetch(); void items.refetch(); }}>Повторить</button>
    </p>}
  </EditorPage>;
}

function CopyTransfer({ id, ...props }: StartDocumentProps & { id: string }) {
  const query = useStockDocument(id);
  const source = query.data?.kind === 'transfer' ? query.data : undefined;
  const items = useIngredients('', source?.warehouseId, !!source);
  const pending = query.isPending || (!!source && items.isPending);
  let error = query.error ? apiError(query.error) : items.error ? apiError(items.error) : '';
  if (!pending && !source && !error) error = 'Исходное перемещение не найдено.';
  if (source && items.isSuccess) {
    const catalog = new Map(items.data.map((item) => [item.id, item]));
    const rows: TransferFields['rows'] = [];
    for (const row of source.items) {
      const item = catalog.get(row.ingredientId);
      const quantity = item?.preparationMode !== 'virtual' && item?.unit && row.quantity != null
        ? documentQuantityInUnit(row.quantity, row.unit, item.unit)
        : undefined;
      if (quantity === undefined || quantity <= 0) {
        error = `Позиция «${row.name}» больше недоступна для перемещения.`;
        break;
      }
      rows.push({ id: row.ingredientId, quantity: String(quantity) });
    }
    if (!props.locations.some(({ id: location }) => location === source.warehouseId)) error = 'Склад-отправитель больше недоступен.';
    if (!error) return <CreateDocument key={id} {...props} warehouseId={source.warehouseId} initialTransfer={{
      destination: props.locations.some(({ id: location }) => location === source.destinationWarehouseId)
        ? source.destinationWarehouseId! : '',
      note: source.note ?? '',
      rows,
    }} />;
  }
  return <EditorPage open title="Копирование перемещения" onClose={props.onClose}>
    {pending && <div className="flex justify-center p-6"><Spinner /></div>}
    {error && <p role="alert" className="p-4 text-sm text-danger">{error}</p>}
  </EditorPage>;
}

function CopyWriteoff({ id, ...props }: StartDocumentProps & { id: string }) {
  const query = useStockDocument(id);
  const source = query.data?.kind === 'writeoff' && !query.data.deletedAt ? query.data : undefined;
  const reasonId = source?.writeoffReasonId ?? source?.reason;
  const usesPackages = source?.sourceLines?.some((line) => !!line.packageId) ?? false;
  const reasons = useWriteoffReasons(!!reasonId);
  const packages = useWriteoffPackages(usesPackages);
  const pending = query.isPending || (!!reasonId && reasons.isPending) || (usesPackages && packages.isPending);
  const error = (query.data ? null : query.error)
    ?? (reasonId && !reasons.data ? reasons.error : null)
    ?? (usesPackages && !packages.data ? packages.error : null);
  if (source && !pending && !error) {
    const usablePackages = new Map(packages.data?.filter((pack) => pack.isActive).map((pack) => [pack.id, pack]));
    const rows = writeoffDraftLines(source.sourceLines, source.items).map((row) => {
      const pack = row.packageId ? usablePackages.get(row.packageId) : undefined;
      const sameSize = pack && pack.unit === row.packageUnit && pack.quantity === row.packageQuantity;
      const line = row.packageId && !sameSize ? changeWriteoffUnit(row, row.unit) : row;
      return { ...line, sourceLineId: crypto.randomUUID(), packageSnapshotLineId: undefined };
    });
    const location = props.locations.some((warehouse) => warehouse.id === source.warehouseId) ? source.warehouseId : '';
    return <CreateDocument key={id} {...props} warehouseId={location} initialWriteoff={{
      note: source.note ?? '', reason: reasonId && reasons.data?.some(({ id }) => id === reasonId) ? reasonId : '', rows,
    }} />;
  }
  return <EditorPage open title="Копирование списания" onClose={props.onClose}>
    {pending ? <div className="flex justify-center p-6"><Spinner /></div> :
      <p role="alert" className="p-4 text-sm text-danger">
        {error ? apiError(error) : 'Исходное списание не найдено.'}
        {error && <button type="button" className="ml-2 text-primary" onClick={() => {
          if (query.isError) void query.refetch();
          if (reasonId && reasons.isError) void reasons.refetch();
          if (usesPackages && packages.isError) void packages.refetch();
        }}>Повторить</button>}
      </p>}
  </EditorPage>;
}

function CreateDocument({ kind, warehouseId, locations, onClose, onCreated, sourcePurchaseId, initialTransfer, initialReturn, initialWriteoff }: StartDocumentProps & {
  initialTransfer?: TransferFields;
  initialReturn?: ReturnFields;
  initialWriteoff?: WriteoffFields;
}) {
  const [location, setLocation] = useState(warehouseId);
  const [destination, setDestination] = useState(initialTransfer?.destination ?? '');
  const [source, setSource] = useState(sourcePurchaseId ?? '');
  const [mode, setMode] = useState<InventoryMode>('full');
  const [initialOperationAt] = useState(() => new Date().toISOString());
  const [timing, setTiming] = useState(() => inventoryTimingFor(kind === 'transfer' || kind === 'writeoff' ? initialOperationAt : undefined));
  const [timingValid, setTimingValid] = useState(true);
  const supportsStockDate = kind === 'transfer' || kind === 'writeoff';
  const historical = supportsStockDate && timing.mode === 'past' && timing.local !== inventoryTimingFor(initialOperationAt).local;
  const timingReady = timingValid && !inventoryTimingError(timing);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const initialNote = initialTransfer?.note ?? initialWriteoff?.note ?? '';
  const initialReason = initialWriteoff?.reason ?? '';
  const [note, setNote] = useState(initialNote);
  const [reason, setReason] = useState(initialReason);
  const initialRows = initialReturn?.rows ?? initialTransfer?.rows ?? [];
  const [rows, setRows] = useState<DraftRow[]>(() => initialReturn || initialRows.length
    ? initialRows.map((row) => ({ ...row, key: crypto.randomUUID() })) : [emptyRow()]);
  const [error, setError] = useState('');
  const [fileReading, setFileReading] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [postAttempt, setPostAttempt] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const [requestKey] = useState(() => crypto.randomUUID());
  const writeoffLines = useWriteoffLines(kind === 'writeoff', location, undefined, inventoryTimingValue(timing, initialOperationAt), initialWriteoff?.rows);
  const changedItems = JSON.stringify(rows.filter(({ id, quantity }) => id || quantity).map(({ id, quantity }) => [id, quantity])) !==
    JSON.stringify(initialRows.map(({ id, quantity }) => [id, quantity]));
  const { markSaved } = useEditorDirty(location !== warehouseId || destination !== (initialTransfer?.destination ?? '') || source !== (sourcePurchaseId ?? '') ||
    mode !== 'full' || note !== initialNote || reason !== initialReason ||
    (kind === 'inventory' && (timing.mode === 'past' || !timingValid)) || (supportsStockDate && (inventoryTimingValue(timing, initialOperationAt) !== initialOperationAt || !timingValid)) || (kind === 'writeoff' ? writeoffLines.dirty : changedItems));
  const mutations = useStockDocumentMutations();
  const push = useNotifications((state) => state.push);
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const purchases = usePurchases({
    status: 'completed',
    search: '',
    warehouseId: location,
    enabled: kind === 'supplier_return' && !initialReturn,
  });
  const ingredients = useIngredients('', location);
  const sourcePurchase = usePurchase(kind === 'supplier_return' && source ? source : null);
  const returnable = new Map(sourcePurchase.data?.returnableItems?.map((item) => [item.ingredientId, item]));
  const busy = mutations.create.isPending || mutations.transition.isPending || fileReading;
  const inventory = kind === 'inventory';
  const productLoading = ingredients.isPending || (kind === 'supplier_return' && !!source && sourcePurchase.isPending);
  const productError = ingredients.isError ? ingredients.error : kind === 'supplier_return' && sourcePurchase.isError ? sourcePurchase.error : null;
  const catalogReady = kind === 'writeoff' ? writeoffLines.options.isSuccess : ingredients.isSuccess && (kind !== 'supplier_return' || (!!source && sourcePurchase.isSuccess));
  const title = inventory
    ? 'Новая инвентаризация'
    : kind === 'transfer'
      ? 'Новое перемещение'
      : kind === 'supplier_return'
        ? 'Возврат поставщику'
        : 'Новое списание';
  const canPost =
    kind === 'transfer'
      ? can('actions.warehouseTransfer')
      : kind === 'supplier_return'
        ? can('actions.warehouseReceive') && costs
        : can('actions.warehouseApprove');
  const enteredRows = rows.filter((row) => initialReturn ? row.quantity.trim() && Number(row.quantity) !== 0 : row.id || row.quantity);
  const products = (ingredients.data ?? []).filter(
    (item) => item.preparationMode !== 'virtual' && (kind !== 'supplier_return' ||
      returnable.has(item.id) && ((returnable.get(item.id)?.remainingQuantityBase ?? 0) > 0 || rows.some((row) => row.id === item.id))),
  );
  function remainingFor(ingredientId: string) {
    const item = ingredients.data?.find((candidate) => candidate.id === ingredientId);
    return kind === 'supplier_return' && sourcePurchase.isSuccess && item
      ? returnableQuantityInUnit(returnable.get(ingredientId)?.remainingQuantityBase ?? 0, item.displayUnit)
      : undefined;
  }
  const catalog = ingredients.data ?? [];
  const catalogById = new Map(catalog.map((item) => [item.id, item]));
  const demands = inventory ? [] : kind === 'writeoff'
    ? writeoffLines.ready ? writeoffLines.lines.flatMap((line) => line.parts) : []
    : enteredRows.flatMap((row) => {
      const item = catalogById.get(row.id);
      return item ? [{ ingredientId: row.id, quantity: Number(row.quantity), unit: item.unit }] : [];
    });
  const shortages = historical ? [] : documentStockShortages(catalog, demands);
  const deficient = new Set(shortages.map(({ ingredientId }) => ingredientId));
  const rowValue = (row: DraftRow) => {
    if (historical) return null;
    const item = catalogById.get(row.id);
    const quantity = Number(row.quantity);
    if (!row.id || !quantity) return 0;
    const cost = documentUnitCost(item?.unit ?? '', item?.avgCostBase);
    return cost === null || deficient.has(row.id) ? null : quantity * cost;
  };
  const rowValues = enteredRows.map(rowValue);
  const unknown = rowValues.some((value) => value === null);
  const total = rowValues.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  function validationFor(post: boolean) {
    const issues = {
      location: location ? '' : 'Выберите склад.',
      destination: kind === 'transfer' && !destination ? 'Выберите склад, на который перемещаете продукты.' : '',
      source: kind === 'supplier_return' && !source ? 'Выберите исходную поставку.' : '',
      scope: inventory && mode === 'partial' && !selectedProducts.length ? 'Выберите продукты, которые нужно посчитать.' : '',
      rows: new Map<string, { product?: string; quantity?: string }>(),
    };
    if (kind === 'writeoff') {
      for (const [key, issue] of writeoffLines.issues) if (issue.product || issue.quantity) issues.rows.set(key, issue);
      if (post && !writeoffLines.enteredCount && !issues.rows.size) issues.rows.set(writeoffLines.rows[0].sourceLineId, { product: 'Добавьте хотя бы один продукт.' });
    } else if (!inventory) {
      for (const row of enteredRows) {
        const rowIssues: { product?: string; quantity?: string } = {};
        if (!row.id) rowIssues.product = 'Выберите продукт.';
        rowIssues.quantity = documentQuantityError(row.quantity, false, remainingFor(row.id));
        if (rowIssues.product || rowIssues.quantity) issues.rows.set(row.key, rowIssues);
      }
      if (post && !enteredRows.length) issues.rows.set(rows[0]?.key ?? 'empty', { product: initialReturn ? 'Укажите количество для возврата.' : 'Добавьте хотя бы один продукт.' });
    }
    return issues;
  }
  const fieldErrors = validationFor(postAttempt);
  useEffect(() => {
    if (validationAttempt)
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [validationAttempt]);
  function retryProducts() {
    void ingredients.refetch();
    if (kind === 'supplier_return' && source) void sourcePurchase.refetch();
  }
  async function submit(post: boolean) {
    if (busy || (!inventory && !catalogReady) || ((inventory || supportsStockDate) && !timingReady) || (inventory && mode === 'partial' && !ingredients.isSuccess)) return;
    setError('');
    setPostAttempt(post);
    setValidationAttempt((attempt) => attempt + 1);
    const issues = validationFor(post);
    if (issues.location || issues.destination || issues.source || issues.scope || issues.rows.size) return;
    if (kind === 'writeoff' && !writeoffLines.ready) {
      setError('Дождитесь расчёта состава или обновите предварительный расчёт.');
      return;
    }
    try {
      const doc = await mutations.create.mutateAsync({
        finalize: post && !inventory ? (canPost ? 'post' : 'submit') : undefined,
        warehouseId: location,
        kind,
        mode: inventory ? mode : undefined,
        countedAt: inventory ? inventoryTimingValue(timing) : undefined,
        effectiveAt: supportsStockDate ? inventoryTimingValue(timing, initialOperationAt) : undefined,
        destinationWarehouseId: kind === 'transfer' ? destination : undefined,
        sourcePurchaseId: kind === 'supplier_return' ? source : undefined,
        requestKey,
        note,
        ...(kind === 'writeoff' ? writeoffReasonInput(reason) : {}),
        sourceLines: kind === 'writeoff' ? writeoffLines.input() : undefined,
        items: kind === 'writeoff' ? undefined : inventory
          ? mode === 'partial' ? selectedProducts.map((ingredientId) => ({ ingredientId, quantity: null })) : undefined
          : enteredRows.map((r) => ({ ingredientId: r.id, quantity: Number(r.quantity) })),
      });
      markSaved();
      if (inventory) onCreated(doc.id);
      else {
        push({ message: doc.status === 'posted' ? 'Документ проведён' : doc.status === 'submitted' ? 'Документ отправлен на утверждение' : 'Черновик сохранён', at: new Date().toISOString() });
        onClose();
      }
    } catch (e) {
      setError(apiError(e));
    }
  }
  return (
    <EditorPage open title={title} onClose={onClose} panelClassName={inventory ? 'max-w-2xl' : 'max-w-4xl'}>
      <div
        ref={formRef}
        className={`poster-form poster-form--document space-y-6 ${inventory ? 'poster-document--inventory' : 'poster-document--modern'}`}
      >
        {kind === 'writeoff' && <>
          {can('actions.exportReports') && <WorkspaceHeaderActions>
            <button type="button" className="btn-secondary btn-md" disabled={!writeoffLines.enteredCount || busy}
              onClick={() => exportWriteoffLines(writeoffLines.rows)}><IconExport />Экспорт CSV</button>
          </WorkspaceHeaderActions>}
          <WriteoffFileImport disabled={busy || !writeoffLines.options.isSuccess} onBusy={setFileReading} onRead={writeoffLines.importRows} />
        </>}
        <div className="poster-document-panel poster-document-fields space-y-3">
          {supportsStockDate && <StockOperationDateField value={timing} onChange={setTiming}
            onValidityChange={setTimingValid} disabled={busy}
            label={kind === 'transfer' ? 'Дата и время перемещения' : 'Дата и время списания'} />}
          {kind === 'supplier_return' && (
            <DocumentField label="Дата возврата">
              <span className="poster-readonly">На момент проведения</span>
            </DocumentField>
          )}
          <DocumentField label={kind === 'transfer' ? 'Со склада' : 'Склад'}>
            {initialReturn ? <span className="poster-readonly">{locations.find((item) => item.id === location)?.name ?? '—'}</span> : <Select
              className="h-10 w-full"
              ariaLabel="Склад документа"
              ariaInvalid={!!validationAttempt && !!fieldErrors.location || undefined}
              ariaDescribedBy={validationAttempt && fieldErrors.location ? `${formId}-location-error` : undefined}
              disabled={busy}
              value={location}
              onChange={(v) => {
                if (v === location) return;
                setLocation(v);
                if (kind === 'transfer' && destination === v) setDestination('');
                if (kind === 'supplier_return') {
                  setSource('');
                  setRows([emptyRow()]);
                }
                if (inventory) setSelectedProducts([]);
                setValidationAttempt(0);
              }}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />}
            {!!validationAttempt && fieldErrors.location && <p id={`${formId}-location-error`} className="mt-1 text-xs text-danger">{fieldErrors.location}</p>}
          </DocumentField>
          {kind === 'transfer' && (
            <DocumentField label="На склад">
              <Select
                className="h-10 w-full"
                ariaLabel="Склад получатель"
                ariaInvalid={!!validationAttempt && !!fieldErrors.destination || undefined}
                ariaDescribedBy={validationAttempt && fieldErrors.destination ? `${formId}-destination-error` : undefined}
                disabled={busy}
                value={destination}
                onChange={setDestination}
                options={locations
                  .filter((l) => l.id !== location)
                  .map((l) => ({ value: l.id, label: l.name }))}
              />
              {!!validationAttempt && fieldErrors.destination && <p id={`${formId}-destination-error`} className="mt-1 text-xs text-danger">{fieldErrors.destination}</p>}
            </DocumentField>
          )}
          {kind === 'supplier_return' && (
            <DocumentField label="Исходная поставка">
              {initialReturn ? <span className="poster-readonly">{purchaseNumber(initialReturn.number)} · {initialReturn.supplier}</span> : <Select
                className="h-10 w-full"
                ariaLabel="Исходная поставка"
                ariaInvalid={!!validationAttempt && !!fieldErrors.source || undefined}
                ariaDescribedBy={validationAttempt && fieldErrors.source ? `${formId}-source-error` : undefined}
                disabled={busy || purchases.isPending || purchases.isError}
                placeholder={purchases.isPending ? 'Загрузка поставок…' : 'Выберите поставку'}
                value={source}
                onChange={(value) => {
                  setSource(value);
                  setRows([emptyRow()]);
                }}
                options={(purchases.data ?? []).map((p) => ({
                  value: p.id,
                  label: `№${p.number} · ${p.supplier} · ${formatDocumentDate(p.effectiveAt ?? p.postedAt ?? p.date)}`,
                }))}
              />}
              {!!validationAttempt && fieldErrors.source && <p id={`${formId}-source-error`} className="mt-1 text-xs text-danger">{fieldErrors.source}</p>}
              {purchases.isError && <p role="alert" className="mt-1 text-sm text-danger">Не удалось загрузить поставки. <button type="button" className="text-primary" onClick={() => void purchases.refetch()}>Повторить загрузку</button></p>}
              {!initialReturn && purchases.isSuccess && !purchases.data?.length && <p className="mt-1 text-sm text-text-muted">На этом складе пока нет проведённых поставок.</p>}
            </DocumentField>
          )}
          {kind === 'writeoff' && (
            <DocumentField label="Причина">
              <WriteoffReasonField disabled={busy} value={reason} onChange={setReason} />
            </DocumentField>
          )}
          {inventory && <InventoryTimingFields value={timing} onChange={setTiming} onValidityChange={setTimingValid} disabled={busy} />}
          {inventory && (
            <DocumentField label="Тип инвентаризации">
              <div
                className="flex h-9 overflow-hidden rounded border border-border"
                role="group"
                aria-label="Тип инвентаризации"
              >
                {(['full', 'partial'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={busy}
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                    className={`flex-1 border-r border-border px-3 text-sm last:border-r-0 ${mode === value ? 'bg-primary/10 text-primary' : 'bg-white text-text-secondary'}`}
                  >
                    {value === 'full' ? 'Полная' : 'Частичная'}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {mode === 'full'
                  ? 'Все продукты с остатком или движениями на выбранном складе.'
                  : 'Выберите ниже продукты, которые будете проверять.'}
              </p>
            </DocumentField>
          )}
          <DocumentField label="Комментарий">
            <textarea
              className="input h-14 w-full"
              value={note}
              aria-label="Комментарий"
              maxLength={1000}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
          </DocumentField>
        </div>
        {inventory ? (
          <>
          {mode === 'partial' && (
            <section className="poster-document-panel space-y-3">
              <InventoryScopePicker key={location} products={products} selected={selectedProducts} onChange={setSelectedProducts}
                disabled={busy} loading={ingredients.isPending} error={ingredients.isError} onRetry={() => void ingredients.refetch()} />
              {fieldErrors.scope && <p className="text-sm text-text-muted" role="status">{fieldErrors.scope}</p>}
            </section>
          )}
          <p className="max-w-3xl text-sm text-text-muted">
            Начните подсчёт и внесите фактические остатки. Пустое поле означает «не посчитано». Для
            отсутствующего товара укажите 0.
          </p>
          </>
        ) : kind === 'writeoff' ? (
          <WriteoffLines editor={writeoffLines} disabled={busy} showErrors={!!validationAttempt} requireRows={postAttempt} showCost={!historical} />
        ) : (
          <section className="poster-document-panel poster-document-products">
          {initialReturn && <p className="mb-3 px-4 text-sm text-text-secondary">Укажите количество возвращаемых товаров. Для остальных оставьте 0.</p>}
          {productLoading && <p role="status" className="mb-3 px-4 text-sm text-text-muted">Загрузка продуктов…</p>}
          {!!productError && <p role="alert" className="mb-3 px-4 text-sm text-danger">Не удалось загрузить продукты. {apiError(productError)} <button type="button" className="text-primary" onClick={retryProducts}>Повторить загрузку</button></p>}
          {kind === 'supplier_return' && sourcePurchase.isSuccess && !products.length && <p role="status" className="mb-3 px-4 text-sm text-text-muted">Все продукты этой поставки уже возвращены.</p>}
          <div className="overflow-x-auto">
            <table className="poster-table poster-document-table poster-document-table--compact w-full min-w-[650px] table-fixed text-sm">
              <colgroup>
                <col className="poster-col-product" />
                <col className="poster-col-quantity" style={{ width: 180 }} />
                <col className="poster-col-amount" style={{ width: 150 }} />
                <col className="poster-col-remove" style={{ width: 40 }} />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-xs font-normal text-text-muted">
                  <th className="py-3 pr-3 font-normal">Наименование</th>
                  <th className="px-3 py-3 text-right font-normal">Количество</th>
                  <th className="px-3 py-3 text-right font-normal">{costs ? 'Сумма' : ''}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="poster-document-rows">
                {rows.map((r) => {
                  const item = catalogById.get(r.id);
                  const issues = validationAttempt ? fieldErrors.rows.get(r.key) : undefined;
                  const errorId = `${formId}-${r.key}-quantity`;
                  const remaining = remainingFor(r.id);
                  const value = rowValue(r);
                  return (
                    <tr key={r.key} className="border-b border-border">
                      <td className="poster-product-cell py-2 pr-3">
                        <div className="poster-inline-product">
                        {initialReturn ? <span className="poster-readonly">{item?.name ?? returnable.get(r.id)?.name ?? 'Продукт'}</span> : <DocumentProductPicker
                          id={`${errorId}-product-input`}
                          label="Продукт документа"
                          value={r.id}
                          disabled={busy || (kind === 'supplier_return' && !source)}
                          loading={productLoading}
                          loadError={productError ? 'Не удалось загрузить продукты.' : undefined}
                          onRetry={retryProducts}
                          error={issues?.product}
                          options={products.filter(
                            (candidate) =>
                              candidate.id === r.id || !rows.some((other) => other.id === candidate.id),
                          ).map((candidate) => ({ ...candidate, detail: candidate.category ?? undefined }))}
                          onSelected={() => focusDocumentInput(`${errorId}-input`)}
                          onChange={(id) =>
                            setRows((current) =>
                              current.map((row) => (row.key === r.key ? { ...row, id, quantity: row.id === id ? row.quantity : '' } : row)),
                            )
                          }
                        />}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <label className="poster-number-unit poster-inline-number ml-auto flex items-center justify-end gap-2">
                          <input
                            id={`${errorId}-input`}
                            className="input poster-document-number h-9 min-w-0 w-full text-right"
                            type="number"
                            min="0"
                            max={remaining}
                            step="any"
                            disabled={busy || !r.id}
                            inputMode="decimal"
                            aria-label={`Количество ${item?.name ?? 'продукта'}`}
                            aria-invalid={!!issues?.quantity || undefined}
                            aria-describedby={issues?.quantity ? errorId : remaining !== undefined ? `${errorId}-limit` : undefined}
                            value={r.quantity}
                            onChange={(e) =>
                              setRows((current) =>
                                current.map((row) =>
                                  row.key === r.key ? { ...row, quantity: e.target.value } : row,
                                ),
                              )
                            }
                          />
                          <span className="whitespace-nowrap text-text-muted">{item?.unit}</span>
                        </label>
                        {remaining !== undefined && <p id={`${errorId}-limit`} className="mt-1 text-left text-xs text-text-muted">К возврату: {remaining.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {item?.unit}</p>}
                        {kind === 'transfer' && item && !historical && <p className="mt-1 text-right text-xs text-text-muted">На складе {item.stock.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} {item.unit}</p>}
                        {issues?.quantity && <p id={errorId} className="mt-1 text-left text-xs text-danger">{issues.quantity}</p>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                        {costs ? value === null ? '—' : balanceMoney(value) : ''}
                      </td>
                      <td className="py-2">
                        {!initialReturn && <button
                          type="button"
                          className="btn-ghost h-8 w-8 text-text-muted hover:text-danger"
                          aria-label={`Удалить ${item?.name ?? 'строку'}`}
                          disabled={busy}
                          onClick={() =>
                            setRows((current) =>
                              current.length > 1 ? current.filter((row) => row.key !== r.key) : [emptyRow()],
                            )
                          }
                        >
                          ×
                        </button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            {!initialReturn && <button
              type="button"
              className="poster-document-add py-3 text-sm text-primary"
              disabled={busy}
              onClick={() => { const row = emptyRow(); setRows((current) => [...current, row]); focusDocumentInput(`${formId}-${row.key}-quantity-product-input`); }}
            >
              + Добавить
            </button>}
          </section>
        )}
        {!inventory && <DocumentStockWarnings shortages={shortages} isTransfer={kind === 'transfer'} />}
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        {!inventory && <p className="text-sm text-text-muted">{canPost ? '«Сохранить» проведёт документ и изменит остатки. Черновик сохраняет данные без изменения остатков.' : 'Черновик не меняет остатки. Они изменятся после утверждения документа.'}</p>}
        <DocumentFooter
          total={
            !inventory && costs
              ? historical ? 'Стоимость после проведения'
              : kind === 'writeoff'
                ? writeoffLines.calculating ? 'Итого: расчёт…' : writeoffLines.total == null ? 'Итого: стоимость неполная' : `Итого: ${balanceMoney(writeoffLines.total)}`
              : unknown
                ? 'Итого: стоимость неполная'
                : `Итого: ${balanceMoney(total)}`
              : undefined
          }
        >
          <button
            className="btn-primary btn-md"
            disabled={
              busy ||
              (!inventory && !catalogReady) ||
              (kind === 'writeoff' && writeoffLines.calculating) ||
              (inventory && mode === 'partial' && (!ingredients.isSuccess || !selectedProducts.length)) ||
              ((inventory || supportsStockDate) && !timingReady) ||
              !location ||
              (kind === 'transfer' && !destination) ||
              (kind === 'supplier_return' && (!source || !!initialReturn && !enteredRows.length))
            }
            onClick={() => void submit(true)}
          >
            {inventory ? 'Начать подсчёт' : canPost ? 'Сохранить' : 'Отправить на утверждение'}
          </button>
          {!inventory && (
            <button className="btn-secondary btn-md" disabled={busy || !catalogReady || (!!initialReturn && !enteredRows.length) || (supportsStockDate && !timingReady) || (kind === 'writeoff' && writeoffLines.calculating)} onClick={() => void submit(false)}>
              Сохранить черновик
            </button>
          )}
        </DocumentFooter>
      </div>
    </EditorPage>
  );
}
