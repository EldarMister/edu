import type { ReactNode } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { money } from '@/lib/format';
import { ITEM_KINDS, PROCESSING_METHODS, qty, useIngredients, type Ingredient } from './api';
import { QueryState } from './WarehouseUi';
import { usePageFilter } from './workspace-route';
import { useWarehousePolicy } from './settings-api';
import { UNIT_OPTIONS, unitLabel } from './units';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from '../WorkspaceHeader';
import { WorkspaceSearch } from '../WorkspaceSearch';

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
  const preparedCatalogue = catalogue === 'preparations';
  const [search, setSearch] = usePageFilter('search');
  const [kind, setKind] = usePageFilter('kind');
  const [category, setCategory] = usePageFilter('category');
  const [unit, setUnit] = usePageFilter('unit');
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
      (catalogue || !kind || item.kind === kind) &&
      (!category || item.category === category) &&
      (!unit || item.displayUnit === unit) &&
      (preparedCatalogue || !filter || (filter === 'empty' ? item.stock <= 0 : item.isLow && item.stock > 0)),
  );
  const categories = [
    ...new Set(catalogueRows.flatMap((item) => (item.category ? [item.category] : []))),
  ].sort();
  const virtual = (item: Ingredient) => !!item.isPrepared && item.preparationMode === 'virtual';
  const unitCost = (item: Ingredient) => (virtual(item) ? (item.recipeUnitCost ?? null) : item.avgCost);
  const listCost = (item: Ingredient) =>
    preparedCatalogue ? (item.recipeTotalCost ?? null) : unitCost(item);
  const stock = (item: Ingredient) => (virtual(item) ? 'По рецепту' : qty(item.stock, item.unit));
  const kindLabel = (item: Ingredient) =>
    item.isPrepared ? 'Полуфабрикат' : ['goods', 'beverage'].includes(item.kind ?? '') ? 'Товар' : 'Ингредиент';
  const threshold = (item: Ingredient) => (virtual(item) ? '—' : qty(item.lowStockThreshold, item.unit));
  const output = (item: Ingredient) =>
    item.recipeOutputQuantity != null && item.recipeOutputUnit
      ? qty(item.recipeOutputQuantity, unitLabel(item.recipeOutputUnit))
      : 'Не задан';
  const valuedRows = rows.filter((item) => !virtual(item));
  const total = valuedRows.reduce((sum, item) => sum + item.stock * (item.avgCost ?? 0), 0);
  const unknown = valuedRows.some((item) => item.avgCost == null && item.stock !== 0);
  const actions = (item: Ingredient) => (
    <div className="poster-row-actions justify-end">
      {!preparedCatalogue && can('actions.warehouseReports') && costs && (
        <button type="button" onClick={() => onHistory(item.id)}>
          История
        </button>
      )}
      <button type="button" onClick={() => onOpen(item)}>
        {preparedCatalogue
          ? can('actions.warehouseRecipes')
            ? 'Ред.'
            : 'Состав'
          : can('actions.warehouseSettings')
            ? 'Ред.'
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
    <div>
      <WorkspaceHeaderCount count={query.data ? catalogueRows.length : undefined} />
      {canCreate && (
        <WorkspaceHeaderActions>
          <button className="btn-primary btn-md" onClick={onCreate}>
            {catalogue ? 'Добавить' : 'Открыть каталог'}
          </button>
        </WorkspaceHeaderActions>
      )}
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск позиции" value={search} onChange={setSearch} />
        {filters}
        {!preparedCatalogue && (
          <>
            <Select
              ariaLabel="Категория"
              className="poster-filter w-40"
              value={category}
              onChange={setCategory}
              options={[
                { value: '', label: 'Категория' },
                ...categories.map((value) => ({ value, label: value })),
              ]}
            />
            <Select
              ariaLabel="Единица измерения"
              className="poster-filter w-40"
              value={unit}
              onChange={setUnit}
              options={[{ value: '', label: 'Ед. измерения' }, ...UNIT_OPTIONS]}
            />
          </>
        )}
        <details className="relative">
          <summary className="cursor-pointer list-none text-sm text-primary">
            + Фильтр{filter || kind || (preparedCatalogue && category) ? ' •' : ''}
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
                ariaLabel="Тип"
                className="w-full"
                value={kind}
                onChange={setKind}
                options={[{ value: '', label: 'Все типы' }, ...ITEM_KINDS]}
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
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="hidden overflow-x-auto md:block">
          <table className={`poster-table w-full ${preparedCatalogue ? 'min-w-[680px]' : 'min-w-[1000px]'}`}>
            <thead>
              <tr>
                <th>Название</th>
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
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button
                      className={`text-left ${preparedCatalogue ? 'text-primary' : 'text-text-primary'}`}
                      onClick={() => onOpen(item)}
                    >
                      {item.name}
                    </button>
                  </td>
                  {!preparedCatalogue && (
                    <>
                      {!catalogue && <td>{kindLabel(item)}</td>}
                      <td>{item.category || 'Без категории'}</td>
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
                        {listCost(item) == null ? '—' : money(listCost(item)!)}
                      </td>
                      {!preparedCatalogue && (
                        <td className="text-right whitespace-nowrap">
                          {!virtual(item) && item.avgCost != null ? money(item.stock * item.avgCost) : '—'}
                        </td>
                      )}
                    </>
                  )}
                  {!catalogue && <td className="text-right whitespace-nowrap">{threshold(item)}</td>}
                  <td>{actions(item)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td
                    colSpan={preparedCatalogue ? (costs ? 4 : 3) : 6 + (costs ? 2 : 0)}
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
                    {unknown ? 'Известная стоимость' : 'Итого'}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(total)}</td>
                  <td colSpan={catalogue ? 1 : 2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {rows.map((item) => (
            <article key={item.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <button className="text-left text-sm text-primary" onClick={() => onOpen(item)}>
                  {item.name}
                </button>
                {costs && (
                  <span className="shrink-0 text-sm">
                    {listCost(item) == null ? '—' : money(listCost(item)!)}
                  </span>
                )}
              </div>
              <div className="mt-1 flex justify-between gap-3 text-xs text-text-muted">
                <span>{preparedCatalogue ? 'Выход' : item.category || 'Без категории'}</span>
                <span>{preparedCatalogue ? output(item) : stock(item)}</span>
              </div>
              {!catalogue && (
                <div className="mt-1 flex justify-between gap-3 text-xs text-text-muted">
                  <span>{kindLabel(item)}</span>
                  <span>Лимит: {threshold(item)}</span>
                </div>
              )}
              <div className="mt-2">{actions(item)}</div>
            </article>
          ))}
          {!rows.length && emptyState}
          {!preparedCatalogue && costs && rows.length > 0 && (
            <p className="flex justify-between py-3 text-sm font-medium">
              <span>{unknown ? 'Известная стоимость' : 'Итого'}</span>
              <span>{money(total)}</span>
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
