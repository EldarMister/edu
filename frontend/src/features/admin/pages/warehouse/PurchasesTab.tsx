import { useState } from 'react';
import { DateTimePicker } from '@/components/DatePicker';
import { EditorPage } from './EditorPage';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { money } from '@/lib/format';
import { useSuppliers } from './settings-api';
import { usePackages } from './extended-api';
import { DocumentField, DocumentFooter } from './WarehouseUi';
import { DocumentProductPicker } from './DocumentProductPicker';
import { formatDocumentDate } from './stock-document-format';
import {
  useIngredients,
  usePurchase,
  usePurchaseMutations,
  purchaseNumber,
  type Purchase,
  type WarehouseLocation,
} from './api';
import { unitsForType, unitLabel, type UnitCode } from './units';

export function PurchaseModal({
  id,
  warehouseId,
  locations,
  onClose,
  onReturn,
}: {
  id?: string;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
  onReturn?: (id: string, warehouseId: string) => void;
}) {
  const query = usePurchase(id ?? null);
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
          key={`${id ?? 'new'}:${query.data?.status ?? ''}`}
          purchase={query.data}
          warehouseId={warehouseId}
          locations={locations}
          onClose={onClose}
          onReturn={onReturn}
        />
      )}
    </EditorPage>
  );
}

type Row = { key: string; ingredientId: string; quantity: string; unit: string; price: string };
const emptyRow = (): Row => ({
  key: crypto.randomUUID(),
  ingredientId: '',
  quantity: '',
  unit: 'pcs',
  price: '',
});
function PurchaseForm({
  purchase,
  warehouseId,
  locations,
  onClose,
  onReturn,
}: {
  purchase?: Purchase;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
  onReturn?: (id: string, warehouseId: string) => void;
}) {
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const [requestKey] = useState(() => crypto.randomUUID());
  const [location, setLocation] = useState(purchase?.warehouseId ?? warehouseId);
  const suppliers = useSuppliers();
  const [supplier, setSupplier] = useState(purchase?.supplier ?? '');
  const [date, setDate] = useState(localTime(purchase?.date));
  const packages = usePackages();
  const [rows, setRows] = useState<Row[]>(
    () =>
      purchase?.items?.map((item) => ({
        key: item.id,
        ingredientId: item.ingredientId,
        quantity: String(item.quantity),
        unit: item.packageId ? `package:${item.packageId}` : item.unitCode,
        price: String(item.purchasePrice),
      })) ?? [emptyRow()],
  );
  const [discount, setDiscount] = useState(String(purchase?.discount ?? 0));
  const [note, setNote] = useState(purchase?.note ?? '');
  const [attachments, setAttachments] = useState((purchase?.attachments ?? []).join('\n'));
  const [error, setError] = useState('');
  const mutations = usePurchaseMutations();
  const ingredients = useIngredients('', location);
  const byId = new Map((ingredients.data ?? []).map((item) => [item.id, item]));
  const editable = can('actions.warehouseReceive') && costs && (!purchase || purchase.status === 'draft');
  const busy =
    mutations.create.isPending ||
    mutations.update.isPending ||
    mutations.complete.isPending ||
    mutations.cancel.isPending ||
    mutations.reverse.isPending;
  const total =
    rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.price || 0), 0) -
    Number(discount || 0);
  const enteredRows = rows.filter((row) => row.ingredientId || row.quantity || row.price);
  function choose(key: string, ingredientId: string) {
    const item = byId.get(ingredientId);
    if (item)
      update(key, {
        ingredientId,
        quantity: '1',
        unit: item.displayUnit,
        price: item.avgCost == null ? '' : String(item.avgCost),
      });
  }
  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  async function save(complete: boolean) {
    if (busy) return;
    if (
      !supplier.trim() ||
      !location ||
      !enteredRows.length ||
      enteredRows.some(
        (r) =>
          !r.ingredientId ||
          !(Number(r.quantity) > 0) ||
          !r.price.trim() ||
          !Number.isFinite(Number(r.price)) ||
          Number(r.price) < 0,
      ) ||
      !Number.isFinite(total) ||
      total < 0
    ) {
      setError(
        'Выберите поставщика, склад и товары. Введите количество и закупочную цену; для бесплатной поставки явно укажите 0.',
      );
      return;
    }
    setError('');
    try {
      const body = {
        warehouseId: location,
        supplier: supplier.trim(),
        supplierId: suppliers.data?.find((s) => s.name === supplier.trim())?.id,
        date: new Date(date).toISOString(),
        note: note.trim(),
        discount: Number(discount || 0),
        attachments: attachments
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        items: enteredRows.map((row) => {
          const item = byId.get(row.ingredientId);
          const packs = item?.purchaseUnits?.length
            ? item.purchaseUnits
            : item?.purchaseUnit && item.purchaseFactor
              ? [{ name: item.purchaseUnit, factor: item.purchaseFactor }]
              : [];
          const globalPackage = row.unit.startsWith('package:') ? row.unit.slice(8) : undefined;
          if (globalPackage)
            return {
              ingredientId: row.ingredientId,
              quantity: Number(row.quantity),
              packageId: globalPackage,
              purchasePrice: Number(row.price),
            };
          const pack = row.unit.startsWith('pack:');
          const factor = pack ? (packs[Number(row.unit.slice(5))]?.factor ?? 1) : 1;
          return {
            ingredientId: row.ingredientId,
            quantity: Number(row.quantity) * factor,
            unit: pack ? item?.displayUnit : row.unit,
            purchasePrice: Number(row.price) / factor,
          };
        }),
      };
      if (purchase) {
        await mutations.update.mutateAsync({ id: purchase.id, ...body, complete });
      } else await mutations.create.mutateAsync({ ...body, complete, requestKey });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  async function reverse() {
    if (!purchase || busy) return;
    const reason = window.prompt('Причина отмены проведения');
    if (!reason?.trim()) return;
    try {
      await mutations.reverse.mutateAsync({ id: purchase.id, note: reason.trim() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <div className="poster-form poster-form--document space-y-6">
      {!costs && (
        <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm">
          Для приёмки товара с закупочными ценами нужен доступ к себестоимости. Обратитесь к владельцу.
        </p>
      )}
      <div className="poster-form-fields space-y-3">
        <DocumentField label="Дата и время поставки">
          {editable ? (
            <div className="w-[250px] max-w-full">
              <DateTimePicker className="input h-9" value={date} onChange={setDate} />
            </div>
          ) : (
            <span className="poster-readonly">{formatDocumentDate(purchase?.date ?? date)}</span>
          )}
        </DocumentField>
        <DocumentField label="Поставщик">
          {editable ? (
            <>
              <input
                className="input w-full"
                list="warehouse-suppliers"
                aria-label="Поставщик"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                disabled={!editable}
              />
              <datalist id="warehouse-suppliers">
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </>
          ) : (
            <span className="poster-readonly">{supplier || '—'}</span>
          )}
        </DocumentField>
        <DocumentField label="Склад">
          {editable ? (
            <Select
              ariaLabel="Склад поставки"
              className="h-10 w-full"
              value={location}
              onChange={setLocation}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
              disabled={!!purchase}
            />
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
              disabled={!editable}
            />
          ) : (
            <span className="poster-readonly whitespace-pre-wrap">{note || '—'}</span>
          )}
        </DocumentField>
      </div>
      <div className="poster-document-table overflow-x-auto">
        <table className="poster-table w-full min-w-[850px] table-fixed text-left text-sm">
          <colgroup>
            <col style={{ width: '29%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '4%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-xs font-normal text-text-muted">
              <th className="pb-3 pr-2 font-normal">Наименование</th>
              <th className="px-2 pb-3 font-normal">Фасовка</th>
              <th className="px-2 pb-3 text-right font-normal">Количество</th>
              <th className="px-2 pb-3 text-right font-normal">{costs ? 'Цена за единицу' : ''}</th>
              <th className="px-2 pb-3 text-right font-normal">{costs ? 'Общая сумма' : ''}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const item = byId.get(row.ingredientId);
              const options = item
                ? unitsForType(item.unitType).map((u) => ({ ...u, value: String(u.value) }))
                : [];
              const packs = item?.purchaseUnits?.length
                ? item.purchaseUnits
                : item?.purchaseUnit && item.purchaseFactor
                  ? [{ name: item.purchaseUnit, factor: item.purchaseFactor }]
                  : [];
              (packages.data ?? [])
                .filter((p) => item && unitsForType(item.unitType).some((u) => u.value === p.unit))
                .forEach((p) =>
                  options.push({
                    value: `package:${p.id}`,
                    label: `${p.name} (${p.quantity} ${unitLabel(p.unit)})`,
                  }),
                );
              const original = purchase?.items?.find((i) => i.id === row.key);
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
                    {editable ? (
                      <DocumentProductPicker
                        value={row.ingredientId}
                        options={ingredients.data ?? []}
                        onChange={(id) => choose(row.key, id)}
                        disabled={!editable}
                        label="Наименование продукта"
                        fallbackName={
                          purchase?.items?.find((entry) => entry.ingredientId === row.ingredientId)
                            ?.ingredientName
                        }
                      />
                    ) : (
                      <span>{item?.name ?? original?.ingredientName ?? 'Продукт'}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {editable ? (
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
                        disabled={!editable || !row.ingredientId}
                        onChange={(unit) => update(row.key, { unit })}
                      />
                    ) : (
                      <span>
                        {options.find((entry) => entry.value === row.unit)?.label ??
                          original?.unit ??
                          row.unit}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {editable ? (
                      <input
                        className="input h-9 w-full text-right"
                        type="number"
                        min="0"
                        step="any"
                        aria-label={`Количество ${item?.name ?? 'продукта'}`}
                        value={row.quantity}
                        disabled={!editable || !row.ingredientId}
                        onChange={(e) => update(row.key, { quantity: e.target.value })}
                      />
                    ) : (
                      <span className="block text-right tabular-nums">
                        {Number(row.quantity).toLocaleString('ru-RU')}
                      </span>
                    )}
                  </td>
                  <td className="relative px-2 py-2">
                    {costs &&
                      (editable ? (
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
                              aria-label={`Цена ${item?.name ?? 'продукта'}`}
                              value={row.price}
                              disabled={!row.ingredientId}
                              onChange={(e) => update(row.key, { price: e.target.value })}
                            />
                            <span className="poster-value-unit__suffix">с</span>
                          </div>
                        </>
                      ) : (
                        <span className="block text-right tabular-nums">{money(Number(row.price))}</span>
                      ))}
                  </td>
                  <td className="relative px-2 py-2">
                    {costs &&
                      (editable ? (
                        <>
                          <span
                            aria-hidden
                            className="absolute -left-1.5 top-1/2 -translate-y-1/2 text-lg text-text-light"
                          >
                            =
                          </span>
                          <div className="poster-value-unit">
                            <output className="input flex h-9 min-w-0 w-full items-center justify-end bg-background/30 tabular-nums">
                              {Number(Number(row.quantity || 0) * Number(row.price || 0)).toLocaleString(
                                'ru-RU',
                                { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                              )}
                            </output>
                            <span className="poster-value-unit__suffix">с</span>
                          </div>
                        </>
                      ) : (
                        <span className="block text-right font-medium tabular-nums">
                          {money(Number(row.quantity || 0) * Number(row.price || 0))}
                        </span>
                      ))}
                  </td>
                  <td className="!px-0 py-2 text-center">
                    {editable && (
                      <button
                        type="button"
                        className="poster-remove"
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
        {editable && (
          <button
            type="button"
            className="py-3 text-sm text-primary"
            onClick={() => setRows((current) => [...current, emptyRow()])}
          >
            + Добавить ещё
          </button>
        )}
      </div>
      {(editable || Number(discount) > 0 || attachments.trim()) && (
        <details className="poster-advanced">
          <summary className="cursor-pointer text-sm font-medium">Скидка и вложения</summary>
          <div className="mt-3 space-y-3">
            <DocumentField label="Скидка поставщика, сом">
              {editable ? (
                <input
                  className="input w-full"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  disabled={!editable}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              ) : (
                <span className="poster-readonly">{money(Number(discount || 0))}</span>
              )}
            </DocumentField>
            <DocumentField label="Ссылки на накладные, по одной на строку">
              {editable ? (
                <textarea
                  className="input w-full"
                  value={attachments}
                  disabled={!editable}
                  onChange={(e) => setAttachments(e.target.value)}
                />
              ) : (
                <span className="poster-readonly whitespace-pre-wrap">{attachments || '—'}</span>
              )}
            </DocumentField>
          </div>
        </details>
      )}
      {(error || ingredients.isError) && (
        <p role="alert" className="text-sm text-danger">
          {error || apiError(ingredients.error)}
        </p>
      )}
      <DocumentFooter total={costs ? `Итого: ${money(total)}` : undefined}>
        {editable ? (
          <>
            <button
              type="button"
              className="btn-primary btn-md"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Сохранить
            </button>
            <button
              type="button"
              className="btn-secondary btn-md"
              disabled={busy}
              onClick={() => void save(false)}
            >
              Сохранить черновик
            </button>
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
            {purchase?.status === 'completed' && can('actions.warehouseReceive') && costs && onReturn && (
              <button
                type="button"
                className="btn-secondary btn-md"
                onClick={() => onReturn(purchase.id, purchase.warehouseId ?? location)}
              >
                Возврат поставщику
              </button>
            )}
            {purchase?.status === 'completed' && can('actions.warehouseApprove') && (
              <button
                type="button"
                className="btn-secondary btn-md"
                disabled={busy}
                onClick={() => void reverse()}
              >
                Отменить проведение
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
