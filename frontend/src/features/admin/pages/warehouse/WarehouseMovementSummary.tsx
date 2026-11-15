import { Fragment, useRef, useState, type ReactNode } from 'react';
import { WorkspaceHeaderActions } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { usePageFilter, usePageFilters } from './workspace-route';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { api, apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useIngredients, type WarehouseLocation } from './api';
import { balanceMoney, balanceQuantity as quantity } from './balance-format';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './WarehouseMultiFilter';
import { canOpenMovementSource } from './movement-source';
import { visibleWarehouseColumns, WarehouseColumnSettings } from './WarehouseColumnSettings';

interface SummaryRow {
  id: string;
  ingredientId: string;
  name: string;
  kind: string;
  warehouseId: string | null;
  unit: string;
  openingQuantity: number;
  openingAvgCost: number | null;
  openingValue: number | null;
  incomingQuantity: number;
  outgoingQuantity: number;
  closingQuantity: number;
  closingAvgCost: number | null;
  closingValue: number | null;
}
interface Summary {
  rows: SummaryRow[];
  totalRows: number;
  openingValue: number | null;
  closingValue: number | null;
  totalValuationAdjustment: number | null;
}
interface Props {
  locations: WarehouseLocation[];
  periodFilter?: ReactNode;
  warehouseId?: string;
  range: { dateFrom?: string; dateTo?: string };
  onOpen: (type: string, id: string) => void;
  onHistory: (itemId: string, warehouseId?: string) => void;
}
const kinds = [
  { value: 'raw', label: 'Ингредиент' },
  { value: 'goods', label: 'Товар' },
  { value: 'beverage', label: 'Напиток' },
  { value: 'preparation', label: 'Полуфабрикат' },
  { value: 'prepared_dish', label: 'Готовое блюдо' },
  { value: 'consumable', label: 'Расходник' },
];
const reportPageSize = 50;
const repeatedParams = { indexes: null } as const;
function cost(value: number | null) {
  return value == null ? '—' : balanceMoney(value);
}

function boundaryCost(average: number | null, quantity: number, total: number | null) {
  return cost(quantity === 0 && total === 0 ? 0 : average);
}

function kindLabel(kind: string) {
  return kinds.find((item) => item.value === kind)?.label ?? kind;
}

const reportColumns = {
  name: { label: 'Название', width: 19, format: (row: SummaryRow) => row.name },
  kind: { label: 'Тип', width: 11, format: (row: SummaryRow) => kindLabel(row.kind) },
  openingQuantity: { label: 'Нач. остаток', width: 9, format: (row: SummaryRow) => quantity(row.openingQuantity, row.unit) },
  openingAvgCost: { label: 'Средняя себест. на начало', width: 7.5, format: (row: SummaryRow) => boundaryCost(row.openingAvgCost, row.openingQuantity, row.openingValue) },
  openingValue: { label: 'Нач. сумма', width: 9.5, format: (row: SummaryRow) => cost(row.openingValue) },
  incomingQuantity: { label: 'Поступления', width: 9, format: (row: SummaryRow) => quantity(row.incomingQuantity, row.unit) },
  outgoingQuantity: { label: 'Расход', width: 8, format: (row: SummaryRow) => quantity(row.outgoingQuantity, row.unit) },
  closingQuantity: { label: 'Итог. остаток', width: 9, format: (row: SummaryRow) => quantity(row.closingQuantity, row.unit) },
  closingAvgCost: { label: 'Средняя себест. на конец', width: 7.5, format: (row: SummaryRow) => boundaryCost(row.closingAvgCost, row.closingQuantity, row.closingValue) },
  closingValue: { label: 'Итог. сумма', width: 10.5, format: (row: SummaryRow) => cost(row.closingValue) },
};
type ReportColumn = keyof typeof reportColumns;
const defaultColumns = Object.keys(reportColumns) as ReportColumn[];
const nameConditions = [
  { value: 'equals', label: 'Равно' },
  { value: 'notEquals', label: 'Не равно' },
  { value: 'contains', label: 'Содержит' },
  { value: 'empty', label: 'Пусто' },
  { value: 'notEmpty', label: 'Не пусто' },
];

type ReportWidths = Partial<Record<ReportColumn, number>>;
const minColumnWidth = (key: ReportColumn) => key === 'name' ? 160 : 76;
const maxColumnWidth = 640;

function readColumnWidths(value: string): ReportWidths {
  if (!value) return {};
  try {
    const widths = JSON.parse(value) as ReportWidths | null;
    return Object.fromEntries(defaultColumns.flatMap((key) => {
      const width = widths?.[key];
      return typeof width === 'number' && Number.isFinite(width) && width >= minColumnWidth(key) && width <= maxColumnWidth
        ? [[key, width]] : [];
    }));
  } catch { return {}; }
}

export function WarehouseMovementSummary({ warehouseId, range, onOpen, onHistory, locations, periodFilter }: Props) {
  const permissions = usePermissions();
  const canExport = permissions.canAction('exportReports');
  const [conditions, updateConditions] = usePageFilters({
    movementSearch: '', movementKind: '', movementCategory: '', movementOnly: '', movementPage: '1',
    movementRange: '', movementExpanded: '', movementDocuments: '', movementWarehouses: '', movementNameSort: 'asc',
    movementNameCondition: '', movementNameValue: '', movementColumns: '', movementColumnWidths: '', movementClosedGroups: '',
    warehouse: '', stockPeriod: 'week', stockFrom: '', stockTo: '',
  });
  const { movementSearch: search, movementOnly: onlyWithMovement } = conditions;
  const selectedKinds = warehouseMultiFilterValues(conditions.movementKind);
  const selectedCategories = warehouseMultiFilterValues(conditions.movementCategory);
  const warehouseSelection = conditions.movementWarehouses ? conditions.movementWarehouses.split(',') : warehouseId ? [warehouseId] : [];
  const selectedWarehouses = locations.map(({ id }) => id).filter((id) => warehouseSelection.includes(id)).sort();
  const scope = selectedWarehouses.length === 1
    ? { warehouseId: selectedWarehouses[0] }
    : { warehouseIds: selectedWarehouses.length ? selectedWarehouses.join(',') : undefined };
  const nameSort = conditions.movementNameSort === 'desc' ? 'desc' : 'asc';
  const rangeKey = [selectedWarehouses.join(','), range.dateFrom, range.dateTo, nameSort].join(':');
  const parsedPage = Number(conditions.movementPage);
  const page = conditions.movementRange === rangeKey && Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const expanded = new Set(conditions.movementExpanded.split(',').filter(Boolean));
  function toggleExpanded(id: string) {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    updateConditions({
      movementExpanded: [...expanded].join(','),
      ...(expanded.has(id) || conditions.movementDocuments !== id ? {} : { movementDocuments: '' }),
    });
  }
  const columns = visibleWarehouseColumns(conditions.movementColumns, defaultColumns);
  const [resizing, setResizing] = useState<{ key: ReportColumn; width: number } | null>(null);
  const savedWidths = readColumnWidths(conditions.movementColumnWidths);
  const widths = resizing ? { ...savedWidths, [resizing.key]: resizing.width } : savedWidths;
  const fixedWidth = columns.reduce((total, key) => total + (widths[key] ?? 0), 0);
  const flexibleWeight = columns.reduce((total, key) => total + (widths[key] ? 0 : reportColumns[key].width), 0);
  const minimumTableWidth = Math.max(190 + (columns.length - 1) * 90,
    columns.reduce((total, key) => total + (widths[key] ?? minColumnWidth(key)), 0));
  const numericColumns = columns.filter((column) => column !== 'name' && column !== 'kind');
  const [editingColumns, setEditingColumns] = useState(false);
  const nameCondition = nameConditions.find(({ value }) => value === conditions.movementNameCondition)?.value;
  const needsNameValue = nameCondition && nameCondition !== 'empty' && nameCondition !== 'notEmpty';
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const ingredients = useIngredients('');
  const params = { view: 'movement_summary', ...scope, nameSort, from: range.dateFrom, to: range.dateTo,
    search: search || undefined, kinds: selectedKinds, categories: selectedCategories,
    nameCondition, nameValue: needsNameValue ? conditions.movementNameValue.trim().slice(0, 160) || undefined : undefined,
    onlyWithMovement: onlyWithMovement === 'true' ? 'true' : 'false', page, pageSize: reportPageSize };
  const query = useQuery({ queryKey: ['admin', 'warehouse', 'reports', params],
    queryFn: async () => (await api.get<Summary>('/admin/warehouse/reports', { params, paramsSerializer: repeatedParams })).data });
  const categories = [...new Set([...selectedCategories, ...(ingredients.data ?? []).map((item) => item.category)].filter((value): value is string => Boolean(value)))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const hasFilters = Boolean(search || selectedKinds.length || selectedCategories.length || selectedWarehouses.length || nameCondition ||
    onlyWithMovement || conditions.stockPeriod !== 'week' || nameSort !== 'asc' ||
    conditions.movementColumns || conditions.movementColumnWidths);
  function saveWidth(key: ReportColumn, width: number) {
    updateConditions({ movementColumnWidths: JSON.stringify({ ...savedWidths, [key]: width }) });
    setResizing(null);
  }
  function resizeHandle(key: ReportColumn) {
    return columns.length > 1 && <ColumnResizeHandle column={key} value={widths[key]}
      onPreview={(width) => setResizing({ key, width })} onCommit={(width) => saveWidth(key, width)}
      onCancel={() => setResizing(null)} />;
  }
  function filter(patch: Partial<typeof conditions>) { updateConditions({ ...patch, movementPage: '1', movementRange: '', movementExpanded: '', movementDocuments: '', movementClosedGroups: '' }); }
  function setPage(value: number) { updateConditions({ movementPage: String(value), movementRange: rangeKey, movementExpanded: '', movementDocuments: '', movementClosedGroups: '' }); }
  async function download() {
    if (!canExport) return;
    setExporting(true); setError('');
    try {
      const response = await api.get('/admin/warehouse/reports/export.xlsx', {
        params: { ...params, columns: columns.join(',') }, paramsSerializer: repeatedParams, responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = range.dateFrom && range.dateTo ? `Движение-продуктов-${range.dateFrom}-${range.dateTo}.xlsx` : 'Движение-продуктов.xlsx';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(apiError(err)); }
    finally { setExporting(false); }
  }
  const summary = query.data;
  const rows = summary?.rows ?? [];
  const totalRows = summary?.totalRows ?? 0;
  const lastPage = Math.max(1, Math.ceil(totalRows / reportPageSize));
  return (
    <section className="poster-report-surface" aria-label="Отчёт по движению продуктов">
      <div className="poster-toolbar print:hidden">
        <WorkspaceSearch label="Поиск продукта в движении" placeholder="Поиск…" value={search} onChange={(value) => filter({ movementSearch: value })} />
        {periodFilter}
        <WarehouseMultiFilter label="Склад" value={JSON.stringify(selectedWarehouses)}
          options={locations.map(({ id, name }) => ({ value: id, label: name }))}
          onChange={(value) => filter({ movementWarehouses: warehouseMultiFilterValues(value).join(','), warehouse: '' })} />
        <WarehouseMultiFilter label="Тип" value={conditions.movementKind} options={kinds}
          onChange={(value) => filter({ movementKind: value })} />
        <WarehouseMultiFilter label="Категория" value={conditions.movementCategory}
          options={categories.map((value) => ({ value, label: value }))}
          onChange={(value) => filter({ movementCategory: value })} />
        <Select ariaLabel="Движение продуктов" value={onlyWithMovement}
          placeholder="Движение продуктов"
          options={[{ value: 'true', label: 'Только продукты с движением' }, { value: 'false', label: 'Все продукты, в т.ч. без движения' }]}
          onChange={(value) => filter({ movementOnly: value })} />
        {nameCondition ? (
          <div className="poster-movement-name-filter">
            <span className="poster-movement-filter-label">
              Название
              <button type="button" aria-label="Убрать фильтр по названию"
                onClick={() => filter({ movementNameCondition: '', movementNameValue: '' })}>×</button>
            </span>
            <Select ariaLabel="Условие по названию" value={nameCondition} options={nameConditions}
              onChange={(value) => filter({ movementNameCondition: value })} />
            {needsNameValue && <input className="input" aria-label="Значение названия" placeholder="Введите название"
              value={conditions.movementNameValue} maxLength={160}
              onChange={(event) => filter({ movementNameValue: event.target.value })} />}
          </div>
        ) : <Select ariaLabel="Добавить фильтр" value="" placeholder="+ Фильтр"
          options={[{ value: 'name', label: 'Название' }]}
          onChange={() => filter({ movementNameCondition: 'equals', movementNameValue: '' })} />}
        {hasFilters && <button type="button" className="text-sm text-primary" onClick={() => filter({
          movementSearch: '', movementKind: '', movementCategory: '', movementOnly: '', movementWarehouses: '',
          movementNameCondition: '', movementNameValue: '',
          movementNameSort: 'asc', movementColumns: '', movementColumnWidths: '',
          warehouse: '', stockPeriod: 'week', stockFrom: '', stockTo: '',
        })}>Сбросить всё</button>}
        <WorkspaceHeaderActions>
          <Select ariaLabel="Действия отчёта" className="report-actions-trigger" placeholder={exporting ? '…' : '⋮'} value="" disabled={exporting}
            options={[{ value: 'columns', label: 'Столбцы' },
              ...(canExport ? [{ value: 'export', label: 'Экспорт в Excel' }] : [])]}
            onChange={(action) => {
              if (action === 'columns') setEditingColumns(true);
              else void download();
            }} />
        </WorkspaceHeaderActions>
      </div>
      {editingColumns && <WarehouseColumnSettings columns={columns} defaults={defaultColumns}
        label={(key) => reportColumns[key].label} onClose={() => setEditingColumns(false)}
        onApply={(selected, resetWidths) => {
          updateConditions({
            movementColumns: selected.join(',') === defaultColumns.join(',') ? '' : selected.join(','),
            ...(resetWidths ? { movementColumnWidths: '' } : {}),
          });
          setEditingColumns(false);
        }} />}
      {query.isPending && <div className="flex justify-center p-8"><Spinner /></div>}
      {(query.isError || error) && (
        <div role="alert" className="space-y-2 p-4 text-danger">
          <p>{error || apiError(query.error)}</p>
          {query.isError && <button type="button" className="text-primary" onClick={() => void query.refetch()}>Повторить загрузку</button>}
        </div>
      )}
      {summary && <>
        <div className="hidden overflow-x-auto lg:block">
          <table className="poster-movement-table w-full table-fixed text-left text-sm"
            style={{ minWidth: minimumTableWidth }}>
            <colgroup>
              {columns.map((key) => {
                const width = widths[key];
                const ratio = reportColumns[key].width / Math.max(1, flexibleWeight);
                return <col key={key} style={{ width: width ?? `calc(${ratio * 100}% - ${ratio * fixedWidth}px)` }} />;
              })}
            </colgroup>
            <thead className="border-b border-border bg-background/50 text-xs text-text-muted">
              <tr>
                <th scope="col" className="relative px-3 py-3" aria-sort={nameSort === 'asc' ? 'ascending' : 'descending'}>
                  <button type="button" className="flex items-center gap-2"
                    onClick={() => filter({ movementNameSort: nameSort === 'asc' ? 'desc' : 'asc' })}>
                    Название <span aria-hidden="true">{nameSort === 'asc' ? '↑' : '↓'}</span>
                  </button>
                  {resizeHandle('name')}
                </th>
                {columns.slice(1).map((key) => <th scope="col" key={key} title={reportColumns[key].label}
                  className={`relative px-3 py-3 font-medium ${key === 'kind' ? '' : 'text-right'}`}>
                  <span className="block truncate">{reportColumns[key].label}</span>
                  {resizeHandle(key)}
                </th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => <Fragment key={row.id}>
                <tr data-expanded={expanded.has(row.id)}>
                  <td className="px-3 py-3"><button type="button" title={row.name} className="flex w-full items-center gap-3 text-left text-text-primary"
                    aria-expanded={expanded.has(row.id)} onClick={() => toggleExpanded(row.id)}>
                    <Chevron expanded={expanded.has(row.id)} />
                    <span className="truncate">{row.name}</span>
                  </button></td>
                  {columns.slice(1).map((key) => {
                    const value = reportColumns[key].format(row);
                    return <td key={key} title={value} className={`truncate px-3 py-3 ${key === 'kind' ? '' : 'text-right tabular-nums'}`}>{value}</td>;
                  })}
                </tr>
                {expanded.has(row.id) && <tr className="poster-movement-detail"><td colSpan={columns.length}>
                  <MovementDetails row={row} scope={scope} range={range} onOpen={onOpen} onHistory={onHistory} />
                </td></tr>}
              </Fragment>)}
            </tbody>
            <tfoot className="border-t border-border bg-background/50 font-medium"><tr>
              <th scope="row" className="px-3 py-3 font-medium">Всего</th>
              {columns.slice(1).map((key) => <td key={key} className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                {key === 'openingValue' || key === 'closingValue' ? cost(summary[key]) : ''}
              </td>)}
            </tr></tfoot>
          </table>
        </div>
        <div className="divide-y divide-border lg:hidden">
          {rows.map((row) => <article key={row.id} className="space-y-3 p-4">
            <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={expanded.has(row.id)}
              onClick={() => toggleExpanded(row.id)}>
              <Chevron expanded={expanded.has(row.id)} />
              <span className="min-w-0 flex-1 truncate font-medium text-text-primary" title={row.name}>{row.name}</span>
            </button>
            {columns.length > 1 && <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {columns.slice(1).map((key) => <Figure key={key} label={reportColumns[key].label} value={reportColumns[key].format(row)} />)}
            </dl>}
            {expanded.has(row.id) && <MovementDetails row={row} scope={scope} range={range} onOpen={onOpen} onHistory={onHistory} />}
          </article>)}
          {numericColumns.filter((key) => key === 'openingValue' || key === 'closingValue').map((key) =>
            <div key={key} className="flex justify-between gap-3 p-4 text-sm font-medium">
              <span>{key === 'openingValue' ? 'Начальная стоимость' : 'Итоговая стоимость'}</span>
              <span>{cost(summary[key])}</span>
            </div>)}
        </div>
        {!rows.length && <p className="p-8 text-center text-sm text-text-muted">По выбранным условиям продуктов нет.</p>}
        {summary.totalValuationAdjustment != null && summary.totalValuationAdjustment !== 0 &&
          <p className="border-t border-border px-4 py-2 text-xs text-text-muted">Корректировка оценки: {cost(summary.totalValuationAdjustment)}</p>}
        <nav aria-label="Страницы отчёта" className="report-pagination print:hidden">
          <span>{totalRows ? `${(page - 1) * reportPageSize + 1}–${Math.min(page * reportPageSize, totalRows)} из ${totalRows}` : '0 строк'}</span>
          <button type="button" aria-label="Первая страница" disabled={page <= 1} onClick={() => setPage(1)}>«</button>
          <button type="button" aria-label="Предыдущая страница" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>Страница {page} из {lastPage}</span>
          <button type="button" aria-label="Следующая страница" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>›</button>
          <button type="button" aria-label="Последняя страница" disabled={page >= lastPage} onClick={() => setPage(lastPage)}>»</button>
        </nav>
      </>}
    </section>
  );
}

function ColumnResizeHandle({ column, value, onPreview, onCommit, onCancel }: {
  column: ReportColumn;
  value?: number;
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
  onCancel: () => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const minimum = minColumnWidth(column);
  function clamp(width: number) { return Math.min(maxColumnWidth, Math.max(minimum, Math.round(width))); }
  return <span role="separator" aria-orientation="vertical" tabIndex={0}
    aria-label={`Ширина столбца «${reportColumns[column].label}»`} aria-valuemin={minimum}
    aria-valuemax={maxColumnWidth} aria-valuenow={value ?? minimum} className="report-column-resizer"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? minimum;
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      if (drag.current) onPreview(clamp(drag.current.width + event.clientX - drag.current.x));
    }}
    onPointerUp={(event) => {
      const initial = drag.current;
      drag.current = null;
      if (!initial) return;
      if (event.clientX === initial.x) onCancel();
      else onCommit(clamp(initial.width + event.clientX - initial.x));
    }}
    onLostPointerCapture={() => {
      if (!drag.current) return;
      drag.current = null;
      onCancel();
    }}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? minimum;
      onCommit(clamp(width + (event.key === 'ArrowRight' ? 16 : -16)));
    }} />;
}

function Figure({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-text-muted">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}>
      <path d="m6 4 4 4-4 4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type MovementGroup = {
  direction: 'incoming' | 'outgoing';
  sourceType: string;
  label: string;
  quantity: number;
  unit: string;
  averageCost: number | null;
  count: number;
};
const movementSections = [
  { direction: 'incoming', title: 'Поставки', types: [
    ['purchase', 'Поставка'], ['inventory', 'Инвентаризация'], ['processing', 'Переработка'],
  ] },
  { direction: 'outgoing', title: 'Расход', types: [
    ['order', 'Продажи'], ['writeoff', 'Ручное списание'], ['production', 'Производство'],
    ['inventory', 'Инвентаризация'], ['processing', 'Переработка'],
  ] },
] as const;

function MovementDetails({ row, scope, range, onOpen, onHistory }: {
  row: SummaryRow;
  scope: { warehouseId?: string; warehouseIds?: string };
  range: Props['range'];
  onOpen: Props['onOpen'];
  onHistory: Props['onHistory'];
}) {
  const permissions = usePermissions();
  const [documentsFor, setDocumentsFor] = usePageFilter('movementDocuments');
  const [closedValue, setClosedGroups] = usePageFilter('movementClosedGroups');
  const closedGroups = closedValue.split(',').filter(Boolean);
  const documentsOpen = documentsFor === row.id;
  const params = { view: 'movements', ingredientId: row.ingredientId, ...scope, from: range.dateFrom, to: range.dateTo, pageSize: 20 };
  const query = useQuery({ queryKey: ['admin', 'warehouse', 'reports', params], queryFn: async () => (await api.get<{
    movementGroups?: MovementGroup[];
    totalRows: number; rows: Array<{ id: string; createdAt: string; quantity: number; unit: string; totalCost: number | null; sourceType: string; sourceId: string | null; documentLabel: string; }>;
  }>('/admin/warehouse/reports', { params })).data });
  return (
    <div className="poster-movement-details space-y-3 text-sm">
      {query.isPending && <div className="flex justify-center py-6" aria-label="Загрузка движений"><Spinner /></div>}
      {query.isError && (
        <div role="alert" className="space-y-2 py-4">
          <p className="text-danger">{apiError(query.error)}</p>
          <button type="button" className="text-primary" onClick={() => void query.refetch()}>Повторить загрузку</button>
        </div>
      )}
      {query.data && (
        <>
        {query.data.movementGroups && (
          <div className="overflow-x-auto">
            <table className="poster-movement-detail-table poster-movement-groups w-full min-w-[300px] text-left" aria-label={`Сводка движения: ${row.name}`}>
              <thead><tr><th>Тип</th><th className="text-right">Количество</th><th title="Средняя себестоимость за единицу" className="text-right">Себестоимость</th></tr></thead>
              <tbody>
                {movementSections.map(({ direction, title, types }) => {
                  const groups = query.data.movementGroups!.filter((group) => group.direction === direction);
                  const byType = new Map(groups.map((group) => [group.sourceType, group]));
                  const knownTypes = new Set<string>(types.map(([type]) => type));
                  const details = [
                    ...types.map(([type, label]) => ({ type, label, group: byType.get(type) })),
                    ...groups.filter((group) => !knownTypes.has(group.sourceType)).map((group) => ({
                      type: group.sourceType,
                      group,
                      label: direction === 'incoming' && group.sourceType === 'order' ? 'Возврат продажи'
                        : direction === 'outgoing' && group.sourceType === 'purchase' ? 'Отмена поставки'
                          : group.label,
                    })),
                  ];
                  const groupKey = `${row.id}:${direction}`;
                  const closed = closedGroups.includes(groupKey);
                  return <Fragment key={direction}>
                    <tr className="poster-movement-group-heading"><td colSpan={3}>
                      <button type="button" className="flex w-full items-center gap-3 text-left" aria-expanded={!closed}
                        onClick={() => setClosedGroups((closed ? closedGroups.filter((value) => value !== groupKey) : [...closedGroups, groupKey]).join(','))}>
                        <Chevron expanded={!closed} />{title}
                      </button>
                    </td></tr>
                    {!closed && details.map(({ type, label, group }) => <tr key={type}>
                      <td>{label}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{group ? quantity(group.quantity, group.unit) : '—'}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{cost(group?.averageCost ?? null)}</td>
                    </tr>)}
                  </Fragment>;
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="flex items-center gap-2 text-primary" aria-expanded={documentsOpen} onClick={() => setDocumentsFor(documentsOpen ? '' : row.id)}>
            <Chevron expanded={documentsOpen} />Документы · {query.data.totalRows}
          </button>
          <button type="button" className="text-primary" onClick={() => onHistory(row.ingredientId, row.warehouseId ?? undefined)}>Открыть журнал</button>
        </div>
        {(documentsOpen || !query.data.movementGroups) && (
        <div className="overflow-x-auto">
          <table className="poster-movement-detail-table w-full min-w-[640px] text-left" aria-label={`Документы движения: ${row.name}`}>
            <thead>
              <tr>
                <th scope="col">Дата</th>
                <th scope="col">Документ</th>
                <th scope="col" className="text-right">Количество</th>
                <th scope="col" className="text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((movement) => (
                <tr key={movement.id}>
                  <td className="whitespace-nowrap">
                    <time dateTime={movement.createdAt}>{new Date(movement.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' })}</time>
                  </td>
                  <td>
                    {movement.sourceId && canOpenMovementSource(movement.sourceType, permissions) ? (
                      <button type="button" className="text-left text-primary" onClick={() => onOpen(movement.sourceType, movement.sourceId!)}>{movement.documentLabel}</button>
                    ) : movement.documentLabel}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{quantity(movement.quantity, movement.unit)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{cost(movement.totalCost)}</td>
                </tr>
              ))}
              {query.data.totalRows === 0 && <tr><td colSpan={4} className="py-6 text-center text-text-muted">За этот период движений нет.</td></tr>}
            </tbody>
          </table>
        </div>
        )}
        </>
      )}
      {query.data && documentsOpen && query.data.totalRows > 20 && <p className="text-xs text-text-muted">Показаны последние 20 из {query.data.totalRows}. Полный список — по ссылке выше.</p>}
    </div>
  );
}
