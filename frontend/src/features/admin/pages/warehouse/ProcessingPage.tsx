import { useState, type ReactNode } from 'react';
import { EditorPage, useEditorDirty } from './EditorPage';
import { DocumentProductPicker } from './DocumentProductPicker';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { formatDocumentListDate } from './WarehouseDocumentLists';
import { usePageFilter } from './workspace-route';
import { Select } from '@/components/Select';
import { DateTimePicker } from '@/components/DatePicker';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import { qty, useIngredients, type WarehouseLocation } from './api';
import { ALL_UNITS, unitLabel, unitsForType, type UnitCode } from './units';
import {
  useProcessing,
  useProcessingDocument,
  useProcessingMutations,
  type ProcessingDocument,
  type ProcessingRow,
} from './extended-api';
import { DocumentField, DocumentFooter, QueryState } from './WarehouseUi';
import { useListPeriod } from './ListPeriodFilter';
import { balanceMoney, balanceQuantity } from './balance-format';
import { inventoryLocalTime, inventoryTimeDisplay, inventoryTimingValue } from './inventory-time';

export function ProcessingPage({
  warehouseId,
  filters,
  onOpen,
  onCreate,
}: {
  warehouseId?: string;
  filters?: ReactNode;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = usePageFilter('processingSearch');
  const period = useListPeriod('processing', 'month');
  const { can } = usePermissions();
  const q = useProcessing({ warehouseId, search, from: period.range.dateFrom, to: period.range.dateTo });
  const documents = q.data ?? [];
  return (
    <div className="poster-register-surface min-w-0">
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск переработок" value={search} onChange={setSearch} />
        {period.filter}
        {filters}
        {can('actions.warehouseProduce') && <button type="button" className="btn-primary btn-md ml-auto" onClick={onCreate}>Добавить</button>}
      </div>
      <QueryState pending={q.isPending} error={q.error}>
        <div className="overflow-x-auto">
          <table className="poster-table poster-register-table w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Исходные продукты</th>
                <th>Полученные продукты</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!documents.length && (
                <tr>
                  <td colSpan={4}>
                    <div className="poster-list-empty">
                      <svg aria-hidden viewBox="0 0 40 40" fill="none">
                        <path d="M11 11h18l6 16v6H5v-6l6-16Z" stroke="currentColor" strokeWidth="2.5" />
                        <path d="M6 26h8l3 5h6l3-5h8" stroke="currentColor" strokeWidth="2.5" />
                      </svg>
                      <h3>{search || period.active ? 'Ничего не найдено' : 'Здесь будут переработки'}</h3>
                      <p>
                        {search || period.active
                          ? 'Попробуйте изменить поиск или период.'
                          : 'Нажмите «Добавить», чтобы создать первую переработку.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap">
                    <button
                      className="text-primary"
                      onClick={() => onOpen(d.id)}
                      title={inventoryTimeDisplay(d.date)}
                    >
                      {formatDocumentListDate(d.date)}
                    </button>
                    {d.status !== 'posted' && (
                      <div className="mt-1">
                        <span className="document-status" data-status={d.status}>
                          {status(d.status)}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {d.inputs
                      .map(
                        (r) =>
                          `${r.ingredientName ?? r.name ?? 'Продукт'} · ${qty(r.quantity, unitLabel(r.unit))}`,
                      )
                      .join(', ')}
                  </td>
                  <td>
                    {d.outputs
                      .map(
                        (r) =>
                          `${r.ingredientName ?? r.name ?? 'Продукт'} · ${qty(r.quantity, unitLabel(r.unit))}`,
                      )
                      .join(', ')}
                  </td>
                  <td>
                    <div className="poster-row-actions">
                      <button onClick={() => onOpen(d.id)}>
                        {d.status === 'draft' ? 'Ред.' : 'Открыть'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    <EditorPage
      open
      onClose={onClose}
      title={id ? 'Переработка' : 'Новая переработка'}
      panelClassName="max-w-6xl"
    >
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
    </EditorPage>
  );
}
type DraftRow = ProcessingRow & { key: string };
function processingValues(date: string, note: string, inputs: ProcessingRow[], outputs: ProcessingRow[]) {
  const lines = (rows: ProcessingRow[]) => rows.filter((row) => row.ingredientId || row.quantity)
    .map(({ ingredientId, warehouseId, quantity, unit, costSharePercent }) => ({ ingredientId, warehouseId, quantity, unit, costSharePercent }));
  return JSON.stringify({ date, note: note.trim(), inputs: lines(inputs), outputs: lines(outputs) });
}
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
  const push = useNotifications((state) => state.push);
  const { can } = usePermissions();
  const [requestKey] = useState(() => crypto.randomUUID());
  const [date, setDate] = useState(inventoryLocalTime(document?.date));
  const [dateValid, setDateValid] = useState(true);
  const [note, setNote] = useState(document?.note ?? '');
  const emptyRow = (output: boolean): DraftRow => ({
    key: crypto.randomUUID(),
    ingredientId: '',
    warehouseId,
    quantity: 0,
    unit: 'kg',
    ...(output ? { costSharePercent: 100 } : {}),
  });
  const [inputs, setInputs] = useState<DraftRow[]>(() =>
    document?.inputs.length
      ? document.inputs.map((r) => ({ ...r, key: crypto.randomUUID() }))
      : [emptyRow(false)],
  );
  const [outputs, setOutputs] = useState<DraftRow[]>(() =>
    document?.outputs.length
      ? document.outputs.map((r) => ({ ...r, key: crypto.randomUUID() }))
      : [emptyRow(true)],
  );
  const [error, setError] = useState('');
  const [rowsChanged, setRowsChanged] = useState(false);
  const editable = (!document || document.status === 'draft') && can('actions.warehouseProduce');
  const signature = processingValues(date, note, inputs, outputs);
  const [savedValues, setSavedValues] = useState(signature);
  const { markSaved } = useEditorDirty(editable && (!dateValid || signature !== savedValues));
  const busy = mutations.save.isPending || mutations.reverse.isPending;
  const enteredInputs = inputs.filter((row) => row.ingredientId || row.quantity);
  const enteredOutputs = outputs.filter((row) => row.ingredientId || row.quantity);
  const allocatedPercent = enteredOutputs.reduce((sum, row) => sum + Math.round((row.costSharePercent ?? 0) * 10000), 0) / 10000;
  async function save(complete: boolean) {
    if (busy || !editable || !dateValid) return;
    const documentDate = inventoryTimingValue({ mode: 'past', local: date }, document?.date);
    if (!documentDate) {
      setError('Укажите дату и время переработки.');
      return;
    }
    if (complete && Date.parse(documentDate) > Date.now()) {
      setError('Дата и время переработки не могут быть в будущем. Сохраните черновик или измените дату.');
      return;
    }
    for (const [label, rows] of [['Исходные продукты', inputs], ['Полученные продукты', outputs]] as const) {
      const invalidIndex = rows.findIndex((row) => (row.ingredientId || row.quantity) &&
        (!row.ingredientId || !row.warehouseId || !Number.isFinite(row.quantity) || row.quantity <= 0));
      if (invalidIndex >= 0) {
        const row = rows[invalidIndex];
        setError(`${label}, строка ${invalidIndex + 1}: ${!row.ingredientId ? 'выберите продукт' : !row.warehouseId ? 'выберите склад' : 'укажите количество больше нуля'}.`);
        return;
      }
      const keys = rows.filter((row) => row.ingredientId).map((row) => `${row.ingredientId}:${row.warehouseId}`);
      if (new Set(keys).size !== keys.length) {
        setError(`${label}: объедините одинаковые продукты одного склада в одну строку.`);
        return;
      }
    }
    if (enteredOutputs.some((row) => !Number.isFinite(row.costSharePercent ?? 0) || (row.costSharePercent ?? 0) < 0 || (row.costSharePercent ?? 0) > 100)) {
      setError('Доля себестоимости каждого полученного продукта должна быть от 0 до 100%.');
      return;
    }
    if (complete && (!enteredInputs.length || !enteredOutputs.length)) {
      setError(!enteredInputs.length ? 'Добавьте исходный продукт.' : 'Добавьте полученный продукт.');
      return;
    }
    if (complete && allocatedPercent !== 100) {
      setError(`Распределите 100% себестоимости между полученными продуктами. Сейчас: ${allocatedPercent.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}%.`);
      return;
    }
    try {
      setError('');
      await mutations.save.mutateAsync({
        id: document?.id,
        revision: document?.revision,
        requestKey,
        complete,
        date: documentDate,
        note,
        inputs: enteredInputs.map(({ ingredientId, warehouseId, quantity, unit }) => ({
          ingredientId,
          warehouseId,
          quantity,
          unit,
        })),
        outputs: enteredOutputs.map(({ ingredientId, warehouseId, quantity, unit, costSharePercent }) => ({
          ingredientId,
          warehouseId,
          quantity,
          unit,
          costSharePercent,
        })),
      });
      setSavedValues(signature);
      setRowsChanged(false);
      markSaved();
      push({ message: complete ? 'Переработка проведена' : 'Черновик переработки сохранён', at: new Date().toISOString() });
      onClose();
    } catch (e) {
      setError(apiError(e));
    }
  }
  async function reverse() {
    const reason = prompt('Причина отмены проведения переработки');
    if (!document || !reason?.trim()) return;
    try {
      await mutations.reverse.mutateAsync({
        id: document.id,
        revision: document.revision,
        note: reason.trim(),
      });
      markSaved();
      push({ message: 'Проведение переработки отменено', at: new Date().toISOString() });
      onClose();
    } catch (e) {
      setError(apiError(e));
    }
  }
  const renderRows = (rows: DraftRow[], setRows: (rows: DraftRow[]) => void, output: boolean) => (
    <section className="poster-document-panel poster-document-products space-y-3">
      <h3 className="text-lg font-medium">{output ? 'Полученные продукты' : 'Исходные продукты'}</h3>
      <div className="overflow-x-auto">
        <table className={`poster-table poster-document-table poster-document-table--compact poster-processing-table w-full table-fixed text-sm ${editable ? 'min-w-[1120px]' : 'min-w-[940px]'}`}>
          <colgroup>
            <col className="poster-col-product" />
            <col className="poster-col-warehouse" style={{ width: '16%' }} />
            <col className="poster-col-quantity" style={{ width: editable ? 180 : '12%' }} />
            <col className="poster-col-cost" style={{ width: '10%' }} />
            <col className="poster-col-share" style={{ width: '12%' }} />
            <col className="poster-col-amount" style={{ width: '10%' }} />
            {editable && <col className="poster-col-remove" style={{ width: 40 }} />}
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs font-normal text-text-muted">
              <th className="pb-3 pr-3 font-normal">Продукты</th>
              <th className="px-2 pb-3 font-normal">Склад</th>
              <th className="px-2 pb-3 text-right font-normal">Количество</th>
              <th className="px-2 pb-3 text-right font-normal">Себестоимость</th>
              <th className="px-2 pb-3 text-right font-normal">Пропорция себестоимости</th>
              <th className="px-2 pb-3 text-right font-normal">Итого</th>
              {editable && <th><span className="sr-only">Действия</span></th>}
            </tr>
          </thead>
          <tbody className="poster-document-rows">
            {rows.map((r) => {
              const ingredient = ingredients.data?.find((i) => i.id === r.ingredientId);
              const change = (patch: Partial<DraftRow>) =>
                setRows(rows.map((value) => (value.key === r.key ? { ...value, ...patch } : value)));
              return (
                <tr key={r.key} className="border-b border-border">
                  <td className="poster-product-cell py-2 pr-3">
                    {editable ? (
                      <div className="poster-inline-product">
                      <DocumentProductPicker
                        value={r.ingredientId}
                        disabled={busy || ingredients.isPending}
                        label={output ? 'Полученный продукт' : 'Исходный продукт'}
                        options={(ingredients.data ?? []).filter(
                          (item) => item.preparationMode !== 'virtual',
                        )}
                        fallbackName={r.ingredientName ?? r.name}
                        onChange={(id) => {
                          const selected = ingredients.data?.find((item) => item.id === id);
                          change({
                            ingredientId: id,
                            unit: selected?.displayUnit ?? 'kg',
                            unitCost: undefined,
                            lineCost: undefined,
                          });
                        }}
                      />
                      </div>
                    ) : (
                      <span className="block truncate" title={ingredient?.name ?? r.ingredientName ?? r.name}>
                        {ingredient?.name ?? r.ingredientName ?? r.name ?? 'Продукт'}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {editable ? (
                      <Select
                        ariaLabel="Склад продукта"
                        disabled={busy}
                        className="poster-inline-select h-9 w-full"
                        value={r.warehouseId}
                        onChange={(id) =>
                          change({ warehouseId: id, unitCost: undefined, lineCost: undefined })
                        }
                        options={locations.map((item) => ({ value: item.id, label: item.name }))}
                      />
                    ) : (
                      <span>{locations.find((entry) => entry.id === r.warehouseId)?.name ?? '—'}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {editable ? (
                      <div className="poster-processing-quantity poster-inline-number flex min-w-0 items-center gap-1">
                        <input
                          className="input poster-document-number h-9 min-w-0 w-full flex-1 text-right"
                          type="number"
                          min="0"
                          step="any"
                          aria-label={`Количество · ${ingredient?.name ?? (output ? 'полученный продукт' : 'исходный продукт')}`}
                          inputMode="decimal"
                          disabled={busy || !r.ingredientId}
                          value={r.quantity || ''}
                          onChange={(e) =>
                            change({
                              quantity: Number(e.target.value),
                              unitCost: undefined,
                              lineCost: undefined,
                            })
                          }
                        />
                        <Select
                          ariaLabel="Единица количества"
                          disabled={busy || !r.ingredientId}
                          className="poster-inline-select h-9 w-[64px] shrink-0"
                          value={r.unit}
                          onChange={(unit) => change({
                            unit: unit as UnitCode,
                            quantity: r.quantity * (ALL_UNITS.find((entry) => entry.code === r.unit)?.factor ?? 1) /
                              (ALL_UNITS.find((entry) => entry.code === unit)?.factor ?? 1),
                            unitCost: undefined,
                            lineCost: undefined,
                          })}
                          options={unitsForType(ingredient?.unitType ?? 'mass')}
                        />
                      </div>
                    ) : (
                      <span className="block text-right tabular-nums whitespace-nowrap">
                        {balanceQuantity(r.quantity, unitLabel(r.unit), ingredient?.unitType)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-text-secondary whitespace-nowrap tabular-nums">
                    {r.unitCost == null || (editable && rowsChanged)
                      ? r.ingredientId && editable
                        ? 'По остатку'
                        : '—'
                      : balanceMoney(r.unitCost)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {output && editable ? (
                      <label className="poster-number-unit poster-inline-number ml-auto flex items-center justify-end gap-1">
                        <input
                          className="input poster-document-number h-9 min-w-0 w-full text-right"
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          aria-label="Доля себестоимости"
                          disabled={busy || !r.ingredientId}
                          value={r.costSharePercent ?? ''}
                          onChange={(e) => change({ costSharePercent: Number(e.target.value) })}
                        />
                        <span>%</span>
                      </label>
                    ) : r.costSharePercent == null ? (
                      '—'
                    ) : (
                      `${r.costSharePercent}%`
                    )}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">
                    {r.lineCost == null || (editable && rowsChanged) ? '—' : balanceMoney(r.lineCost)}
                  </td>
                  {editable && <td className="py-2">
                      <button
                        type="button"
                        className="btn-ghost h-8 w-8 text-text-muted hover:text-danger"
                        aria-label="Удалить строку"
                        disabled={busy}
                        onClick={() =>
                          setRows(
                            rows.length > 1
                              ? rows.filter((value) => value.key !== r.key)
                              : [emptyRow(output)],
                          )
                        }
                      >
                        ×
                      </button>
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && (
        <button
          type="button"
          className="poster-document-add py-3 text-sm text-primary"
          disabled={busy}
          onClick={() =>
            setRows([
              ...rows,
              { ...emptyRow(output), ...(output ? { costSharePercent: rows.length ? 0 : 100 } : {}) },
            ])
          }
        >
          + Добавить
        </button>
      )}
    </section>
  );
  return (
    <div className="poster-form poster-form--document poster-document--modern space-y-7">
      <div className="poster-document-panel poster-document-fields space-y-3">
        <DocumentField label="Дата документа">
          {editable ? (
            <div className="w-[250px] max-w-full">
              <DateTimePicker className="input h-9" value={date} onChange={setDate} onValidityChange={setDateValid} required disabled={busy} />
              <p className="mt-1 text-xs text-text-muted">Время Бишкека</p>
            </div>
          ) : (
            <span className="poster-readonly">{inventoryTimeDisplay(document?.date ?? inventoryTimingValue({ mode: 'past', local: date })!)}</span>
          )}
        </DocumentField>
        <DocumentField label="Комментарий">
          {editable ? (
            <textarea
              className="input h-14 w-full py-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              maxLength={1000}
            />
          ) : (
            <span className="poster-readonly whitespace-pre-wrap">{note || '—'}</span>
          )}
        </DocumentField>
        {document && <DocumentField label="Статус">
          <span className="poster-readonly"><span className="document-status" data-status={document.status}>{status(document.status)}</span></span>
        </DocumentField>}
        {document?.postedAt && <DocumentField label="Проведено">
          <span className="poster-readonly">{inventoryTimeDisplay(document.postedAt)} · время изменения остатков</span>
        </DocumentField>}
        {document?.status === 'reversed' && document.reversedAt && <DocumentField label="Проведение отменено">
          <span className="poster-readonly">{inventoryTimeDisplay(document.reversedAt)}</span>
        </DocumentField>}
        {document?.status === 'reversed' && document.reversalReason && <DocumentField label="Причина отмены">
          <span className="poster-readonly whitespace-pre-wrap">{document.reversalReason}</span>
        </DocumentField>}
      </div>
      {renderRows(inputs, (rows) => { setInputs(rows); setRowsChanged(true); }, false)}
      {renderRows(outputs, (rows) => { setOutputs(rows); setRowsChanged(true); }, true)}
      {editable && (
        <p className="text-xs text-text-muted">
          Стоимость исходных продуктов определяется по выбранным складам при проведении. Распределите её между
          полученными продуктами. Сейчас распределено: {allocatedPercent.toLocaleString('ru-RU', { maximumFractionDigits: 4 })}%.
          {' '}«Сохранить» проведёт переработку и изменит остатки. Черновик сохраняет данные без изменения остатков.
          {' '}Дата документа нужна для поиска; складские движения и себестоимость фиксируются на момент проведения.
        </p>
      )}
      {(error || ingredients.isError) && (
        <p role="alert" className="text-sm text-danger">
          {error || apiError(ingredients.error)}
        </p>
      )}
      {document?.reversalBlockedReason && <p role="status" className="rounded-lg bg-background p-3 text-sm text-text-secondary">{document.reversalBlockedReason}</p>}
      <DocumentFooter
        total={
          editable && rowsChanged
            ? 'Итого будет рассчитано после сохранения'
            : document
            ? document.totalCost != null
              ? `Итого: ${balanceMoney(document.totalCost)}`
              : 'Итого: стоимость неизвестна'
            : undefined
        }
      >
        {editable ? (
          <>
            <button className="btn-primary btn-md" disabled={busy || !dateValid} onClick={() => void save(true)}>
              Сохранить
            </button>
            <button className="btn-secondary btn-md" disabled={busy || !dateValid} onClick={() => void save(false)}>
              Сохранить черновик
            </button>
          </>
        ) : (
          <>
            <span className="document-status self-center" data-status={document?.status}>
              {status(document?.status ?? 'draft')}
            </span>
            {document?.status === 'posted' && can('actions.warehouseApprove') && (
              <button className="btn-secondary btn-md" disabled={busy || !!document.reversalBlockedReason} onClick={() => void reverse()}>
                Отменить проведение
              </button>
            )}
          </>
        )}
      </DocumentFooter>
    </div>
  );
}
function status(value: string) {
  return value === 'posted' ? 'Проведена' : value === 'reversed' ? 'Проведение отменено' : 'Черновик';
}
