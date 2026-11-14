import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { EditorPage } from './EditorPage';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { DocumentProductPicker } from './DocumentProductPicker';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { DocumentField, DocumentFooter } from './WarehouseUi';
import { qty, useIngredients, useWarehouseLocations, type Ingredient, type WarehouseLocation } from './api';
import {
  useStockDocument,
  useStockDocumentMutations,
  type StockDocumentDetails,
  type StockDocumentItem,
  type WriteoffReason,
} from './stock-documents-api';
import {
  documentLabel,
  documentStatus,
  formatDocumentDate,
  formatVariance,
  WRITEOFF_REASONS,
} from './stock-document-format';

export function StockDocumentModal({
  id,
  warehouse,
  isOwner,
  onClose,
}: {
  id: string;
  warehouse: WarehouseLocation;
  isOwner: boolean;
  onClose: () => void;
}) {
  const query = useStockDocument(id);
  const locations = useWarehouseLocations();
  const { can } = usePermissions();
  const document = query.data;
  const documentWarehouse =
    locations.data?.locations.find((l) => l.id === document?.warehouseId) ?? warehouse;
  const canApprove =
    document?.kind === 'transfer'
      ? can('actions.warehouseTransfer')
      : document?.kind === 'supplier_return'
        ? can('actions.warehouseReceive') && can('actions.warehouseCosts')
        : isOwner;
  return (
    <EditorPage
      open
      title={document ? documentLabel(document) : 'Складской документ'}
      panelClassName="max-w-4xl"
      onClose={onClose}
    >
      {query.isPending && (
        <div className="flex justify-center py-8 text-primary">
          <Spinner />
        </div>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {apiError(query.error)}
        </p>
      )}
      {document?.status === 'draft' && (
        <StockDocumentDraft
          document={document}
          warehouse={documentWarehouse}
          onReload={() => query.refetch()}
          canApprove={canApprove}
        />
      )}
      {document && document.status !== 'draft' && (
        <StockDocumentReview document={document} warehouse={documentWarehouse} isOwner={canApprove} />
      )}
    </EditorPage>
  );
}

interface DraftItem {
  item: StockDocumentItem;
  input: string;
}

function draftItems(document: StockDocumentDetails): DraftItem[] {
  return document.items.map((item) => ({ item, input: item.quantity === null ? '' : String(item.quantity) }));
}

function StockDocumentDraft({
  document,
  warehouse,
  onReload,
  canApprove,
}: {
  document: StockDocumentDetails;
  warehouse: WarehouseLocation;
  onReload: () => Promise<{ data?: StockDocumentDetails }>;
  canApprove: boolean;
}) {
  const { update } = useStockDocumentMutations();
  const { can } = usePermissions();
  const editable = can(
    `actions.${document.kind === 'inventory' ? 'warehouseCount' : document.kind === 'writeoff' ? 'warehouseWriteoff' : document.kind === 'transfer' ? 'warehouseTransfer' : 'warehouseReceive'}`,
  );
  const ingredients = useIngredients('', warehouse.id);
  const push = useNotifications((state) => state.push);
  const [baseRevision, setBaseRevision] = useState(document.revision);
  const [items, setItems] = useState(() => draftItems(document));
  const [reason, setReason] = useState<WriteoffReason | ''>(document.reason ?? '');
  const [note, setNote] = useState(document.note ?? '');
  const [error, setError] = useState('');
  const [recountOpen, setRecountOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const writeoff = document.kind !== 'inventory';
  const needsReason = document.kind === 'writeoff';
  const full = document.mode === 'full';
  const stale = baseRevision !== document.revision;
  const pending = update.isPending || reloading || !editable;
  const usedIds = new Set(items.map(({ item }) => item.ingredientId));
  const byId = new Map(ingredients.data?.map((ingredient) => [ingredient.id, ingredient]));
  const available = (ingredients.data ?? []).filter(
    ({ id, preparationMode }) => !usedIds.has(id) && preparationMode !== 'virtual',
  );
  const counted = items.filter(({ input }) => input.trim() !== '');
  const invalidCount = counted.some(({ input }) => {
    const quantity = Number(input);
    return !Number.isFinite(quantity) || quantity < 0 || (writeoff && quantity === 0);
  });
  const allCounted = !full || counted.length === items.length;
  const canSubmit =
    counted.length > 0 && allCounted && (!needsReason || (reason && (reason !== 'other' || note.trim())));

  function adopt(saved: StockDocumentDetails) {
    setBaseRevision(saved.revision);
    setItems(draftItems(saved));
    setReason(saved.reason ?? '');
    setNote(saved.note ?? '');
  }

  function addIngredient(ingredientId: string) {
    const ingredient = byId.get(ingredientId);
    if (!ingredient) return;
    setItems((current) => [
      ...current,
      {
        item: {
          ingredientId,
          name: ingredient.name,
          unit: ingredient.unit,
          expected: ingredient.stock,
          quantity: null,
          difference: null,
          value: null,
          unitCost: ingredient.avgCost,
          costKnown: ingredient.valuationKnown,
        },
        input: '',
      },
    ]);
  }

  async function save(action: 'save' | 'submit' | 'recount') {
    if (pending || invalidCount || stale || (action === 'submit' && !canSubmit)) return;
    setError('');
    try {
      const saved = await update.mutateAsync({
        id: document.id,
        revision: baseRevision,
        finalize: action === 'submit' ? (canApprove ? 'post' : 'submit') : undefined,
        reason: needsReason ? reason || null : undefined,
        note: note.trim(),
        recount: action === 'recount' || undefined,
        items: counted.map(({ item, input }) => ({
          ingredientId: item.ingredientId,
          quantity: Number(input),
        })),
      });
      adopt(saved);
      setRecountOpen(false);
      if (action === 'submit') {
        push({
          message: canApprove ? 'Документ проведён' : 'Документ отправлен на утверждение',
          at: new Date().toISOString(),
        });
      } else {
        push({ message: 'Черновик сохранён', at: new Date().toISOString() });
      }
    } catch (err) {
      setError(apiError(err));
    }
  }

  async function reload() {
    setReloading(true);
    setError('');
    try {
      const result = await onReload();
      if (result.data) adopt(result.data);
    } finally {
      setReloading(false);
    }
  }

  const rows = items.map(({ item, input }) => {
    const ingredient = byId.get(item.ingredientId);
    const quantity = input.trim() === '' ? null : Number(input);
    const validQuantity = quantity !== null && Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
    const changed = validQuantity !== item.quantity;
    const expected = item.expected ?? ingredient?.stock ?? null;
    const unitCost = item.costKnown === false ? null : (item.unitCost ?? ingredient?.avgCost ?? null);
    const difference =
      validQuantity === null
        ? null
        : writeoff
          ? -validQuantity
          : expected === null
            ? null
            : validQuantity - expected;
    const value =
      difference === null || unitCost === null ? null : Math.round(difference * unitCost * 100) / 100;
    return {
      ...item,
      expected,
      quantity: validQuantity,
      difference: changed ? difference : item.difference,
      value: changed ? value : item.value,
      input,
    };
  });
  const totals = rows.filter((row) => row.quantity !== null && row.value !== null);
  const total = totals.length ? totals.reduce((sum, row) => sum + (row.value ?? 0), 0) : null;

  return (
    <div className="poster-form poster-form--document space-y-6">
      <DocumentHeader document={document} warehouse={warehouse} />
      <div className="space-y-3">
        {needsReason && (
          <DocumentField label="Причина списания">
            <Select
              ariaLabel="Причина списания"
              className="h-10 w-full"
              value={reason}
              onChange={(value) => setReason(value as WriteoffReason)}
              options={WRITEOFF_REASONS}
            />
          </DocumentField>
        )}
        <DocumentField label={reason === 'other' ? 'Уточните причину' : 'Комментарий'}>
          <textarea
            className="input h-14 w-full"
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
          />
        </DocumentField>
      </div>
      {ingredients.isError && (
        <p role="alert" className="text-sm text-danger">
          {apiError(ingredients.error)}
        </p>
      )}
      <DocumentItems
        writeoff={writeoff}
        rows={rows}
        total={total}
        addProducts={!full ? { options: available, onSelect: addIngredient } : undefined}
        editable={{
          onChange: (ingredientId, input) =>
            setItems((current) =>
              current.map((row) => (row.item.ingredientId === ingredientId ? { ...row, input } : row)),
            ),
          onRemove: full
            ? undefined
            : (ingredientId) =>
                setItems((current) => current.filter(({ item }) => item.ingredientId !== ingredientId)),
          disabled: pending || stale,
        }}
      />
      {full && (
        <p className="text-xs text-text-muted">
          Посчитано {counted.length} из {items.length}. Для отсутствующего товара укажите 0.
        </p>
      )}
      {stale && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-warning/10 p-3 text-sm text-text-primary"
        >
          Документ изменился. Загрузите актуальную версию перед сохранением.
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={pending}
            onClick={() => void reload()}
          >
            Загрузить изменения
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          {error}
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={pending}
            onClick={() => void reload()}
          >
            Загрузить изменения
          </button>
        </div>
      )}
      <DocumentFooter>
        <button
          type="button"
          className="btn-primary btn-md"
          disabled={pending || stale || invalidCount || !canSubmit}
          onClick={() => void save('submit')}
        >
          {canApprove
            ? document.kind === 'inventory'
              ? 'Завершить инвентаризацию'
              : 'Сохранить'
            : 'Отправить на утверждение'}
        </button>
        <button
          type="button"
          className="btn-secondary btn-md"
          disabled={pending || stale || invalidCount}
          onClick={() => void save('save')}
        >
          Сохранить черновик
        </button>
        {!writeoff && counted.length > 0 && (
          <button
            type="button"
            className="btn-ghost btn-md"
            disabled={pending || stale || invalidCount}
            onClick={() => setRecountOpen(true)}
          >
            Повторный пересчёт
          </button>
        )}
      </DocumentFooter>
      {recountOpen && (
        <Modal open title="Повторный пересчёт" onClose={() => setRecountOpen(false)}>
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Перед сохранением пересчитайте товары и внесите свежие фактические остатки. Система обновит
              учётные остатки для внесённых позиций.
            </p>
            <button
              type="button"
              className="btn-primary btn-md w-full"
              disabled={pending || stale || invalidCount}
              onClick={() => void save('recount')}
            >
              Сохранить повторный пересчёт
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StockDocumentReview({
  document,
  warehouse,
  isOwner,
}: {
  document: StockDocumentDetails;
  warehouse: WarehouseLocation;
  isOwner: boolean;
}) {
  const { transition } = useStockDocumentMutations();
  const { can } = usePermissions();
  const [error, setError] = useState('');
  const push = useNotifications((state) => state.push);
  const pending = transition.isPending;
  const needsApproval = document.status === 'submitted';
  const reason = WRITEOFF_REASONS.find(({ value }) => value === document.reason)?.label;

  async function change(action: 'approve' | 'reopen' | 'reverse') {
    const note =
      action === 'reverse' ? window.prompt('Укажите причину отмены проведения')?.trim() : undefined;
    if (action === 'reverse' && !note) return;
    setError('');
    try {
      await transition.mutateAsync({ id: document.id, action, revision: document.revision, note });
      push({
        message:
          action === 'approve'
            ? 'Документ проведён'
            : action === 'reverse'
              ? 'Проведение отменено'
              : 'Документ возвращён в черновик',
        at: new Date().toISOString(),
      });
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className="poster-form poster-form--document space-y-6">
      <DocumentHeader document={document} warehouse={warehouse} />
      {(reason || document.note) && (
        <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">
          {[reason, document.note].filter(Boolean).join(' · ')}
        </p>
      )}
      <DocumentItems
        writeoff={document.kind !== 'inventory'}
        rows={document.items}
        total={document.varianceValue}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <WorkspaceHeaderActions>
        <button
          type="button"
          className="btn-ghost btn-md print:hidden text-primary"
          onClick={() => window.print()}
        >
          Печать
        </button>
      </WorkspaceHeaderActions>
      {((needsApproval && isOwner) || (document.status === 'posted' && can('actions.warehouseApprove'))) && (
        <DocumentFooter>
          {needsApproval && isOwner && (
            <>
              <button
                type="button"
                className="btn-primary btn-md"
                disabled={pending}
                onClick={() => void change('approve')}
              >
                Утвердить и провести
              </button>
              <button
                type="button"
                className="btn-secondary btn-md"
                disabled={pending}
                onClick={() => void change('reopen')}
              >
                Вернуть в черновик
              </button>
            </>
          )}
          {document.status === 'posted' && can('actions.warehouseApprove') && (
            <button
              type="button"
              className="btn-secondary btn-md"
              disabled={pending}
              onClick={() => void change('reverse')}
            >
              Отменить проведение
            </button>
          )}
        </DocumentFooter>
      )}
    </div>
  );
}

function DocumentHeader({
  document,
  warehouse,
}: {
  document: StockDocumentDetails;
  warehouse: WarehouseLocation;
}) {
  const locations = useWarehouseLocations();
  const destination = locations.data?.locations.find((l) => l.id === document.destinationWarehouseId);
  return (
    <dl className="space-y-3 text-sm">
      <Meta label="Склад">{warehouse.name}</Meta>
      {destination && <Meta label="На склад">{destination.name}</Meta>}
      <Meta label="Статус">
        <span className="document-status" data-status={document.status}>
          {documentStatus(document.status)}
        </span>
      </Meta>
      <Meta label="Создан">
        {formatDocumentDate(document.createdAt)}
        {document.createdByName && ` · ${document.createdByName}`}
      </Meta>
      {document.postedAt ? (
        <Meta label="Проведён">
          {formatDocumentDate(document.postedAt)}
          {document.postedByName && ` · ${document.postedByName}`}
        </Meta>
      ) : (
        document.submittedAt && <Meta label="Отправлен">{formatDocumentDate(document.submittedAt)}</Meta>
      )}
    </dl>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="poster-document-meta grid min-h-9 items-center gap-1 md:grid-cols-[min(334px,27%)_minmax(0,470px)] md:gap-0">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="break-words text-text-primary">{children}</dd>
    </div>
  );
}

function DocumentItems({
  rows,
  total,
  writeoff,
  editable,
  addProducts,
}: {
  rows: (StockDocumentItem & { input?: string })[];
  total: number | null;
  writeoff: boolean;
  editable?: {
    onChange: (id: string, value: string) => void;
    onRemove?: (id: string) => void;
    disabled: boolean;
  };
  addProducts?: { options: Ingredient[]; onSelect: (id: string) => void };
}) {
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const columns = writeoff ? 4 : 6;
  return (
    <div className="overflow-x-auto">
      <table className="poster-table w-full min-w-[700px] table-fixed text-sm">
        <colgroup>
          {writeoff ? (
            <>
              <col style={{ width: '54%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '4%' }} />
            </>
          ) : (
            <>
              <col style={{ width: '34%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '4%' }} />
            </>
          )}
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-xs text-text-muted">
            <th className="py-3 pr-3 font-normal">Наименование</th>
            {!writeoff && <th className="px-3 py-3 text-right font-normal">По учёту</th>}
            <th className="px-3 py-3 text-right font-normal">{writeoff ? 'Количество' : 'Фактически'}</th>
            {!writeoff && <th className="px-3 py-3 text-right font-normal">Разница</th>}
            <th className="px-3 py-3 text-right font-normal">{costs ? 'Сумма' : ''}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ingredientId} className="border-b border-border">
              <td className="py-3 pr-3 font-medium">{row.name}</td>
              {!writeoff && (
                <td className="px-3 py-3 text-right text-text-secondary">
                  {row.expected === null ? '—' : qty(row.expected, row.unit)}
                </td>
              )}
              <td className="px-3 py-2 text-right">
                {editable ? (
                  <label className="poster-number-unit flex items-center gap-2">
                    <input
                      className="input h-9 min-w-0 w-full text-right"
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      aria-label={`Количество · ${row.name}`}
                      disabled={editable.disabled}
                      value={row.input ?? ''}
                      onChange={(event) => editable.onChange(row.ingredientId, event.target.value)}
                    />
                    <span className="whitespace-nowrap text-text-muted">{row.unit}</span>
                  </label>
                ) : row.quantity === null ? (
                  '—'
                ) : (
                  qty(row.quantity, row.unit)
                )}
              </td>
              {!writeoff && (
                <td className="px-3 py-3 text-right text-text-secondary">
                  {row.difference === null ? '—' : signedQuantity(row.difference, row.unit)}
                </td>
              )}
              <td className="px-3 py-3 text-right">{costs ? formatVariance(row.value) : ''}</td>
              <td>
                {editable?.onRemove && (
                  <button
                    type="button"
                    className="btn-ghost h-8 w-8 text-text-muted hover:text-danger"
                    disabled={editable.disabled}
                    aria-label={`Убрать ${row.name}`}
                    onClick={() => editable.onRemove?.(row.ingredientId)}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
          {addProducts && (
            <tr className="border-b border-border">
              <td className="py-2 pr-3">
                <DocumentProductPicker
                  key={rows.length}
                  value=""
                  label="Добавить продукт"
                  options={addProducts.options}
                  disabled={editable?.disabled || !addProducts.options.length}
                  onChange={addProducts.onSelect}
                />
              </td>
              <td colSpan={columns - 1} />
            </tr>
          )}
          {!rows.length && !addProducts && (
            <tr>
              <td colSpan={columns} className="py-12 text-center text-text-muted">
                В документе нет позиций
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-background/30">
            <td colSpan={columns - 2} className="py-3 pr-3 font-medium">
              {writeoff ? 'Итого' : 'Итого расхождение'}
            </td>
            <td className="px-3 py-3 text-right font-medium">{costs ? formatVariance(total) : ''}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function signedQuantity(value: number, unit: string) {
  const rounded = Math.round(Math.abs(value) * 1000) / 1000;
  const sign = rounded === 0 ? '' : value < 0 ? '−' : '+';
  return `${sign}${qty(rounded, unit)}`;
}
