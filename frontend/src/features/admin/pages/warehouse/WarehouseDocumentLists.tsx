import { IconExport } from '@/features/admin/components/icons';
import { Fragment, useState, type ReactNode } from 'react';
import { ColumnButton } from '../../components/ColumnControl';
import { RowIconButton } from '../../components/RowIconButton';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { useNotifications } from '@/store/notifications';
import { apiError } from '@/lib/api';
import {
  qty,
  useProductionJournal,
  type ProductionBatch,
  type WarehouseLocation,
} from './api';
import { downloadTransferRegister, useStockDocument, useStockDocuments, useWriteoffReasons, type StockDocument, type StockDocumentKind } from './stock-documents-api';
import { documentDisplayStatus, documentStatus, formatDocumentDate, formatVariance, WRITEOFF_REASONS, writeoffPostedTotals, writeoffReasonLabel, type StockDocumentDisplayStatus } from './stock-document-format';
import { exportCsv } from '@/lib/report-output';
import { useListPeriod } from './ListPeriodFilter';
import { balanceMoney } from './balance-format';
import { QueryState } from './WarehouseUi';
import { unitLabel } from './units';
import { usePageFilters } from './workspace-route';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { warehouseDay } from './warehouse-period';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './WarehouseMultiFilter';

import { visibleWarehouseColumns, WarehouseColumnSettings } from './WarehouseColumnSettings';

const registerColumnLabels = {
  date: 'Дата', products: 'Товары', note: 'Комментарий', amount: 'Сумма', employee: 'Сотрудник',
  warehouses: 'Склад', categories: 'Категории', reason: 'Причина',
};
type RegisterColumn = keyof typeof registerColumnLabels;
const transferColumns: RegisterColumn[] = ['date', 'products', 'note', 'amount', 'employee', 'warehouses'];
const writeoffColumns: RegisterColumn[] = ['date', 'warehouses', 'products', 'amount', 'employee', 'reason', 'categories', 'note'];
export const noWriteoffReason = '__none';

function parseDocumentAmount(value: string) {
  const parsed = Number(value.trim().replace(',', '.'));
  return value.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function DocumentList({
  kind, warehouseId, filters, locations, onOpen, onCreate, onCopy,
}: {
  kind: Exclude<StockDocumentKind, 'supplier_return'>;
  warehouseId?: string;
  locations: WarehouseLocation[];
  filters?: ReactNode;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onCopy?: (id: string) => void;
}) {
  const [conditions, updateConditions] = usePageFilters({
    [kind + 'Search']: '', [kind + 'Status']: '', [kind + 'Reason']: '', [kind + 'Category']: '', [kind + 'Employee']: '',
    [kind + 'Warehouses']: '', [kind + 'Comment']: '', [kind + 'MinAmount']: '', [kind + 'MaxAmount']: '',
    [kind + 'Page']: '1', [kind + 'Sort']: 'desc', warehouse: '',
    [kind + 'Period']: kind === 'transfer' ? 'month' : 'all', [kind + 'From']: '', [kind + 'To']: '',
  });
  const search = conditions[kind + 'Search'];
  const status = conditions[kind + 'Status'];
  const reason = conditions[kind + 'Reason'];
  const employeeFilter = conditions[kind + 'Employee'];
  const transfer = kind === 'transfer';
  const inventory = kind === 'inventory';
  const writeoff = kind === 'writeoff';
  const reasons = useWriteoffReasons(writeoff, true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggle = (id: string) => setExpanded((last) => last === id ? null : id);
  const warehouseSelection = conditions[kind + 'Warehouses'] || warehouseId || '';
  const selectedWarehouses = inventory ? [] : warehouseMultiFilterValues(warehouseSelection);
  const categories = kind === 'writeoff' ? warehouseMultiFilterValues(conditions.writeoffCategory) : [];
  const ascending = conditions[kind + 'Sort'] === 'asc';
  const changeFilter = (name: 'Search' | 'Status' | 'Reason' | 'Employee' | 'Comment' | 'MinAmount' | 'MaxAmount', value: string) =>
    updateConditions({ [kind + name]: value, [kind + 'Page']: '1' });
  const period = useListPeriod(kind, transfer ? 'month' : 'all');
  const query = useStockDocuments(inventory ? warehouseId : undefined, kind, search);
  const categoryOptions = [...new Set([...categories, ...(query.data ?? []).flatMap((document) => document.categories ?? [])])]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const [columnPreference, saveColumns] = useColumnPreference(transfer ? 'warehouse-transfers' : 'warehouse-writeoffs');
  const [editingColumns, setEditingColumns] = useState(false);
  const [exporting, setExporting] = useState(false);
  const notify = useNotifications((state) => state.push);
  const availableColumns = (transfer ? transferColumns : writeoffColumns).filter((key) => costs || key !== 'amount');
  const defaultColumns = transfer ? availableColumns : availableColumns.filter((key) => key !== 'categories' && key !== 'note');
  const selectedColumns = visibleWarehouseColumns(columnPreference, defaultColumns, availableColumns);
  function columnLabel(key: RegisterColumn) {
    if (transfer && key === 'products') return 'Наименование';
    if (transfer && key === 'warehouses') return 'Склады';
    return registerColumnLabels[key];
  }
  const comment = inventory ? '' : conditions[kind + 'Comment'].trim().toLocaleLowerCase('ru');
  const minAmount = !inventory && costs ? parseDocumentAmount(conditions[kind + 'MinAmount']) : null;
  const maxAmount = !inventory && costs ? parseDocumentAmount(conditions[kind + 'MaxAmount']) : null;
  const extraFilterCount = Number(!!status) + Number(!!employeeFilter) + Number(!!comment) + Number(minAmount != null || maxAmount != null);
  const canCreate = can(`actions.${kind === 'inventory' ? 'warehouseCount' : kind === 'writeoff' ? 'warehouseWriteoff' : 'warehouseTransfer'}`);
  const statuses: StockDocumentDisplayStatus[] = inventory
    ? ['draft', 'submitted', 'posted', 'reopened', 'reversed'] : ['draft', 'submitted', 'posted', 'reversed'];
  const operationDate = (document: StockDocument) => document.countedAt ?? document.effectiveAt ?? document.postedAt ?? document.createdAt;
  const documentEmployee = (document: StockDocument) => document.postedByName ?? document.createdByName;
  const employees = !inventory ? [...new Set((query.data ?? []).map(documentEmployee).filter((name): name is string => !!name))]
    .sort((a, b) => a.localeCompare(b, 'ru')) : [];
  const names = new Map(locations.map((location) => [location.id, location.name]));
  const rows = (query.data ?? []).filter((document) =>
    (!status || documentDisplayStatus(document) === status) &&
    (!reason || (document.writeoffReasonId ?? document.reason ?? noWriteoffReason) === reason) &&
    (inventory || !employeeFilter || documentEmployee(document) === employeeFilter) &&
    (!comment || document.note?.toLocaleLowerCase('ru').includes(comment)) &&
    (minAmount == null || (document.varianceValue != null && Math.abs(document.varianceValue) >= minAmount)) &&
    (maxAmount == null || (document.varianceValue != null && Math.abs(document.varianceValue) <= maxAmount)) &&
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
    : [...selectedColumns.map(columnLabel), ''];
  const filtered = !!(search || reason || extraFilterCount || categories.length || period.active || warehouseId || selectedWarehouses.length);
  const resetFilters = () => updateConditions({ [kind + 'Search']: '', [kind + 'Status']: '', [kind + 'Reason']: '',
    [kind + 'Page']: '1', [kind + 'Period']: 'all', [kind + 'From']: '', [kind + 'To']: '', [kind + 'Category']: '',
    [kind + 'Employee']: '', [kind + 'Warehouses']: '', [kind + 'Comment']: '', [kind + 'MinAmount']: '', [kind + 'MaxAmount']: '', warehouse: '' });
  const products = (document: StockDocument) => document.productNames?.length
    ? document.productNames.join(', ') + (document.itemsCount > document.productNames.length ? '…' : '')
    : document.itemsCount ? document.itemsCount + ' позиций' : 'Без продуктов';
  const employee = (document: StockDocument) => documentEmployee(document) ?? '—';
  const warehouses = (document: StockDocument) =>
    (names.get(document.warehouseId) ?? 'Склад') + (document.destinationWarehouseId ? ' → ' + (names.get(document.destinationWarehouseId) ?? 'Склад') : '');
  const amount = (document: StockDocument) => document.varianceValue == null
    ? '—'
    : inventory ? formatVariance(document.varianceValue) : balanceMoney(Math.abs(document.varianceValue));
  const dateCell = (value: string | null) => value
    ? <time dateTime={value} title={formatDocumentDate(value)}>{formatDocumentListDate(value)}</time>
    : <span className="text-text-muted">—</span>;
  const dateColumn = inventory ? 1 : selectedColumns.indexOf('date');
  const countTime = (document: StockDocument) => document.countedAt ?? document.postedAt;
  async function exportTransfers() {
    setExporting(true);
    try {
      await downloadTransferRegister(rows.map(({ id }) => id), selectedColumns);
    } catch (error) {
      notify({ message: apiError(error), at: new Date().toISOString() });
    } finally {
      setExporting(false);
    }
  }
  const statusCell = (document: StockDocument) => {
    const state = documentDisplayStatus(document);
    return <span className="document-status" data-status={state}>{documentStatus(state)}</span>;
  };
  const registerDate = (document: StockDocument) => <>
    <button type="button" className="flex max-w-full items-center gap-2 whitespace-normal text-left text-primary"
      aria-expanded={writeoff ? expanded === document.id : undefined} onClick={() => writeoff ? toggle(document.id) : onOpen(document.id)}>
      {writeoff && <span aria-hidden>{expanded === document.id ? '⌄' : '›'}</span>}
      {dateCell(operationDate(document))}
    </button>
    {document.status !== 'posted' && <div className="mt-1 whitespace-normal">{statusCell(document)}</div>}
  </>;
  function registerCell(key: RegisterColumn, document: StockDocument) {
    if (key === 'date') return <td key={key}>{registerDate(document)}</td>;
    if (key === 'products') return <td key={key} title={products(document)}>
      <button className="line-clamp-2 w-full break-words text-left" onClick={() => onOpen(document.id)}>{products(document)}</button>
    </td>;
    if (key === 'amount') return <td key={key} className="whitespace-nowrap text-right tabular-nums" title={amount(document)}>{amount(document)}</td>;
    const values = {
      note: document.note || '—',
      employee: employee(document),
      warehouses: warehouses(document),
      categories: document.categories?.join(', ') || '—',
      reason: writeoffReasonLabel(document),
    };
    const value = values[key];
    return <td key={key} title={value}><span className="line-clamp-2 break-words">{value}</span></td>;
  }
  const postedTotals = writeoffPostedTotals(rows);
  function exportWriteoffs() {
    exportCsv('Списания', selectedColumns.map(columnLabel), rows.map((document) => {
      const cells = { date: formatDocumentDate(operationDate(document)), warehouses: warehouses(document),
        products: products(document), note: document.note ?? '', amount: amount(document), employee: employee(document),
        categories: document.categories?.join(', ') ?? '', reason: writeoffReasonLabel(document) };
      return selectedColumns.map((column) => cells[column]);
    }));
  }
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
      {writeoff && <WorkspaceHeaderActions>
        {can('actions.exportReports') && <button type="button" className="btn-secondary btn-md" disabled={!rows.length}
          onClick={exportWriteoffs}><IconExport />Экспорт CSV</button>}
        {canCreate && <button type="button" className="btn-primary btn-md" onClick={onCreate}>Добавить</button>}
      </WorkspaceHeaderActions>}
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск документов" placeholder={inventory ? 'Быстрый поиск' : 'Поиск...'} value={search} onChange={(value) => changeFilter('Search', value)} />
        {!inventory && period.filter}
        {filters}
        {!inventory && <WarehouseMultiFilter label={transfer ? 'Склады' : 'Склад'} value={warehouseSelection}
          options={locations.map(({ id, name }) => ({ value: id, label: name }))}
          onChange={(value) => updateConditions({ [kind + 'Warehouses']: value, warehouse: '', [kind + 'Page']: '1' })} />}
        {kind === 'writeoff' && <WarehouseMultiFilter label="Категории" value={conditions[kind + 'Category']}
          options={categoryOptions.map((category) => ({ value: category, label: category }))}
          onChange={(value) => updateConditions({ [kind + 'Category']: value, [kind + 'Page']: '1' })} />}
        {kind === 'writeoff' && <Select ariaLabel="Причина списания" value={reason} onChange={(value) => changeFilter('Reason', value)}
          options={[{ value: '', label: 'Причина' }, { value: noWriteoffReason, label: 'Без причины' },
            ...(reasons.data?.map(({ id, label, archived }) => ({ value: id, label: archived ? `${label} (удалена)` : label })) ?? WRITEOFF_REASONS)]} />}
        <details className="poster-list-filter">
          <summary>+ Фильтр{extraFilterCount ? ' · ' + extraFilterCount : ''}</summary>
          <div className="poster-list-filter-content">
            <Select ariaLabel="Статус документа" value={status} onChange={(value) => changeFilter('Status', value)} className="w-48"
              options={[{ value: '', label: 'Все статусы' }, ...statuses.map((value) => ({
                value, label: documentStatus(value),
              }))]} />
            {!inventory && <Select ariaLabel="Сотрудник" value={employeeFilter} className="mt-2 w-48"
              onChange={(value) => changeFilter('Employee', value)} options={[
                { value: '', label: 'Все сотрудники' }, ...employees.map((name) => ({ value: name, label: name })),
              ]} />}
            {!inventory && <input aria-label="Комментарий" placeholder="Комментарий" className="input mt-2 w-48"
              value={conditions[kind + 'Comment']}
              onChange={(event) => changeFilter('Comment', event.target.value)} />}
            {!inventory && costs && <fieldset className="mt-2 w-48">
              <legend className="text-xs text-text-muted">Сумма, с</legend>
              <div className="flex gap-2">
                <input aria-label="Сумма от" placeholder="От" className="input min-w-0 w-1/2" type="number" min="0" step="any"
                  value={conditions[kind + 'MinAmount']}
                  onChange={(event) => changeFilter('MinAmount', event.target.value)} />
                <input aria-label="Сумма до" placeholder="До" className="input min-w-0 w-1/2" type="number" min="0" step="any"
                  value={conditions[kind + 'MaxAmount']}
                  onChange={(event) => changeFilter('MaxAmount', event.target.value)} />
              </div>
            </fieldset>}
          </div>
        </details>
        {filtered && <button type="button" className="text-sm text-text-muted" onClick={resetFilters}>Сбросить всё</button>}
        {!inventory && <ColumnButton onClick={() => setEditingColumns(true)} />}
        {transfer && can('actions.exportReports') && <button type="button" className="btn-secondary btn-md" disabled={!rows.length || exporting}
          onClick={exportTransfers}><IconExport />Экспорт Excel</button>}
        {!writeoff && canCreate && <button type="button" className="btn-primary btn-md ml-auto" onClick={onCreate}>Добавить</button>}
      </div>
      {!inventory && editingColumns && <WarehouseColumnSettings columns={selectedColumns} defaults={availableColumns} resetColumns={defaultColumns}
        label={columnLabel} onClose={() => setEditingColumns(false)}
        onApply={(selection) => {
          const joined = selection.join(',');
          saveColumns(joined === defaultColumns.join(',') ? '' : joined);
          setEditingColumns(false);
        }} />}
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className="poster-table poster-register-table w-full min-w-[780px] text-left text-sm">
            <thead><tr>{columns.map((heading, index) => <th key={index} scope="col" className={['Сумма', 'Результат'].includes(heading) ? 'text-right' : ''}
              aria-sort={index === dateColumn ? ascending ? 'ascending' : 'descending' : undefined}>
              {index === dateColumn ? <button type="button" className="flex items-center gap-2" onClick={() => updateConditions({ [kind + 'Sort']: ascending ? 'desc' : 'asc', [kind + 'Page']: '1' })}>
                {heading} <span aria-hidden="true">{ascending ? '↑' : '↓'}</span>
              </button> : heading}
            </th>)}</tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={columns.length}>{empty}</td></tr>}
              {visibleRows.map((document) => <Fragment key={document.id}><tr>
                {inventory ? <>
                  <td><button className="text-primary" onClick={() => onOpen(document.id)}>{warehouses(document)}</button></td>
                  <td className="whitespace-nowrap">{countTime(document) ? dateCell(countTime(document)) : 'При проведении'}</td>
                  <td className="whitespace-nowrap">{dateCell(document.postedAt)}</td>
                  <td>{document.mode === 'full' ? 'Полная' : 'Частичная'}</td>
                  {costs && <td className="whitespace-nowrap text-right tabular-nums">{amount(document)}</td>}
                  <td>{statusCell(document)}</td>
                </> : selectedColumns.map((key) => registerCell(key, document))}
                <td><div className="poster-row-actions">
                  {writeoff && dateColumn < 0 && <button type="button" aria-expanded={expanded === document.id} onClick={() => toggle(document.id)}>Состав</button>}
                  {document.status === 'draft' ? <RowIconButton icon="edit" label="Редактировать документ" onClick={() => onOpen(document.id)} />
                    : <button type="button" onClick={() => onOpen(document.id)}>{inventory ? 'Посмотреть' : 'Открыть'}</button>}
                  {transfer && canCreate && onCopy && <button type="button" onClick={() => onCopy(document.id)}>Копировать</button>}
                </div></td>
              </tr>
              {writeoff && expanded === document.id && <tr><td colSpan={columns.length} className="!bg-background !p-3">
                <WriteoffRegisterDetails id={document.id} costs={costs} />
              </td></tr>}</Fragment>)}
            </tbody>
            {writeoff && rows.length > 0 && <tfoot><tr className="border-t border-border font-medium">
              {selectedColumns.map((column, index) => <td key={column} className={column === 'amount' ? 'text-right tabular-nums' : ''}>
                {column === 'amount' ? <>{index === 0 && 'Итого: '}{balanceMoney(postedTotals.amount)}{postedTotals.partial && ' · неполная оценка'}</>
                  : index === 0 ? `Проведено: ${postedTotals.count}` : null}
              </td>)}
              <td />
            </tr></tfoot>}
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {!rows.length && empty}
          {visibleRows.map((document) => <div key={document.id}><button className="block w-full space-y-2 p-4 text-left" onClick={() => onOpen(document.id)}>
            <span className="flex justify-between gap-2"><span className="font-medium text-primary">{inventory ? warehouses(document) : products(document)}</span>{costs && (inventory || selectedColumns.includes('amount')) && <span className="whitespace-nowrap">{amount(document)}</span>}</span>
            <span className="block text-xs text-text-muted">{inventory && !countTime(document) ? 'При проведении' : formatDocumentListDate(operationDate(document))} · {inventory ? document.mode === 'full' ? 'Полная' : 'Частичная' : warehouses(document)}</span>
            {!inventory && selectedColumns.includes('note') && document.note && <span className="block text-xs text-text-secondary">{document.note}</span>}
            {kind === 'writeoff' && selectedColumns.includes('reason') && <span className="block text-xs text-text-secondary">Причина: {writeoffReasonLabel(document)}</span>}
            <span className="flex items-center justify-between gap-2 text-xs">{statusCell(document)}<span>{inventory && document.postedAt && !document.reopenedAt ? 'Проведена ' + formatDocumentDate(document.postedAt) : inventory ? document.createdByName : employee(document)}</span></span>
          </button>{writeoff && <div className="px-4 pb-3">
            <button type="button" className="text-sm text-primary" aria-expanded={expanded === document.id}
              onClick={() => toggle(document.id)}>Позиции списания</button>
            {expanded === document.id && <div className="mt-2 bg-background"><WriteoffRegisterDetails id={document.id} costs={costs} /></div>}
          </div>}</div>)}
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
          {!writeoff && costs && rows.length > 0 && <span>{inventory ? 'Результат' : 'Сумма'}: {rows.some((document) => document.varianceValue == null) ? '—' : inventory ? formatVariance(rows.reduce((sum, document) => sum + document.varianceValue!, 0)) : balanceMoney(rows.reduce((sum, document) => sum + Math.abs(document.varianceValue!), 0))}</span>}
          {writeoff && costs && rows.length > 0 && <span className="md:hidden">Итого по проведённым {balanceMoney(postedTotals.amount)}{postedTotals.partial && ' · неполная оценка'}</span>}
        </div>}
      </QueryState>
    </div>
  );
}

function WriteoffRegisterDetails({ id, costs }: { id: string; costs: boolean }) {
  const query = useStockDocument(id);
  const document = query.data;
  const lines = document?.sourceLines?.map((line) => ({ id: line.sourceLineId, name: line.name, details: line.details,
    quantity: line.quantity, unit: line.packageName ?? line.unit, cost: line.total }))
    ?? (document?.items ?? []).map((line) => ({ id: line.ingredientId, name: line.name, details: undefined,
      quantity: line.quantity, unit: line.unit, cost: line.value }));
  return <QueryState pending={query.isPending} error={query.error} empty={!lines.length}>
    <div className="overflow-x-auto"><table className="poster-table w-full min-w-[400px] text-left text-sm">
      <thead><tr><th>Наименование</th><th>Детали</th><th>Количество</th>{costs && <th className="text-right">Сумма</th>}</tr></thead>
      <tbody>{lines.map((line) => <tr key={line.id}>
        <td>{line.name}</td><td className="whitespace-normal break-words">{line.details || '—'}</td>
        <td className="whitespace-nowrap">{line.quantity == null ? '—' : qty(line.quantity, line.unit)}</td>
        {costs && <td className="whitespace-nowrap text-right">{line.cost == null ? '—' : balanceMoney(Math.abs(line.cost))}</td>}
      </tr>)}</tbody>
    </table></div>
  </QueryState>;
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
