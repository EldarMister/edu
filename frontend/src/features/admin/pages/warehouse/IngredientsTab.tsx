import { Fragment, useId, type ReactNode } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { PROCESSING_METHODS, useIngredients, type Ingredient } from './api';
import { QueryState } from './WarehouseUi';
import { usePageFilter, usePageFilters } from './workspace-route';
import { useWarehousePolicy } from './settings-api';
import { UNIT_OPTIONS, unitLabel } from './units';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';
import { BalanceSupplies } from './BalanceSupplies';
import { balanceMoney, balanceQuantity, balanceValue } from './balance-format';
import { CatalogueUsage, PreparationComposition } from './CatalogueDetails';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './WarehouseMultiFilter';

export type StockFilter = '' | 'low' | 'empty';
export function IngredientsTab({
  warehouseId,
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
  filter: StockFilter;
  onFilter: (value: StockFilter) => void;
  onOpen: (item: Ingredient) => void;
  onCreate: () => void;
  onHistory: (id: string) => void;
  onProduce: (item: Ingredient) => void;
  catalogue?: false | 'ingredients' | 'preparations';
  filters?: ReactNode;
}) {
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
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
        [item.name, item.barcode, item.category].some((value) =>
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
  const threshold = (item: Ingredient) => virtual(item) ? '—'
    : `${item.lowStockThreshold.toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} ${item.unit}`;
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
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className={`poster-table w-full ${preparedCatalogue ? 'min-w-[680px]' : 'min-w-[1000px]'} ${catalogue ? 'poster-catalogue-table' : 'poster-balance-table table-fixed'}`}>
            {!catalogue && (
              <colgroup>
                <col style={{ width: costs ? '20%' : '28%' }} />
                <col style={{ width: costs ? '13.333%' : '18%' }} />
                <col style={{ width: costs ? '13.333%' : '18%' }} />
                <col style={{ width: costs ? '13.333%' : '18%' }} />
                {costs && <col style={{ width: '13.333%' }} />}
                {costs && <col style={{ width: '13.333%' }} />}
                <col style={{ width: costs ? '13.335%' : '18%' }} />
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
                {!preparedCatalogue && (
                  <>
                    {!catalogue && <th>Тип</th>}
                    <th>Категория</th>
                    {catalogue && <th>Ед. измерения</th>}
                    {catalogue === 'ingredients' && <th className="text-center">Потери</th>}
                  </>
                )}
                <th className="text-right">
                  {preparedCatalogue ? 'Выход' : catalogue ? 'Остатки на складах' : 'Остатки'}
                </th>
                {costs && (
                  <>
                    <th className="text-right">Себестоимость</th>
                    {!preparedCatalogue && (
                      <th className="text-right">{catalogue ? 'Сумма остатков' : 'Сумма'}</th>
                    )}
                  </>
                )}
                {!catalogue && <th className="text-right">Лимит</th>}
                {catalogue && <th><span className="sr-only">Действия</span></th>}
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
                  {!preparedCatalogue && (
                    <>
                      {!catalogue && <td className="truncate" title={kindLabel(item)}>{kindLabel(item)}</td>}
                      <td className={catalogue ? undefined : 'truncate'} title={item.category || undefined}>{item.category || (catalogue ? 'Без категории' : '')}</td>
                      {catalogue && <td>{item.unit}</td>}
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
                  {!catalogue && <td className="text-right whitespace-nowrap">{threshold(item)}</td>}
                  {catalogue && <td>{actions(item)}</td>}
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
                    <td colSpan={costs ? 7 : 5}>
                      {details(item, `${detailId}-desktop-${item.id}`)}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {!rows.length && (
                <tr>
                  <td
                    colSpan={preparedCatalogue ? (costs ? 4 : 3) : !catalogue ? (costs ? 7 : 5) : (costs ? 8 : 6)}
                    className="py-12 text-center text-text-muted"
                  >
                    {emptyState}
                  </td>
                </tr>
              )}
            </tbody>
            {!preparedCatalogue && costs && rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={catalogue === 'ingredients' ? 6 : 5}>
                    {unknown ? 'Известная стоимость' : catalogue ? 'Итого' : 'Всего'}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{amount(total)}</td>
                  <td />
                </tr>
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
                <p className="poster-balance-mobile-meta">{kindLabel(item)}{item.category ? ` · ${item.category}` : ''}</p>
                <dl className="poster-balance-mobile-values">
                  <div><dt>Остатки</dt><dd>{stock(item)}</dd></div>
                  <div><dt>Лимит</dt><dd>{threshold(item)}</dd></div>
                  {costs && <>
                    <div><dt>Себестоимость</dt><dd>{unitCost(item) == null ? '—' : amount(unitCost(item)!)}</dd></div>
                    <div><dt>Сумма</dt><dd>{!virtual(item) && balanceValue(item) != null ? amount(balanceValue(item)!) : '—'}</dd></div>
                  </>}
                </dl>
              </>}
              {catalogue ? <div className="mt-2">{actions(item)}</div> : expanded === item.id && details(item, `${detailId}-mobile-${item.id}`)}
              {catalogue && catalogueDetail?.id === item.id && catalogueDetails(item)}
            </article>
          ))}
          {!rows.length && emptyState}
          {!preparedCatalogue && costs && rows.length > 0 && (
            <p className="flex justify-between py-3 text-sm font-medium">
              <span>{unknown ? 'Известная стоимость' : catalogue ? 'Итого' : 'Всего'}</span>
              <span>{amount(total)}</span>
            </p>
          )}
        </div>
        {unknown && !preparedCatalogue && costs && (
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
