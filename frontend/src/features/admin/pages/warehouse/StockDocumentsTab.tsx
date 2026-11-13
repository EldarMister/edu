import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { usePurchases, useIngredients, type WarehouseLocation } from './api';
import {
  useStockDocumentMutations,
  type StockDocumentKind,
  type InventoryMode,
  type WriteoffReason,
} from './stock-documents-api';
import { WRITEOFF_REASONS } from './stock-document-format';
import { DocumentField, DocumentFooter } from './WarehouseUi';
export function StartDocumentModal({
  kind,
  warehouseId,
  locations,
  onClose,
  onCreated,
}: {
  kind: StockDocumentKind;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [location, setLocation] = useState(warehouseId);
  const [destination, setDestination] = useState('');
  const [source, setSource] = useState('');
  const [mode, setMode] = useState<InventoryMode>('full');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<WriteoffReason | ''>('');
  const [rows, setRows] = useState<{ id: string; quantity: string }[]>([]);
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
  const unknown = rows.some((r) => ingredients.data?.find((i) => i.id === r.id)?.avgCost == null);
  const total = rows.reduce(
    (sum, r) => sum + Number(r.quantity || 0) * (ingredients.data?.find((i) => i.id === r.id)?.avgCost ?? 0),
    0,
  );
  async function submit(post: boolean) {
    if (busy) return;
    setError('');
    if (
      !inventory &&
      (!rows.length ||
        rows.some((r) => !(Number(r.quantity) > 0)) ||
        (kind === 'writeoff' && (!reason || (reason === 'other' && !note.trim()))))
    ) {
      setError('Добавьте товары, количество и причину операции.');
      return;
    }
    try {
      let doc = await mutations.create.mutateAsync({
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
          : rows.map((r) => ({ ingredientId: r.id, quantity: Number(r.quantity) })),
      });
      if (post && !inventory) {
        if (doc.status === 'draft')
          doc = await mutations.transition.mutateAsync({
            id: doc.id,
            action: 'submit',
            revision: doc.revision,
          });
        if (canPost && doc.status === 'submitted')
          doc = await mutations.transition.mutateAsync({
            id: doc.id,
            action: 'approve',
            revision: doc.revision,
          });
      }
      onCreated(doc.id);
    } catch (e) {
      setError(apiError(e));
    }
  }
  return (
    <Modal open title={title} onClose={onClose} panelClassName={inventory ? 'max-w-2xl' : 'max-w-4xl'}>
      <div className="space-y-4">
        <div className="space-y-3">
          <DocumentField label="Дата операции">
            <span className="text-sm">На момент проведения</span>
          </DocumentField>
          <DocumentField label={kind === 'transfer' ? 'Со склада' : 'Склад'}>
            <Select
              className="h-10 w-full"
              ariaLabel="Склад документа"
              value={location}
              onChange={(v) => {
                setLocation(v);
                setDestination('');
                setSource('');
                setRows([]);
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
                onChange={setSource}
                options={(purchases.data ?? []).map((p) => ({
                  value: p.id,
                  label: `№${p.number} · ${p.supplier} · ${p.date.slice(0, 10)}`,
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
              <Select
                className="h-10 w-full"
                ariaLabel="Тип инвентаризации"
                value={mode}
                onChange={(v) => setMode(v as InventoryMode)}
                options={[
                  { value: 'full', label: 'Полная — все позиции склада' },
                  { value: 'partial', label: 'Частичная — выбранные позиции' },
                ]}
              />
            </DocumentField>
          )}
          <DocumentField label="Комментарий">
            <textarea className="input h-20 w-full" value={note} onChange={(e) => setNote(e.target.value)} />
          </DocumentField>
        </div>
        {inventory ? (
          <p className="text-sm text-text-muted">
            Начало подсчёта фиксирует учётный остаток сейчас. Затем внесите фактическое количество. Пустое
            поле означает «не посчитано». Продажи во время подсчёта учитываются автоматически.
          </p>
        ) : (
          <div className="rounded-xl border border-border">
            <div className="hidden grid-cols-[2fr_1fr_1fr_auto] gap-3 border-b border-border bg-background/40 p-3 text-xs text-text-muted sm:grid">
              <span>Название</span>
              <span>Количество</span>
              <span>{costs ? 'Сумма' : ''}</span>
              <span />
            </div>
            {rows.map((r) => {
              const item = ingredients.data?.find((i) => i.id === r.id);
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border p-3 sm:grid-cols-[2fr_1fr_1fr_auto]"
                >
                  <span className="text-sm font-medium">{item?.name}</span>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      className="input h-10 w-24"
                      type="number"
                      min="0"
                      step="any"
                      aria-label={`Количество ${item?.name}`}
                      value={r.quantity}
                      onChange={(e) =>
                        setRows((v) => v.map((x) => (x.id === r.id ? { ...x, quantity: e.target.value } : x)))
                      }
                    />
                    {item?.unit}
                  </label>
                  <span className="text-sm">
                    {costs
                      ? item?.avgCost == null
                        ? 'Неизвестно'
                        : money(Number(r.quantity || 0) * item.avgCost)
                      : ''}
                  </span>
                  <button
                    className="btn-ghost btn-md"
                    aria-label={`Удалить ${item?.name}`}
                    onClick={() => setRows((v) => v.filter((x) => x.id !== r.id))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <div className="p-3">
              <Select
                className="h-10 w-full sm:max-w-sm"
                ariaLabel="Добавить продукт"
                value=""
                placeholder="+ Добавить продукт"
                options={(ingredients.data ?? [])
                  .filter((i) => !rows.some((r) => r.id === i.id))
                  .map((i) => ({ value: i.id, label: i.name }))}
                onChange={(id) => setRows((v) => [...v, { id, quantity: '' }])}
              />
            </div>
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
            {inventory ? 'Начать подсчёт' : canPost ? 'Провести' : 'Отправить на утверждение'}
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
    </Modal>
  );
}
