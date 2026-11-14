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
import { useStockDocuments, type StockDocument, type StockDocumentKind, type StockDocumentStatus } from './stock-documents-api';
import { documentStatus, formatDocumentDate, formatVariance, WRITEOFF_REASONS } from './stock-document-format';
import { useListPeriod } from './ListPeriodFilter';
import { balanceMoney, balanceQuantity } from './balance-format';
import { QueryState } from './WarehouseUi';
import { unitLabel } from './units';
import { usePageFilter } from './workspace-route';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { useSuppliers } from './settings-api';

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
  const [supplier, setSupplier] = usePageFilter('supplySupplier');
  const [order, setOrder] = usePageFilter('supplyOrder', 'desc');
  const period = useListPeriod('supply');
  const [expanded, setExpanded] = useState<string>();
  const query = usePurchases({ warehouseId, search, status });
  const suppliers = useSuppliers();
  const rows = (query.data ?? []).filter((purchase) => (!supplier || purchase.supplier === supplier) && period.includes(purchase.date))
    .sort((a, b) => (order === 'asc' ? 1 : -1) * (new Date(a.date).getTime() - new Date(b.date).getTime() || a.number - b.number));
  const supplierNames = [...new Set([
    ...(suppliers.data ?? []).map((entry) => entry.name),
    ...(query.data ?? []).map((purchase) => purchase.supplier),
    ...(supplier ? [supplier] : []),
  ])].sort((a, b) => a.localeCompare(b, 'ru'));
  const locations = useWarehouseLocations();
  const warehouseNames = new Map(locations.data?.locations.map((location) => [location.id, location.name]));
  const defaultWarehouseId = locations.data?.locations.find((location) => location.isDefault)?.id ?? '';
  const emptyMessage =
    search || status || warehouseId || supplier || period.active
      ? 'Поставки не найдены. Измените поиск или фильтры.'
      : 'Поставок пока нет. Добавьте первую поставку.';
  return (
    <div>
      <WorkspaceHeaderCount count={query.data ? rows.length : undefined} />
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск поставок" value={search} onChange={setSearch} />
        <Select ariaLabel="Поставщик" value={supplier} onChange={setSupplier} className="h-9 min-w-36"
          options={[{ value: '', label: 'Поставщик' }, ...supplierNames.map((name) => ({ value: name, label: name }))]} />
        {filters}
        <details className="poster-list-filter">
        <summary>+ Фильтр{status ? ' · 1' : ''}</summary>
        <div className="poster-list-filter-content">
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
        </div>
        </details>
        <WorkspaceHeaderActions>
          {period.filter}
          <button className="btn-primary btn-md" onClick={onCreate}>
            Добавить
          </button>
        </WorkspaceHeaderActions>
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className="poster-table poster-supply-table w-full min-w-[980px] table-fixed text-left text-sm">
            <colgroup>{[4, 15, 12, 10, 15, 12, 9, 10, 13].map((width, index) => <col key={index} style={{ width: width + '%' }} />)}</colgroup>
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>
                {['№', 'Дата', 'Поставщик', 'Склад', 'Товары', 'Комментарий', 'Статус', 'Сумма', ''].map((h) => (
                  <th key={h} className={`px-4 py-3 font-medium ${h === 'Сумма' ? 'text-right' : ''}`}>
                    {h === 'Дата' ? <button onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}>Дата {order === 'desc' ? '↓' : '↑'}</button> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-text-muted">
                    {emptyMessage}
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <Fragment key={p.id}>
                  <tr className="border-b border-border hover:bg-background/50">
                    <td className="px-4 py-3">
                      <button className="font-medium text-primary" onClick={() => onOpen(p.id)}>
                        {p.number}
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <time dateTime={p.date} title={formatDocumentDate(p.date)}>
                        {formatDocumentListDate(p.date)}
                      </time>
                    </td>
                    <td className="truncate px-4 py-3" title={p.supplier}>{p.supplier}</td>
                    <td className="truncate px-4 py-3" title={warehouseNames.get(p.warehouseId ?? defaultWarehouseId)}>{warehouseNames.get(p.warehouseId ?? defaultWarehouseId) ?? '—'}</td>
                    <td className="max-w-48 truncate px-4 py-3" title={p.productNames?.join(', ')}>
                      {p.productNames?.join(', ') || '—'}{p.itemsCount > 3 && p.productNames?.length ? '…' : ''}
                    </td>
                    <td className="max-w-48 truncate px-4 py-3" title={p.note ?? undefined}>
                      {p.note || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="document-status" data-status={p.status}>
                        {purchaseStatus(p.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right font-medium tabular-nums">
                      {balanceMoney(p.totalAmount)}
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
                    <tr className="poster-supply-detail-row">
                      <td colSpan={9} className="bg-background/60 p-4">
                        <SupplyLines id={p.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="px-4 py-3" colSpan={7}>
                  Итого
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {balanceMoney(rows.reduce((sum, p) => sum + p.totalAmount, 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {!rows.length && <p className="py-10 text-center text-sm text-text-muted">{emptyMessage}</p>}
          {rows.map((p) => (
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
                    {formatDocumentListDate(p.date)} · {warehouseNames.get(p.warehouseId ?? defaultWarehouseId) ?? 'Склад'} ·{' '}
                    {purchaseStatus(p.status)}
                  </span>
                </span>
                <span className="text-sm font-medium">{money(p.totalAmount)}</span>
              </button>
              {!!p.productNames?.length && <p className="text-sm text-text-secondary">{p.productNames.join(', ')}{p.itemsCount > 3 ? '…' : ''}</p>}
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
  return status === 'draft' ? 'Черновик' : status === 'completed' ? 'Проведена' : 'Отменена';
}
function SupplyLines({ id }: { id: string }) {
  const q = usePurchase(id);
  return (
    <QueryState pending={q.isPending} error={q.error}>
      <div className="overflow-x-auto">
        <table className="poster-supply-details w-full min-w-[420px] text-sm">
        <thead><tr><th>Товар</th><th className="w-32 text-right">Количество</th><th className="w-32 text-right">Сумма</th></tr></thead>
        <tbody>
        {q.data?.items?.map((i) => (
          <tr key={i.id}>
            <td>{i.ingredientName}</td>
            <td className="whitespace-nowrap text-right tabular-nums">{balanceQuantity(i.quantity, i.unit, i.packageId ? 'count' : undefined)}</td>
            <td className="whitespace-nowrap text-right tabular-nums">{balanceMoney(i.total)}</td>
          </tr>
        ))}
        </tbody></table>
      </div>
    </QueryState>
  );
}

export function DocumentList({
  kind, warehouseId, filters, locations, onOpen, onCreate,
}: {
  kind: StockDocumentKind;
  warehouseId?: string;
  locations: WarehouseLocation[];
  filters?: ReactNode;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const [search, setSearch] = usePageFilter(kind + 'Search');
  const [status, setStatus] = usePageFilter(kind + 'Status');
  const [reason, setReason] = usePageFilter(kind + 'Reason');
  const period = useListPeriod(kind, kind === 'transfer' ? 'month' : 'all');
  const query = useStockDocuments(warehouseId, kind, search);
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const inventory = kind === 'inventory';
  const transfer = kind === 'transfer';
  const operationDate = (document: StockDocument) => inventory ? document.createdAt : document.postedAt ?? document.createdAt;
  const names = new Map(locations.map((location) => [location.id, location.name]));
  const rows = (query.data ?? []).filter((document) =>
    (!status || document.status === status) &&
    (!reason || document.reason === reason) &&
    period.includes(operationDate(document)),
  ).sort((a, b) => new Date(operationDate(b)).getTime() - new Date(operationDate(a)).getTime());
  const columns = inventory
    ? ['Склад', 'Начало', 'Дата и время проведения', 'Тип', ...(costs ? ['Результат'] : []), 'Статус', '']
    : transfer
      ? ['Дата', 'Наименование', ...(costs ? ['Сумма'] : []), 'Сотрудник', 'Склады', '']
      : ['Дата', 'Склад', 'Товары', ...(costs ? ['Сумма'] : []), 'Сотрудник', 'Причина', ''];
  const filtered = !!(search || status || reason || period.active);
  const products = (document: StockDocument) => document.productNames?.length
    ? document.productNames.join(', ') + (document.itemsCount > document.productNames.length ? '…' : '')
    : document.itemsCount + ' позиций';
  const warehouses = (document: StockDocument) =>
    (names.get(document.warehouseId) ?? 'Склад') + (document.destinationWarehouseId ? ' → ' + (names.get(document.destinationWarehouseId) ?? 'Склад') : '');
  const amount = (document: StockDocument) => document.varianceValue == null
    ? '—'
    : inventory ? formatVariance(document.varianceValue) : balanceMoney(Math.abs(document.varianceValue));
  const dateCell = (value: string | null) => value
    ? <time dateTime={value} title={formatDocumentDate(value)}>{formatDocumentListDate(value)}</time>
    : <span className="text-text-muted">—</span>;
  const statusCell = (document: StockDocument) =>
    <span className="document-status" data-status={document.status}>{documentStatus(document.status)}</span>;
  const empty = <div className="poster-list-empty">
    <svg aria-hidden viewBox="0 0 40 40" fill="none"><path d="M11 11h18l6 16v6H5v-6l6-16Z" stroke="currentColor" strokeWidth="2.5"/><path d="M6 26h8l3 5h6l3-5h8" stroke="currentColor" strokeWidth="2.5"/></svg>
    <h3>{filtered ? 'Ничего не найдено' : inventory ? 'Здесь будут инвентаризации' : transfer ? 'Здесь будут перемещения' : 'Здесь будут списания'}</h3>
    <p>{filtered ? 'Попробуйте изменить поиск или фильтры.' : inventory ? 'Добавьте инвентаризацию, чтобы сравнить фактические и расчётные остатки.' : 'Нажмите «Добавить», чтобы создать первый документ.'}</p>
  </div>;
  return (
    <div className={inventory ? 'poster-inventory-list' : 'poster-register-surface'}>
      {inventory && <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />}
      <WorkspaceHeaderActions>
        {inventory && period.filter}
        <button className="btn-primary btn-md" onClick={onCreate}>Добавить</button>
      </WorkspaceHeaderActions>
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск документов" value={search} onChange={setSearch} />
        {!inventory && period.filter}
        {filters}
        {kind === 'writeoff' && <Select ariaLabel="Причина списания" value={reason} onChange={setReason}
          options={[{ value: '', label: 'Причина' }, ...WRITEOFF_REASONS]} />}
        <details className="poster-list-filter">
          <summary>+ Фильтр{status ? ' · 1' : ''}</summary>
          <div className="poster-list-filter-content">
            <Select ariaLabel="Статус документа" value={status} onChange={setStatus} className="w-48"
              options={[{ value: '', label: 'Все статусы' }, ...['draft', 'submitted', 'posted', 'reversed'].map((value) => ({
                value, label: documentStatus(value as StockDocumentStatus),
              }))]} />
          </div>
        </details>
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className={`poster-table poster-register-table w-full min-w-[780px] text-left text-sm ${inventory ? '' : 'table-fixed'}`}>
            {!inventory && (
              <colgroup>
                <col style={{ width: transfer ? '14%' : '13%' }} />
                {!transfer && <col style={{ width: '14%' }} />}
                <col style={{ width: transfer ? (costs ? '34%' : '44%') : (costs ? '29%' : '39%') }} />
                {costs && <col style={{ width: '10%' }} />}
                <col style={{ width: transfer ? '16%' : '14%' }} />
                <col />
                <col style={{ width: 88 }} />
              </colgroup>
            )}
            <thead><tr>{columns.map((heading, index) => <th key={index} className={['Сумма', 'Результат'].includes(heading) ? 'text-right' : ''}>{heading}</th>)}</tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={columns.length}>{empty}</td></tr>}
              {rows.map((document) => <tr key={document.id}>
                {inventory ? <>
                  <td><button className="text-primary" onClick={() => onOpen(document.id)}>{warehouses(document)}</button></td>
                  <td className="whitespace-nowrap">{dateCell(document.createdAt)}</td>
                  <td className="whitespace-nowrap">{dateCell(document.postedAt)}</td>
                  <td>{document.mode === 'full' ? 'Полная' : 'Частичная'}</td>
                  {costs && <td className="whitespace-nowrap text-right tabular-nums">{amount(document)}</td>}
                  <td>{statusCell(document)}</td>
                </> : <>
                  <td className="whitespace-normal">
                    <button className="block max-w-full whitespace-normal text-left text-primary" onClick={() => onOpen(document.id)}>{dateCell(operationDate(document))}</button>
                    {document.status !== 'posted' && <div className="mt-1 whitespace-normal">{statusCell(document)}</div>}
                  </td>
                  {!transfer && <td title={warehouses(document)}><span className="line-clamp-2 break-words">{warehouses(document)}</span></td>}
                  <td title={products(document)}>
                    <button className="line-clamp-2 w-full break-words text-left" onClick={() => onOpen(document.id)}>{products(document)}</button>
                  </td>
                  {costs && <td className="whitespace-nowrap text-right tabular-nums" title={amount(document)}><span className="block truncate">{amount(document)}</span></td>}
                  <td title={document.postedByName ?? document.createdByName ?? undefined}>
                    <span className="line-clamp-2 break-words">{document.postedByName ?? document.createdByName ?? '—'}</span>
                  </td>
                  <td title={transfer ? warehouses(document) : undefined}>
                    <span className="line-clamp-2 break-words">
                      {transfer ? warehouses(document) : (WRITEOFF_REASONS.find((item) => item.value === document.reason)?.label ?? '—')}
                    </span>
                  </td>
                </>}
                <td><div className="poster-row-actions"><button onClick={() => onOpen(document.id)}>{document.status === 'draft' ? 'Ред.' : 'Открыть'}</button></div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {!rows.length && empty}
          {rows.map((document) => <button key={document.id} className="block w-full space-y-2 p-4 text-left" onClick={() => onOpen(document.id)}>
            <span className="flex justify-between gap-2"><span className="font-medium text-primary">{inventory ? warehouses(document) : products(document)}</span>{costs && <span className="whitespace-nowrap">{amount(document)}</span>}</span>
            <span className="block text-xs text-text-muted">{formatDocumentDate(operationDate(document))} · {inventory ? document.mode === 'full' ? 'Полная' : 'Частичная' : warehouses(document)}</span>
            <span className="flex items-center justify-between gap-2 text-xs">{statusCell(document)}<span>{inventory && document.postedAt ? 'Проведена ' + formatDocumentDate(document.postedAt) : document.createdByName}</span></span>
          </button>)}
        </div>
        {!!rows.length && <div className="poster-register-footer">Всего: {rows.length}{costs && <span>{inventory ? 'Результат' : 'Сумма'}: {rows.some((document) => document.varianceValue == null) ? '—' : inventory ? formatVariance(rows.reduce((sum, document) => sum + document.varianceValue!, 0)) : balanceMoney(rows.reduce((sum, document) => sum + Math.abs(document.varianceValue!), 0))}</span>}</div>}
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
