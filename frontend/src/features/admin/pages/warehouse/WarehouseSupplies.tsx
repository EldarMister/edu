import { Fragment, useState, type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { api, apiError } from '@/lib/api';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { purchaseListQuery, purchaseNumber, useIngredients, usePurchase, usePurchases, useWarehouseLocations, type Purchase } from './api';
import { balanceMoney, balanceQuantity } from './balance-format';
import { useListPeriod } from './ListPeriodFilter';
import { useSuppliers } from './settings-api';
import { inventoryTimeDisplay } from './inventory-time';
import { formatDocumentListDate } from './WarehouseDocumentLists';
import { QueryState } from './WarehouseUi';
import { visibleWarehouseColumns, WarehouseColumnSettings } from './WarehouseColumnSettings';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './WarehouseMultiFilter';
import { usePageFilters } from './workspace-route';
import './warehouse-supplies.css';

const supplyColumns = {
  number: { label: '№', width: 5 },
  date: { label: 'Дата', width: 14 },
  supplier: { label: 'Поставщик', width: 13 },
  warehouse: { label: 'Склад', width: 11 },
  products: { label: 'Товары', width: 16 },
  note: { label: 'Комментарий', width: 12 },
  status: { label: 'Статус', width: 11 },
  totalAmount: { label: 'Сумма', width: 9 },
};
type SupplyColumn = keyof typeof supplyColumns;
const defaultColumns = Object.keys(supplyColumns) as SupplyColumn[];
const supplyPageSize = 25;
const states = [
  { value: '', label: 'Все статусы' },
  { value: 'draft', label: 'Черновики' },
  { value: 'completed', label: 'Проведённые' },
  { value: 'cancelled', label: 'Отменённые' },
];

function purchaseStatus(status: string) {
  return status === 'draft' ? 'Черновик' : status === 'completed' ? 'Проведена' : 'Отменена';
}

function optionsFor(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'ru'))
    .map((value) => ({ value, label: value }));
}

export function SupplyList({ warehouseId, filters, onOpen, onCreate }: {
  warehouseId?: string;
  filters?: ReactNode;
  onOpen: (id: string, edit?: boolean) => void;
  onCreate: () => void;
}) {
  const permissions = usePermissions();
  const canEdit = permissions.canAction('warehouseReceive') && permissions.canAction('warehouseCosts');
  const canExport = canEdit && permissions.canAction('exportReports');
  const [conditions, update] = usePageFilters({
    supplySearch: '', supplyStatus: '', supplySupplier: '', supplyCategories: '', supplyOrder: 'desc',
    supplyExpanded: '', supplyColumns: '', supplyPage: '1', warehouse: '',
    supplyPeriod: 'all', supplyFrom: '', supplyTo: '',
  });
  const { supplySearch: search, supplyStatus: status, supplySupplier: supplier, supplyCategories: categories } = conditions;
  const dateSort = conditions.supplyOrder === 'asc' ? 'asc' : 'desc';
  const period = useListPeriod('supply');
  const selectedSuppliers = warehouseMultiFilterValues(supplier);
  const selectedCategories = warehouseMultiFilterValues(categories);
  const columns = visibleWarehouseColumns(conditions.supplyColumns, defaultColumns);
  const expanded = new Set(conditions.supplyExpanded.split(',').filter(Boolean));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [statusFilterOpen, setStatusFilterOpen] = useState(false);
  const params = { warehouseId, search, status, suppliers: selectedSuppliers, categories: selectedCategories,
    from: period.range.dateFrom, to: period.range.dateTo, dateSort } as const;
  const query = usePurchases(params);
  const suppliers = useSuppliers();
  const ingredients = useIngredients('');
  const locations = useWarehouseLocations();
  const warehouseNames = new Map(locations.data?.locations.map((location) => [location.id, location.name]));
  const defaultWarehouseId = locations.data?.locations.find((location) => location.isDefault)?.id ?? '';
  const supplierOptions = optionsFor([...selectedSuppliers, ...(suppliers.data ?? []).map((entry) => entry.name),
    ...(query.data ?? []).map((purchase) => purchase.supplier)]);
  const categoryOptions = optionsFor([...selectedCategories, ...(ingredients.data ?? []).map((item) => item.category)]);
  const rows = query.data ?? [];
  const total = rows.reduce((sum, purchase) => sum + purchase.totalAmount, 0);
  const pages = Math.max(1, Math.ceil(rows.length / supplyPageSize));
  const page = Math.max(1, Math.min(Math.trunc(Number(conditions.supplyPage)) || 1, pages));
  const offset = (page - 1) * supplyPageSize;
  const visible = rows.slice(offset, offset + supplyPageSize);
  const hasFilters = Boolean(search || status || warehouseId || supplier || categories || period.active);
  const actionWidth = 15;
  const totalWidth = actionWidth + columns.reduce((width, column) => width + supplyColumns[column].width, 0);

  function filter(patch: Partial<typeof conditions>) {
    update({ supplyPage: '1', supplyExpanded: '', ...patch });
  }
  function toggle(id: string) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    update({ supplyExpanded: [...expanded].join(',') });
  }
  function cell(purchase: Purchase, key: SupplyColumn): ReactNode {
    switch (key) {
      case 'number': return <button type="button" aria-label={`Открыть поставку ${purchase.number}`} className="font-medium text-primary"
        onClick={() => onOpen(purchase.id)}>{purchase.number}</button>;
      case 'date': {
        const operationDate = purchase.effectiveAt ?? purchase.date;
        return <time dateTime={operationDate} title={`${inventoryTimeDisplay(operationDate)} (Бишкек)`}>{formatDocumentListDate(operationDate)}</time>;
      }
      case 'supplier': return <span title={purchase.supplier}>{purchase.supplier}</span>;
      case 'warehouse': return warehouseNames.get(purchase.warehouseId ?? defaultWarehouseId) ?? '—';
      case 'products': return <span title={purchase.productNames?.join(', ')}>{purchase.productNames?.join(', ') || '—'}
        {purchase.itemsCount > (purchase.productNames?.length ?? 0) && purchase.productNames?.length ? '…' : ''}</span>;
      case 'note': return <span title={purchase.note ?? undefined}>{purchase.note || '—'}</span>;
      case 'status': return <span className="document-status" data-status={purchase.status}>{purchaseStatus(purchase.status)}</span>;
      case 'totalAmount': return balanceMoney(purchase.totalAmount);
    }
  }
  function rowActions(purchase: Purchase) {
    return <div className="supply-actions">
      <button type="button" aria-expanded={expanded.has(purchase.id)} onClick={() => toggle(purchase.id)}>Детали</button>
      {canEdit && purchase.status !== 'cancelled' && <button type="button" aria-label={`Редактировать поставку ${purchase.number}`}
        onClick={() => onOpen(purchase.id, purchase.status === 'completed')}>Ред.</button>}
    </div>;
  }
  async function exportWorkbook() {
    if (!canExport) return;
    setExporting(true);
    setExportError('');
    try {
      const q = purchaseListQuery(params);
      q.set('columns', columns.join(','));
      const response = await api.get(`/admin/warehouse/purchases/export.xlsx?${q}`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Поставки.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) { setExportError(apiError(err)); }
    finally { setExporting(false); }
  }

  return (
    <section className="warehouse-supplies" aria-label="Реестр поставок">
      <WorkspaceHeaderCount count={query.data ? rows.length : undefined} />
      <WorkspaceHeaderActions>
        <button type="button" className="supply-header-action" onClick={() => setSettingsOpen(true)}>Столбцы</button>
        {canExport && <button type="button" className="supply-header-action" disabled={exporting}
          onClick={() => void exportWorkbook()}>{exporting ? 'Выгрузка…' : 'Экспорт'}</button>}
        {period.filter}
        {canEdit && <button type="button" className="btn-primary btn-md" onClick={onCreate}>Добавить</button>}
      </WorkspaceHeaderActions>
      {settingsOpen && <WarehouseColumnSettings columns={columns} defaults={defaultColumns}
        label={(key) => supplyColumns[key].label} onClose={() => setSettingsOpen(false)}
        onApply={(selected) => {
          update({ supplyColumns: selected.join(',') === defaultColumns.join(',') ? '' : selected.join(',') });
          setSettingsOpen(false);
        }} />}
      <div className="poster-toolbar print:hidden">
        <WorkspaceSearch label="Поиск поставок" placeholder="Быстрый поиск" value={search}
          onChange={(value) => filter({ supplySearch: value })} />
        <WarehouseMultiFilter label="Поставщик" value={supplier} options={supplierOptions}
          onChange={(value) => filter({ supplySupplier: value })} />
        {filters}
        <WarehouseMultiFilter label="Категории" value={categories} options={categoryOptions}
          onChange={(value) => filter({ supplyCategories: value })} />
        {statusFilterOpen || status ? <div className="flex items-center gap-2">
          <Select ariaLabel="Статус поставки" value={status} options={states} onChange={(value) => filter({ supplyStatus: value })} />
          <button type="button" className="text-text-muted" aria-label="Убрать фильтр статуса" onClick={() => {
            setStatusFilterOpen(false);
            filter({ supplyStatus: '' });
          }}>×</button>
        </div> : <Select ariaLabel="Добавить фильтр поставки" value="" placeholder="+ Фильтр"
          options={[{ value: 'status', label: 'Статус' }]} onChange={() => setStatusFilterOpen(true)} />}
        {hasFilters && <button type="button" className="text-sm text-primary" onClick={() => {
          setStatusFilterOpen(false);
          filter({ supplySearch: '', supplyStatus: '', supplySupplier: '', supplyCategories: '', warehouse: '',
            supplyPeriod: 'all', supplyFrom: '', supplyTo: '' });
        }}>Сбросить всё</button>}
      </div>
      {exportError && <p role="alert" className="p-3 text-sm text-danger">{exportError}</p>}
      <QueryState pending={query.isPending} error={query.error}>
        {!rows.length ? <p className="py-12 text-center text-sm text-text-muted">
          {hasFilters ? 'Поставки не найдены. Измените поиск или фильтры.' : 'Поставок пока нет.'}
        </p> : <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="supply-register-table w-full table-fixed text-left text-sm"
              style={{ minWidth: 180 + columns.length * 100 }}>
              <colgroup>
                {columns.map((key) => <col key={key} style={{ width: `${supplyColumns[key].width / totalWidth * 100}%` }} />)}
                <col style={{ width: `${actionWidth / totalWidth * 100}%` }} />
              </colgroup>
              <thead><tr>
                {columns.map((key) => <th scope="col" key={key}
                  aria-sort={key === 'date' ? (dateSort === 'desc' ? 'descending' : 'ascending') : undefined}
                  className={key === 'totalAmount' ? 'text-right' : undefined}>
                  {key === 'date' ? <button type="button" onClick={() => filter({ supplyOrder: dateSort === 'desc' ? 'asc' : 'desc' })}>
                    Дата <span aria-hidden="true">{dateSort === 'desc' ? '↓' : '↑'}</span>
                  </button> : supplyColumns[key].label}
                </th>)}
                <th scope="col" aria-label="Действия" />
              </tr></thead>
              <tbody>{visible.map((purchase) => <Fragment key={purchase.id}>
                <tr data-expanded={expanded.has(purchase.id)}>
                  {columns.map((key) => <td key={key} className={key === 'totalAmount' ? 'whitespace-nowrap text-right font-medium tabular-nums' : 'truncate'}>
                    {cell(purchase, key)}
                  </td>)}
                  <td>{rowActions(purchase)}</td>
                </tr>
                {expanded.has(purchase.id) && <tr className="supply-detail-row">
                  <td colSpan={columns.length + 1}><SupplyLines id={purchase.id} number={purchase.number} /></td>
                </tr>}
              </Fragment>)}</tbody>
              {columns.includes('totalAmount') && <tfoot><tr>
                <th scope="row">Итого</th>
                {columns.slice(1).map((key) => <td key={key} className="text-right font-medium tabular-nums">
                  {key === 'totalAmount' ? balanceMoney(total) : null}
                </td>)}
                <td />
              </tr></tfoot>}
            </table>
          </div>
          <div className="divide-y divide-border lg:hidden">
            {visible.map((purchase) => <article key={purchase.id} className="supply-register-card">
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="font-medium text-primary" onClick={() => onOpen(purchase.id)}>
                  Поставка {purchaseNumber(purchase.number)}
                </button>
                {columns.includes('totalAmount') && <strong>{balanceMoney(purchase.totalAmount)}</strong>}
              </div>
              {columns.length > 1 && <dl className="supply-register-values">{columns.filter((key) => key !== 'number' && key !== 'totalAmount')
                .map((key) => <div key={key}><dt>{supplyColumns[key].label}</dt><dd>{cell(purchase, key)}</dd></div>)}</dl>}
              {rowActions(purchase)}
              {expanded.has(purchase.id) && <SupplyLines id={purchase.id} number={purchase.number} />}
            </article>)}
            {columns.includes('totalAmount') && <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <strong>Итого</strong><strong>{balanceMoney(total)}</strong>
            </div>}
          </div>
          {pages > 1 && <nav aria-label="Страницы поставок" className="report-pagination print:hidden">
            <span>{offset + 1}–{Math.min(offset + supplyPageSize, rows.length)} из {rows.length}</span>
            <button type="button" aria-label="Предыдущая страница поставок" disabled={page <= 1}
              onClick={() => filter({ supplyPage: String(page - 1) })}>‹</button>
            <span>Страница {page} из {pages}</span>
            <button type="button" aria-label="Следующая страница поставок" disabled={page >= pages}
              onClick={() => filter({ supplyPage: String(page + 1) })}>›</button>
          </nav>}
        </>}
      </QueryState>
    </section>
  );
}

function SupplyLines({ id, number }: { id: string; number: number }) {
  const query = usePurchase(id);
  return <QueryState pending={query.isPending} error={query.error}>
    <table className="supply-lines-table w-full text-sm" aria-label={`Позиции поставки ${number}`}>
      <thead><tr><th scope="col">Товар</th><th scope="col" className="text-right">Количество</th>
        <th scope="col" className="text-right">Сумма</th></tr></thead>
      <tbody>{query.data?.items?.map((item) => <tr key={item.id}>
        <td>{item.ingredientName}</td>
        <td className="whitespace-nowrap text-right tabular-nums">{balanceQuantity(item.quantity, item.unit, item.packageId ? 'count' : undefined)}</td>
        <td className="whitespace-nowrap text-right tabular-nums">{balanceMoney(item.total)}</td>
      </tr>)}</tbody>
    </table>
    {query.data && !query.data.items?.length && <p className="p-3 text-sm text-text-muted">В поставке нет позиций.</p>}
  </QueryState>;
}
