import { useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { DateTimePicker } from '@/components/DatePicker';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { money } from '@/lib/format';
import { qty, useIngredients, type WarehouseLocation } from './api';
import { unitLabel, unitsForType, type UnitCode } from './units';
import {
  useProcessing,
  useProcessingDocument,
  useProcessingMutations,
  type ProcessingDocument,
  type ProcessingRow,
} from './extended-api';
import { DocumentField, DocumentFooter, QueryState } from './WarehouseUi';
import { formatDocumentDate } from './stock-document-format';

export function ProcessingPage({
  warehouseId,
  onOpen,
  onCreate,
}: {
  warehouseId?: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState('');
  const q = useProcessing({ warehouseId, search });
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <input
          className="input h-10 flex-1 sm:max-w-xs"
          placeholder="Поиск переработок"
          aria-label="Поиск переработок"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-primary btn-md ml-auto" onClick={onCreate}>
          + Добавить
        </button>
      </div>
      <QueryState pending={q.isPending} error={q.error} empty={q.isSuccess && !q.data.length}>
        <div className="hidden grid-cols-[150px_1fr_1fr_120px] gap-3 border-b border-border bg-background/50 px-4 py-3 text-xs text-text-muted md:grid">
          <span>Дата</span>
          <span>Исходные продукты</span>
          <span>Полученные продукты</span>
          <span>Статус</span>
        </div>
        {q.data?.map((d) => (
          <button
            key={d.id}
            className="grid w-full gap-2 border-b border-border p-4 text-left text-sm last:border-0 hover:bg-background/50 md:grid-cols-[150px_1fr_1fr_120px] md:gap-3"
            onClick={() => onOpen(d.id)}
          >
            <span className="text-text-muted">{formatDocumentDate(d.date)}</span>
            <span>
              {d.inputs
                .map(
                  (r) => `${r.ingredientName ?? r.name ?? 'Продукт'} · ${qty(r.quantity, unitLabel(r.unit))}`,
                )
                .join(', ')}
            </span>
            <span>
              {d.outputs
                .map(
                  (r) => `${r.ingredientName ?? r.name ?? 'Продукт'} · ${qty(r.quantity, unitLabel(r.unit))}`,
                )
                .join(', ')}
            </span>
            <span>{status(d.status)}</span>
          </button>
        ))}
      </QueryState>
    </div>
  );
}
export function ProcessingModal({
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
  const q = useProcessingDocument(id);
  return (
    <Modal open onClose={onClose} title={id ? 'Переработка' : 'Новая переработка'} panelClassName="max-w-6xl">
      <QueryState pending={!!id && q.isPending} error={q.error}>
        {(!id || q.data) && (
          <ProcessingForm
            key={id ?? 'new'}
            document={q.data}
            warehouseId={warehouseId}
            locations={locations}
            onClose={onClose}
          />
        )}
      </QueryState>
    </Modal>
  );
}
type DraftRow = ProcessingRow & { key: string };
function ProcessingForm({
  document,
  warehouseId,
  locations,
  onClose,
}: {
  document?: ProcessingDocument;
  warehouseId: string;
  locations: WarehouseLocation[];
  onClose: () => void;
}) {
  const ingredients = useIngredients('');
  const mutations = useProcessingMutations();
  const { can } = usePermissions();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(localTime(document?.date));
  const [note, setNote] = useState(document?.note ?? '');
  const [inputs, setInputs] = useState<DraftRow[]>(() =>
    (document?.inputs ?? []).map((r) => ({ ...r, key: crypto.randomUUID() })),
  );
  const [outputs, setOutputs] = useState<DraftRow[]>(() =>
    (document?.outputs ?? []).map((r) => ({ ...r, key: crypto.randomUUID() })),
  );
  const [error, setError] = useState('');
  const editable = (!document || document.status === 'draft') && can('actions.warehouseProduce');
  const busy = mutations.save.isPending || mutations.reverse.isPending;
  async function save(complete: boolean) {
    if (busy) return;
    if (
      !inputs.length ||
      !outputs.length ||
      [...inputs, ...outputs].some((r) => !r.ingredientId || !r.warehouseId || !(r.quantity > 0)) ||
      (complete && Math.abs(outputs.reduce((s, r) => s + (r.costSharePercent ?? 0), 0) - 100) > 0.001)
    ) {
      setError(
        'Добавьте исходные и полученные продукты, положительное количество и склады. Для проведения распределите 100% стоимости между полученными продуктами.',
      );
      return;
    }
    try {
      setError('');
      await mutations.save.mutateAsync({
        id: document?.id,
        revision: document?.revision,
        requestKey,
        complete,
        date: new Date(date).toISOString(),
        note,
        inputs: inputs.map(({ ingredientId, warehouseId, quantity, unit }) => ({
          ingredientId,
          warehouseId,
          quantity,
          unit,
        })),
        outputs: outputs.map(({ ingredientId, warehouseId, quantity, unit, costSharePercent }) => ({
          ingredientId,
          warehouseId,
          quantity,
          unit,
          costSharePercent,
        })),
      });
      onClose();
    } catch (e) {
      setError(apiError(e));
    }
  }
  async function reverse() {
    const reason = prompt('Причина сторнирования переработки');
    if (!document || !reason?.trim()) return;
    try {
      await mutations.reverse.mutateAsync({
        id: document.id,
        revision: document.revision,
        note: reason.trim(),
      });
      onClose();
    } catch (e) {
      setError(apiError(e));
    }
  }
  const renderRows = (rows: DraftRow[], setRows: (rows: DraftRow[]) => void, output: boolean) => (
    <section className="rounded-xl border border-border">
      <h3 className="border-b border-border px-4 py-3 font-semibold">
        {output ? 'Полученные продукты' : 'Исходные продукты'}
      </h3>
      <div className="hidden grid-cols-[minmax(160px,1.5fr)_minmax(120px,1fr)_85px_70px_85px_85px_85px_28px] gap-2 px-4 py-3 text-xs text-text-muted lg:grid">
        <span>Продукт</span>
        <span>Склад</span>
        <span>Количество</span>
        <span>Единица</span>
        <span>Себестоимость</span>
        <span>Доля стоимости</span>
        <span>Сумма</span>
        <span />
      </div>
      {rows.map((r) => {
        const ingredient = ingredients.data?.find((i) => i.id === r.ingredientId);
        const change = (patch: Partial<DraftRow>) =>
          setRows(rows.map((v) => (v.key === r.key ? { ...v, ...patch } : v)));
        return (
          <div
            key={r.key}
            className="grid gap-2 border-t border-border px-4 py-3 sm:grid-cols-2 lg:grid-cols-[minmax(160px,1.5fr)_minmax(120px,1fr)_85px_70px_85px_85px_85px_28px] lg:items-center"
          >
            <ProcessingCell label="Продукт">
              <Select
                ariaLabel="Продукт переработки"
                disabled={!editable}
                className="h-10 w-full"
                value={r.ingredientId}
                onChange={(v) => {
                  const selected = ingredients.data?.find((i) => i.id === v);
                  change({
                    ingredientId: v,
                    unit: selected?.displayUnit ?? 'kg',
                    unitCost: undefined,
                    lineCost: undefined,
                  });
                }}
                options={[
                  { value: '', label: 'Выберите продукт' },
                  ...(ingredients.data ?? []).map((i) => ({ value: i.id, label: i.name })),
                ]}
              />
            </ProcessingCell>
            <ProcessingCell label="Склад">
              <Select
                ariaLabel="Склад продукта"
                disabled={!editable}
                className="h-10 w-full"
                value={r.warehouseId}
                onChange={(v) => change({ warehouseId: v })}
                options={locations.map((l) => ({ value: l.id, label: l.name }))}
              />
            </ProcessingCell>
            <ProcessingCell label="Количество">
              <input
                className="input h-10"
                type="number"
                min="0"
                step="any"
                aria-label="Количество продукта"
                disabled={!editable}
                value={r.quantity || ''}
                onChange={(e) =>
                  change({ quantity: Number(e.target.value), unitCost: undefined, lineCost: undefined })
                }
              />
            </ProcessingCell>
            <ProcessingCell label="Единица">
              <Select
                ariaLabel="Единица количества"
                disabled={!editable}
                className="h-10 w-full"
                value={r.unit}
                onChange={(v) => change({ unit: v as UnitCode })}
                options={unitsForType(ingredient?.unitType ?? 'mass')}
              />
            </ProcessingCell>
            <ProcessingCell label="Себестоимость">
              <span className="text-sm text-text-secondary">
                {r.unitCost == null ? (editable ? 'По остатку' : 'Неизвестно') : money(r.unitCost)}
              </span>
            </ProcessingCell>
            <ProcessingCell label="Доля стоимости">
              {output ? (
                <label className="flex items-center gap-1 text-sm">
                  <input
                    className="input h-10"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    aria-label="Доля себестоимости"
                    disabled={!editable}
                    value={r.costSharePercent ?? ''}
                    onChange={(e) => change({ costSharePercent: Number(e.target.value) })}
                  />
                  %
                </label>
              ) : (
                <span className="text-sm">{r.costSharePercent == null ? '—' : `${r.costSharePercent}%`}</span>
              )}
            </ProcessingCell>
            <ProcessingCell label="Сумма">
              <span className="text-sm">{r.lineCost == null ? '—' : money(r.lineCost)}</span>
            </ProcessingCell>
            {editable && (
              <button
                className="text-text-muted hover:text-danger"
                aria-label="Удалить строку"
                onClick={() => setRows(rows.filter((v) => v.key !== r.key))}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      {editable && (
        <button
          className="px-4 py-3 text-sm text-primary"
          onClick={() =>
            setRows([
              ...rows,
              {
                key: crypto.randomUUID(),
                ingredientId: '',
                warehouseId,
                unit: 'kg',
                quantity: 0,
                ...(output ? { costSharePercent: rows.length ? 0 : 100 } : {}),
              },
            ])
          }
        >
          + Добавить продукт
        </button>
      )}
    </section>
  );
  return (
    <div className="space-y-4">
      <div className="space-y-3 py-2">
        <DocumentField label="Дата и время">
          <DateTimePicker className="input" value={date} onChange={setDate} disabled={!editable} />
        </DocumentField>
        <DocumentField label="Комментарий">
          <textarea
            className="input h-20 py-2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={!editable}
          />
        </DocumentField>
      </div>
      {renderRows(inputs, setInputs, false)}
      {renderRows(outputs, setOutputs, true)}
      <p className="text-xs text-text-muted">
        Стоимость исходных продуктов определяется по выбранным складам при проведении. Распределите её между
        полученными продуктами.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <DocumentFooter
        total={
          document
            ? document.totalCost != null
              ? `Итого: ${money(document.totalCost)}`
              : 'Итого: стоимость неизвестна'
            : undefined
        }
      >
        {editable ? (
          <>
            <button className="btn-primary btn-md" disabled={busy} onClick={() => void save(true)}>
              Провести
            </button>
            <button className="btn-secondary btn-md" disabled={busy} onClick={() => void save(false)}>
              Сохранить черновик
            </button>
          </>
        ) : (
          <>
            <span className="self-center text-sm">{status(document?.status ?? 'draft')}</span>
            {document?.status === 'posted' && can('actions.warehouseApprove') && (
              <button className="btn-secondary btn-md" disabled={busy} onClick={() => void reverse()}>
                Сторнировать
              </button>
            )}
          </>
        )}
        <button className="btn-ghost btn-md" onClick={onClose}>
          Закрыть
        </button>
      </DocumentFooter>
    </div>
  );
}
function status(value: string) {
  return value === 'posted' ? 'Проведена' : value === 'reversed' ? 'Сторнирована' : 'Черновик';
}
function localTime(value?: string) {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function ProcessingCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block text-xs text-text-muted lg:hidden">{label}</span>
      {children}
    </div>
  );
}
