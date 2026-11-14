import { useEffect, useId, useRef, useState } from 'react';
import { EditorPage, useEditorDirty } from './EditorPage';
import { DocumentProductPicker } from './DocumentProductPicker';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { apiError } from '@/lib/api';
import { balanceMoney } from './balance-format';
import { usePurchases, usePurchase, useIngredients, type WarehouseLocation } from './api';
import {
  useStockDocumentMutations,
  type StockDocumentKind,
  type InventoryMode,
  type WriteoffReason,
} from './stock-documents-api';
import { formatDocumentDate, WRITEOFF_REASONS } from './stock-document-format';
import { DocumentField, DocumentFooter } from './WarehouseUi';
import { documentQuantityError, returnableQuantityInUnit } from './stock-document-form';
import { WriteoffLines, useWriteoffLines } from './WriteoffLines';
type DraftRow = { key: string; id: string; quantity: string };
const emptyRow = (): DraftRow => ({ key: crypto.randomUUID(), id: '', quantity: '' });

export function StartDocumentModal({
  kind,
  warehouseId,
  locations,
  onClose,
  onCreated,
  sourcePurchaseId,
}: {
  kind: StockDocumentKind;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
  onCreated: (id: string) => void;
  sourcePurchaseId?: string;
}) {
  const [location, setLocation] = useState(warehouseId);
  const [destination, setDestination] = useState('');
  const [source, setSource] = useState(sourcePurchaseId ?? '');
  const [mode, setMode] = useState<InventoryMode>('full');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [scopeSearch, setScopeSearch] = useState('');
  const [scopeCategory, setScopeCategory] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<WriteoffReason | ''>('');
  const [rows, setRows] = useState<DraftRow[]>(() => [emptyRow()]);
  const [error, setError] = useState('');
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [postAttempt, setPostAttempt] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const [requestKey] = useState(() => crypto.randomUUID());
  const writeoffLines = useWriteoffLines(kind === 'writeoff', location);
  const { markSaved } = useEditorDirty(location !== warehouseId || destination !== '' || source !== (sourcePurchaseId ?? '') ||
    mode !== 'full' || note !== '' || reason !== '' || (kind === 'writeoff' ? writeoffLines.dirty : rows.some((row) => !!row.id || !!row.quantity)));
  const mutations = useStockDocumentMutations();
  const push = useNotifications((state) => state.push);
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const purchases = usePurchases({
    status: 'completed',
    search: '',
    warehouseId: location,
    enabled: kind === 'supplier_return',
  });
  const ingredients = useIngredients('', location);
  const sourcePurchase = usePurchase(kind === 'supplier_return' && source ? source : null);
  const returnable = new Map(sourcePurchase.data?.returnableItems?.map((item) => [item.ingredientId, item]));
  const busy = mutations.create.isPending || mutations.transition.isPending;
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
  const enteredRows = rows.filter((row) => row.id || row.quantity);
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
  const scopeProducts = products.filter((item) => (!scopeCategory || item.category === scopeCategory) &&
    (!scopeSearch.trim() || item.name.toLocaleLowerCase().includes(scopeSearch.trim().toLocaleLowerCase())));
  const scopeCategories = [...new Set(products.map((item) => item.category).filter((category): category is string => !!category))].sort((a, b) => a.localeCompare(b, 'ru'));
  const unknown = enteredRows.some((r) => ingredients.data?.find((i) => i.id === r.id)?.avgCost == null);
  const total = rows.reduce(
    (sum, r) => sum + Number(r.quantity || 0) * (ingredients.data?.find((i) => i.id === r.id)?.avgCost ?? 0),
    0,
  );
  function validationFor(post: boolean) {
    const issues = {
      location: location ? '' : 'Выберите склад.',
      destination: kind === 'transfer' && !destination ? 'Выберите склад, на который перемещаете продукты.' : '',
      source: kind === 'supplier_return' && !source ? 'Выберите исходную поставку.' : '',
      reason: post && kind === 'writeoff' && !reason ? 'Выберите причину списания.' : '',
      note: post && kind === 'writeoff' && reason === 'other' && !note.trim() ? 'Уточните причину списания.' : '',
      scope: inventory && mode === 'partial' && !selectedProducts.length ? 'Выберите продукты, которые нужно посчитать.' : '',
      rows: new Map<string, { product?: string; quantity?: string }>(),
    };
    if (kind === 'writeoff') {
      for (const [key, issue] of writeoffLines.issues) if (issue.product || issue.quantity) issues.rows.set(key, issue);
      if (post && !writeoffLines.enteredCount) issues.rows.set(writeoffLines.rows[0].sourceLineId, { product: 'Добавьте хотя бы один продукт.' });
    } else if (!inventory) {
      for (const row of enteredRows) {
        const rowIssues: { product?: string; quantity?: string } = {};
        if (!row.id) rowIssues.product = 'Выберите продукт.';
        rowIssues.quantity = documentQuantityError(row.quantity, false, remainingFor(row.id));
        if (rowIssues.product || rowIssues.quantity) issues.rows.set(row.key, rowIssues);
      }
      if (post && !enteredRows.length) issues.rows.set(rows[0].key, { product: 'Добавьте хотя бы один продукт.' });
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
    if (busy || (!inventory && !catalogReady) || (inventory && mode === 'partial' && !ingredients.isSuccess)) return;
    setError('');
    setPostAttempt(post);
    setValidationAttempt((attempt) => attempt + 1);
    const issues = validationFor(post);
    if (issues.location || issues.destination || issues.source || issues.reason || issues.note || issues.scope || issues.rows.size) return;
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
        destinationWarehouseId: kind === 'transfer' ? destination : undefined,
        sourcePurchaseId: kind === 'supplier_return' ? source : undefined,
        requestKey,
        note,
        reason: kind === 'writeoff' ? reason || null : undefined,
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
        <div className="poster-document-panel poster-document-fields space-y-3">
          {!inventory && (
            <DocumentField
              label={
                kind === 'transfer'
                  ? 'Дата и время перемещения'
                  : kind === 'writeoff'
                    ? 'Дата и время списания'
                    : 'Дата возврата'
              }
            >
              <span className="poster-readonly">На момент проведения</span>
            </DocumentField>
          )}
          <DocumentField label={kind === 'transfer' ? 'Со склада' : 'Склад'}>
            <Select
              className="h-10 w-full"
              ariaLabel="Склад документа"
              ariaInvalid={!!validationAttempt && !!fieldErrors.location || undefined}
              ariaDescribedBy={validationAttempt && fieldErrors.location ? `${formId}-location-error` : undefined}
              disabled={busy}
              value={location}
              onChange={(v) => {
                setLocation(v);
                setDestination('');
                setSource('');
                setRows([emptyRow()]);
                if (kind === 'writeoff') writeoffLines.adopt();
                setSelectedProducts([]);
                setScopeSearch('');
                setScopeCategory('');
                setValidationAttempt(0);
              }}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />
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
              <Select
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
                  label: `№${p.number} · ${p.supplier} · ${formatDocumentDate(p.date)}`,
                }))}
              />
              {!!validationAttempt && fieldErrors.source && <p id={`${formId}-source-error`} className="mt-1 text-xs text-danger">{fieldErrors.source}</p>}
              {purchases.isError && <p role="alert" className="mt-1 text-sm text-danger">Не удалось загрузить поставки. <button type="button" className="text-primary" onClick={() => void purchases.refetch()}>Повторить загрузку</button></p>}
              {purchases.isSuccess && !purchases.data?.length && <p className="mt-1 text-sm text-text-muted">На этом складе пока нет проведённых поставок.</p>}
            </DocumentField>
          )}
          {kind === 'writeoff' && (
            <DocumentField label="Причина">
              <Select
                className="h-10 w-full"
                ariaLabel="Причина списания"
                ariaInvalid={!!validationAttempt && !!fieldErrors.reason || undefined}
                ariaDescribedBy={validationAttempt && fieldErrors.reason ? `${formId}-reason-error` : undefined}
                disabled={busy}
                value={reason}
                onChange={(v) => setReason(v as WriteoffReason)}
                options={WRITEOFF_REASONS}
              />
              {!!validationAttempt && fieldErrors.reason && <p id={`${formId}-reason-error`} className="mt-1 text-xs text-danger">{fieldErrors.reason}</p>}
            </DocumentField>
          )}
          {inventory && (
            <DocumentField label="Проверка остатков">
              <span className="poster-readonly">На момент проведения</span>
            </DocumentField>
          )}
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
          <DocumentField label={kind === 'writeoff' && reason === 'other' ? 'Уточните причину' : 'Комментарий'}>
            <textarea
              className="input h-14 w-full"
              value={note}
              aria-label={kind === 'writeoff' && reason === 'other' ? 'Уточните причину' : 'Комментарий'}
              aria-invalid={!!validationAttempt && !!fieldErrors.note || undefined}
              aria-describedby={validationAttempt && fieldErrors.note ? `${formId}-note-error` : undefined}
              maxLength={1000}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
            />
            {!!validationAttempt && fieldErrors.note && <p id={`${formId}-note-error`} className="mt-1 text-xs text-danger">{fieldErrors.note}</p>}
          </DocumentField>
        </div>
        {inventory ? (
          <>
          {mode === 'partial' && (
            <section className="poster-document-panel space-y-3" aria-label="Продукты частичной инвентаризации">
              <div className="flex flex-wrap items-center gap-3">
                <WorkspaceSearch label="Поиск продуктов для подсчёта" value={scopeSearch} onChange={setScopeSearch} />
                <Select ariaLabel="Категория продуктов" className="h-9 min-w-44" value={scopeCategory} onChange={setScopeCategory}
                  options={[{ value: '', label: 'Все категории' }, ...scopeCategories.map((category) => ({ value: category, label: category }))]} />
              </div>
              {ingredients.isPending ? <p role="status" className="text-sm text-text-muted">Загрузка продуктов…</p> : ingredients.isError ? (
                <p role="alert" className="text-sm text-danger">Не удалось загрузить продукты. <button type="button" className="text-primary" onClick={() => void ingredients.refetch()}>Повторить загрузку</button></p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span>Выбрано: {selectedProducts.length}</span>
                    <div className="flex gap-4">
                      <button type="button" className="text-primary" disabled={busy || !scopeProducts.length} onClick={() => setSelectedProducts((current) => [...new Set([...current, ...scopeProducts.map((item) => item.id)])])}>Выбрать все показанные</button>
                      {!!selectedProducts.length && <button type="button" className="text-primary" disabled={busy} onClick={() => setSelectedProducts([])}>Очистить</button>}
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-border border-y border-border">
                    {scopeProducts.map((item) => (
                      <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 py-2 text-sm">
                        <input type="checkbox" className="h-4 w-4 accent-primary" disabled={busy} checked={selectedProducts.includes(item.id)}
                          onChange={(event) => setSelectedProducts((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
                        <span className="flex-1">{item.name}</span><span className="text-text-muted">{item.unit}</span>
                      </label>
                    ))}
                    {!scopeProducts.length && <p className="py-6 text-center text-sm text-text-muted">{scopeSearch || scopeCategory ? 'Продукты не найдены. Измените поиск или категорию.' : 'Нет продуктов для инвентаризации.'}</p>}
                  </div>
                </>
              )}
              {fieldErrors.scope && <p className="text-sm text-text-muted" role="status">{fieldErrors.scope}</p>}
            </section>
          )}
          <p className="max-w-3xl text-sm text-text-muted">
            Начните подсчёт и внесите фактические остатки. Пустое поле означает «не посчитано». Для
            отсутствующего товара укажите 0.
          </p>
          </>
        ) : kind === 'writeoff' ? (
          <WriteoffLines editor={writeoffLines} disabled={busy} showErrors={!!validationAttempt} requireRows={postAttempt} />
        ) : (
          <section className="poster-document-panel poster-document-products">
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
                  const item = ingredients.data?.find((i) => i.id === r.id);
                  const issues = validationAttempt ? fieldErrors.rows.get(r.key) : undefined;
                  const errorId = `${formId}-${r.key}-quantity`;
                  const remaining = remainingFor(r.id);
                  return (
                    <tr key={r.key} className="border-b border-border">
                      <td className="poster-product-cell py-2 pr-3">
                        <div className="poster-inline-product">
                        <DocumentProductPicker
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
                          )}
                          onChange={(id) =>
                            setRows((current) =>
                              current.map((row) => (row.key === r.key ? { ...row, id, quantity: row.id === id ? row.quantity : '' } : row)),
                            )
                          }
                        />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <label className="poster-number-unit poster-inline-number ml-auto flex items-center justify-end gap-2">
                          <input
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
                        {issues?.quantity && <p id={errorId} className="mt-1 text-left text-xs text-danger">{issues.quantity}</p>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                        {costs
                          ? !r.id
                            ? balanceMoney(0)
                            : item?.avgCost == null
                              ? '—'
                              : balanceMoney(Number(r.quantity || 0) * item.avgCost)
                          : ''}
                      </td>
                      <td className="py-2">
                        <button
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
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            <button
              type="button"
              className="poster-document-add py-3 text-sm text-primary"
              disabled={busy}
              onClick={() => setRows((current) => [...current, emptyRow()])}
            >
              + Добавить
            </button>
          </section>
        )}
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
        {!inventory && <p className="text-sm text-text-muted">{canPost ? '«Сохранить» проведёт документ и изменит остатки. Черновик сохраняет данные без изменения остатков.' : 'Черновик не меняет остатки. Они изменятся после утверждения документа.'}</p>}
        <DocumentFooter
          total={
            !inventory && costs
              ? kind === 'writeoff'
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
              !location ||
              (kind === 'transfer' && !destination) ||
              (kind === 'supplier_return' && !source)
            }
            onClick={() => void submit(true)}
          >
            {inventory ? 'Начать подсчёт' : canPost ? 'Сохранить' : 'Отправить на утверждение'}
          </button>
          {!inventory && (
            <button className="btn-secondary btn-md" disabled={busy || !catalogReady || (kind === 'writeoff' && writeoffLines.calculating)} onClick={() => void submit(false)}>
              Сохранить черновик
            </button>
          )}
        </DocumentFooter>
      </div>
    </EditorPage>
  );
}
