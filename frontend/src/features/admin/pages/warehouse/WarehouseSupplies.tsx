import { IconExport, IconImport, IconPrinter } from '@/features/admin/components/icons';
import { Fragment, useState, type ReactNode } from 'react';
import { ColumnButton } from '../../components/ColumnControl';
import { RowIconButton } from '../../components/RowIconButton';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { api, apiError } from '@/lib/api';
import { printReport } from '@/lib/report-output';
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
import { purchasePaymentLabels } from './purchase-settlement-api';
import './warehouse-supplies.css';

const supplyColumns = {
  number: { label: '№', width: 5 },
  date: { label: 'Дата', width: 14 },
  supplier: { label: 'Поставщик', width: 13 },
  warehouse: { label: 'Склад', width: 11 },
  fundingAccounts: { label: 'Счёт', width: 12 },
  products: { label: 'Товары', width: 16 },
  note: { label: 'Комментарий', width: 12 },
  status: { label: 'Статус', width: 11 },
  totalAmount: { label: 'Сумма', width: 9 },
  paymentStatus: { label: 'Оплата', width: 12 },
  paidAmount: { label: 'Оплачено', width: 9 },
  debtAmount: { label: 'Задолженность', width: 11 },
};
type SupplyColumn = keyof typeof supplyColumns;
const allColumns = Object.keys(supplyColumns) as SupplyColumn[];
const defaultColumns: SupplyColumn[] = ['number', 'date', 'supplier', 'warehouse', 'fundingAccounts', 'products', 'note', 'status', 'totalAmount', 'paymentStatus', 'debtAmount'];
const moneyColumns: SupplyColumn[] = ['totalAmount', 'paidAmount', 'debtAmount'];
const supplyPageSize = 25;
const states = [
  { value: '', label: 'Все статусы' },
  { value: 'draft', label: 'Черновики' },
  { value: 'completed', label: 'Проведённые' },
  { value: 'cancelled', label: 'Отменённые' },
];
const paymentStates = [{ value: '', label: 'Любая оплата' }, ...Object.entries(purchasePaymentLabels).map(([value, label]) => ({ value, label }))];

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
  onCreate: (importInvoice?: boolean) => void;
}) {
  const permissions = usePermissions();
  const canEdit = permissions.canEditSection('warehouse') && permissions.canAction('warehouseReceive') && permissions.canAction('warehouseCosts');
  const canExport = permissions.canAction('warehouseCosts') && permissions.canAction('exportReports');
  const canViewAccounts = permissions.canSection('finance');
  const allowedColumns = canViewAccounts ? allColumns : allColumns.filter((key) => key !== 'fundingAccounts');
  const resetColumns = canViewAccounts ? defaultColumns : defaultColumns.filter((key) => key !== 'fundingAccounts');
  const [conditions, update] = usePageFilters({
    supplySearch: '', supplyStatus: '', supplyPayment: '', supplySupplier: '', supplyCategories: '', supplyOrder: 'desc',
    supplyExpanded: '', supplyColumns: '', supplyPage: '1', warehouse: '',
    supplyPeriod: 'all', supplyFrom: '', supplyTo: '',
  });
  const { supplySearch: search, supplyStatus: status, supplyPayment: paymentStatus, supplySupplier: supplier, supplyCategories: categories } = conditions;
  const dateSort = conditions.supplyOrder === 'asc' ? 'asc' : 'desc';
  const period = useListPeriod('supply');
  const selectedSuppliers = warehouseMultiFilterValues(supplier);
  const selectedCategories = warehouseMultiFilterValues(categories);
  const [savedColumns, saveColumns] = useColumnPreference('warehouse-supplies');
  const columnSetting = conditions.supplyColumns || savedColumns;
  const columns = columnSetting ? visibleWarehouseColumns(columnSetting, allowedColumns) : resetColumns;
  const expanded = new Set(conditions.supplyExpanded.split(',').filter(Boolean));
  const [settingsOpen, setSettingsOpen] = useState<HTMLButtonElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const params = { warehouseId, search, status, paymentStatus, suppliers: selectedSuppliers, categories: selectedCategories,
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
  const totals = {
    totalAmount: rows.reduce((sum, purchase) => sum + Math.round(purchase.totalAmount * 100), 0) / 100,
    paidAmount: rows.reduce((sum, purchase) => sum + Math.round((purchase.paidAmount ?? 0) * 100), 0) / 100,
    debtAmount: rows.reduce((sum, purchase) => sum + Math.round((purchase.debtAmount ?? 0) * 100), 0) / 100,
  };
  const incomplete = rows.some(({ paymentStatus }) => paymentStatus === 'untracked');
  const hasRecordedSettlement = rows.some(({ paidAmount }) => paidAmount != null);
  const pages = Math.max(1, Math.ceil(rows.length / supplyPageSize));
  const page = Math.max(1, Math.min(Math.trunc(Number(conditions.supplyPage)) || 1, pages));
  const offset = (page - 1) * supplyPageSize;
  const visible = rows.slice(offset, offset + supplyPageSize);
  const hasFilters = Boolean(search || status || paymentStatus || warehouseId || supplier || categories || period.active);
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
  function cellText(purchase: Purchase, key: SupplyColumn): string {
    switch (key) {
      case 'number': return String(purchase.number);
      case 'date': return formatDocumentListDate(purchase.effectiveAt ?? purchase.postedAt ?? purchase.date);
      case 'supplier': return purchase.supplier;
      case 'warehouse': return warehouseNames.get(purchase.warehouseId ?? defaultWarehouseId) ?? '—';
      case 'fundingAccounts': return purchase.fundingAccounts?.join(', ') || '—';
      case 'products': {
        const names = purchase.productNames ?? [];
        return names.length ? names.join(', ') + (purchase.itemsCount > names.length ? '…' : '') : '—';
      }
      case 'note': return purchase.note || '—';
      case 'status': return purchaseStatus(purchase.status);
      case 'totalAmount': return balanceMoney(purchase.totalAmount);
      case 'paymentStatus': return purchase.paymentStatus ? purchasePaymentLabels[purchase.paymentStatus] : '—';
      case 'paidAmount': return purchase.paidAmount == null ? '—' : balanceMoney(purchase.paidAmount);
      case 'debtAmount': return purchase.debtAmount == null ? '—' : balanceMoney(purchase.debtAmount);
    }
  }
  function cell(purchase: Purchase, key: SupplyColumn): ReactNode {
    const value = cellText(purchase, key);
    switch (key) {
      case 'number': return <button type="button" aria-label={`Открыть поставку ${purchase.number}`} className="font-medium text-primary"
        onClick={() => onOpen(purchase.id)}>{value}</button>;
      case 'date': {
        const operationDate = purchase.effectiveAt ?? purchase.postedAt ?? purchase.date;
        return <time dateTime={operationDate} title={`${inventoryTimeDisplay(operationDate)} (Бишкек)`}>{value}</time>;
      }
      case 'status': return <span className="document-status" data-status={purchase.status}>{value}</span>;
      case 'supplier':
      case 'fundingAccounts':
      case 'products':
      case 'note': return <span title={value}>{value}</span>;
      default: return value;
    }
  }
  function footerText(key: SupplyColumn) {
    if (key === 'totalAmount') return balanceMoney(totals.totalAmount);
    if (key !== 'paidAmount' && key !== 'debtAmount') return '';
    if (!hasRecordedSettlement) return '—';
    return balanceMoney(totals[key]);
  }
  function footer(key: SupplyColumn) {
    return <>{footerText(key)}{incomplete && hasRecordedSettlement && (key === 'paidAmount' || key === 'debtAmount') &&
      <span className="block text-xs font-normal text-text-muted">По сверенным</span>}</>;
  }
  function printList() {
    setExportError('');
    const data = rows.map((purchase) => columns.map((key) => cellText(purchase, key)));
    const totalsLabel = columns.filter((key) => moneyColumns.includes(key)).map((key) =>
      `${supplyColumns[key].label} — ${footerText(key)}${incomplete && hasRecordedSettlement && key !== 'totalAmount' ? ' (по сверенным)' : ''}`);
    if (!printReport('Поставки', `Документов — ${rows.length}`, columns.map((key) => supplyColumns[key].label), data,
      { title: 'Итого', text: totalsLabel.join('\n') })) setExportError('Разрешите открытие окна печати в браузере.');
  }
  function rowActions(purchase: Purchase) {
    return <div className="supply-actions">
      <RowIconButton icon="details" label={`Детали поставки ${purchase.number}`}
        expanded={expanded.has(purchase.id)} onClick={() => toggle(purchase.id)} />
      {canEdit && purchase.status !== 'cancelled' && <RowIconButton icon="edit" label={`Редактировать поставку ${purchase.number}`}
        onClick={() => onOpen(purchase.id, purchase.status === 'completed')} />}
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
        <ColumnButton expanded={!!settingsOpen} onClick={(event) => setSettingsOpen(settingsOpen ? null : event.currentTarget)} />
        {canExport && <button type="button" className="workspace-tool" disabled={exporting}
          onClick={() => void exportWorkbook()}><IconExport />{exporting ? 'Выгрузка…' : 'Экспорт'}</button>}
        {canEdit && <button type="button" className="workspace-tool" onClick={() => onCreate(true)}><IconImport />Импорт с ИИ</button>}
        {canExport && <button type="button" className="workspace-tool" disabled={!query.isSuccess || !rows.length}
          onClick={printList}><IconPrinter />Печать</button>}
        {canEdit && <button type="button" className="btn-primary btn-md" onClick={() => onCreate()}>Добавить</button>}
      </WorkspaceHeaderActions>
      {settingsOpen && <WarehouseColumnSettings anchor={settingsOpen} columns={columns} defaults={allowedColumns} resetColumns={resetColumns}
        label={(key) => supplyColumns[key].label} onClose={() => setSettingsOpen(null)}
        onChange={(selected) => {
          const value = selected.join(',') === resetColumns.join(',') ? '' : selected.join(',');
          saveColumns(value);
          update({ supplyColumns: value });
        }} />}
      <div className="poster-toolbar print:hidden">
        {period.filter}
        <WorkspaceSearch label="Поиск поставок" placeholder="Быстрый поиск" value={search}
          onChange={(value) => filter({ supplySearch: value })} />
        <WarehouseMultiFilter label="Поставщик" value={supplier} options={supplierOptions}
          onChange={(value) => filter({ supplySupplier: value })} />
        {filters}
        <WarehouseMultiFilter label="Категории" value={categories} options={categoryOptions}
          onChange={(value) => filter({ supplyCategories: value })} />
        <Select ariaLabel="Оплата поставки" value={paymentStatus} options={paymentStates}
          onChange={(value) => filter({ supplyPayment: value })} />
        {status && <div className="flex items-center gap-2">
          <Select ariaLabel="Статус поставки" value={status} options={states} onChange={(value) => filter({ supplyStatus: value })} />
          <button type="button" className="text-text-muted" aria-label="Убрать фильтр статуса" onClick={() => filter({ supplyStatus: '' })}>×</button>
        </div>}
        {hasFilters && <button type="button" className="text-sm text-primary" onClick={() => {
          filter({ supplySearch: '', supplyStatus: '', supplyPayment: '', supplySupplier: '', supplyCategories: '', warehouse: '',
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
                  className={moneyColumns.includes(key) ? 'text-right' : undefined}>
                  {key === 'date' ? <button type="button" onClick={() => filter({ supplyOrder: dateSort === 'desc' ? 'asc' : 'desc' })}>
                    Дата <span aria-hidden="true">{dateSort === 'desc' ? '↓' : '↑'}</span>
                  </button> : supplyColumns[key].label}
                </th>)}
                <th scope="col" aria-label="Действия" />
              </tr></thead>
              <tbody>{visible.map((purchase) => <Fragment key={purchase.id}>
                <tr data-expanded={expanded.has(purchase.id)}>
                  {columns.map((key) => <td key={key} className={moneyColumns.includes(key) ? 'whitespace-nowrap text-right font-medium tabular-nums' : 'truncate'}>
                    {cell(purchase, key)}
                  </td>)}
                  <td>{rowActions(purchase)}</td>
                </tr>
                {expanded.has(purchase.id) && <tr className="supply-detail-row">
                  <td colSpan={columns.length + 1}><SupplyLines id={purchase.id} number={purchase.number} /></td>
                </tr>}
              </Fragment>)}</tbody>
              {columns.some((key) => moneyColumns.includes(key)) && <tfoot><tr>
                <th scope="row">Итого</th>
                {columns.slice(1).map((key) => <td key={key} className="text-right font-medium tabular-nums">
                  {footer(key)}
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
            {columns.filter((key) => moneyColumns.includes(key)).map((key) => <div key={key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <strong>{key === 'totalAmount' ? 'Итого' : supplyColumns[key].label}</strong><strong>{footer(key)}</strong>
            </div>)}
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
        <td className="whitespace-nowrap text-right tabular-nums">{balanceMoney(item.totalWithTax ?? item.total)}</td>
      </tr>)}</tbody>
    </table>
    {query.data && !query.data.items?.length && <p className="p-3 text-sm text-text-muted">В поставке нет позиций.</p>}
  </QueryState>;
}
