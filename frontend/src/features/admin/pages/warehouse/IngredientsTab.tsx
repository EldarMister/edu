import { Fragment, useId, useState, type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { api, apiError } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { PROCESSING_METHODS, useIngredients, type Ingredient } from './api';
import { QueryState } from './WarehouseUi';
import { usePageFilter, usePageFilters } from './workspace-route';
import { useWarehousePolicy } from './settings-api';
import { UNIT_OPTIONS, unitLabel } from './units';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { BalanceSupplies } from './BalanceSupplies';
import { balanceMoney, balanceQuantity, balanceValue } from './balance-format';
import { CatalogueUsage, PreparationComposition } from './CatalogueDetails';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './WarehouseMultiFilter';
import { visibleWarehouseColumns, WarehouseColumnSettings } from './WarehouseColumnSettings';

const balanceColumns = {
  name: { label: 'Название', width: 210 },
  warehouse: { label: 'Склад', width: 155, optional: true },
  kind: { label: 'Тип', width: 130 },
  category: { label: 'Категория', width: 130 },
  stock: { label: 'Остатки', width: 125, numeric: true },
  unit: { label: 'Ед. измерения', width: 130, optional: true },
  cost: { label: 'Себестоимость', width: 150, numeric: true, costs: true },
  total: { label: 'Сумма', width: 120, numeric: true, costs: true },
  limit: { label: 'Лимит', width: 125, numeric: true },
} satisfies Record<string, { label: string; width: number; numeric?: boolean; costs?: boolean; optional?: boolean }>;
type BalanceColumn = keyof typeof balanceColumns;

function columnSpec(key: BalanceColumn): { label: string; width: number; numeric?: boolean; costs?: boolean; optional?: boolean } {
  return balanceColumns[key];
}

export type StockFilter = '' | 'low' | 'empty';
export function IngredientsTab({
  warehouseId,
  warehouseName,
  filter,
  onFilter,
  onOpen,
  onCreate,
  onHistory,
  onProduce,
  catalogue = false,
  filters,
}: {
  warehouseId?: string;
  warehouseName?: string;
  filter: StockFilter;
  onFilter: (value: StockFilter) => void;
  onOpen: (item: Ingredient) => void;
  onCreate: () => void;
  onHistory: (id: string) => void;
  onProduce: (item: Ingredient) => void;
  catalogue?: false | 'ingredients' | 'preparations';
  filters?: ReactNode;
}) {
  const { can, effectiveRole } = usePermissions();
  const userId = useAuth((state) => state.user?.id);
  const costs = can('actions.warehouseCosts');
  const canExport = (effectiveRole === 'OWNER' || effectiveRole === 'ADMIN') && costs && can('actions.exportReports');
  const columnStorageKey = `edu-pos-balance-columns:${userId ?? ''}`;
  const [columnFilter, setColumnFilter] = useState(() => {
    if (catalogue || !userId) return '';
    try { return localStorage.getItem(columnStorageKey) ?? ''; }
    catch { return ''; }
  });
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const columnOptions = (Object.keys(balanceColumns) as BalanceColumn[]).filter((key) => costs || !columnSpec(key).costs);
  const defaultColumns = columnOptions.filter((key) => !columnSpec(key).optional);
  const columns = columnFilter ? visibleWarehouseColumns(columnFilter, columnOptions) : defaultColumns;
  const dataColumns = columns.slice(1);
  const suppliesVisible = can('actions.warehouseReports') && costs;
  const preparedCatalogue = catalogue === 'preparations';
  const [expanded, setExpanded] = usePageFilter('balanceExpanded');
  const [catalogueExpanded, setCatalogueExpanded] = usePageFilter('catalogueExpanded');
  const catalogueDetail = catalogueExpanded.startsWith('composition:')
    ? { id: catalogueExpanded.slice('composition:'.length), kind: 'composition' as const }
    : catalogueExpanded.startsWith('usage:')
      ? { id: catalogueExpanded.slice('usage:'.length), kind: 'usage' as const }
      : null;
  const detailId = useId();
  const [search, setSearch] = usePageFilter('search');
  const [kind, setKind] = usePageFilter('kind');
  const [category, setCategory] = usePageFilter('category');
  const [unit, setUnit] = usePageFilter('unit');
  const [sort, setSort] = usePageFilter('balanceSort', 'asc');
  const [catalogueSort, setCatalogueSort] = usePageFilter('nameSort', 'asc');
  const [, updateBalanceFilters] = usePageFilters({ search: '', kind: '', category: '', unit: '', stockFilter: '', warehouse: '' });
  const balanceKinds = warehouseMultiFilterValues(kind);
  const balanceCategories = warehouseMultiFilterValues(category);
  const policy = useWarehousePolicy();
  const production = policy.data?.warehouseProductionEnabled || policy.data?.productionInUse;
  const query = useIngredients('', warehouseId);
  const catalogueRows = (query.data ?? []).filter((item) =>
    preparedCatalogue
      ? item.isPrepared
      : catalogue === 'ingredients'
        ? !item.isPrepared && item.kind !== 'goods' && item.kind !== 'beverage'
        : true,
  );
  const searchText = search.trim().toLocaleLowerCase();
  const rows = catalogueRows.filter(
    (item) =>
      (!searchText ||
        [item.name, item.category].some((value) =>
          value?.toLocaleLowerCase().includes(searchText),
        )) &&
      (catalogue || !balanceKinds.length || balanceKinds.includes(balanceKind(item)) || balanceKinds.includes(item.kind ?? '')) &&
      (catalogue ? !category || item.category === category : !balanceCategories.length || balanceCategories.includes(item.category ?? '')) &&
      (!unit || item.displayUnit === unit) &&
      (preparedCatalogue || !filter || (filter === 'empty' ? item.stock <= 0 : item.isLow && item.stock > 0)),
  );
  if (!catalogue) rows.sort((a, b) => a.name.localeCompare(b.name, 'ru') * (sort === 'desc' ? -1 : 1));
  else rows.sort((a, b) => a.name.localeCompare(b.name, 'ru') * (catalogueSort === 'desc' ? -1 : 1));
  const categories = [
    ...new Set(catalogueRows.flatMap((item) => (item.category ? [item.category] : []))),
  ].sort();
  const virtual = (item: Ingredient) => !!item.isPrepared && item.preparationMode === 'virtual';
  const unitCost = (item: Ingredient) => (virtual(item) ? (item.recipeUnitCost ?? null) : item.avgCost);
  const listCost = (item: Ingredient) =>
    preparedCatalogue ? (item.recipeTotalCost ?? null) : unitCost(item);
  const quantity = (value: number, item: Ingredient) =>
    balanceQuantity(value, item.unit, item.unitType);
  const amount = balanceMoney;
  const stock = (item: Ingredient) => (virtual(item) ? 'По рецепту' : quantity(item.stock, item));
  const kindLabel = (item: Ingredient) =>
    item.isPrepared ? 'Полуфабрикат' : ['goods', 'beverage'].includes(item.kind ?? '') ? 'Товар' : 'Ингредиент';
  const includeUnit = !columns.includes('unit');
  const threshold = (item: Ingredient) => virtual(item) ? '—'
    : item.lowStockThreshold.toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      + (includeUnit ? ` ${item.unit}` : '');
  const output = (item: Ingredient) =>
    item.recipeOutputQuantity != null && item.recipeOutputUnit
      ? balanceQuantity(item.recipeOutputQuantity, unitLabel(item.recipeOutputUnit))
      : 'Не задан';
  const valuedRows = rows.filter((item) => !virtual(item));
  const total = valuedRows.reduce((sum, item) => sum + (balanceValue(item) ?? 0), 0);
  const unknown = valuedRows.some((item) => item.avgCost == null && item.stock !== 0);
  const toggleCatalogue = (id: string, kind: 'usage' | 'composition') =>
    setCatalogueExpanded(catalogueDetail?.id === id && catalogueDetail.kind === kind ? '' : `${kind}:${id}`);
  const catalogueDetails = (item: Ingredient) => (
    <div className="poster-catalogue-detail" role="region" aria-label={`${catalogueDetail?.kind === 'composition' ? 'Состав' : 'Использование'}: ${item.name}`}>
      {catalogueDetail?.kind === 'composition'
        ? <PreparationComposition id={item.id} warehouseId={warehouseId} />
        : <CatalogueUsage id={item.id} prepared={preparedCatalogue} />}
    </div>
  );
  const actions = (item: Ingredient) => (
    <div className={`poster-row-actions ${catalogue ? 'justify-end' : 'poster-balance-actions'}`}>
      {catalogue && (
        <button type="button"
          aria-label={`${preparedCatalogue ? 'Состав' : 'Детали'}: ${item.name}`}
          aria-expanded={catalogueDetail?.id === item.id && catalogueDetail.kind === (preparedCatalogue ? 'composition' : 'usage')}
          onClick={() => toggleCatalogue(item.id, preparedCatalogue ? 'composition' : 'usage')}>
          {preparedCatalogue ? 'Состав' : 'Детали'}
        </button>
      )}
      {!catalogue && can('actions.warehouseReports') && costs && (
        <button type="button" onClick={() => onHistory(item.id)}>
          История
        </button>
      )}
      <button type="button" onClick={() => onOpen(item)}>
        {preparedCatalogue
          ? can('actions.warehouseRecipes')
            ? catalogue ? 'Ред.' : 'Изменить'
            : 'Открыть'
          : can('actions.warehouseSettings')
            ? catalogue ? 'Ред.' : 'Изменить'
            : 'Открыть'}
      </button>
      {production &&
        item.isPrepared &&
        item.preparationMode !== 'virtual' &&
        can('actions.warehouseProduce') && (
          <button type="button" onClick={() => onProduce(item)}>
            Приготовить
          </button>
        )}
    </div>
  );
  const details = (item: Ingredient, id: string) => (
    <div id={id} className="poster-balance-detail" aria-label={`Поставки: ${item.name}`}>
      {suppliesVisible && (
        <>
          <div className="poster-balance-detail-heading"><h3>Поставки</h3>{actions(item)}</div>
          <BalanceSupplies
            key={`${warehouseId ?? 'all'}:${item.id}`}
            ingredientId={item.id}
            warehouseId={warehouseId}
            unitType={item.unitType}
          />
        </>
      )}
      {!suppliesVisible && actions(item)}
    </div>
  );
  const toggle = (item: Ingredient, id: string) => (
    <button
      type="button"
      className="poster-balance-toggle flex min-w-0 w-full items-center gap-3 text-left"
      aria-expanded={expanded === item.id}
      aria-controls={expanded === item.id ? id : undefined}
      onClick={() => setExpanded(expanded === item.id ? '' : item.id)}
      title={item.name}
    >
      <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor"
        className={`shrink-0 transition-transform ${expanded === item.id ? 'rotate-90' : ''}`}>
        <path d="m6 3 5 5-5 5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{item.name}</span>
    </button>
  );
  const filtered = !!(
    searchText ||
    category ||
    unit ||
    (!catalogue && kind) ||
    (!preparedCatalogue && filter)
  );
  const canCreate = preparedCatalogue ? can('actions.warehouseRecipes') : can('actions.warehouseReceive');
  const showTotal = !preparedCatalogue && costs && rows.length > 0 && (catalogue || columns.includes('total'));
  const totalLabel = unknown ? 'Известная стоимость' : catalogue ? 'Итого' : 'Всего';
  function balanceCell(item: Ingredient, key: BalanceColumn) {
    switch (key) {
      case 'warehouse': return warehouseName || 'Все склады';
      case 'kind': return kindLabel(item);
      case 'category': return item.category || '—';
      case 'stock': return virtual(item) ? 'По рецепту' : balanceQuantity(item.stock, item.unit, item.unitType, includeUnit);
      case 'unit': return item.unit;
      case 'cost': return unitCost(item) == null ? '—' : amount(unitCost(item)!);
      case 'total': return virtual(item) || balanceValue(item) == null ? '—' : amount(balanceValue(item)!);
      case 'limit': return threshold(item);
      default: return item.name;
    }
  }

  async function exportBalances() {
    if (!canExport || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const params = new URLSearchParams({ columns: columns.join(','), sort: sort === 'desc' ? 'desc' : 'asc' });
      if (warehouseId) params.set('warehouseId', warehouseId);
      if (searchText) params.set('search', search.trim());
      if (unit) params.set('unit', unit);
      if (filter) params.set('stockFilter', filter);
      balanceKinds.forEach((value) => params.append('kinds', value));
      balanceCategories.forEach((value) => params.append('categories', value));
      const response = await api.get<Blob>(`/admin/warehouse/ingredients/export.xlsx?${params}`, { responseType: 'blob' });
      const downloadUrl = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'Остатки.xlsx';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
      setExportError(apiError(error));
    } finally {
      setExporting(false);
    }
  }

  const emptyState = (
    <div className="py-6 text-center">
      <p className="font-medium text-text-primary">
        {filtered
          ? 'Ничего не найдено'
          : preparedCatalogue
            ? 'Здесь будут ваши полуфабрикаты'
            : catalogue
              ? 'Здесь будут ваши ингредиенты'
              : 'Здесь будут остатки на складе'}
      </p>
      <p className="mt-2 text-sm text-text-muted">
        {filtered
          ? 'Измените поиск или выбранные фильтры.'
          : preparedCatalogue
            ? 'Полуфабрикаты объединяют ингредиенты в заготовки для блюд.'
            : catalogue
              ? canCreate
                ? 'Нажмите «Добавить», чтобы создать первый ингредиент.'
                : 'Ингредиенты появятся здесь после добавления в каталог.'
              : 'Добавьте позиции в каталог и оформите поставку.'}
      </p>
    </div>
  );
  return (
    <div className={catalogue ? undefined : 'poster-balance-surface'}>
      {catalogue && <WorkspaceHeaderCount count={query.data ? catalogueRows.length : undefined} />}
      {!catalogue && <>
        {canExport && <WorkspaceHeaderActions>
          <button type="button" className="supply-header-action" disabled={exporting || !query.isSuccess}
            onClick={() => void exportBalances()}>{exporting ? 'Выгрузка…' : 'Экспорт'}</button>
        </WorkspaceHeaderActions>}
        {columnsOpen && <WarehouseColumnSettings columns={columns} defaults={columnOptions} resetColumns={defaultColumns}
          label={(key) => columnSpec(key).label} onClose={() => setColumnsOpen(false)}
          onApply={(selection) => {
            const selected = selection.join(',');
            const value = selected === defaultColumns.join(',') ? '' : selected;
            setColumnFilter(value);
            if (userId) {
              try { localStorage.setItem(columnStorageKey, value); }
              catch { /* The selection remains available in the open table. */ }
            }
            setColumnsOpen(false);
          }} />}
        {exportError && <p role="alert" className="py-2 text-sm text-danger">{exportError}</p>}
      </>}
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск позиции" placeholder={catalogue ? 'Быстрый поиск' : 'Поиск...'} value={search} onChange={setSearch} />
        {filters}
        {catalogue && canCreate && <button type="button" className="btn-primary btn-md ml-auto" onClick={onCreate}>Добавить</button>}
        {!catalogue && (
          <WarehouseMultiFilter
            label="Тип"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'ingredient', label: 'Ингредиент' },
              { value: 'goods', label: 'Товар' },
              { value: 'preparation', label: 'Полуфабрикат' },
            ]}
          />
        )}
        {!preparedCatalogue && (
          <>
            {catalogue ? <Select
              ariaLabel="Категория"
              className="poster-filter w-40"
              value={category}
              onChange={setCategory}
              options={[
                { value: '', label: 'Категория' },
                ...categories.map((value) => ({ value, label: value })),
              ]}
            /> : <WarehouseMultiFilter label="Категория" value={category} onChange={setCategory} options={[
              { value: '', label: 'Без категории' },
              ...categories.map((value) => ({ value, label: value })),
            ]} />}
            {catalogue && <Select
              ariaLabel="Единица измерения"
              className="poster-filter w-40"
              value={unit}
              onChange={setUnit}
              options={[{ value: '', label: 'Ед. измерения' }, ...UNIT_OPTIONS]}
            />}
          </>
        )}
        <details className="relative">
          <summary className="cursor-pointer list-none text-sm text-primary">
            + Фильтр{filter || (!catalogue && unit) || (preparedCatalogue && category) ? ' •' : ''}
          </summary>
          <div className="absolute left-0 top-full z-30 mt-2 w-60 space-y-3 border border-border bg-white p-3 shadow-md">
            {preparedCatalogue && (
              <Select
                ariaLabel="Категория"
                className="w-full"
                value={category}
                onChange={setCategory}
                options={[
                  { value: '', label: 'Все категории' },
                  ...categories.map((value) => ({ value, label: value })),
                ]}
              />
            )}
            {!catalogue && (
              <Select
                ariaLabel="Единица измерения"
                className="w-full"
                value={unit}
                onChange={setUnit}
                options={[{ value: '', label: 'Ед. измерения' }, ...UNIT_OPTIONS]}
              />
            )}
            {!preparedCatalogue && (
              <Select
                ariaLabel="Остатки"
                className="w-full"
                value={filter}
                onChange={(value) => onFilter(value as StockFilter)}
                options={[
                  { value: '', label: 'Все остатки' },
                  { value: 'low', label: 'Ниже лимита' },
                  { value: 'empty', label: 'Закончилось' },
                ]}
              />
            )}
          </div>
        </details>
        {!catalogue && (filtered || warehouseId) && <button type="button" className="poster-balance-reset"
          onClick={() => updateBalanceFilters({ search: '', kind: '', category: '', unit: '', stockFilter: '', warehouse: '' })}>
          Сбросить всё
        </button>}
        {!catalogue && <button type="button" className="supply-header-action ml-auto shrink-0 print:hidden"
          onClick={() => setColumnsOpen(true)}>Столбцы</button>}
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className={`poster-table w-full ${catalogue ? `poster-catalogue-table ${preparedCatalogue ? 'min-w-[680px]' : 'min-w-[1000px]'}` : 'poster-balance-table table-fixed'}`}
            style={catalogue ? undefined : { minWidth: columns.reduce((width, key) => width + columnSpec(key).width, 0) }}>
            {!catalogue && (
              <colgroup>
                {columns.map((key) => <col key={key} style={{ width: columnSpec(key).width }} />)}
              </colgroup>
            )}
            <thead>
              <tr>
                <th aria-sort={(catalogue ? catalogueSort : sort) === 'desc' ? 'descending' : 'ascending'}>
                  {catalogue ? (
                    <button type="button" className="flex items-center gap-2"
                      onClick={() => setCatalogueSort(catalogueSort === 'desc' ? 'asc' : 'desc')}>
                      Название <span aria-hidden>{catalogueSort === 'desc' ? '↓' : '↑'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-2"
                      onClick={() => setSort(sort === 'desc' ? 'asc' : 'desc')}
                    >
                      Название <span aria-hidden>{sort === 'desc' ? '↓' : '↑'}</span>
                    </button>
                  )}
                </th>
                {catalogue ? <>
                {!preparedCatalogue && (
                  <>
                    <th>Категория</th>
                    <th>Ед. измерения</th>
                    {catalogue === 'ingredients' && <th className="text-center">Потери</th>}
                  </>
                )}
                <th className="text-right">
                  {preparedCatalogue ? 'Выход' : 'Остатки на складах'}
                </th>
                {costs && (
                  <>
                    <th className="text-right">Себестоимость</th>
                    {!preparedCatalogue && (
                      <th className="text-right">Сумма остатков</th>
                    )}
                  </>
                )}
                <th><span className="sr-only">Действия</span></th>
                </> : dataColumns.map((key) => <th key={key} scope="col" className={columnSpec(key).numeric ? 'text-right' : undefined}>
                  {columnSpec(key).label}
                </th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <Fragment key={item.id}>
                <tr data-expanded={(catalogue ? catalogueDetail?.id === item.id : expanded === item.id) ? 'true' : undefined}>
                  <td>
                    {catalogue ? <button
                      type="button"
                      className={`text-left ${preparedCatalogue ? 'text-primary' : 'text-text-primary'}`}
                      title={preparedCatalogue ? 'Где используется полуфабрикат' : 'Остатки и использование ингредиента'}
                      aria-expanded={catalogueDetail?.id === item.id && catalogueDetail.kind === 'usage'}
                      onClick={() => toggleCatalogue(item.id, 'usage')}
                    >
                      {item.name}
                    </button> : toggle(item, `${detailId}-desktop-${item.id}`)}
                  </td>
                  {catalogue ? <>
                  {!preparedCatalogue && (
                    <>
                      <td title={item.category || undefined}>{item.category || 'Без категории'}</td>
                      <td>{item.unit}</td>
                      {catalogue === 'ingredients' && (
                        <td>
                          {item.unitType === 'mass' ||
                          PROCESSING_METHODS.some(
                            (method) => Number(item.processingLosses?.[method.value]) > 0,
                          ) ? (
                            <div className="flex justify-between gap-3 text-xs">
                              {PROCESSING_METHODS.map((method) => (
                                <span
                                  key={method.value}
                                  title={`${method.label}: ${item.processingLosses?.[method.value] ?? 0}%`}
                                  aria-label={`${method.label}: ${item.processingLosses?.[method.value] ?? 0}%`}
                                >
                                  {item.processingLosses?.[method.value] ?? 0}%
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="block text-center">—</span>
                          )}
                        </td>
                      )}
                    </>
                  )}
                  <td className="text-right whitespace-nowrap">
                    {preparedCatalogue ? output(item) : stock(item)}
                  </td>
                  {costs && (
                    <>
                      <td className="text-right whitespace-nowrap">
                        {listCost(item) == null ? '—' : amount(listCost(item)!)}
                      </td>
                      {!preparedCatalogue && (
                        <td className="text-right whitespace-nowrap">
                          {!virtual(item) && balanceValue(item) != null ? amount(balanceValue(item)!) : '—'}
                        </td>
                      )}
                    </>
                  )}
                  <td>{actions(item)}</td>
                  </> : dataColumns.map((key) => {
                    const value = balanceCell(item, key);
                    return <td key={key} className={columnSpec(key).numeric ? 'text-right whitespace-nowrap' : 'truncate'}
                      data-column={key} title={value}>{value}</td>;
                  })}
                </tr>
                {catalogue && catalogueDetail?.id === item.id && (
                  <tr className="poster-catalogue-detail-row">
                    <td colSpan={preparedCatalogue ? (costs ? 4 : 3) : (costs ? 8 : 6)}>
                      {catalogueDetails(item)}
                    </td>
                  </tr>
                )}
                {!catalogue && expanded === item.id && (
                  <tr className="poster-balance-detail-row">
                    <td colSpan={columns.length}>
                      {details(item, `${detailId}-desktop-${item.id}`)}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {!rows.length && (
                <tr>
                  <td
                    colSpan={!catalogue ? columns.length : preparedCatalogue ? (costs ? 4 : 3) : (costs ? 8 : 6)}
                    className="py-12 text-center text-text-muted"
                  >
                    {emptyState}
                  </td>
                </tr>
              )}
            </tbody>
            {showTotal && (
              <tfoot>
                {catalogue ? <tr>
                  <td colSpan={catalogue === 'ingredients' ? 6 : 5}>
                    {totalLabel}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{amount(total)}</td>
                  <td />
                </tr> : <tr>
                  <td>{totalLabel}</td>
                  {dataColumns.map((key) => <td key={key} className="whitespace-nowrap text-right tabular-nums">
                    {key === 'total' ? amount(total) : null}
                  </td>)}
                </tr>}
              </tfoot>
            )}
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {rows.map((item) => (
            <article key={item.id} className="py-3">
              {catalogue ? <>
              <div className="flex items-start justify-between gap-3">
                <button type="button" className="text-left text-sm text-primary"
                  aria-expanded={catalogueDetail?.id === item.id && catalogueDetail.kind === 'usage'}
                  onClick={() => toggleCatalogue(item.id, 'usage')}>
                  {item.name}
                </button>
                {costs && (
                  <span className="shrink-0 text-sm">
                    {listCost(item) == null ? '—' : amount(listCost(item)!)}
                  </span>
                )}
              </div>
              <div className="mt-1 flex justify-between gap-3 text-xs text-text-muted">
                <span>{preparedCatalogue ? 'Выход' : item.category || 'Без категории'}</span>
                <span>{preparedCatalogue ? output(item) : stock(item)}</span>
              </div>
              </> : <>
                {toggle(item, `${detailId}-mobile-${item.id}`)}
                {dataColumns.length > 0 && <dl className="poster-balance-mobile-values mt-2">
                  {dataColumns.map((key) => <div key={key}><dt>{columnSpec(key).label}</dt><dd>{balanceCell(item, key)}</dd></div>)}
                </dl>}
              </>}
              {catalogue ? <div className="mt-2">{actions(item)}</div> : expanded === item.id && details(item, `${detailId}-mobile-${item.id}`)}
              {catalogue && catalogueDetail?.id === item.id && catalogueDetails(item)}
            </article>
          ))}
          {!rows.length && emptyState}
          {showTotal && (
            <p className="flex justify-between py-3 text-sm font-medium">
              <span>{totalLabel}</span>
              <span>{amount(total)}</span>
            </p>
          )}
        </div>
        {unknown && showTotal && (
          <p className="mt-2 text-xs text-text-muted">Стоимость части остатков неизвестна. Итог неполный.</p>
        )}
      </QueryState>
    </div>
  );
}

function balanceKind(item: Ingredient) {
  if (item.isPrepared) return 'preparation';
  if (item.kind === 'goods' || item.kind === 'beverage') return 'goods';
  return 'ingredient';
}
