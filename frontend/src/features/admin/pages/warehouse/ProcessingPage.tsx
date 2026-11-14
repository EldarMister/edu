import { useState, type ReactNode } from 'react';
import { EditorPage } from './EditorPage';
import { DocumentProductPicker } from './DocumentProductPicker';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { formatDocumentListDate } from './WarehouseDocumentLists';
import { usePageFilter } from './workspace-route';
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
  const q = useProcessing({ warehouseId, search });
  return (
    <div className="min-w-0">
      <WorkspaceHeaderCount count={q.data?.length} />
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск переработок" value={search} onChange={setSearch} />
        {filters}
        <WorkspaceHeaderActions>
          <button className="btn-primary btn-md" onClick={onCreate}>
            Добавить
          </button>
        </WorkspaceHeaderActions>
      </div>
      <QueryState pending={q.isPending} error={q.error}>
        <div className="overflow-x-auto">
          <table className="poster-table w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Исходные продукты</th>
                <th>Полученные продукты</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!q.data?.length && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-text-muted">
                    {search
                      ? 'Переработки не найдены. Измените поиск.'
                      : 'Переработок пока нет. Добавьте первую переработку.'}
                  </td>
                </tr>
              )}
              {q.data?.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap">
                    <button
                      className="text-primary"
                      onClick={() => onOpen(d.id)}
                      title={formatDocumentDate(d.date)}
                    >
                      {formatDocumentListDate(d.date)}
                    </button>
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
                    <span className="document-status" data-status={d.status}>
                      {status(d.status)}
                    </span>
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
  const editable = (!document || document.status === 'draft') && can('actions.warehouseProduce');
  const busy = mutations.save.isPending || mutations.reverse.isPending;
  const enteredInputs = inputs.filter((row) => row.ingredientId || row.quantity);
  const enteredOutputs = outputs.filter((row) => row.ingredientId || row.quantity);
  async function save(complete: boolean) {
    if (busy) return;
    if (
      !enteredInputs.length ||
      !enteredOutputs.length ||
      [...enteredInputs, ...enteredOutputs].some(
        (r) => !r.ingredientId || !r.warehouseId || !(r.quantity > 0),
      ) ||
      (complete && Math.abs(enteredOutputs.reduce((s, r) => s + (r.costSharePercent ?? 0), 0) - 100) > 0.001)
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
      onClose();
    } catch (e) {
      setError(apiError(e));
    }
  }
  const renderRows = (rows: DraftRow[], setRows: (rows: DraftRow[]) => void, output: boolean) => (
    <section className="space-y-3">
      <h3 className="text-lg font-medium">{output ? 'Полученные продукты' : 'Исходные продукты'}</h3>
      <div className="overflow-x-auto">
        <table className="poster-table w-full min-w-[950px] table-fixed text-sm">
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '3%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-border text-left text-xs font-normal text-text-muted">
              <th className="pb-3 pr-3 font-normal">Продукты</th>
              <th className="px-2 pb-3 font-normal">Склад</th>
              <th className="px-2 pb-3 text-right font-normal">Количество</th>
              <th className="px-2 pb-3 font-normal">Ед.</th>
              <th className="px-2 pb-3 text-right font-normal">Себестоимость</th>
              <th className="px-2 pb-3 text-right font-normal">Доля стоимости</th>
              <th className="px-2 pb-3 text-right font-normal">Итого</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ingredient = ingredients.data?.find((i) => i.id === r.ingredientId);
              const change = (patch: Partial<DraftRow>) =>
                setRows(rows.map((value) => (value.key === r.key ? { ...value, ...patch } : value)));
              return (
                <tr key={r.key} className="border-b border-border">
                  <td className="py-2 pr-3">
                    {editable ? (
                      <DocumentProductPicker
                        value={r.ingredientId}
                        disabled={!editable}
                        label="Продукт переработки"
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
                    ) : (
                      <span>{ingredient?.name ?? r.ingredientName ?? r.name ?? 'Продукт'}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {editable ? (
                      <Select
                        ariaLabel="Склад продукта"
                        disabled={!editable}
                        className="h-9 w-full"
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
                      <input
                        className="input h-9 min-w-0 w-full text-right"
                        type="number"
                        min="0"
                        step="any"
                        aria-label="Количество продукта"
                        disabled={!editable || !r.ingredientId}
                        value={r.quantity || ''}
                        onChange={(e) =>
                          change({
                            quantity: Number(e.target.value),
                            unitCost: undefined,
                            lineCost: undefined,
                          })
                        }
                      />
                    ) : (
                      <span className="block text-right tabular-nums">
                        {r.quantity.toLocaleString('ru-RU')}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {editable ? (
                      <Select
                        ariaLabel="Единица количества"
                        disabled={!editable || !r.ingredientId}
                        className="h-9 w-full"
                        value={r.unit}
                        onChange={(unit) => change({ unit: unit as UnitCode })}
                        options={unitsForType(ingredient?.unitType ?? 'mass')}
                      />
                    ) : (
                      <span>{unitLabel(r.unit)}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-text-secondary">
                    {r.unitCost == null
                      ? r.ingredientId && editable
                        ? 'По остатку'
                        : '—'
                      : money(r.unitCost)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {output && editable ? (
                      <label className="poster-number-unit flex items-center gap-1">
                        <input
                          className="input h-9 min-w-0 w-full text-right"
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          aria-label="Доля себестоимости"
                          disabled={!editable || !r.ingredientId}
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
                  <td className="px-2 py-2 text-right">{r.lineCost == null ? '—' : money(r.lineCost)}</td>
                  <td className="py-2">
                    {editable && (
                      <button
                        type="button"
                        className="btn-ghost h-8 w-8 text-text-muted hover:text-danger"
                        aria-label="Удалить строку"
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
      </div>
    </section>
  );
  return (
    <div className="poster-form poster-form--document space-y-7">
      <div className="space-y-3">
        <DocumentField label="Дата и время">
          {editable ? (
            <div className="w-[250px] max-w-full">
              <DateTimePicker className="input h-9" value={date} onChange={setDate} />
            </div>
          ) : (
            <span className="poster-readonly">{formatDocumentDate(document?.date ?? date)}</span>
          )}
        </DocumentField>
        <DocumentField label="Комментарий">
          {editable ? (
            <textarea
              className="input h-14 w-full py-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!editable}
            />
          ) : (
            <span className="poster-readonly whitespace-pre-wrap">{note || '—'}</span>
          )}
        </DocumentField>
      </div>
      {renderRows(inputs, setInputs, false)}
      {renderRows(outputs, setOutputs, true)}
      {editable && (
        <p className="text-xs text-text-muted">
          Стоимость исходных продуктов определяется по выбранным складам при проведении. Распределите её между
          полученными продуктами.
        </p>
      )}
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
              Сохранить
            </button>
            <button className="btn-secondary btn-md" disabled={busy} onClick={() => void save(false)}>
              Сохранить черновик
            </button>
          </>
        ) : (
          <>
            <span className="document-status self-center" data-status={document?.status}>
              {status(document?.status ?? 'draft')}
            </span>
            {document?.status === 'posted' && can('actions.warehouseApprove') && (
              <button className="btn-secondary btn-md" disabled={busy} onClick={() => void reverse()}>
                Отменить проведение
              </button>
            )}
          </>
        )}
        {editable && (
          <button className="btn-ghost btn-md" onClick={onClose}>
            Отмена
          </button>
        )}
      </DocumentFooter>
    </div>
  );
}
function status(value: string) {
  return value === 'posted' ? 'Проведена' : value === 'reversed' ? 'Проведение отменено' : 'Черновик';
}
function localTime(value?: string) {
  const d = value ? new Date(value) : new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
