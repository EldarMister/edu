import type { ReactNode } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { exportCsv } from '@/lib/report-output';
import {
  qty,
  useProductionJournal,
  type ProductionBatch,
  type WarehouseLocation,
} from './api';
import { useStockDocuments, type StockDocument, type StockDocumentKind } from './stock-documents-api';
import { documentDisplayStatus, documentStatus, formatDocumentDate, formatVariance, WRITEOFF_REASONS, type StockDocumentDisplayStatus } from './stock-document-format';
import { useListPeriod } from './ListPeriodFilter';
import { balanceMoney } from './balance-format';
import { QueryState } from './WarehouseUi';
import { unitLabel } from './units';
import { usePageFilters } from './workspace-route';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { warehouseDay } from './warehouse-period';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './WarehouseMultiFilter';

export function DocumentList({
  kind, warehouseId, filters, locations, onOpen, onCreate, onCopy,
}: {
  kind: StockDocumentKind;
  warehouseId?: string;
  locations: WarehouseLocation[];
  filters?: ReactNode;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onCopy?: (id: string) => void;
}) {
  const [conditions, updateConditions] = usePageFilters({
    [kind + 'Search']: '', [kind + 'Status']: '', [kind + 'Reason']: '', [kind + 'Category']: '', [kind + 'Employee']: '',
    transferWarehouses: '',
    [kind + 'Page']: '1', [kind + 'Sort']: 'desc', warehouse: '',
    [kind + 'Period']: kind === 'transfer' ? 'month' : 'all', [kind + 'From']: '', [kind + 'To']: '',
  });
  const search = conditions[kind + 'Search'];
  const status = conditions[kind + 'Status'];
  const reason = conditions[kind + 'Reason'];
  const employeeFilter = conditions[kind + 'Employee'];
  const transfer = kind === 'transfer';
  const warehouseSelection = conditions.transferWarehouses || (transfer ? warehouseId ?? '' : '');
  const selectedWarehouses = transfer ? warehouseMultiFilterValues(warehouseSelection) : [];
  const categories = kind === 'writeoff' ? warehouseMultiFilterValues(conditions[kind + 'Category']) : [];
  const ascending = conditions[kind + 'Sort'] === 'asc';
  const changeFilter = (name: 'Search' | 'Status' | 'Reason' | 'Employee', value: string) => updateConditions({ [kind + name]: value, [kind + 'Page']: '1' });
  const period = useListPeriod(kind, kind === 'transfer' ? 'month' : 'all');
  const query = useStockDocuments(transfer ? undefined : warehouseId, kind, search);
  const categoryOptions = [...new Set([...categories, ...(query.data ?? []).flatMap((document) => document.categories ?? [])])]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const canCreate = can(`actions.${kind === 'inventory' ? 'warehouseCount' : kind === 'writeoff' ? 'warehouseWriteoff' : 'warehouseTransfer'}`);
  const inventory = kind === 'inventory';
  const statuses: StockDocumentDisplayStatus[] = inventory
    ? ['draft', 'submitted', 'posted', 'reopened', 'reversed'] : ['draft', 'submitted', 'posted', 'reversed'];
  const operationDate = (document: StockDocument) => document.countedAt ?? document.effectiveAt ?? document.postedAt ?? document.createdAt;
  const documentEmployee = (document: StockDocument) => document.postedByName ?? document.createdByName;
  const employees = transfer ? [...new Set((query.data ?? []).map(documentEmployee).filter((name): name is string => !!name))]
    .sort((a, b) => a.localeCompare(b, 'ru')) : [];
  const names = new Map(locations.map((location) => [location.id, location.name]));
  const rows = (query.data ?? []).filter((document) =>
    (!status || documentDisplayStatus(document) === status) &&
    (!reason || document.reason === reason) &&
    (!transfer || !employeeFilter || documentEmployee(document) === employeeFilter) &&
    (!selectedWarehouses.length || selectedWarehouses.includes(document.warehouseId) ||
      selectedWarehouses.includes(document.destinationWarehouseId ?? '')) &&
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
  const filtered = !!(search || status || reason || employeeFilter || categories.length || period.active || warehouseId || selectedWarehouses.length);
  const resetFilters = () => updateConditions({ [kind + 'Search']: '', [kind + 'Status']: '', [kind + 'Reason']: '',
    [kind + 'Page']: '1', [kind + 'Period']: 'all', [kind + 'From']: '', [kind + 'To']: '', [kind + 'Category']: '', [kind + 'Employee']: '', warehouse: '', transferWarehouses: '' });
  const products = (document: StockDocument) => document.productNames?.length
    ? document.productNames.join(', ') + (document.itemsCount > document.productNames.length ? '…' : '')
    : document.itemsCount ? document.itemsCount + ' позиций' : 'Без продуктов';
  const writeoffReason = (document: StockDocument) => WRITEOFF_REASONS.find((item) => item.value === document.reason)?.label ?? '—';
  const employee = (document: StockDocument) => documentEmployee(document) ?? '—';
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
  function exportTransfers() {
    exportCsv('Перемещения', columns.filter(Boolean), rows.map((document) => [
      formatDocumentDate(operationDate(document)), products(document), ...(costs ? [amount(document)] : []), employee(document), warehouses(document),
    ]));
  }
  const statusCell = (document: StockDocument) => {
    const state = documentDisplayStatus(document);
    return <span className="document-status" data-status={state}>{documentStatus(state)}</span>;
  };
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
        {transfer && <WarehouseMultiFilter label="Склады" value={warehouseSelection}
          options={locations.map(({ id, name }) => ({ value: id, label: name }))}
          onChange={(value) => updateConditions({ transferWarehouses: value, warehouse: '', transferPage: '1' })} />}
        {kind === 'writeoff' && <WarehouseMultiFilter label="Категории" value={conditions[kind + 'Category']}
          options={categoryOptions.map((category) => ({ value: category, label: category }))}
          onChange={(value) => updateConditions({ [kind + 'Category']: value, [kind + 'Page']: '1' })} />}
        {kind === 'writeoff' && <Select ariaLabel="Причина списания" value={reason} onChange={(value) => changeFilter('Reason', value)}
          options={[{ value: '', label: 'Причина' }, ...WRITEOFF_REASONS]} />}
        <details className="poster-list-filter">
          <summary>+ Фильтр{status || employeeFilter ? ' · ' + (Number(!!status) + Number(!!employeeFilter)) : ''}</summary>
          <div className="poster-list-filter-content">
            <Select ariaLabel="Статус документа" value={status} onChange={(value) => changeFilter('Status', value)} className="w-48"
              options={[{ value: '', label: 'Все статусы' }, ...statuses.map((value) => ({
                value, label: documentStatus(value),
              }))]} />
            {transfer && <Select ariaLabel="Сотрудник" value={employeeFilter} className="mt-2 w-48"
              onChange={(value) => changeFilter('Employee', value)} options={[
                { value: '', label: 'Все сотрудники' }, ...employees.map((name) => ({ value: name, label: name })),
              ]} />}
          </div>
        </details>
        {filtered && <button type="button" className="text-sm text-text-muted" onClick={resetFilters}>Сбросить всё</button>}
        {transfer && can('actions.exportReports') && <button type="button" className="btn-secondary btn-md" disabled={!rows.length}
          onClick={exportTransfers}>Экспорт CSV</button>}
        {canCreate && <button type="button" className="btn-primary btn-md ml-auto" onClick={onCreate}>Добавить</button>}
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
                <col style={{ width: transfer && canCreate && onCopy ? 164 : 88 }} />
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
                <td><div className="poster-row-actions">
                  <button type="button" onClick={() => onOpen(document.id)}>{document.status === 'draft' ? 'Ред.' : inventory ? 'Посмотреть' : 'Открыть'}</button>
                  {transfer && canCreate && onCopy && <button type="button" onClick={() => onCopy(document.id)}>Копировать</button>}
                </div></td>
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
            <span className="flex items-center justify-between gap-2 text-xs">{statusCell(document)}<span>{inventory && document.postedAt && !document.reopenedAt ? 'Проведена ' + formatDocumentDate(document.postedAt) : inventory ? document.createdByName : employee(document)}</span></span>
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
  warehouseId?: string;
  filters?: ReactNode;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const [state, update] = usePageFilters({ productionSearch: '', productionStatus: '', productionSort: 'desc', productionPage: '1' });
  const period = useListPeriod('production');
  const sort = state.productionSort === 'asc' ? 'asc' : 'desc';
  const status = ['posted', 'reversed'].includes(state.productionStatus) ? state.productionStatus : undefined;
  const parsedPage = Number(state.productionPage);
  const pageSize = 50;
  const query = useProductionJournal({ warehouseId, search: state.productionSearch.trim().slice(0, 160) || undefined,
    from: period.range.dateFrom, to: period.range.dateTo, status, sort,
    page: Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 1000000) : 1, pageSize });
  const rows = query.data?.rows ?? [];
  const totalRows = query.data?.totalRows ?? 0;
  const page = query.data?.page ?? 1;
  const lastPage = Math.ceil(totalRows / pageSize);
  const emptyLabel = state.productionSearch || status || period.active || warehouseId
    ? 'По выбранным условиям производств нет.' : 'Производств пока нет.';
  const fields = [
    { title: 'Дата', show: (batch: ProductionBatch) => <time dateTime={batch.producedAt} title={formatDocumentDate(batch.producedAt)}>
      {formatDocumentListDate(batch.producedAt)}</time> },
    { title: 'Склад', show: (batch: ProductionBatch) => batch.warehouseName ?? '—' },
    { title: 'Техкарты и полуфабрикаты', show: (batch: ProductionBatch) => <button type="button" className="text-primary text-left" onClick={() => onOpen(batch.id)}>
      {batch.ingredientName}{batch.batchNumber && <span className="ml-2 text-xs text-text-muted">№ {batch.batchNumber}</span>}</button> },
    { title: 'Комментарий', show: (batch: ProductionBatch) => batch.comment ?? '—' },
    { title: 'Кол-во', show: (batch: ProductionBatch) => qty(batch.actualQuantity, unitLabel(batch.unit)), numeric: true },
    ...(costs ? [{ title: 'Сумма', show: (batch: ProductionBatch) => batch.totalCost == null ? '—' : balanceMoney(batch.totalCost), numeric: true }] : []),
    { title: 'Сотрудник', show: (batch: ProductionBatch) => batch.actorName ?? '—' },
    { title: 'Статус', show: (batch: ProductionBatch) => batch.reversedAt ? 'Сторнирована' : 'Проведена' },
  ];
  return (
    <div>
      <WorkspaceHeaderCount count={query.isSuccess ? totalRows : undefined} />
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск производства" value={state.productionSearch} onChange={(value) => update({ productionSearch: value, productionPage: '1' })} />
        {period.filter}
        {filters}
        <Select ariaLabel="Статус производства" className="poster-filter h-9 min-w-36" value={status ?? ''}
          onChange={(value) => update({ productionStatus: value, productionPage: '1' })}
          options={[{ value: '', label: 'Все статусы' }, { value: 'posted', label: 'Проведена' }, { value: 'reversed', label: 'Сторнирована' }]} />
        {can('actions.warehouseProduce') && <button type="button" className="btn-primary btn-md ml-auto" onClick={onCreate}>Произвести</button>}
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className="poster-table w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                {fields.map((field) => field.title === 'Дата'
                  ? <th key={field.title} scope="col" aria-sort={sort === 'asc' ? 'ascending' : 'descending'}>
                    <button type="button" onClick={() => update({ productionSort: sort === 'asc' ? 'desc' : 'asc', productionPage: '1' })}>
                      Дата <span aria-hidden>{sort === 'asc' ? '↑' : '↓'}</span></button></th>
                  : <th key={field.title} scope="col" className={field.numeric ? 'text-right' : undefined}>{field.title}</th>)}
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr>
                  <td colSpan={fields.length} className="py-12 text-center text-text-muted">
                    {emptyLabel}
                  </td>
                </tr>
              )}
              {rows.map((row) => <tr key={row.id}>{fields.map((field) => <td key={field.title}
                className={field.numeric ? 'whitespace-nowrap text-right tabular-nums' : 'break-words'}>{field.show(row)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {rows.length > 0 && <button type="button" className="py-2 text-sm text-primary"
            onClick={() => update({ productionSort: sort === 'asc' ? 'desc' : 'asc', productionPage: '1' })}>
            {sort === 'asc' ? 'Сначала старые' : 'Сначала новые'}
          </button>}
          {rows.map((row) => <article key={row.id} className="py-3">
            <button type="button" className="font-medium text-primary" onClick={() => onOpen(row.id)}>{row.ingredientName}
              {row.batchNumber && <span className="ml-2 text-xs text-text-muted">№ {row.batchNumber}</span>}</button>
            <dl className="poster-balance-mobile-values mt-2">{fields.filter(({ title }) => title !== 'Техкарты и полуфабрикаты')
              .map((field) => <div key={field.title}><dt>{field.title}</dt><dd className="break-words">{field.show(row)}</dd></div>)}</dl>
          </article>)}
          {!rows.length && <p className="py-10 text-center text-sm text-text-muted">{emptyLabel}</p>}
        </div>
        {lastPage > 1 && <nav className="poster-balance-pagination" aria-label="Страницы производства">
          <button type="button" disabled={page <= 1} onClick={() => update({ productionPage: String(page - 1) })}>Назад</button>
          <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalRows)} из {totalRows}</span>
          <button type="button" disabled={page >= lastPage} onClick={() => update({ productionPage: String(page + 1) })}>Вперёд</button>
        </nav>}
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
