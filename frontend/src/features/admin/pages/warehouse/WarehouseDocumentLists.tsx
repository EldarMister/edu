import type { ReactNode } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import {
  qty,
  useProductionJournal,
  type WarehouseLocation,
} from './api';
import { useStockDocuments, type StockDocument, type StockDocumentKind, type StockDocumentStatus } from './stock-documents-api';
import { documentStatus, formatDocumentDate, formatVariance, WRITEOFF_REASONS } from './stock-document-format';
import { useListPeriod } from './ListPeriodFilter';
import { balanceMoney } from './balance-format';
import { QueryState } from './WarehouseUi';
import { unitLabel } from './units';
import { usePageFilter, usePageFilters } from './workspace-route';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { warehouseDay } from './warehouse-period';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './WarehouseMultiFilter';

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
  const [conditions, updateConditions] = usePageFilters({
    [kind + 'Search']: '', [kind + 'Status']: '', [kind + 'Reason']: '', [kind + 'Category']: '',
    [kind + 'Page']: '1', [kind + 'Sort']: 'desc', warehouse: '',
    [kind + 'Period']: kind === 'transfer' ? 'month' : 'all', [kind + 'From']: '', [kind + 'To']: '',
  });
  const search = conditions[kind + 'Search'];
  const status = conditions[kind + 'Status'];
  const reason = conditions[kind + 'Reason'];
  const categories = kind === 'writeoff' ? warehouseMultiFilterValues(conditions[kind + 'Category']) : [];
  const ascending = conditions[kind + 'Sort'] === 'asc';
  const changeFilter = (name: 'Search' | 'Status' | 'Reason', value: string) => updateConditions({ [kind + name]: value, [kind + 'Page']: '1' });
  const period = useListPeriod(kind, kind === 'transfer' ? 'month' : 'all');
  const query = useStockDocuments(warehouseId, kind, search);
  const categoryOptions = [...new Set([...categories, ...(query.data ?? []).flatMap((document) => document.categories ?? [])])]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const canCreate = can(`actions.${kind === 'inventory' ? 'warehouseCount' : kind === 'writeoff' ? 'warehouseWriteoff' : 'warehouseTransfer'}`);
  const inventory = kind === 'inventory';
  const transfer = kind === 'transfer';
  const operationDate = (document: StockDocument) => document.countedAt ?? document.effectiveAt ?? document.postedAt ?? document.createdAt;
  const names = new Map(locations.map((location) => [location.id, location.name]));
  const rows = (query.data ?? []).filter((document) =>
    (!status || document.status === status) &&
    (!reason || document.reason === reason) &&
    (!categories.length || document.categories?.some((category) => categories.includes(category))) &&
    period.includes(operationDate(document)),
  ).sort((a, b) => (new Date(operationDate(a)).getTime() - new Date(operationDate(b)).getTime()) * (ascending ? 1 : -1));
  const pageSize = 25;
  const pageCount = Math.ceil(rows.length / pageSize);
  const page = Math.min(Math.max(1, Number.parseInt(conditions[kind + 'Page'], 10) || 1), Math.max(1, pageCount));
  const visibleRows = inventory ? rows : rows.slice((page - 1) * pageSize, page * pageSize);
  const columns = inventory
    ? ['Склад', 'Проверка остатков на', 'Дата и время проведения', 'Тип', ...(costs ? ['Результат'] : []), 'Статус', '']
    : transfer
      ? ['Дата', 'Наименование', ...(costs ? ['Сумма'] : []), 'Сотрудник', 'Склады', '']
      : ['Дата', 'Склад', 'Товары', ...(costs ? ['Сумма'] : []), 'Сотрудник', 'Причина', ''];
  const filtered = !!(search || status || reason || categories.length || period.active || warehouseId);
  const resetFilters = () => updateConditions({ [kind + 'Search']: '', [kind + 'Status']: '', [kind + 'Reason']: '',
    [kind + 'Page']: '1', [kind + 'Period']: 'all', [kind + 'From']: '', [kind + 'To']: '', [kind + 'Category']: '', warehouse: '' });
  const products = (document: StockDocument) => document.productNames?.length
    ? document.productNames.join(', ') + (document.itemsCount > document.productNames.length ? '…' : '')
    : document.itemsCount ? document.itemsCount + ' позиций' : 'Без продуктов';
  const writeoffReason = (document: StockDocument) => WRITEOFF_REASONS.find((item) => item.value === document.reason)?.label ?? '—';
  const employee = (document: StockDocument) => document.postedByName ?? document.createdByName ?? '—';
  const warehouses = (document: StockDocument) =>
    (names.get(document.warehouseId) ?? 'Склад') + (document.destinationWarehouseId ? ' → ' + (names.get(document.destinationWarehouseId) ?? 'Склад') : '');
  const amount = (document: StockDocument) => document.varianceValue == null
    ? '—'
    : inventory ? formatVariance(document.varianceValue) : balanceMoney(Math.abs(document.varianceValue));
  const dateCell = (value: string | null) => value
    ? <time dateTime={value} title={formatDocumentDate(value)}>{formatDocumentListDate(value)}</time>
    : <span className="text-text-muted">—</span>;
  const dateColumn = inventory ? 1 : 0;
  const countTime = (document: StockDocument) => document.countedAt ?? document.postedAt;
  const statusCell = (document: StockDocument) =>
    <span className="document-status" data-status={document.status}>{documentStatus(document.status)}</span>;
  const empty = <div className="poster-list-empty">
    <svg aria-hidden viewBox="0 0 40 40" fill="none"><path d="M11 11h18l6 16v6H5v-6l6-16Z" stroke="currentColor" strokeWidth="2.5"/><path d="M6 26h8l3 5h6l3-5h8" stroke="currentColor" strokeWidth="2.5"/></svg>
    <h3>{filtered ? 'Ничего не найдено' : inventory ? 'Здесь будут инвентаризации' : transfer ? 'Здесь будут перемещения' : 'Здесь будут списания'}</h3>
    <p>{filtered ? 'Попробуйте изменить поиск или фильтры.' : inventory ? 'Добавьте инвентаризацию, чтобы сравнить фактические и расчётные остатки.' : 'Нажмите «Добавить», чтобы создать первый документ.'}</p>
    {filtered && <button type="button" className="mt-3 text-sm text-primary" onClick={resetFilters}>Сбросить фильтры</button>}
  </div>;
  return (
    <div className={inventory ? 'poster-inventory-list' : 'poster-register-surface'}>
      {inventory && <WorkspaceHeaderCount count={query.isSuccess ? rows.length : undefined} />}
      {inventory && <WorkspaceHeaderActions>{period.filter}</WorkspaceHeaderActions>}
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск документов" placeholder={inventory ? 'Быстрый поиск' : 'Поиск...'} value={search} onChange={(value) => changeFilter('Search', value)} />
        {!inventory && period.filter}
        {filters}
        {canCreate && <button type="button" className="btn-primary btn-md ml-auto" onClick={onCreate}>Добавить</button>}
        {kind === 'writeoff' && <WarehouseMultiFilter label="Категории" value={conditions[kind + 'Category']}
          options={categoryOptions.map((category) => ({ value: category, label: category }))}
          onChange={(value) => updateConditions({ [kind + 'Category']: value, [kind + 'Page']: '1' })} />}
        {kind === 'writeoff' && <Select ariaLabel="Причина списания" value={reason} onChange={(value) => changeFilter('Reason', value)}
          options={[{ value: '', label: 'Причина' }, ...WRITEOFF_REASONS]} />}
        <details className="poster-list-filter">
          <summary>+ Фильтр{status ? ' · 1' : ''}</summary>
          <div className="poster-list-filter-content">
            <Select ariaLabel="Статус документа" value={status} onChange={(value) => changeFilter('Status', value)} className="w-48"
              options={[{ value: '', label: 'Все статусы' }, ...['draft', 'submitted', 'posted', 'reversed'].map((value) => ({
                value, label: documentStatus(value as StockDocumentStatus),
              }))]} />
          </div>
        </details>
        {filtered && <button type="button" className="text-sm text-text-muted" onClick={resetFilters}>Сбросить всё</button>}
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
            <thead><tr>{columns.map((heading, index) => <th key={index} className={['Сумма', 'Результат'].includes(heading) ? 'text-right' : ''}
              aria-sort={index === dateColumn ? ascending ? 'ascending' : 'descending' : undefined}>
              {index === dateColumn ? <button type="button" className="flex items-center gap-2" onClick={() => updateConditions({ [kind + 'Sort']: ascending ? 'desc' : 'asc', [kind + 'Page']: '1' })}>
                {heading} <span aria-hidden="true">{ascending ? '↑' : '↓'}</span>
              </button> : heading}
            </th>)}</tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={columns.length}>{empty}</td></tr>}
              {visibleRows.map((document) => <tr key={document.id}>
                {inventory ? <>
                  <td><button className="text-primary" onClick={() => onOpen(document.id)}>{warehouses(document)}</button></td>
                  <td className="whitespace-nowrap">{countTime(document) ? dateCell(countTime(document)) : 'При проведении'}</td>
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
                  <td title={employee(document)}>
                    <span className="line-clamp-2 break-words">{employee(document)}</span>
                  </td>
                  <td title={transfer ? warehouses(document) : undefined}>
                    <span className="line-clamp-2 break-words">
                      {transfer ? warehouses(document) : writeoffReason(document)}
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
          {visibleRows.map((document) => <button key={document.id} className="block w-full space-y-2 p-4 text-left" onClick={() => onOpen(document.id)}>
            <span className="flex justify-between gap-2"><span className="font-medium text-primary">{inventory ? warehouses(document) : products(document)}</span>{costs && <span className="whitespace-nowrap">{amount(document)}</span>}</span>
            <span className="block text-xs text-text-muted">{inventory && !countTime(document) ? 'При проведении' : formatDocumentListDate(operationDate(document))} · {inventory ? document.mode === 'full' ? 'Полная' : 'Частичная' : warehouses(document)}</span>
            {kind === 'writeoff' && <span className="block text-xs text-text-secondary">Причина: {writeoffReason(document)}</span>}
            <span className="flex items-center justify-between gap-2 text-xs">{statusCell(document)}<span>{inventory && document.postedAt ? 'Проведена ' + formatDocumentDate(document.postedAt) : inventory ? document.createdByName : employee(document)}</span></span>
          </button>)}
        </div>
        {(!inventory || !!rows.length) && <div className="poster-register-footer flex flex-wrap items-center gap-4">
          {!inventory ? <nav aria-label="Страницы документов" className="flex flex-wrap items-center gap-3">
            <button type="button" className="min-h-8 px-1 disabled:opacity-35" aria-label="Первая страница" disabled={page <= 1} onClick={() => updateConditions({ [kind + 'Page']: '1' })}>«</button>
            <button type="button" className="min-h-8 px-1 disabled:opacity-35" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => updateConditions({ [kind + 'Page']: String(page - 1) })}>‹</button>
            <span>Страница {pageCount ? page : 0} из {pageCount}</span>
            <button type="button" className="min-h-8 px-1 disabled:opacity-35" aria-label="Следующая страница" disabled={!pageCount || page >= pageCount} onClick={() => updateConditions({ [kind + 'Page']: String(page + 1) })}>›</button>
            <button type="button" className="min-h-8 px-1 disabled:opacity-35" aria-label="Последняя страница" disabled={!pageCount || page >= pageCount} onClick={() => updateConditions({ [kind + 'Page']: String(pageCount) })}>»</button>
            <span>{rows.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, rows.length)} из {rows.length}</span>
          </nav> : <>Всего: {rows.length}</>}
          {costs && rows.length > 0 && <span>{inventory ? 'Результат' : 'Сумма'}: {rows.some((document) => document.varianceValue == null) ? '—' : inventory ? formatVariance(rows.reduce((sum, document) => sum + document.varianceValue!, 0)) : balanceMoney(rows.reduce((sum, document) => sum + Math.abs(document.varianceValue!), 0))}</span>}
        </div>}
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
  const { can } = usePermissions();
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
        {can('actions.warehouseProduce') && <button type="button" className="btn-primary btn-md ml-auto" onClick={onCreate}>Произвести</button>}
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
  const includeYear = warehouseDay(date).getUTCFullYear() !== warehouseDay().getUTCFullYear();
  const day = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Asia/Bishkek',
    ...(includeYear ? { year: 'numeric' } : {}) });
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
  return `${day}, ${time}`;
}
