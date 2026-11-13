import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { DocumentFooter } from './WarehouseUi';
import { qty, useIngredients, useWarehouseLocations, type WarehouseLocation } from './api';
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
    <Modal
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
        />
      )}
      {document && document.status !== 'draft' && (
        <StockDocumentReview document={document} warehouse={documentWarehouse} isOwner={canApprove} />
      )}
    </Modal>
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
}: {
  document: StockDocumentDetails;
  warehouse: WarehouseLocation;
  onReload: () => Promise<{ data?: StockDocumentDetails }>;
}) {
  const { update, transition } = useStockDocumentMutations();
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
  const pending = update.isPending || transition.isPending || reloading || !editable;
  const usedIds = new Set(items.map(({ item }) => item.ingredientId));
  const byId = new Map(ingredients.data?.map((ingredient) => [ingredient.id, ingredient]));
  const available = (ingredients.data ?? []).filter(({ id }) => !usedIds.has(id));
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
        await transition.mutateAsync({ id: saved.id, action: 'submit', revision: saved.revision });
        push({ message: 'Документ отправлен на утверждение', at: new Date().toISOString() });
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
    <div className="space-y-4">
      <DocumentHeader document={document} warehouse={warehouse} />
      <div className="grid gap-3 sm:grid-cols-2">
        {needsReason && (
          <div>
            <div className="mb-1 text-xs font-medium text-text-secondary">Причина списания</div>
            <Select
              ariaLabel="Причина списания"
              className="h-10 w-full"
              value={reason}
              onChange={(value) => setReason(value as WriteoffReason)}
              options={WRITEOFF_REASONS}
            />
          </div>
        )}
        <label className="block text-xs font-medium text-text-secondary">
          {reason === 'other' ? 'Уточните причину' : 'Комментарий'}
          <input
            className="input mt-1 h-10 w-full"
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>
      {!full && (
        <Select
          ariaLabel="Добавить товары"
          placeholder="Добавить товары"
          value=""
          className="h-10 w-full sm:max-w-xs"
          options={available.map(({ id, name }) => ({ value: id, label: name }))}
          disabled={pending || !available.length}
          onChange={addIngredient}
        />
      )}
      {ingredients.isError && (
        <p role="alert" className="text-sm text-danger">
          {apiError(ingredients.error)}
        </p>
      )}
      <DocumentItems
        writeoff={writeoff}
        rows={rows}
        total={total}
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
        {!writeoff && counted.length > 0 && (
          <button
            type="button"
            className="btn-secondary btn-md mr-auto"
            disabled={pending || stale || invalidCount}
            onClick={() => setRecountOpen(true)}
          >
            Повторный пересчёт
          </button>
        )}
        <button
          type="button"
          className="btn-secondary btn-md"
          disabled={pending || stale || invalidCount}
          onClick={() => void save('save')}
        >
          Сохранить черновик
        </button>
        <button
          type="button"
          className="btn-primary btn-md"
          disabled={pending || stale || invalidCount || !canSubmit}
          onClick={() => void save('submit')}
        >
          Отправить на утверждение
        </button>
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
    const note = action === 'reverse' ? window.prompt('Укажите причину сторнирования')?.trim() : undefined;
    if (action === 'reverse' && !note) return;
    setError('');
    try {
      await transition.mutateAsync({ id: document.id, action, revision: document.revision, note });
      push({
        message:
          action === 'approve'
            ? 'Документ проведён'
            : action === 'reverse'
              ? 'Документ сторнирован'
              : 'Документ возвращён в черновик',
        at: new Date().toISOString(),
      });
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <div className="space-y-4">
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
      {document.status === 'posted' && can('actions.warehouseApprove') && (
        <button
          type="button"
          className="btn-secondary btn-md"
          disabled={pending}
          onClick={() => void change('reverse')}
        >
          Сторнировать с причиной
        </button>
      )}
      <button type="button" className="btn-secondary btn-md print:hidden" onClick={() => window.print()}>
        Печать документа
      </button>
      {needsApproval && isOwner && (
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={pending}
            onClick={() => void change('reopen')}
          >
            Вернуть в черновик
          </button>
          <button
            type="button"
            className="btn-primary btn-md"
            disabled={pending}
            onClick={() => void change('approve')}
          >
            Утвердить и провести
          </button>
        </div>
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
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-background/50 p-3 text-sm sm:grid-cols-4">
      <Meta label="Склад">{warehouse.name}</Meta>
      {destination && <Meta label="Куда перемещаем">{destination.name}</Meta>}
      <Meta label="Статус">{documentStatus(document.status)}</Meta>
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
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="break-words font-medium text-text-primary">{children}</dd>
    </div>
  );
}

function DocumentItems({
  rows,
  total,
  writeoff,
  editable,
}: {
  rows: (StockDocumentItem & { input?: string })[];
  total: number | null;
  writeoff: boolean;
  editable?: {
    onChange: (id: string, value: string) => void;
    onRemove?: (id: string) => void;
    disabled: boolean;
  };
}) {
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  if (!rows.length)
    return (
      <p className="rounded-lg border border-border p-3 text-sm text-text-muted">В документе нет позиций</p>
    );
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="hidden grid-cols-[1.35fr_0.8fr_1fr_0.8fr_0.8fr] gap-3 bg-background/60 p-3 text-xs font-medium text-text-muted sm:grid">
        <span>Товар</span>
        <span>По учёту</span>
        <span>{writeoff ? 'Количество' : 'Фактически'}</span>
        <span>Разница</span>
        <span className="text-right">{costs ? 'Сумма' : ''}</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.ingredientId}
            className="grid grid-cols-2 items-center gap-2 p-3 text-sm sm:grid-cols-[1.35fr_0.8fr_1fr_0.8fr_0.8fr] sm:gap-3"
          >
            <div className="col-span-2 min-w-0 break-words font-medium text-text-primary sm:col-span-1">
              {row.name}
              {editable?.onRemove && (
                <button
                  type="button"
                  className="ml-2 text-xs text-danger"
                  disabled={editable.disabled}
                  aria-label={`Убрать ${row.name}`}
                  onClick={() => editable.onRemove?.(row.ingredientId)}
                >
                  Убрать
                </button>
              )}
            </div>
            <Cell label="По учёту">{row.expected === null ? '—' : qty(row.expected, row.unit)}</Cell>
            <Cell label={writeoff ? 'Количество' : 'Фактически'}>
              {editable ? (
                <div className="flex items-center gap-1">
                  <input
                    className="input h-9 min-w-0 text-sm"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    aria-label={`Количество · ${row.name}`}
                    disabled={editable.disabled}
                    value={row.input ?? ''}
                    onChange={(event) => editable.onChange(row.ingredientId, event.target.value)}
                  />
                  <span>{row.unit}</span>
                </div>
              ) : row.quantity === null ? (
                '—'
              ) : (
                qty(row.quantity, row.unit)
              )}
            </Cell>
            <Cell label="Разница">
              {row.difference === null ? '—' : signedQuantity(row.difference, row.unit)}
            </Cell>
            <Cell label={costs ? 'Сумма' : ''} className="sm:text-right">
              {costs ? formatVariance(row.value) : ''}
            </Cell>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border bg-background/60 px-3 py-2 text-sm font-medium text-text-primary">
        <span>{writeoff ? 'Итого изменение на складе' : 'Итого расхождение'}</span>
        <span>{costs ? formatVariance(total) : 'Сумма доступна с правом просмотра себестоимости'}</span>
      </div>
    </div>
  );
}

function Cell({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 text-text-secondary ${className}`}>
      <span className="block text-xs text-text-muted sm:hidden">{label}</span>
      {children}
    </div>
  );
}

function signedQuantity(value: number, unit: string) {
  const rounded = Math.round(Math.abs(value) * 1000) / 1000;
  const sign = rounded === 0 ? '' : value < 0 ? '−' : '+';
  return `${sign}${qty(rounded, unit)}`;
}
