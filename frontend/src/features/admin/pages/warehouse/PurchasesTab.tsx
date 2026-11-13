import { useState } from 'react';
import { DateTimePicker } from '@/components/DatePicker';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { money } from '@/lib/format';
import { useSuppliers } from './settings-api';
import { usePackages } from './extended-api';
import { DocumentField, DocumentFooter } from './WarehouseUi';
import { ItemCard, Field } from './ItemCard';
import {
  useIngredients,
  usePurchase,
  usePurchaseMutations,
  purchaseNumber,
  type Ingredient,
  type Purchase,
  type WarehouseLocation,
} from './api';
import { unitsForType, unitLabel, type UnitCode } from './units';

export function PurchaseModal({
  id,
  warehouseId,
  locations,
  onClose,
}: {
  id?: string;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
}) {
  const query = usePurchase(id ?? null);
  return (
    <Modal
      open
      onClose={onClose}
      title={query.data ? `Поставка ${purchaseNumber(query.data.number)}` : 'Новая поставка'}
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
        />
      )}
    </Modal>
  );
}

type Row = { key: string; ingredientId: string; quantity: string; unit: string; price: string };
function PurchaseForm({
  purchase,
  warehouseId,
  locations,
  onClose,
}: {
  purchase?: Purchase;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
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
      })) ?? [],
  );
  const [discount, setDiscount] = useState(String(purchase?.discount ?? 0));
  const [note, setNote] = useState(purchase?.note ?? '');
  const [attachments, setAttachments] = useState((purchase?.attachments ?? []).join('\n'));
  const [search, setSearch] = useState('');
  const [creatingItem, setCreatingItem] = useState(false);
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
  function add(item: Ingredient) {
    setRows((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        ingredientId: item.id,
        quantity: '1',
        unit: item.displayUnit,
        price: item.avgCost == null ? '' : String(item.avgCost),
      },
    ]);
    setSearch('');
  }
  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }
  async function save(complete: boolean) {
    if (busy) return;
    if (
      !supplier.trim() ||
      !location ||
      !rows.length ||
      rows.some(
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
        items: rows.map((row) => {
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
        await mutations.update.mutateAsync({ id: purchase.id, ...body });
        if (complete) await mutations.complete.mutateAsync(purchase.id);
      } else await mutations.create.mutateAsync({ ...body, complete, requestKey });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  async function reverse() {
    if (!purchase || busy) return;
    const reason = window.prompt('Причина сторнирования прихода');
    if (!reason?.trim()) return;
    try {
      await mutations.reverse.mutateAsync({ id: purchase.id, note: reason.trim() });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  const matches = (ingredients.data ?? []).filter(
    (item) =>
      !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.barcode?.includes(search),
  );
  return (
    <div className="space-y-4">
      {!costs && (
        <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm">
          Для приёмки товара с закупочными ценами нужен доступ к себестоимости. Обратитесь к владельцу.
        </p>
      )}
      <div className="space-y-3 py-2">
        <DocumentField label="Дата и время">
          <DateTimePicker
            className="input h-10 w-full"
            value={date}
            onChange={setDate}
            disabled={!editable}
          />
        </DocumentField>
        <DocumentField label="Поставщик">
          <input
            className="input w-full"
            list="warehouse-suppliers"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            disabled={!editable}
          />
          <datalist id="warehouse-suppliers">
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </DocumentField>
        <DocumentField label="Склад">
          <Select
            ariaLabel="Склад поставки"
            className="h-10 w-full"
            value={location}
            onChange={setLocation}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            disabled={!!purchase}
          />
        </DocumentField>
        <DocumentField label="Комментарий">
          <textarea
            className="input min-h-20 w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!editable}
          />
        </DocumentField>
      </div>
      {editable && (
        <div className="rounded-xl border border-border p-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="input h-10 min-w-40 flex-1"
              aria-label="Поиск или сканирование штрихкода"
              placeholder="Найти товар или отсканировать штрихкод"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const exact = (ingredients.data ?? []).find((i) => i.barcode === search);
                  if (exact) add(exact);
                }
              }}
            />
            <button type="button" className="btn-secondary btn-md" onClick={() => setCreatingItem(true)}>
              + Новый товар
            </button>
          </div>
          <Select
            ariaLabel="Добавить товар в приход"
            className="mt-2 h-10 w-full"
            value=""
            placeholder="Добавить товар"
            options={matches.map((item) => ({ value: item.id, label: `${item.name} · ${item.unit}` }))}
            onChange={(id) => {
              const item = byId.get(id);
              if (item) add(item);
            }}
          />
        </div>
      )}
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
          options.push({ value: row.unit, label: original?.packageName ?? original?.unit ?? row.unit });
        packs.forEach((pack, index) =>
          options.push({ value: `pack:${index}`, label: `${pack.name} (${pack.factor} ${item?.unit})` }),
        );
        return (
          <div
            key={row.key}
            className="grid gap-2 rounded-xl border border-border p-3 lg:grid-cols-[1.5fr_1.1fr_0.7fr_0.8fr_0.7fr_auto] sm:items-end"
          >
            <div className="text-sm font-medium">
              {item?.name ??
                purchase?.items?.find((i) => i.ingredientId === row.ingredientId)?.ingredientName}
            </div>
            <Field label="Фасовка">
              <Select
                ariaLabel="Единица закупки"
                className="h-10 w-full"
                value={row.unit}
                options={
                  options.length ? options : [{ value: row.unit, label: unitLabel(row.unit as UnitCode) }]
                }
                disabled={!editable}
                onChange={(unit) => update(row.key, { unit })}
              />
            </Field>
            <Field label="Количество">
              <input
                className="input h-10 w-full"
                type="number"
                min="0"
                step="any"
                value={row.quantity}
                disabled={!editable}
                onChange={(e) => update(row.key, { quantity: e.target.value })}
              />
            </Field>
            {costs && (
              <Field label="Цена за единицу, сом">
                <input
                  className="input h-10 w-full"
                  type="number"
                  min="0"
                  step="any"
                  value={row.price}
                  disabled={!editable}
                  onChange={(e) => update(row.key, { price: e.target.value })}
                />
              </Field>
            )}
            {costs && (
              <div className="text-sm">
                <span className="block text-xs text-text-muted">Сумма</span>
                <strong>{money(Number(row.quantity || 0) * Number(row.price || 0))}</strong>
              </div>
            )}
            {editable && (
              <button
                type="button"
                className="btn-secondary btn-md"
                aria-label={`Убрать ${item?.name ?? 'товар'}`}
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
              >
                Убрать
              </button>
            )}
          </div>
        );
      })}
      {!rows.length && (
        <p className="text-sm text-text-muted">
          Добавьте товары: количество и цена сразу покажут итог прихода.
        </p>
      )}
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Скидка и вложения</summary>
        <div className="mt-3 space-y-3">
          <Field label="Скидка поставщика, сом">
            <input
              className="input w-full"
              type="number"
              min="0"
              step="0.01"
              value={discount}
              disabled={!editable}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </Field>
          <Field label="Ссылки на накладные, по одной на строку">
            <textarea
              className="input w-full"
              value={attachments}
              disabled={!editable}
              onChange={(e) => setAttachments(e.target.value)}
            />
          </Field>
        </div>
      </details>
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
              className="btn-secondary btn-md"
              disabled={busy}
              onClick={() => void save(false)}
            >
              Сохранить черновик
            </button>
            <button
              type="button"
              className="btn-primary btn-md"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Провести приход
            </button>
          </>
        ) : (
          <>
            <span className="mr-auto text-sm text-text-muted">
              {purchase?.status === 'cancelled'
                ? 'Приход сторнирован'
                : 'Проведённый приход сохранён в истории'}
            </span>
            {purchase?.status === 'completed' && can('actions.warehouseApprove') && (
              <button
                type="button"
                className="btn-secondary btn-md"
                disabled={busy}
                onClick={() => void reverse()}
              >
                Сторнировать
              </button>
            )}
          </>
        )}
      </DocumentFooter>
      {creatingItem && <ItemCard onClose={() => setCreatingItem(false)} onSaved={add} />}
    </div>
  );
}

function localTime(value?: string) {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
