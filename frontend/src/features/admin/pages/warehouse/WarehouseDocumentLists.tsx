import { Fragment, useState, type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { money } from '@/lib/format';
import {
  purchaseNumber,
  qty,
  useProductionJournal,
  usePurchase,
  usePurchases,
  useWarehouseLocations,
  type WarehouseLocation,
} from './api';
import { useStockDocuments, type StockDocumentKind, type StockDocumentStatus } from './stock-documents-api';
import { documentLabel, documentStatus, formatDocumentDate, WRITEOFF_REASONS } from './stock-document-format';
import { QueryState } from './WarehouseUi';
import { unitLabel } from './units';
import { usePageFilter } from './workspace-route';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';

export function SupplyList({
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
  const [search, setSearch] = usePageFilter('supplySearch');
  const [status, setStatus] = usePageFilter('supplyStatus');
  const [expanded, setExpanded] = useState<string>();
  const query = usePurchases({ warehouseId, search, status });
  const locations = useWarehouseLocations();
  const warehouseNames = new Map(locations.data?.locations.map((location) => [location.id, location.name]));
  const emptyMessage =
    search || status || warehouseId
      ? 'Поставки не найдены. Измените поиск или фильтры.'
      : 'Поставок пока нет. Добавьте первую поставку.';
  return (
    <div>
      <WorkspaceHeaderCount count={query.data?.length} />
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск поставок" value={search} onChange={setSearch} />
        {filters}
        <Select
          ariaLabel="Статус поставки"
          value={status}
          onChange={setStatus}
          className="h-9 min-w-36"
          options={[
            { value: '', label: 'Все статусы' },
            { value: 'draft', label: 'Черновики' },
            { value: 'completed', label: 'Проведённые' },
            { value: 'cancelled', label: 'Отменённые' },
          ]}
        />
        <WorkspaceHeaderActions>
          <button className="btn-primary btn-md" onClick={onCreate}>
            Добавить
          </button>
        </WorkspaceHeaderActions>
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className="poster-table w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>
                {['№', 'Дата', 'Поставщик', 'Склад', 'Комментарий', 'Статус', 'Сумма', ''].map((h) => (
                  <th key={h} className={`px-4 py-3 font-medium ${h === 'Сумма' ? 'text-right' : ''}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!query.data?.length && (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {query.data?.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-b border-border hover:bg-background/50">
                    <td className="px-4 py-3">
                      <button className="font-medium text-primary" onClick={() => onOpen(p.id)}>
                        {purchaseNumber(p.number)}
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <time dateTime={p.date} title={formatDocumentDate(p.date)}>
                        {formatDocumentListDate(p.date)}
                      </time>
                    </td>
                    <td className="px-4 py-3">{p.supplier}</td>
                    <td className="px-4 py-3">{warehouseNames.get(p.warehouseId ?? '') ?? '—'}</td>
                    <td className="max-w-48 truncate px-4 py-3" title={p.note ?? undefined}>
                      {p.note || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="document-status" data-status={p.status}>
                        {purchaseStatus(p.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-medium tabular-nums">
                      {money(p.totalAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="poster-row-actions">
                        <button
                          className="text-primary"
                          aria-expanded={expanded === p.id}
                          onClick={() => setExpanded(expanded === p.id ? undefined : p.id)}
                        >
                          Детали
                        </button>
                        <button className="text-primary" onClick={() => onOpen(p.id)}>
                          {p.status === 'draft' ? 'Ред.' : 'Открыть'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === p.id && (
                    <tr>
                      <td colSpan={8} className="bg-background/60 p-4">
                        <SupplyLines id={p.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-4 py-3" colSpan={6}>
                  Итого
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {money(query.data?.reduce((sum, p) => sum + p.totalAmount, 0) ?? 0)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {!query.data?.length && <p className="py-10 text-center text-sm text-text-muted">{emptyMessage}</p>}
          {query.data?.map((p) => (
            <div key={p.id} className="space-y-3 p-4">
              <button
                className="flex w-full items-start justify-between gap-3 text-left"
                onClick={() => onOpen(p.id)}
              >
                <span>
                  <span className="block font-medium text-primary">
                    {purchaseNumber(p.number)} · {p.supplier}
                  </span>
                  <span className="text-xs text-text-muted">
                    {formatDocumentListDate(p.date)} · {warehouseNames.get(p.warehouseId ?? '') ?? 'Склад'} ·{' '}
                    {purchaseStatus(p.status)}
                  </span>
                </span>
                <span className="text-sm font-medium">{money(p.totalAmount)}</span>
              </button>
              {p.note && <p className="text-sm text-text-secondary">{p.note}</p>}
              <button
                className="text-sm text-primary"
                aria-expanded={expanded === p.id}
                onClick={() => setExpanded(expanded === p.id ? undefined : p.id)}
              >
                Детали
              </button>
              {expanded === p.id && <SupplyLines id={p.id} />}
            </div>
          ))}
        </div>
      </QueryState>
    </div>
  );
}
function purchaseStatus(status: string) {
  return status === 'draft' ? 'Черновик' : status === 'completed' ? 'Проведена' : 'Сторнирована';
}
function SupplyLines({ id }: { id: string }) {
  const q = usePurchase(id);
  return (
    <QueryState pending={q.isPending} error={q.error}>
      <div className="text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-2 border-b border-border px-3 py-2 text-xs text-text-muted">
          <span>Товар</span>
          <span>Количество</span>
          <span className="text-right">Сумма</span>
        </div>
        {q.data?.items?.map((i) => (
          <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-2 px-3 py-2">
            <span>{i.ingredientName}</span>
            <span>{qty(i.quantity, i.unit)}</span>
            <span className="text-right">{money(i.total)}</span>
          </div>
        ))}
      </div>
    </QueryState>
  );
}

export function DocumentList({
  kind,
  warehouseId,
  filters,
  locations,
  onOpen,
  onCreate,
}: {
  kind: StockDocumentKind;
  warehouseId: string;
  locations: WarehouseLocation[];
  filters?: ReactNode;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = usePageFilter(`${kind}Search`);
  const [status, setStatus] = usePageFilter(`${kind}Status`);
  const [reason, setReason] = usePageFilter(`${kind}Reason`);
  const query = useStockDocuments(warehouseId, kind);
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const rows = (query.data ?? []).filter(
    (d) =>
      (!status || d.status === status) &&
      (!reason || d.reason === reason) &&
      `${documentLabel(d)} ${d.note ?? ''} ${d.createdByName ?? ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const names = new Map(locations.map((l) => [l.id, l.name]));
  return (
    <div>
      <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск документов" value={search} onChange={setSearch} />
        {filters}
        <Select
          ariaLabel="Статус документа"
          value={status}
          onChange={setStatus}
          className="h-9 min-w-36"
          options={[
            { value: '', label: 'Все статусы' },
            ...['draft', 'submitted', 'posted', 'reversed'].map((v) => ({
              value: v,
              label: documentStatus(v as StockDocumentStatus),
            })),
          ]}
        />
        {kind === 'writeoff' && (
          <Select
            ariaLabel="Причина списания"
            value={reason}
            onChange={setReason}
            className="h-9 min-w-36"
            options={[{ value: '', label: 'Все причины' }, ...WRITEOFF_REASONS]}
          />
        )}
        <WorkspaceHeaderActions>
          <button className="btn-primary btn-md" onClick={onCreate}>
            Добавить
          </button>
        </WorkspaceHeaderActions>
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className="poster-table w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>
                {[
                  'Дата',
                  'Документ',
                  'Склад',
                  kind === 'inventory' ? 'Тип' : 'Комментарий',
                  'Сотрудник',
                  'Статус',
                  ...(costs ? ['Сумма'] : []),
                ].map((h) => (
                  <th key={h} className="px-4 py-3 text-right font-medium tabular-nums">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!rows.length && (
                <tr>
                  <td colSpan={costs ? 7 : 6} className="py-12 text-center text-text-muted">
                    {search || status || reason
                      ? 'Документы не найдены. Измените поиск или фильтры.'
                      : 'Документов пока нет. Добавьте первый документ.'}
                  </td>
                </tr>
              )}
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-background/50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <time dateTime={d.createdAt} title={formatDocumentDate(d.createdAt)}>
                      {formatDocumentListDate(d.createdAt)}
                    </time>
                  </td>
                  <td className="px-4 py-3">
                    <button className="font-medium text-primary" onClick={() => onOpen(d.id)}>
                      {documentLabel(d)}
                    </button>
                    <p className="text-xs text-text-muted">{d.itemsCount} позиций</p>
                  </td>
                  <td className="px-4 py-3">
                    {names.get(d.warehouseId) ?? 'Склад'}
                    {d.destinationWarehouseId && ` → ${names.get(d.destinationWarehouseId) ?? 'Склад'}`}
                  </td>
                  <td className="px-4 py-3">
                    {kind === 'inventory'
                      ? d.mode === 'full'
                        ? 'Полная'
                        : 'Частичная'
                      : kind === 'writeoff'
                        ? (WRITEOFF_REASONS.find((r) => r.value === d.reason)?.label ?? d.note ?? '—')
                        : d.note || '—'}
                  </td>
                  <td className="px-4 py-3">{d.createdByName || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="document-status" data-status={d.status}>
                      {documentStatus(d.status)}
                    </span>
                  </td>
                  {costs && (
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {d.varianceValue == null ? '—' : money(d.varianceValue)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {!rows.length && (
            <p className="py-10 text-center text-sm text-text-muted">
              {search || status || reason
                ? 'Документы не найдены. Измените поиск или фильтры.'
                : 'Документов пока нет.'}
            </p>
          )}
          {rows.map((d) => (
            <button key={d.id} className="block w-full space-y-2 p-4 text-left" onClick={() => onOpen(d.id)}>
              <span className="flex justify-between gap-2 text-sm">
                <span className="font-medium text-primary">{documentLabel(d)}</span>
                <span>{documentStatus(d.status)}</span>
              </span>
              <span className="block text-xs text-text-muted">
                {formatDocumentDate(d.createdAt)} · {names.get(d.warehouseId)}
                {d.destinationWarehouseId ? ` → ${names.get(d.destinationWarehouseId)}` : ''}
              </span>
              <span className="flex justify-between gap-2 text-sm">
                <span>{d.note || `${d.itemsCount} позиций`}</span>
                {costs && <span>{d.varianceValue == null ? '—' : money(d.varianceValue)}</span>}
              </span>
            </button>
          ))}
        </div>
      </QueryState>
    </div>
  );
}

export function ProductionList({
  warehouseId,
  filters,
  onOpen,
  onCreate,
}: {
  warehouseId: string;
  filters?: ReactNode;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const query = useProductionJournal(warehouseId);
  const [search, setSearch] = usePageFilter('productionSearch');
  const rows = (query.data ?? []).filter((m) =>
    m.ingredientName.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div>
      <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск производства" value={search} onChange={setSearch} />
        {filters}
        <WorkspaceHeaderActions>
          <button className="btn-primary btn-md" onClick={onCreate}>
            Произвести
          </button>
        </WorkspaceHeaderActions>
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="overflow-x-auto">
          <table className="poster-table w-full min-w-[650px] text-left text-sm">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Полуфабрикат</th>
                <th>Количество</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-text-muted">
                    {search ? 'Производства не найдены. Измените поиск.' : 'Производств пока нет.'}
                  </td>
                </tr>
              )}
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">
                    <time dateTime={m.producedAt} title={formatDocumentDate(m.producedAt)}>
                      {formatDocumentListDate(m.producedAt)}
                    </time>
                  </td>
                  <td>
                    <button className="text-primary" onClick={() => onOpen(m.id)}>
                      {m.ingredientName}
                    </button>
                    {m.batchNumber && <span className="ml-2 text-xs text-text-muted">№ {m.batchNumber}</span>}
                  </td>
                  <td>{qty(m.actualQuantity, unitLabel(m.unit))}</td>
                  <td>{m.reversedAt ? 'Сторнирована' : 'Проведена'}</td>
                  <td>
                    <div className="poster-row-actions">
                      <button onClick={() => onOpen(m.id)}>Открыть</button>
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

export function formatDocumentListDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
