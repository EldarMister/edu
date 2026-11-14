import { useState } from 'react';
import { EditorPage } from './EditorPage';
import { DocumentProductPicker } from './DocumentProductPicker';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { usePurchases, usePurchase, useIngredients, type WarehouseLocation } from './api';
import {
  useStockDocumentMutations,
  type StockDocumentKind,
  type InventoryMode,
  type WriteoffReason,
} from './stock-documents-api';
import { formatDocumentDate, WRITEOFF_REASONS } from './stock-document-format';
import { DocumentField, DocumentFooter } from './WarehouseUi';
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
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<WriteoffReason | ''>('');
  const [rows, setRows] = useState<DraftRow[]>(() => [emptyRow()]);
  const [error, setError] = useState('');
  const [requestKey] = useState(() => crypto.randomUUID());
  const mutations = useStockDocumentMutations();
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
  const sourceItems = new Set(sourcePurchase.data?.items?.map((item) => item.ingredientId));
  const busy = mutations.create.isPending || mutations.transition.isPending;
  const inventory = kind === 'inventory';
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
    (item) => item.preparationMode !== 'virtual' && (kind !== 'supplier_return' || sourceItems.has(item.id)),
  );
  const unknown = enteredRows.some((r) => ingredients.data?.find((i) => i.id === r.id)?.avgCost == null);
  const total = rows.reduce(
    (sum, r) => sum + Number(r.quantity || 0) * (ingredients.data?.find((i) => i.id === r.id)?.avgCost ?? 0),
    0,
  );
  async function submit(post: boolean) {
    if (busy) return;
    setError('');
    if (
      !inventory &&
      (!enteredRows.length ||
        enteredRows.some((r) => !r.id || !(Number(r.quantity) > 0)) ||
        (kind === 'writeoff' && (!reason || (reason === 'other' && !note.trim()))))
    ) {
      setError('Добавьте товары, количество и причину операции.');
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
        items: inventory
          ? undefined
          : enteredRows.map((r) => ({ ingredientId: r.id, quantity: Number(r.quantity) })),
      });
      onCreated(doc.id);
    } catch (e) {
      setError(apiError(e));
    }
  }
  return (
    <EditorPage open title={title} onClose={onClose} panelClassName={inventory ? 'max-w-2xl' : 'max-w-4xl'}>
      <div className="poster-form poster-form--document space-y-6">
        <div className="space-y-3">
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
              <span className="flex h-9 items-center text-sm">На момент проведения</span>
            </DocumentField>
          )}
          <DocumentField label={kind === 'transfer' ? 'Со склада' : 'Склад'}>
            <Select
              className="h-10 w-full"
              ariaLabel="Склад документа"
              value={location}
              onChange={(v) => {
                setLocation(v);
                setDestination('');
                setSource('');
                setRows([emptyRow()]);
              }}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />
          </DocumentField>
          {kind === 'transfer' && (
            <DocumentField label="На склад">
              <Select
                className="h-10 w-full"
                ariaLabel="Склад получатель"
                value={destination}
                onChange={setDestination}
                options={locations
                  .filter((l) => l.id !== location)
                  .map((l) => ({ value: l.id, label: l.name }))}
              />
            </DocumentField>
          )}
          {kind === 'supplier_return' && (
            <DocumentField label="Исходная поставка">
              <Select
                className="h-10 w-full"
                ariaLabel="Исходная поставка"
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
            </DocumentField>
          )}
          {kind === 'writeoff' && (
            <DocumentField label="Причина">
              <Select
                className="h-10 w-full"
                ariaLabel="Причина списания"
                value={reason}
                onChange={(v) => setReason(v as WriteoffReason)}
                options={WRITEOFF_REASONS}
              />
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
                  ? 'Все позиции выбранного склада.'
                  : 'Выберите продукты на странице подсчёта.'}
              </p>
            </DocumentField>
          )}
          <DocumentField label="Комментарий">
            <textarea className="input h-14 w-full" value={note} onChange={(e) => setNote(e.target.value)} />
          </DocumentField>
        </div>
        {inventory ? (
          <p className="max-w-3xl text-sm text-text-muted">
            Начните подсчёт и внесите фактические остатки. Пустое поле означает «не посчитано». Для
            отсутствующего товара укажите 0.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="poster-table w-full min-w-[650px] table-fixed text-sm">
              <colgroup>
                <col style={{ width: kind === 'writeoff' ? '44%' : '60%' }} />
                <col style={{ width: '20%' }} />
                {kind === 'writeoff' && <col style={{ width: '16%' }} />}
                <col style={{ width: '16%' }} />
                <col style={{ width: '4%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-xs font-normal text-text-muted">
                  <th className="py-3 pr-3 font-normal">Наименование</th>
                  <th className="px-3 py-3 text-right font-normal">Количество</th>
                  {kind === 'writeoff' && <th className="px-3 py-3 font-normal">Единица</th>}
                  <th className="px-3 py-3 text-right font-normal">{costs ? 'Сумма' : ''}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const item = ingredients.data?.find((i) => i.id === r.id);
                  return (
                    <tr key={r.key} className="border-b border-border">
                      <td className="py-2 pr-3">
                        <DocumentProductPicker
                          label="Продукт документа"
                          value={r.id}
                          options={products.filter(
                            (candidate) =>
                              candidate.id === r.id || !rows.some((other) => other.id === candidate.id),
                          )}
                          onChange={(id) =>
                            setRows((current) =>
                              current.map((row) => (row.key === r.key ? { ...row, id } : row)),
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <label className="poster-number-unit flex items-center gap-2">
                          <input
                            className="input h-9 min-w-0 w-full text-right"
                            type="number"
                            min="0"
                            step="any"
                            disabled={!r.id}
                            aria-label={`Количество ${item?.name ?? 'продукта'}`}
                            value={r.quantity}
                            onChange={(e) =>
                              setRows((current) =>
                                current.map((row) =>
                                  row.key === r.key ? { ...row, quantity: e.target.value } : row,
                                ),
                              )
                            }
                          />
                          {kind !== 'writeoff' && (
                            <span className="whitespace-nowrap text-text-muted">{item?.unit}</span>
                          )}
                        </label>
                      </td>
                      {kind === 'writeoff' && (
                        <td className="px-3 py-2 text-text-secondary">{item?.unit ?? '—'}</td>
                      )}
                      <td className="px-3 py-2 text-right">
                        {costs
                          ? !r.id
                            ? money(0)
                            : item?.avgCost == null
                              ? '—'
                              : money(Number(r.quantity || 0) * item.avgCost)
                          : ''}
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          className="btn-ghost h-8 w-8 text-text-muted hover:text-danger"
                          aria-label={`Удалить ${item?.name ?? 'строку'}`}
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
            <button
              type="button"
              className="py-3 text-sm text-primary"
              onClick={() => setRows((current) => [...current, emptyRow()])}
            >
              + Добавить
            </button>
          </div>
        )}
        {(error || ingredients.isError || purchases.isError) && (
          <p role="alert" className="text-danger text-sm">
            {error || apiError(ingredients.error ?? purchases.error)}
          </p>
        )}
        <DocumentFooter
          total={
            !inventory && costs
              ? unknown
                ? 'Итого: стоимость неполная'
                : `Итого: ${money(total)}`
              : undefined
          }
        >
          <button
            className="btn-primary btn-md"
            disabled={
              busy ||
              !location ||
              (kind === 'transfer' && !destination) ||
              (kind === 'supplier_return' && !source)
            }
            onClick={() => void submit(true)}
          >
            {inventory ? 'Начать подсчёт' : canPost ? 'Сохранить' : 'Отправить на утверждение'}
          </button>
          {!inventory && (
            <button className="btn-secondary btn-md" disabled={busy} onClick={() => void submit(false)}>
              Сохранить черновик
            </button>
          )}
          <button className="btn-ghost btn-md" onClick={onClose}>
            Отмена
          </button>
        </DocumentFooter>
      </div>
    </EditorPage>
  );
}
