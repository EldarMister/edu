import { useEffect, useId, useRef, useState } from 'react';
import { DateTimePicker } from '@/components/DatePicker';
import { EditorPage, useEditorDirty } from './EditorPage';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { useStockDocuments } from './stock-documents-api';
import { useSuppliers } from './settings-api';
import { usePackages } from './extended-api';
import { DocumentField, DocumentFooter } from './WarehouseUi';
import { DocumentProductPicker } from './DocumentProductPicker';
import { focusDocumentInput } from './document-focus';
import { InventoryTimingFields } from './InventoryTimingFields';
import { inventoryTimeDisplay, inventoryTimingError, inventoryTimingFor, inventoryTimingValue } from './inventory-time';
import './document-workspace.css';
import './inventory-workspace.css';
import { documentStatus, formatDocumentDate } from './stock-document-format';
import {
  useIngredients,
  usePurchase,
  usePurchaseMutations,
  useLastPurchasePrices,
  purchaseNumber,
  type Purchase,
  type WarehouseLocation,
} from './api';
import { unitsForType, unitLabel, type UnitCode } from './units';
import { balanceMoney } from './balance-format';
import {
  convertPurchasePrice,
  purchasePriceFromTotal,
  purchaseRowTotal,
  purchaseRowTotalText,
  purchaseUnitFactor,
  roundPurchaseMoney,
  roundPurchaseQuantity,
  selectPurchaseProduct,
  type PurchaseRowValues,
} from './purchase-form-values';

export function PurchaseModal({
  id,
  warehouseId,
  locations,
  onClose,
  onReturn,
  onOpenDocument,
  edit = false,
}: {
  id?: string;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
  onReturn?: (id: string, warehouseId: string) => void;
  onOpenDocument?: (id: string) => void;
  edit?: boolean;
}) {
  const query = usePurchase(id ?? null);
  const permissions = usePermissions();
  const [requestedCorrection, setCorrecting] = useState(edit);
  const correcting = requestedCorrection && query.data?.status === 'completed' &&
    permissions.canAction('warehouseReceive') && permissions.canAction('warehouseCosts');
  return (
    <EditorPage
      open
      onClose={onClose}
      title={
        query.data ? `Поставка ${purchaseNumber(query.data.number)}` : id ? 'Поставка' : 'Новая поставка'
      }
      panelClassName="max-w-4xl"
    >
      {id && query.isPending && (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      )}
      {query.isError && (
        <p role="alert" className="text-danger">
          {apiError(query.error)}
        </p>
      )}
      {(!id || query.data) && (
        <PurchaseForm
          key={`${id ?? 'new'}:${query.data?.status ?? ''}:${correcting}:${!correcting && query.data?.status === 'completed' ? query.data.updatedAt : ''}`}
          purchase={query.data}
          warehouseId={warehouseId}
          locations={locations}
          onClose={onClose}
          onReturn={onReturn}
          onOpenDocument={onOpenDocument}
          correcting={correcting}
          onCorrecting={setCorrecting}
        />
      )}
    </EditorPage>
  );
}

type Row = PurchaseRowValues & { key: string; ingredientId: string; unit: string };
const emptyRow = (): Row => ({
  key: crypto.randomUUID(),
  ingredientId: '',
  quantity: '',
  unit: 'pcs',
  price: '',
});
function PurchaseForm({
  purchase: latestPurchase,
  warehouseId,
  locations,
  onClose,
  onReturn,
  onOpenDocument,
  correcting,
  onCorrecting,
}: {
  purchase?: Purchase;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
  onReturn?: (id: string, warehouseId: string) => void;
  onOpenDocument?: (id: string) => void;
  correcting: boolean;
  onCorrecting: (value: boolean) => void;
}) {
  const purchaseSnapshot = useRef(latestPurchase).current;
  const purchase = !correcting && latestPurchase?.status === 'completed' ? latestPurchase : purchaseSnapshot;
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const [requestKey] = useState(() => crypto.randomUUID());
  const [location, setLocation] = useState(purchase?.warehouseId ?? warehouseId);
  const suppliers = useSuppliers();
  const [supplier, setSupplier] = useState(purchase?.supplier ?? '');
  const [date, setDate] = useState(localTime(purchase?.date));
  const [dateValid, setDateValid] = useState(true);
  const [timing, setTiming] = useState(() => inventoryTimingFor(purchase?.effectiveAt));
  const [timingValid, setTimingValid] = useState(true);
  const [focusedPrice, setFocusedPrice] = useState<string | null>(null);
  const packages = usePackages();
  const [rows, setRows] = useState<Row[]>(
    () =>
      purchase?.items?.map((item) => ({
        key: item.id,
        ingredientId: item.ingredientId,
        quantity: String(item.quantity),
        unit: item.packageId ? `package:${item.packageId}` : item.unitCode,
        price: item.purchasePrice == null ? '' : String(item.purchasePrice),
        total: item.grossTotal == null ? undefined : String(item.grossTotal),
      })) ?? [emptyRow()],
  );
  const [discount, setDiscount] = useState(String(purchase?.discount ?? 0));
  const [discountVisible, setDiscountVisible] = useState(Number(purchase?.discount ?? 0) > 0);
  const [note, setNote] = useState(purchase?.note ?? '');
  const [attachments, setAttachments] = useState((purchase?.attachments ?? []).join('\n'));
  const [error, setError] = useState('');
  const [validationAttempt, setValidationAttempt] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const mutations = usePurchaseMutations();
  const ingredients = useIngredients('', location);
  const byId = new Map((ingredients.data ?? []).map((item) => [item.id, item]));
  const editable = can('actions.warehouseReceive') && costs && (!purchase || purchase.status === 'draft' || correcting);
  const stockEditable = editable && (purchase?.status !== 'completed' || purchase.canCorrectStock === true);
  const timingEditable = editable && (!purchase || purchase.status === 'draft');
  const effectiveAt = inventoryTimingValue(timing, purchase?.effectiveAt);
  const timingReady = !timingEditable || (timingValid && effectiveAt !== undefined && !inventoryTimingError(timing, undefined, true));
  const push = useNotifications((state) => state.push);
  const signature = JSON.stringify({ location, supplier, date, timing, rows, discount, note, attachments });
  const initialSignature = useRef(signature);
  const { markSaved } = useEditorDirty(editable && (signature !== initialSignature.current || !dateValid || !timingReady));
  const lastPrices = useLastPurchasePrices(stockEditable ? rows.map((row) => row.ingredientId) : [], location, purchase?.id);
  const returns = useStockDocuments(purchase?.warehouseId ?? undefined, 'supplier_return');
  const linkedReturns = (returns.data ?? []).filter((document) => document.sourcePurchaseId === purchase?.id);
  const catalogReady = ingredients.isSuccess && packages.isSuccess;
  const busy =
    mutations.create.isPending ||
    mutations.update.isPending ||
    mutations.complete.isPending ||
    mutations.cancel.isPending;
  const subtotal = roundPurchaseMoney(rows.reduce((sum, row) => sum + purchaseRowTotal(row), 0));
  const discountInput = Number(discount || 0);
  const discountAmount = roundPurchaseMoney(discountInput);
  const total = !stockEditable && purchase ? purchase.totalAmount : roundPurchaseMoney(subtotal - discountAmount);
  const enteredRows = rows.filter((row) => row.ingredientId || row.quantity || row.price || row.total);
  const supplierError = supplier.trim() ? '' : 'Укажите поставщика.';
  const locationError = location ? '' : 'Выберите склад.';
  const discountError = !Number.isFinite(discountInput) || discountInput < 0 || discountAmount > subtotal
    ? 'Скидка должна быть от 0 до суммы товаров.' : '';
  const rowErrors = new Map<string, { product?: string; quantity?: string; price?: string; total?: string }>();
  for (const row of enteredRows) {
    const issues: { product?: string; quantity?: string; price?: string; total?: string } = {};
    if (!row.ingredientId) issues.product = 'Выберите продукт.';
    if (!Number.isFinite(Number(row.quantity)) || !(roundPurchaseQuantity(Number(row.quantity)) > 0))
      issues.quantity = 'Введите количество больше нуля.';
    if (!(row.total ?? row.price).trim() || !Number.isFinite(Number(row.total ?? row.price)) ||
      Number(row.total ?? row.price) < 0 || !Number.isFinite(purchaseRowTotal(row)) || purchaseRowTotal(row) < 0)
      issues[row.total === undefined ? 'price' : 'total'] = row.total === undefined
        ? 'Введите цену. Для бесплатного товара укажите 0.' : 'Введите сумму не меньше 0.';
    if (Object.keys(issues).length) rowErrors.set(row.key, issues);
  }
  if (!enteredRows.length && rows[0]) rowErrors.set(rows[0].key, { product: 'Добавьте хотя бы один продукт.' });
  useEffect(() => {
    if (validationAttempt)
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"] button')?.focus();
  }, [validationAttempt]);
  function choose(key: string, ingredientId: string) {
    const item = byId.get(ingredientId);
    if (!item) return;
    setRows((current) => {
      const index = current.findIndex((row) => row.key === key);
      if (index < 0) return current;
      const selected = selectPurchaseProduct(current[index], item);
      return selected === current[index]
        ? current
        : current.map((row, rowIndex) => rowIndex === index ? selected : row);
    });
  }
  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  function changeUnit(row: Row, unit: string) {
    const item = byId.get(row.ingredientId);
    const original = purchase?.items?.find((entry) => entry.id === row.key && entry.ingredientId === row.ingredientId);
    update(row.key, {
      unit,
      price: convertPurchasePrice(
        row.price,
        purchaseUnitFactor(row.unit, item, packages.data, original),
        purchaseUnitFactor(unit, item, packages.data, original),
      ),
      total: undefined,
    });
  }
  async function save(complete: boolean) {
    if (busy || !editable || (stockEditable && !catalogReady) || !dateValid || !date || !timingReady) return;
    setError('');
    setValidationAttempt((attempt) => attempt + 1);
    if (discountError) setDiscountVisible(true);
    if (supplierError || (stockEditable && (locationError || discountError || rowErrors.size))) return;
    if (stockEditable && !enteredRows.length) {
      setError('Добавьте хотя бы один продукт.');
      return;
    }
    if (stockEditable && (!Number.isFinite(total) || total < 0)) {
      setError('Проверьте общую сумму поставки и скидку.');
      return;
    }
    try {
      const body = {
        warehouseId: location,
        supplier: supplier.trim(),
        supplierId: suppliers.data?.find((s) => s.name === supplier.trim())?.id,
        date: purchase && date === localTime(purchase.date) ? purchase.date : new Date(date).toISOString(),
        ...(timingEditable ? { effectiveAt } : {}),
        note: note.trim(),
        discount: discountAmount,
        attachments: attachments
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        items: enteredRows.map((row) => {
          const quantity = roundPurchaseQuantity(Number(row.quantity));
          const item = byId.get(row.ingredientId);
          const packs = item?.purchaseUnits?.length
            ? item.purchaseUnits
            : item?.purchaseUnit && item.purchaseFactor
              ? [{ name: item.purchaseUnit, factor: item.purchaseFactor }]
              : [];
          const globalPackage = row.unit.startsWith('package:') ? row.unit.slice(8) : undefined;
          const original = purchase?.items?.find((entry) => entry.id === row.key && entry.ingredientId === row.ingredientId && entry.packageId === globalPackage);
          const lineValue =
            row.total === undefined
              ? { purchasePrice: Number(row.price) }
              : { total: purchaseRowTotal(row) };
          if (globalPackage)
            return {
              ingredientId: row.ingredientId,
              quantity,
              packageId: globalPackage,
              ...(original ? { purchaseItemId: original.id } : {}),
              ...lineValue,
            };
          const pack = row.unit.startsWith('pack:');
          const factor = pack ? (packs[Number(row.unit.slice(5))]?.factor ?? 1) : 1;
          return {
            ingredientId: row.ingredientId,
            quantity: quantity * factor,
            unit: pack ? item?.displayUnit : row.unit,
            ...(row.total === undefined && !pack
              ? { purchasePrice: Number(row.price) / factor }
              : { total: purchaseRowTotal(row) }),
          };
        }),
      };
      if (purchase) {
        await mutations.update.mutateAsync({ id: purchase.id,
          ...(purchase.status === 'completed' && !stockEditable ? { date: body.date, supplier: body.supplier, supplierId: body.supplierId, note: body.note, attachments: body.attachments } : body),
          expectedUpdatedAt: purchase.updatedAt, complete: purchase.status === 'completed' ? false : complete });
      } else await mutations.create.mutateAsync({ ...body, complete, requestKey });
      markSaved();
      push({ type: 'success', at: new Date().toISOString(), message: correcting ? 'Исправления поставки сохранены' : complete ? 'Поставка проведена. Остатки обновлены.' : 'Черновик сохранён. Остатки не изменились.' });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <div ref={formRef} className="poster-form poster-form--document poster-purchase-form space-y-6">
      {!costs && (
        <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm">
          Для приёмки товара с закупочными ценами нужен доступ к себестоимости. Обратитесь к владельцу.
        </p>
      )}
      {purchase?.status === 'completed' ? (
        <div className="space-y-1 text-sm text-text-muted">
          <p>Поставка проведена{purchase.postedAt ? ` ${inventoryTimeDisplay(purchase.postedAt)} (Бишкек)` : ''}.{purchase.effectiveAt ? ' Остатки и себестоимость пересчитаны с даты складской операции.' : ' Остатки изменены в момент проведения.'}</p>
          {correcting && !stockEditable && <p role="status">{purchase.correctionBlockedReason} Доступно исправление реквизитов и комментария.</p>}
          {correcting && stockEditable && <p>Исправление обновит остатки и себестоимость. Предыдущая версия останется в истории.</p>}
        </div>
      ) : editable && <p className="text-sm text-text-muted">«Сохранить» оприходует товары с выбранного момента. Черновик не меняет остатки. Дата накладной хранится отдельно.</p>}
      <div className="poster-form-fields space-y-3">
        <DocumentField label="Дата накладной">
          {editable ? (
            <div className="w-[250px] max-w-full">
              <DateTimePicker className="input h-9" value={date} onChange={setDate} onValidityChange={setDateValid} required disabled={busy} />
            </div>
          ) : (
            <span className="poster-readonly">{formatDocumentDate(purchase?.date ?? date)}</span>
          )}
        </DocumentField>
        {timingEditable ? <InventoryTimingFields value={timing} onChange={setTiming} onValidityChange={setTimingValid} disabled={busy} operationLabel="Оприходовать товары" /> : <DocumentField label="Дата складской операции">
          <span className="poster-readonly">{purchase?.effectiveAt || purchase?.postedAt ? `${inventoryTimeDisplay((purchase.effectiveAt ?? purchase.postedAt)!)} (Бишкек)` : 'На момент проведения'}</span>
        </DocumentField>}
        <DocumentField label="Поставщик">
          {editable ? (
            <>
              <DocumentProductPicker
                label="Поставщик"
                placeholder="Выберите поставщика или введите название"
                allowCustomValue
                value={supplier}
                options={(suppliers.data ?? []).map((entry) => ({ id: entry.name, name: entry.name }))}
                onChange={setSupplier}
                error={validationAttempt ? supplierError || undefined : undefined}
                disabled={busy}
              />
              {suppliers.isPending && <p role="status" className="mt-1 text-xs text-text-muted">Загрузка поставщиков. Можно ввести название вручную.</p>}
              {suppliers.isError && <p role="alert" className="mt-1 text-xs text-text-muted">Список поставщиков не загрузился. Введите название или <button type="button" className="text-primary" onClick={() => void suppliers.refetch()}>повторите загрузку</button>.</p>}
            </>
          ) : (
            <span className="poster-readonly">{supplier || '—'}</span>
          )}
        </DocumentField>
        <DocumentField label="Склад">
          {stockEditable ? (
            <div data-invalid={!!validationAttempt && !!locationError || undefined}>
            <Select
              ariaLabel="Склад поставки"
              ariaInvalid={!!validationAttempt && !!locationError || undefined}
              ariaDescribedBy={validationAttempt && locationError ? `${formId}-location-error` : undefined}
              className="h-10 w-full"
              value={location}
              onChange={setLocation}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
              disabled={busy}
            />
            {!!validationAttempt && locationError && <p id={`${formId}-location-error`} className="mt-1 text-xs text-danger">{locationError}</p>}
            </div>
          ) : (
            <span className="poster-readonly whitespace-pre-wrap">
              {locations.find((entry) => entry.id === location)?.name ?? '—'}
            </span>
          )}
        </DocumentField>
        <DocumentField label="Комментарий">
          {editable ? (
            <textarea
              className="input h-14 min-h-14 w-full"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
          ) : (
            <span className="poster-readonly whitespace-pre-wrap">{note || '—'}</span>
          )}
        </DocumentField>
      </div>
      <div className="poster-purchase-products">
        {stockEditable && (ingredients.isPending || packages.isPending) && <p role="status" className="mb-3 text-sm text-text-muted">Загрузка продуктов и фасовок…</p>}
        {stockEditable && (ingredients.isError || packages.isError) && (
          <div role="alert" className="mb-3 text-sm text-danger">
            Не удалось загрузить продукты или фасовки. {apiError(ingredients.error ?? packages.error)}{' '}
            <button type="button" className="text-primary" onClick={() => { void ingredients.refetch(); void packages.refetch(); }}>Повторить загрузку</button>
          </div>
        )}
        <div className="poster-document-table overflow-x-auto">
          <table className="poster-table poster-purchase-table w-full min-w-[850px] table-fixed text-left text-sm">
            <colgroup>
              <col />
              <col style={{ width: '16%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: 40 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-xs font-normal text-text-muted">
                <th className="pb-3 pr-2 font-normal">Наименование</th>
                <th className="px-2 pb-3 font-normal">Фасовки</th>
                <th className="px-2 pb-3 text-right font-normal">Количество</th>
                <th className="px-2 pb-3 text-right font-normal">{costs && <>Цена<br />за единицу</>}</th>
                <th className="px-2 pb-3 text-right font-normal">{costs && <>Общая<br />сумма</>}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const item = byId.get(row.ingredientId);
                const issues = validationAttempt ? rowErrors.get(row.key) : undefined;
                const errorId = `${formId}-${row.key}`;
                const options = item
                  ? unitsForType(item.unitType).map((u) => ({ ...u, value: String(u.value) }))
                  : [];
                const packs = item?.purchaseUnits?.length
                  ? item.purchaseUnits
                  : item?.purchaseUnit && item.purchaseFactor
                    ? [{ name: item.purchaseUnit, factor: item.purchaseFactor }]
                    : [];
                (packages.data ?? [])
                  .filter((p) => p.isActive && item && unitsForType(item.unitType).some((u) => u.value === p.unit))
                  .forEach((p) =>
                    options.push({
                      value: `package:${p.id}`,
                      label: `${p.name} (${p.quantity} ${unitLabel(p.unit)})`,
                    }),
                  );
                const original = purchase?.items?.find((i) => i.id === row.key && i.ingredientId === row.ingredientId);
                const previousPrice = lastPrices.data?.find((entry) => entry.ingredientId === row.ingredientId);
                const previousConverted = previousPrice ? convertPurchasePrice(
                  String(previousPrice.unitPrice),
                  purchaseUnitFactor(previousPrice.unitCode, item, packages.data),
                  purchaseUnitFactor(row.unit, item, packages.data, original),
                ) : '';
                if (original?.packageId && row.unit === `package:${original.packageId}`) {
                  const selected = options.find((option) => option.value === row.unit);
                  if (selected && original.packageName) {
                    selected.label = `${original.packageName}${original.packageQuantity != null && original.packageUnit
                      ? ` (${original.packageQuantity} ${unitLabel(original.packageUnit as UnitCode)})`
                      : ''}`;
                  }
                }
                if (!options.some((o) => o.value === row.unit))
                  options.push({
                    value: row.unit,
                    label: original?.packageName ?? unitLabel((original?.unit ?? row.unit) as UnitCode),
                  });
                packs.forEach((pack, index) =>
                  options.push({
                    value: `pack:${index}`,
                    label: `${pack.name} (${pack.factor} ${item?.unit})`,
                  }),
                );
                return (
                  <tr key={row.key} className="border-b border-border">
                    <td className="py-2 pr-2">
                      {stockEditable ? (
                        <DocumentProductPicker
                          id={`${errorId}-product-input`}
                          value={row.ingredientId}
                          options={(ingredients.data ?? []).filter((entry) => entry.preparationMode !== 'virtual').map((entry) => ({ ...entry, detail: entry.category ?? undefined }))}
                          onChange={(id) => choose(row.key, id)}
                          onSelected={() => focusDocumentInput(`${errorId}-quantity-input`)}
                          disabled={busy}
                          loading={ingredients.isPending}
                          loadError={ingredients.isError ? 'Не удалось загрузить продукты.' : undefined}
                          onRetry={() => void ingredients.refetch()}
                          error={issues?.product}
                          label="Наименование продукта"
                          fallbackName={
                            purchase?.items?.find((entry) => entry.ingredientId === row.ingredientId)
                              ?.ingredientName
                          }
                        />
                      ) : (
                        <span>{original?.ingredientName ?? item?.name ?? 'Продукт'}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {stockEditable ? (
                        <Select
                          ariaLabel="Единица закупки"
                          className="h-9 w-full"
                          value={row.unit}
                          options={
                            !row.ingredientId
                              ? [{ value: row.unit, label: '—' }]
                              : options.length
                                ? options
                                : [{ value: row.unit, label: unitLabel(row.unit as UnitCode) }]
                          }
                          disabled={busy || !row.ingredientId || !catalogReady}
                          onChange={(unit) => changeUnit(row, unit)}
                        />
                      ) : (
                        <span>
                          {original?.packageName
                            ? `${original.packageName}${original.packageQuantity != null && original.packageUnit ? ` (${original.packageQuantity} ${unitLabel(original.packageUnit as UnitCode)})` : ''}`
                            : original?.unit ?? options.find((entry) => entry.value === row.unit)?.label ?? row.unit}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {stockEditable ? (
                        <>
                        <input
                          id={`${errorId}-quantity-input`}
                          className="input h-9 w-full text-right"
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          aria-label={`Количество ${item?.name ?? 'продукта'}`}
                          aria-invalid={!!issues?.quantity || undefined}
                          aria-describedby={issues?.quantity ? `${errorId}-quantity` : undefined}
                          value={row.quantity}
                          disabled={busy || !row.ingredientId}
                          onChange={(e) => update(row.key, { quantity: e.target.value, total: undefined })}
                        onBlur={() => {
                          const quantity = Number(row.quantity);
                          if (row.quantity.trim() && Number.isFinite(quantity) && quantity >= 0)
                            update(row.key, { quantity: String(roundPurchaseQuantity(quantity)) });
                        }}
                        />
                        {issues?.quantity && <p id={`${errorId}-quantity`} className="mt-1 text-xs text-danger">{issues.quantity}</p>}
                        </>
                      ) : (
                        <span className="block text-right tabular-nums">
                          {Number(row.quantity).toLocaleString('ru-RU')}
                        </span>
                      )}
                    </td>
                    <td className="relative px-2 py-2">
                      {costs &&
                        (stockEditable ? (
                          <>
                            <span
                              aria-hidden
                              className="absolute -left-1.5 top-1/2 -translate-y-1/2 text-lg text-text-light"
                            >
                              ×
                            </span>
                            <div className="poster-value-unit">
                              <input
                                className="input h-9 min-w-0 w-full text-right"
                                type="number"
                                min="0"
                                step="any"
                                inputMode="decimal"
                                aria-label={`Цена ${item?.name ?? 'продукта'}`}
                                aria-invalid={!!issues?.price || undefined}
                                aria-describedby={issues?.price ? `${errorId}-price` : undefined}
                                value={focusedPrice === row.key ? row.price : priceInputText(row.price)}
                                onFocus={() => setFocusedPrice(row.key)}
                                onBlur={() => setFocusedPrice(null)}
                                disabled={busy || !row.ingredientId}
                                onChange={(e) => update(row.key, { price: e.target.value, total: undefined })}
                              />
                              <span className="poster-value-unit__suffix">с</span>
                            </div>
                            {previousPrice && !row.price.trim() && <button type="button" className="mt-1 block w-full text-right text-xs text-primary" disabled={busy} title={`Поставка от ${formatDocumentDate(previousPrice.date)}, ${previousPrice.supplier}`} onClick={() => update(row.key, { price: previousConverted, total: undefined })}>
                              Предыдущая: {balanceMoney(Number(previousConverted))} · {new Date(previousPrice.date).toLocaleDateString('ru-RU')}
                            </button>}
                            {issues?.price && <p id={`${errorId}-price`} className="mt-1 text-xs text-danger">{issues.price}</p>}
                          </>
                        ) : (
                          <span className="block text-right tabular-nums">{balanceMoney(Number(row.price))}</span>
                        ))}
                    </td>
                    <td className="relative px-2 py-2">
                      {costs &&
                        (stockEditable ? (
                          <>
                            <span
                              aria-hidden
                              className="absolute -left-1.5 top-1/2 -translate-y-1/2 text-lg text-text-light"
                            >
                              =
                            </span>
                            <div className="poster-value-unit">
                              <input
                                className="input h-9 min-w-0 w-full text-right tabular-nums"
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                aria-label={`Общая сумма ${item?.name ?? 'продукта'}`}
                                aria-invalid={!!issues?.total || undefined}
                                aria-describedby={issues?.total ? `${errorId}-total` : undefined}
                                value={purchaseRowTotalText(row)}
                                disabled={busy || !row.ingredientId || !(Number(row.quantity) > 0)}
                                onChange={(e) => update(row.key, {
                                  total: e.target.value,
                                  price: purchasePriceFromTotal(row.quantity, e.target.value),
                                })}
                              />
                              <span className="poster-value-unit__suffix">с</span>
                            </div>
                            {issues?.total && <p id={`${errorId}-total`} className="mt-1 text-xs text-danger">{issues.total}</p>}
                          </>
                        ) : (
                          <span className="block text-right font-medium tabular-nums">
                            {balanceMoney(purchaseRowTotal(row))}
                          </span>
                        ))}
                    </td>
                    <td className="!px-0 py-2 text-center">
                      {stockEditable && (
                        <button
                          type="button"
                          className="poster-remove"
                          disabled={busy}
                          aria-label={`Убрать ${item?.name ?? 'строку'}`}
                          onClick={() =>
                            setRows((current) =>
                              current.length > 1 ? current.filter((r) => r.key !== row.key) : [emptyRow()],
                            )
                          }
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="poster-purchase-table-actions flex flex-wrap items-center justify-between gap-3">
          {stockEditable && (
            <button
              type="button"
              className="py-3 text-sm text-primary"
              disabled={busy}
              onClick={() => {
                const row = emptyRow();
                setRows((current) => [...current, row]);
                focusDocumentInput(`${formId}-${row.key}-product-input`);
              }}
            >
              + Добавить ещё
            </button>
          )}
          {stockEditable && !discountVisible && (
            <button className="py-3 text-sm text-primary" type="button" disabled={busy} onClick={() => setDiscountVisible(true)}>
              + Скидка поставщика
            </button>
          )}
        </div>
        {costs && discountVisible && (
          <div className="poster-purchase-discount mt-3 flex flex-wrap items-center justify-end gap-3 text-sm">
            {discountAmount > 0 && <span className="text-text-muted">До скидки: {balanceMoney(subtotal)}</span>}
            <span>Скидка поставщика</span>
            {stockEditable ? (
              <div className="poster-value-unit w-40">
                <input
                  className="input h-9 min-w-0 w-full text-right"
                  aria-label="Скидка поставщика"
                  aria-invalid={!!validationAttempt && !!discountError || undefined}
                  aria-describedby={validationAttempt && discountError ? `${formId}-discount-error` : undefined}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={discount}
                  disabled={busy}
                  onChange={(event) => setDiscount(event.target.value)}
                  onBlur={() => {
                    if (Number.isFinite(discountInput) && discountInput >= 0)
                      setDiscount(discountAmount.toFixed(2));
                  }}
                />
                <span className="poster-value-unit__suffix">с</span>
              </div>
            ) : <span>{balanceMoney(discountAmount)}</span>}
            {!!validationAttempt && discountError && <p id={`${formId}-discount-error`} className="w-full text-right text-xs text-danger">{discountError}</p>}
          </div>
        )}
      </div>
      {(editable || attachments.trim()) && (
        <details className="poster-advanced">
          <summary className="cursor-pointer text-sm font-medium">Накладные</summary>
          <div className="mt-3 space-y-3">
            <DocumentField label="Ссылки на накладные, по одной на строку">
              {editable ? (
                <textarea
                  className="input w-full"
                  value={attachments}
                  disabled={busy}
                  onChange={(e) => setAttachments(e.target.value)}
                />
              ) : (
                <span className="poster-readonly whitespace-pre-wrap">{attachments || '—'}</span>
              )}
            </DocumentField>
          </div>
        </details>
      )}
      {purchase?.status === 'completed' && <section className="space-y-3 border-t border-border pt-4">
        <h3 className="font-medium">Возвраты по поставке</h3>
        {returns.isPending && <p className="text-sm text-text-muted">Загрузка возвратов…</p>}
        {returns.isError && <p role="alert" className="text-sm text-danger">Не удалось загрузить возвраты. <button type="button" className="text-primary" onClick={() => void returns.refetch()}>Повторить</button></p>}
        {returns.isSuccess && !linkedReturns.length && <p className="text-sm text-text-muted">Возвратов пока нет. Новый возврат и его черновик будут доступны здесь.</p>}
        {linkedReturns.map((document) => <div key={document.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm">
          <span>Возврат · {formatDocumentDate(document.createdAt)}</span>
          <span className="document-status" data-status={document.status}>{documentStatus(document.status)}</span>
          {onOpenDocument && <button type="button" className="text-primary" onClick={() => onOpenDocument(document.id)}>Открыть возврат</button>}
        </div>)}
      </section>}
      {!!purchase?.corrections?.length && <details className="poster-advanced">
        <summary className="cursor-pointer text-sm font-medium">История исправлений ({purchase.corrections.length})</summary>
        <div className="mt-3 space-y-3 text-sm">{purchase.corrections.map((correction) => <div key={correction.id} className="border-b border-border pb-2">
          <p>{formatDocumentDate(correction.createdAt)} · {correction.actorName ?? 'Сотрудник'}</p>
          <p className="text-text-muted">{correction.reason}{costs && correction.before.totalAmount !== correction.after.totalAmount ? ` · ${balanceMoney(correction.before.totalAmount)} → ${balanceMoney(correction.after.totalAmount)}` : ''}</p>
        </div>)}</div>
      </details>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <DocumentFooter total={costs ? `Итого: ${Number.isFinite(total) ? balanceMoney(total) : '—'}` : undefined}>
        {editable ? (
          <>
            <button
              type="button"
              className="btn-primary btn-md"
              disabled={busy || (stockEditable && !catalogReady) || !dateValid || !date || !timingReady}
              onClick={() => void save(true)}
            >
              {correcting ? 'Сохранить исправление' : 'Сохранить'}
            </button>
            {correcting ? <button type="button" className="btn-secondary btn-md" disabled={busy} onClick={() => { markSaved(); onCorrecting(false); }}>Отменить изменения</button> : <button
              type="button"
              className="btn-secondary btn-md"
              disabled={busy || (stockEditable && !catalogReady) || !dateValid || !date || !timingReady}
              onClick={() => void save(false)}
            >
              Сохранить черновик
            </button>}
          </>
        ) : (
          <>
            <span className="document-status mr-auto self-center" data-status={purchase?.status}>
              {purchase?.status === 'cancelled'
                ? 'Проведение отменено'
                : purchase?.status === 'draft'
                  ? 'Черновик'
                  : 'Поставка проведена'}
            </span>
            {purchase?.status === 'completed' && can('actions.warehouseReceive') && costs && <button type="button" className="btn-primary btn-md" onClick={() => onCorrecting(true)}>{purchase.canCorrectStock ? 'Исправить' : 'Исправить реквизиты'}</button>}
            {purchase?.status === 'completed' && can('actions.warehouseReceive') && costs && onReturn && (
              <button
                type="button"
                className="btn-secondary btn-md"
                disabled={purchase.returnableItems?.every((item) => item.remainingQuantity <= 0)}
                onClick={() => onReturn(purchase.id, purchase.warehouseId ?? location)}
              >
                Возврат поставщику
              </button>
            )}
          </>
        )}
      </DocumentFooter>
    </div>
  );
}

function localTime(value?: string) {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// Keep the exact calculation in row.price; shorten only its unfocused presentation.
function priceInputText(value: string) {
  const price = Number(value);
  if (!value.trim() || !Number.isFinite(price)) return value;
  return price.toLocaleString('en-US', {
    useGrouping: false,
    minimumFractionDigits: 2,
    maximumFractionDigits: price > 0 && price < 0.01 ? 8 : 2,
  });
}
