import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { Navigate, useLocation } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { captureDeletionEffect } from '../components/deletion-effect';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { WorkspacePending } from '../components/WorkspacePending';
import { ColumnButton } from '../components/ColumnControl';
import { minDishUnitPrice, taxRateLabel, variantNamesLine } from '@/lib/format';
import { resolveApiImage } from '@/lib/image';
import { useT } from '@/lib/i18n';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';
import { printReport } from '@/lib/report-output';
import { WorkspaceSearch } from './WorkspaceSearch';
import { apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { useNotifications } from '@/store/notifications';
import {
  routingOptions,
  usePreparationStations,
  usePreparationStationUpdates,
  type PreparationStation,
} from '@/features/kitchen/stations';
import { IconEdit, IconEllipsis, IconPrinter, IconTrash, IconPlus } from '../components/icons';
import type { MenuView } from './warehouse/navigation';
import { MenuStockCatalogue } from './warehouse/MenuStockCatalogue';
import { DishComposition } from './warehouse/CatalogueDetails';
import { balanceMoney, balanceQuantity } from './warehouse/balance-format';
import { normalizeUnitLabel } from './warehouse/units';
import { EditorPage } from './warehouse/EditorPage';
import { useEditorRoute, usePageFilters } from './warehouse/workspace-route';
import { WarehouseMultiFilter, warehouseMultiFilterValues } from './warehouse/WarehouseMultiFilter';
import { visibleWarehouseColumns, WarehouseColumnSettings } from './warehouse/WarehouseColumnSettings';
import { filterMenuGoods, MenuAdditionalFilters, MenuGoodsActions, menuGoodsColumns, menuListFilters,
  useMenuGoodsColumns, type MenuGoodsColumn } from './MenuGoodsControls';
import { MenuEntryPage } from './MenuEntryPage';
import { MenuImportButton } from './MenuImportButton';
import { MenuCategoryFields, useMenuCategoryDraft } from './MenuCategoryFields';
import { menuCategoryOptions } from '@/lib/menu-category-scope';
import { InlineMenuPrice } from './InlineMenuPrice';
import { RecipeExportButton } from './warehouse/RecipeExportButton';
import { costPercent, menuOutputLabel, useMenuCosts, type MenuCostRow } from './menu-cost-api';
import { dishTaxInput, dishTaxValue, effectiveMenuTaxId, MenuTaxSelect } from '../../settings/MenuTaxSelect';
import { useMenuTaxOptions } from '../../settings/taxes-api';
import {
  useAdminCategories,
  useAdminDishes,
  useAdminGoods,
  useAdminSets,
  useCategoryMutations,
  useCategoryTrash,
  useDishMutations,
  useRecipeTrash,
  useSetMutations,
  type AdminDish,
  type AdminGood,
  type AdminCategory,
} from '../api';

export function MenuPage({ view }: { view: Exclude<MenuView, 'categories'> }) {
  if (view === 'ingredients' || view === 'preparations')
    return <MenuStockCatalogue key={view} view={view} />;
  return <MenuDishList key={view} view={view} />;
}
const recipePageSize = 24;
const recipeColumnLabels = {
  name: 'Название', category: 'Категория', tax: 'Налог', output: 'Выход',
  foodCost: 'Себестоимость', price: 'Цена', markupPercent: 'Наценка', foodCostPercent: 'Фудкост',
};
type RecipeColumn = keyof typeof recipeColumnLabels;
const recipeColumnOrder = Object.keys(recipeColumnLabels) as RecipeColumn[];
const recipeCostColumns = new Set<RecipeColumn>(['foodCost', 'markupPercent', 'foodCostPercent']);

function MenuDishList({ view }: { view: 'goods' | 'recipes' }) {
  const t = useT();
  const isGoods = view === 'goods';
  const [filters, setFilters] = usePageFilters({ ...menuListFilters, recipePage: '1' });
  const updateFilters = (patch: Partial<typeof filters>) => setFilters({ recipePage: '1', ...patch });
  const { category: categoryId, search, availability, station: stationId, nameSort } = filters;
  const taxSort = filters.taxSort === 'asc' || filters.taxSort === 'desc' ? filters.taxSort : '';
  const [compositionId, setCompositionId] = useState<string | null>(null);
  const [recipeColumnsOpen, setRecipeColumnsOpen] = useState<HTMLButtonElement | null>(null);
  const [recipeColumnPreference, saveRecipeColumnPreference] = useColumnPreference('menu-recipes');
  const location = useLocation();
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const compositionPanelId = useId();
  const stations = usePreparationStations().data ?? [];
  usePreparationStationUpdates();
  const categoriesQ = useAdminCategories();
  const taxes = useMenuTaxOptions().data ?? [];
  const displayTax = !isGoods && (taxes.length > 0 || !!filters.tax);
  const taxNames = new Map(taxes.map((tax) => [tax.id, `${tax.name} · ${taxRateLabel(tax.rate)}`]));
  const taxFilters = [{ value: 'none', label: 'Без налога' }, ...[...taxNames].map(([value, label]) => ({ value, label }))];
  const menuTaxName = (item: AdminDish) => taxNames.get(effectiveMenuTaxId(item) ?? '') ?? '';
  const taxCell = (item: AdminDish) => menuTaxName(item) || '—';
  const dishesQ = useAdminDishes('', search, !isGoods);
  const goodsQ = useAdminGoods(isGoods);
  const listQ = isGoods ? goodsQ : dishesQ;
  const { columns, saveColumns } = useMenuGoodsColumns(isGoods);
  const dataColumns = columns.filter((column): column is MenuGoodsColumn => column !== 'name');
  const { remove, update } = useDishMutations();
  const queryClient = useQueryClient();
  const push = useNotifications((state) => state.push);
  const { can } = usePermissions();
  const editable = can('actions.editMenu');
  const canExportRecipes = !isGoods && can('sections.warehouse') && can('actions.exportReports');
  const showRecipeCosts = !isGoods && can('sections.warehouse') && can('actions.warehouseCosts');
  const recipeDefaults = recipeColumnOrder.filter((column) =>
    (column !== 'tax' || displayTax) && (showRecipeCosts || !recipeCostColumns.has(column)));
  const recipeColumns = visibleWarehouseColumns(recipeColumnPreference, recipeDefaults);
  const recipeDataColumns = recipeColumns.slice(1);
  const filtered = Object.entries(filters).some(([key, value]) => !['nameSort', 'taxSort', 'recipePage'].includes(key) && value);
  function clearFilters() {
    updateFilters({ ...menuListFilters, nameSort, taxSort });
  }
  const categoryStations = new Map((categoriesQ.data ?? []).map((category) => [category.id, category.prepStation]));
  const categoryOptions = menuCategoryOptions(categoriesQ.data ?? [], { includeMain: true });
  const categoryLabels = new Map(categoryOptions.map(({ value, label }) => [value, label]));
  const dishStation = (dish: AdminDish) => dish.prepStation ?? categoryStations.get(dish.categoryId) ?? 'none';
  const selectedCategories = warehouseMultiFilterValues(categoryId);
  const selectedStations = warehouseMultiFilterValues(stationId);
  const rows = (isGoods ? filterMenuGoods(goodsQ.data ?? [], filters) : (dishesQ.data ?? []).filter(
    (dish) =>
      (dish.catalogKind ?? (dish.hasDirectStock ? 'goods' : 'recipe')) === 'recipe' &&
      (!selectedCategories.length || selectedCategories.includes(dish.categoryId)) &&
      (!selectedStations.length || selectedStations.includes(dishStation(dish))) &&
      (!filters.tax || (effectiveMenuTaxId(dish) ?? 'none') === filters.tax) &&
      (!availability || (availability === 'visible' ? dish.isAvailable && dish.isActive : !dish.isAvailable || !dish.isActive)),
  )).sort((a, b) => {
    const byTax = taxSort ? menuTaxName(a).localeCompare(menuTaxName(b), 'ru') * (taxSort === 'desc' ? -1 : 1) : 0;
    return byTax || a.name.localeCompare(b.name, 'ru') * (nameSort === 'desc' ? -1 : 1);
  });
  const taxHeader = <button type="button" className="flex items-center gap-2"
    onClick={() => updateFilters({ taxSort: taxSort === 'asc' ? 'desc' : 'asc' })}>
    Налог {taxSort && <span aria-hidden>{taxSort === 'desc' ? '↓' : '↑'}</span>}
  </button>;
  const taxAriaSort = taxSort ? taxSort === 'asc' ? 'ascending' : 'descending' : undefined;
  const recipePages = Math.max(1, Math.ceil(rows.length / recipePageSize));
  const recipePage = Math.min(recipePages, Math.max(1, Number.parseInt(filters.recipePage, 10) || 1));
  const visibleRows = isGoods ? rows : rows.slice((recipePage - 1) * recipePageSize, recipePage * recipePageSize);
  const costQuery = useMenuCosts({ dishIds: visibleRows.map(({ id }) => id).join(','), limit: recipePageSize },
    showRecipeCosts && !editor && visibleRows.length > 0);
  const costsByDish = new Map<string, MenuCostRow[]>();
  for (const row of costQuery.data?.rows ?? []) {
    const entries = costsByDish.get(row.dishId) ?? [];
    entries.push(row);
    costsByDish.set(row.dishId, entries);
  }
  const stationOptions = [...stations.map((station) => ({ value: station.id, label: station.name })), { value: 'none', label: 'Без цеха' }];
  const unitOptions = [...new Set(goodsQ.data?.flatMap((item) => item.goodsUnits))].sort((a, b) => a.localeCompare(b, 'ru'))
    .map((unit) => ({ value: unit, label: unit }));
  const priceCell = (dish: AdminDish, display: string) => editable && !dish.isSet && !dish.isWeighted && !dish.variants.length
    ? <InlineMenuPrice name={dish.name} price={Number(dish.price)} display={display} onSave={async (price) => {
      await update.mutateAsync({ id: dish.id, price });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'menu-entry', dish.id] });
      push({ message: 'Цена сохранена', at: new Date().toISOString() });
    }} /> : display;
  const goodsCell = (dish: AdminGood, column: MenuGoodsColumn, interactive = true) => {
    switch (column) {
      case 'category': return categoryLabels.get(dish.categoryId) ?? dish.category.name;
      case 'price': {
        const label = `${dish.variants.length ? 'от ' : ''}${balanceMoney(dish.goodsPrice)}`;
        return interactive ? priceCell(dish, label) : label;
      }
      case 'station': return stationOptions.find((option) => option.value === dish.goodsStation)?.label ?? dish.goodsStation;
      case 'unit': return dish.goodsUnits.join(', ');
      case 'weighted': return dish.isWeighted ? 'Да' : 'Нет';
      case 'availability': return dish.isAvailable && dish.isActive ? 'Доступен в меню' : 'Скрыт';
      case 'tax': return taxCell(dish);
    }
  };
  const recipeCell = (dish: AdminDish, column: RecipeColumn, interactive = true) => {
    const costs = costsByDish.get(dish.id);
    switch (column) {
      case 'category': return categoryLabels.get(dish.categoryId) ?? dish.category.name;
      case 'tax': return taxCell(dish);
      case 'output': return dishOutput(dish, costs);
      case 'price': {
        const label = dish.variants.length ? `от ${balanceMoney(minDishUnitPrice(dish))}` : balanceMoney(Number(dish.price));
        return interactive ? priceCell(dish, label) : label;
      }
      case 'foodCost': return recipeMetric(costs, column, balanceMoney);
      case 'markupPercent':
      case 'foodCostPercent': return recipeMetric(costs, column, costPercent);
    }
  };
  function printList() {
    const headers = isGoods ? dataColumns.map((column) => menuGoodsColumns[column]) : recipeDataColumns.map((column) => recipeColumnLabels[column]);
    const values = visibleRows.map((dish) => {
      const cells = isGoods ? dataColumns.map((column) => goodsCell(dish as AdminGood, column, false))
        : recipeDataColumns.map((column) => recipeCell(dish, column, false));
      return [dish.name, ...cells.map((cell) => typeof cell === 'string' ? cell : '—')];
    });
    const printed = printReport(isGoods ? 'Товары' : 'Техкарты',
      !isGoods && recipePages > 1 ? `Страница ${recipePage} из ${recipePages}` : '', ['Название', ...headers], values);
    if (!printed) push({ message: 'Разрешите всплывающие окна для печати.', at: new Date().toISOString() });
  }
  async function onDelete(dish: AdminDish) {
    if (remove.isPending || !confirm(`Удалить «${dish.name}» из меню?`)) return;
    const playEffect = captureDeletionEffect(`menu-entry-${dish.id}`);
    try {
      await remove.mutateAsync(dish.id);
      playEffect?.();
      push({ message: !isGoods && !dish.isSet ? 'Техкарта перемещена в корзину' : 'Позиция удалена', at: new Date().toISOString() });
      if (!isGoods && !dish.isSet) void queryClient.invalidateQueries({ queryKey: ['admin', 'recipe-trash'] });
    } catch (failure) {
      push({ message: apiError(failure), at: new Date().toISOString() });
    }
  }
  if (!isGoods && editable && editor?.type === 'recipeTrash') return <RecipeTrashPage onClose={closeEditor} />;
  if (editor?.type === 'categories' || editor?.type === 'category') {
    const categoryRoute = new URLSearchParams({ section: 'menu', view: 'categories' });
    if (editor.type === 'category') {
      categoryRoute.set('editor', 'category');
      if (editor.id) categoryRoute.set('id', editor.id);
    }
    return <Navigate replace to={{ pathname: location.pathname, search: categoryRoute.toString() }} />;
  }
  if (editor?.type === 'set')
    return editor.id ? (
      <ExistingSetPage key={editor.id} id={editor.id} stations={stations} onClose={closeEditor} />
    ) : (
      <SetModal set={null} stations={stations} onClose={closeEditor} />
    );
  if (editor?.type === 'entry') {
    return <MenuEntryPage
      id={editor.id}
      kind={isGoods ? 'goods' : 'recipe'}
      categoryId={selectedCategories.length === 1 ? selectedCategories[0] : ''}
      initialTab={editor.action === 'recipe' ? 'recipe' : 'main'}
      initialVariantId={editor.itemId}
      copy={editor.action === 'copy' && !isGoods && editable && can('actions.warehouseRecipes')}
      onClose={closeEditor}
    />;
  }
  return (
    <div className="min-w-0">
      <WorkspaceHeaderCount count={listQ.isSuccess ? rows.length : undefined} />
      <div className="poster-toolbar">
        <WorkspaceSearch
          label={isGoods ? 'Поиск товаров' : t('Поиск техкарт')}
          value={search}
          onChange={(search) => updateFilters({ search })}
        />
        <WarehouseMultiFilter label="Категория" value={categoryId} onChange={(category) => updateFilters({ category })}
          options={categoryOptions} />
        <WarehouseMultiFilter label="Цех" value={stationId} onChange={(station) => updateFilters({ station })}
          options={stationOptions} />
        <MenuAdditionalFilters filters={filters} update={updateFilters} goods={isGoods} units={unitOptions}
          taxes={isGoods || displayTax ? taxFilters : []} />
      </div>
      {!editor && (
        <WorkspaceHeaderActions>
          <div className="catalogue-header-actions">
            {isGoods && <MenuGoodsActions filters={filters} columns={columns} saveColumns={saveColumns}
              ready={goodsQ.isSuccess} canExport={can('actions.exportReports')} />}
            {!isGoods && <ColumnButton expanded={!!recipeColumnsOpen} onClick={(event) => setRecipeColumnsOpen(recipeColumnsOpen ? null : event.currentTarget)} />}
            {canExportRecipes && <RecipeExportButton kind="recipes" ids={rows.map(({ id }) => id)} pending={!dishesQ.isSuccess} />}
            {editable && <MenuImportButton kind={isGoods ? 'goods' : 'recipe'} />}
            <button type="button" className="workspace-tool" title="Печать" onClick={printList}
              disabled={!listQ.isSuccess || !visibleRows.length || showRecipeCosts && costQuery.isPending}>
              <IconPrinter aria-hidden="true" /><span className="catalogue-action-label">Печать</span>
            </button>
            {!isGoods && editable && <button type="button" className="workspace-tool" title="Корзина"
              onClick={() => openEditor({ type: 'recipeTrash' })}><IconTrash aria-hidden="true" /><span className="catalogue-action-label">Корзина</span></button>}
            {!isGoods && editable && (
              <MenuActions
                ariaLabel="Другие действия"
                onChange={() => openEditor({ type: 'set' })}
                options={[{ value: 'set', label: 'Добавить сет' }]}
              />
            )}
            {editable && <button type="button" className="catalogue-add" aria-label={t(isGoods ? 'Добавить товар' : 'Добавить блюдо')}
              onClick={() => openEditor({ type: 'entry' })}>
              Добавить
            </button>}
          </div>
        </WorkspaceHeaderActions>
      )}
      {!isGoods && recipeColumnsOpen && <WarehouseColumnSettings anchor={recipeColumnsOpen} columns={recipeColumns} defaults={recipeDefaults}
        label={(column) => recipeColumnLabels[column]} onClose={() => setRecipeColumnsOpen(null)}
        onApply={(selected, reset) => {
          saveRecipeColumnPreference(reset && selected.join(',') === recipeDefaults.join(',') ? '' : selected.join(','));
          setRecipeColumnsOpen(null);
        }} />}
      {categoriesQ.isError && (
        <ListLoadError
          error={categoriesQ.error}
          onRetry={() => void categoriesQ.refetch()}
          pending={categoriesQ.isFetching}
        />
      )}
      {showRecipeCosts && costQuery.isError && <ListLoadError error={costQuery.error}
        onRetry={() => void costQuery.refetch()} pending={costQuery.isFetching} />}
      {listQ.isPending ? (
        <WorkspacePending />
      ) : listQ.isError ? (
        <ListLoadError
          error={listQ.error}
          onRetry={() => void listQ.refetch()}
          pending={listQ.isFetching}
        />
      ) : (
        <div className="relative min-w-0 overflow-x-auto">
          <table className="poster-table poster-menu-table poster-catalogue-table w-full min-w-[720px] text-sm"
            style={{ minWidth: isGoods ? Math.max(560, 310 + dataColumns.length * 125) : Math.max(520, 300 + recipeDataColumns.length * 70) }}>
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th scope="col" className="py-3 pr-4 font-normal" aria-sort={taxSort ? undefined : nameSort === 'desc' ? 'descending' : 'ascending'}>
                  <button type="button" className="flex items-center gap-2"
                    onClick={() => updateFilters({ nameSort: !taxSort && nameSort === 'asc' ? 'desc' : 'asc', taxSort: '' })}>
                    Название {!taxSort && <span aria-hidden>{nameSort === 'desc' ? '↓' : '↑'}</span>}
                  </button>
                </th>
                {isGoods ? dataColumns.map((column) => <th key={column} scope="col" aria-sort={column === 'tax' ? taxAriaSort : undefined}
                  className={`px-4 py-3 font-normal ${column === 'price' ? 'text-right' : ''}`}>{column === 'tax' ? taxHeader : menuGoodsColumns[column]}</th>)
                  : recipeDataColumns.map((column) => <th key={column} scope="col" aria-sort={column === 'tax' ? taxAriaSort : undefined}
                    className={`px-4 py-3 font-normal ${column === 'category' || column === 'tax' ? '' : 'text-right'}`}>
                    {column === 'tax' ? taxHeader : recipeColumnLabels[column]}
                  </th>)}
                <th scope="col">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((dish) => (
                <Fragment key={dish.id}>
                <tr id={`menu-entry-${dish.id}`} className="border-b border-border hover:bg-background/40" data-expanded={compositionId === dish.id ? 'true' : undefined}>
                  <td className="py-3 pr-4">
                    <button
                      type="button"
                      className="flex items-center gap-3 text-left"
                      onClick={() =>
                        openEditor({ type: dish.isSet ? 'set' : 'entry', id: dish.id })
                      }
                    >
                      <span className="h-9 w-12 shrink-0">
                        {dish.imageUrl && (
                          <img
                            src={resolveApiImage(dish.imageUrl) ?? undefined}
                            alt=""
                            className="h-9 w-12 rounded-sm object-cover"
                          />
                        )}
                      </span>
                      <span>
                        <span className="font-medium text-text-primary">{dish.name}</span>
                        {dish.isSet && <span className="ml-2 text-xs text-text-muted">Сет</span>}
                        {(!dish.isAvailable || !dish.isActive) && <span className="ml-2 text-xs text-text-muted">Скрыт</span>}
                        {dish.variants.length > 0 && (
                          <span className="mt-0.5 block text-xs text-text-muted">
                            {variantNamesLine(dish.variants)}
                          </span>
                        )}
                      </span>
                    </button>
                  </td>
                  {isGoods ? dataColumns.map((column) => <td key={column}
                    className={`px-4 py-3 ${column === 'price' ? 'whitespace-nowrap text-right tabular-nums text-text-primary' : 'text-text-secondary'}`}>
                    {goodsCell(dish as AdminGood, column)}
                  </td>) : recipeDataColumns.map((column) => <td key={column}
                    className={`px-4 py-3 ${column === 'category' || column === 'tax' ? 'text-text-secondary' : 'whitespace-nowrap text-right tabular-nums text-text-primary'}`}>
                    {recipeCell(dish, column)}
                  </td>)}
                  <td className="w-px px-3 py-3 text-right">
                    <div className="poster-row-actions">
                      {!isGoods && can('sections.warehouse') && (
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline"
                          aria-expanded={compositionId === dish.id}
                          aria-controls={compositionId === dish.id ? `${compositionPanelId}-${dish.id}` : undefined}
                          onClick={() => setCompositionId(compositionId === dish.id ? null : dish.id)}
                        >
                          Состав
                        </button>
                      )}
                      <button
                        type="button"
                        className={editable ? 'row-action-icon' : 'text-xs text-primary hover:underline'}
                        title={editable ? t('Редактировать') : undefined}
                        aria-label={editable ? `${t('Редактировать')}: ${dish.name}` : undefined}
                        onClick={() =>
                          openEditor({ type: dish.isSet ? 'set' : 'entry', id: dish.id })
                        }
                      >
                        {editable ? <IconEdit className="h-4 w-4" /> : 'Открыть'}
                      </button>
                      {editable && (
                        <MenuActions
                          ariaLabel={`Действия: ${dish.name}`}
                          disabled={remove.isPending}
                          onChange={(action) => {
                            if (action === 'delete') void onDelete(dish);
                            if (action === 'copy') openEditor({ type: 'entry', id: dish.id, action: 'copy' });
                          }}
                          options={[
                            ...(!isGoods && !dish.isSet && can('actions.warehouseRecipes') ? [{ value: 'copy', label: 'Копировать техкарту' }] : []),
                            { value: 'delete', label: 'Удалить' },
                          ]}
                        />
                      )}
                    </div>
                  </td>
                </tr>
                {compositionId === dish.id && (
                  <tr className="poster-catalogue-detail-row"><td colSpan={recipeColumns.length + 1}>
                    <div id={`${compositionPanelId}-${dish.id}`} className="poster-catalogue-detail" aria-label={`Состав: ${dish.name}`}><DishComposition dish={dish} /></div>
                  </td></tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!isGoods && recipePages > 1 && <nav aria-label="Страницы техкарт" className="flex items-center justify-end gap-2 py-3 text-sm">
            <button type="button" className="btn-secondary btn-md" aria-label="Предыдущая страница" disabled={recipePage <= 1}
              onClick={() => updateFilters({ recipePage: String(recipePage - 1) })}>‹</button>
            <span>Страница {recipePage} из {recipePages}</span>
            <button type="button" className="btn-secondary btn-md" aria-label="Следующая страница" disabled={recipePage >= recipePages}
              onClick={() => updateFilters({ recipePage: String(recipePage + 1) })}>›</button>
          </nav>}
          {!rows.length && (
            <div className="space-y-3 py-12 text-center text-sm text-text-muted" role="status">
              <p>
                {filtered
                  ? 'Нет позиций по выбранным условиям'
                  : isGoods
                    ? editable
                      ? 'Добавьте первый товар для продажи'
                      : 'Товаров пока нет'
                    : editable
                      ? 'Добавьте первое блюдо'
                      : 'Блюд пока нет'}
              </p>
              {filtered && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={clearFilters}
                >
                  Сбросить фильтры
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function RecipeTrashPage({ onClose }: { onClose: () => void }) {
  const { list, restore } = useRecipeTrash();
  const push = useNotifications((state) => state.push);
  const stations = usePreparationStations().data ?? [];
  const categories = useAdminCategories().data ?? [];
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stationFilter, setStationFilter] = useState('');
  const categoryNames = new Map(menuCategoryOptions(categories, { includeMain: true }).map(({ value, label }) => [value, label]));
  const stationNames = new Map(routingOptions(stations).map(({ value, label }) => [value, label]));
  for (const station of stations) stationNames.set(station.id, station.name);
  const recipes = list.data ?? [];
  const categoryOptions = Array.from(new Map(recipes.map(({ category }) =>
    [category.id, { value: category.id, label: categoryNames.get(category.id) ?? category.name }],
  )).values()).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  const stationOptions = [...new Set(recipes.map(({ prepStation }) => prepStation))].map((value) => ({
    value, label: stationNames.get(value) ?? value,
  })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  const selectedCategories = warehouseMultiFilterValues(categoryFilter);
  const selectedStations = warehouseMultiFilterValues(stationFilter);
  const query = search.trim().toLocaleLowerCase('ru');
  const rows = recipes.filter(({ name, category, prepStation }) =>
    (!query || name.toLocaleLowerCase('ru').includes(query))
    && (!selectedCategories.length || selectedCategories.includes(category.id))
    && (!selectedStations.length || selectedStations.includes(prepStation)));
  return <EditorPage title="Корзина техкарт" onClose={onClose}>
    <p className="py-3 text-sm text-text-secondary">Техкарту с её вариантами и модификаторами можно восстановить в течение 30 дней после удаления.</p>
    <div className="poster-toolbar">
      <WorkspaceSearch label="Поиск техкарт в корзине" value={search} onChange={setSearch} />
      <WarehouseMultiFilter label="Категория" value={categoryFilter} options={categoryOptions} onChange={setCategoryFilter} />
      <WarehouseMultiFilter label="Цех" value={stationFilter} options={stationOptions} onChange={setStationFilter} />
    </div>
    {list.isPending ? <WorkspacePending /> : list.isError ? <ListLoadError error={list.error}
      pending={list.isFetching} onRetry={() => void list.refetch()} /> : !rows.length ?
      <p className="py-6">{recipes.length ? 'Техкарты по этим фильтрам не найдены' : 'Корзина пуста'}</p> :
      <div className="overflow-x-auto"><table className="poster-table w-full min-w-[620px] text-sm">
        <thead><tr className="border-b border-border text-left text-text-secondary">
          <th className="p-3">Название</th><th className="p-3">Категория</th><th className="p-3">Цех</th>
          <th className="p-3">Дата удаления</th><th aria-label="Действия" />
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-b border-border">
          <td className="p-3">{row.name}</td><td className="p-3">{categoryNames.get(row.category.id) ?? row.category.name}</td>
          <td className="p-3">{stationNames.get(row.prepStation) ?? row.prepStation}</td>
          <td className="p-3">{new Date(row.archivedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek', dateStyle: 'short', timeStyle: 'short' })}</td>
          <td className="p-3 text-right"><button type="button" className="text-primary hover:underline" disabled={restore.isPending}
            aria-label={'Восстановить ' + row.name} onClick={() => restore.mutate(row.id, { onSuccess: () =>
              push({ message: `Техкарта «${row.name}» восстановлена`, at: new Date().toISOString() }) })}>Восстановить</button></td>
        </tr>)}</tbody>
      </table></div>}
    {restore.isError && <p role="alert" className="py-2 text-danger">{apiError(restore.error)}</p>}
  </EditorPage>;
}

function recipeMetric(rows: MenuCostRow[] | undefined, metric: 'foodCost' | 'markupPercent' | 'foodCostPercent',
  format: (value: number) => string) {
  if (!rows?.length) return '—';
  const values = rows.flatMap((row) => row[metric] == null ? [] : [row[metric]]);
  if (!values.length) return '—';
  if (values.length !== rows.length) return 'По вариантам';
  const min = Math.min(...values), max = Math.max(...values);
  return min === max ? format(min) : `${format(min)} – ${format(max)}`;
}
function dishOutput(dish: AdminDish, costs?: MenuCostRow[]) {
  if (costs?.length) {
    const outputs = costs.flatMap(({ output }) => output ? [output] : []);
    if (!outputs.length) return '—';
    const units = new Set(outputs.map(({ unit }) => normalizeUnitLabel(unit)));
    if (units.size > 1 || outputs.length !== costs.length) return 'По вариантам';
    const amounts = outputs.map(({ amount }) => amount);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    return min === max ? menuOutputLabel(outputs[0])
      : `${balanceQuantity(min, normalizeUnitLabel(outputs[0].unit), undefined, false)} – ${menuOutputLabel({ amount: max, unit: outputs[0].unit })}`;
  }
  if (dish.variants.length) return 'По вариантам';
  const metadata = (
    dish as AdminDish & { recipeMetadata?: { outputQuantity?: number; outputUnit?: string } | null }
  ).recipeMetadata;
  return metadata?.outputQuantity != null
    ? balanceQuantity(metadata.outputQuantity, metadata.outputUnit ? normalizeUnitLabel(metadata.outputUnit) : '')
    : '—';
}
function ListLoadError({
  error,
  onRetry,
  pending,
}: {
  error: unknown;
  onRetry: () => void;
  pending: boolean;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm">
      <p className="text-danger">{apiError(error)}</p>
      <button
        type="button"
        className="text-primary hover:underline disabled:opacity-50"
        onClick={onRetry}
        disabled={pending}
      >
        {pending ? 'Загрузка…' : 'Повторить загрузку'}
      </button>
    </div>
  );
}
function ExistingSetPage({
  id,
  stations,
  onClose,
}: {
  id: string;
  stations: PreparationStation[];
  onClose: () => void;
}) {
  const setsQ = useAdminSets();
  if (setsQ.isPending)
    return (
      <EditorPage title="Сет" onClose={onClose}>
        <Spinner />
      </EditorPage>
    );
  if (setsQ.isError)
    return (
      <EditorPage title="Сет" onClose={onClose}>
        <ListLoadError
          error={setsQ.error}
          onRetry={() => void setsQ.refetch()}
          pending={setsQ.isFetching}
        />
      </EditorPage>
    );
  const set = setsQ.data.find((item) => item.id === id);
  if (!set)
    return (
      <EditorPage title="Сет не найден" onClose={onClose}>
        <p>Позиция удалена или недоступна.</p>
      </EditorPage>
    );
  return <SetModal key={id} set={set} stations={stations} onClose={onClose} />;
}
export function MenuCategoriesPage({ search, clearSearch }: { search: string; clearSearch: () => void }) {
  const categoriesQ = useAdminCategories();
  const stations = usePreparationStations().data ?? [];
  usePreparationStationUpdates();
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const { can } = usePermissions();
  const editable = can('actions.editMenu');
  const { reorder, update } = useCategoryMutations();
  const push = useNotifications((state) => state.push);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);
  const sorted = (categoriesQ.data ?? []).filter((category) => !category.id.startsWith('menu-root:')).sort((a, b) => a.sortOrder - b.sortOrder);
  const categoryPaths = new Map(menuCategoryOptions(sorted).map(({ value, label }) => [value, label]));
  const rows = sorted.filter((category) =>
    (categoryPaths.get(category.id) ?? category.name).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  const stationNames = new Map(
    routingOptions(stations).map((station) => [station.value, station.label]),
  );
  for (const station of stations) stationNames.set(station.id, station.name);
  async function move(categoryId: string, offset: number) {
    const index = sorted.findIndex((category) => category.id === categoryId),
      destination = index + offset;
    if (index < 0 || destination < 0 || destination >= sorted.length) return;
    const ids = sorted.map((category) => category.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    try {
      await reorder.mutateAsync(ids);
    } catch (failure) {
      push({ message: apiError(failure), at: new Date().toISOString() });
    }
  }
  const editingCategory = editor?.type === 'category' && !!editor.id;
  const categoryIndex = editingCategory ? sorted.findIndex((category) => category.id === editor.id) : -1;
  const creatingCategory = editor?.type === 'category' && !editor.id && editable;
  if (editor?.type === 'categoryTrash') {
    return editable ? <CategoryTrashPage onClose={closeEditor} /> : <EditorPage title="Корзина категорий" onClose={closeEditor}>
      <p role="alert" className="text-text-secondary">У вас нет доступа к восстановлению категорий.</p>
    </EditorPage>;
  }
  return (
    <div className="min-w-0">
      <WorkspaceHeaderCount count={categoriesQ.isSuccess ? rows.length : undefined} />
      {editable && !editor && <WorkspaceHeaderActions>
        <div className="catalogue-header-actions">
          <button type="button" className="workspace-tool" title="Корзина категорий"
            onClick={() => openEditor({ type: 'categoryTrash' })}>
            <IconTrash aria-hidden="true" /><span className="catalogue-action-label">Корзина</span>
          </button>
          <button type="button"
            aria-label="Добавить категорию"
            className="catalogue-add"
            onClick={() => openEditor({ type: 'category' })}
          >
            Добавить
          </button>
        </div>
      </WorkspaceHeaderActions>}
      {categoriesQ.isPending ? (
        <WorkspacePending />
      ) : categoriesQ.isError ? (
        <ListLoadError
          error={categoriesQ.error}
          onRetry={() => void categoriesQ.refetch()}
          pending={categoriesQ.isFetching}
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="poster-table poster-directory-table w-full min-w-[480px]">
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Станция</th>
                <th scope="col" className="text-right">Позиций меню</th>
                <th>
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((category) => (
                <tr key={category.id} id={`menu-category-${category.id}`}>
                  <td>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-left text-primary"
                      onClick={() => openEditor({ type: 'category', id: category.id })}
                    >
                      {category.imageUrl && <img src={resolveApiImage(category.imageUrl) ?? undefined} loading="lazy" alt="" className="h-8 w-10 rounded object-cover" />}
                      {categoryPaths.get(category.id) ?? category.name}
                      {!category.isActive && <span className="text-xs text-text-muted">Скрыта</span>}
                    </button>
                  </td>
                  <td className="text-text-secondary">
                    {stationNames.get(category.prepStation) ?? category.prepStation}
                  </td>
                  <td className="text-right tabular-nums">{category._count.dishes}</td>
                  <td className="w-px text-right">
                    <div className="poster-row-actions">
                      {editable && <button type="button" title="Изменить" aria-label={`Изменить категорию ${category.name}`}
                        className="row-action-icon"
                        onClick={() => openEditor({ type: 'category', id: category.id })}>
                        <IconEdit className="h-4 w-4" />
                      </button>}
                      {editable && (
                        <MenuActions
                          ariaLabel={`Действия категории ${category.name}`}
                          disabled={reorder.isPending || update.isPending}
                          onChange={(action) => {
                            if (action === 'delete') setDeleteTarget(category);
                            else if (action === 'up') void move(category.id, -1);
                            else if (action === 'down') void move(category.id, 1);
                            else if (action === 'visibility') update.mutate({ id: category.id, isActive: !category.isActive }, {
                              onError: (error) => push({ message: apiError(error), at: new Date().toISOString() }),
                            });
                          }}
                          options={[
                            ...(sorted[0]?.id === category.id
                              ? []
                              : [{ value: 'up', label: 'Поднять выше' }]),
                            ...(sorted.at(-1)?.id === category.id
                              ? []
                              : [{ value: 'down', label: 'Опустить ниже' }]),
                            { value: 'visibility', label: category.isActive ? 'Скрыть с кассы' : 'Показать на кассе' },
                            { value: 'delete', label: 'Удалить' },
                          ]}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="space-y-3 py-12 text-center text-sm text-text-muted" role="status">
              <p>
                {search
                  ? 'Категории по этому запросу не найдены'
                  : editable
                    ? 'Добавьте первую категорию товаров и блюд'
                    : 'Категорий пока нет'}
              </p>
              {search && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={clearSearch}
                >
                  Сбросить поиск
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {creatingCategory && <MenuCategoryForm key="new" stations={stations} onClose={closeEditor} />}
      {editingCategory && (categoryIndex >= 0 ? (
        <MenuCategoryForm key={editor.id} category={sorted[categoryIndex]} position={categoryIndex + 1}
          categoryCount={sorted.length} stations={stations} onClose={closeEditor} />
      ) : (
        <Modal open title="Категория" onClose={closeEditor}>
          {categoriesQ.isPending ? <Spinner /> : categoriesQ.isError ? (
            <ListLoadError error={categoriesQ.error} onRetry={() => void categoriesQ.refetch()} pending={categoriesQ.isFetching} />
          ) : <p className="text-sm text-text-secondary">Категория недоступна.</p>}
        </Modal>
      ))}
      {deleteTarget && (
        <DeleteCategorySheet
          category={deleteTarget}
          categories={sorted}
          onDone={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

function CategoryTrashPage({ onClose }: { onClose: () => void }) {
  const { list, restore } = useCategoryTrash();
  const push = useNotifications((state) => state.push);

  return <EditorPage title="Корзина категорий" onClose={onClose}>
    <p className="py-3 text-sm text-text-secondary">Категории со вложенными разделами и позициями можно восстановить в течение 30 дней после удаления.</p>
    {list.isPending ? <WorkspacePending /> : list.isError ? <ListLoadError error={list.error}
      pending={list.isFetching} onRetry={() => void list.refetch()} /> : !list.data.length ? <p className="py-6">Корзина пуста</p> :
      <div className="overflow-x-auto">
        <table className="poster-table poster-directory-table w-full min-w-[520px] text-sm">
          <thead><tr>
            <th scope="col">Категория</th>
            <th scope="col" className="text-right">Позиций меню</th>
            <th scope="col">Дата удаления</th>
            <th scope="col"><span className="sr-only">Действия</span></th>
          </tr></thead>
          <tbody>{list.data.map((row) => <tr key={row.id}>
            <td>{row.name}</td>
            <td className="text-right tabular-nums">{row.itemCount}</td>
            <td>{new Date(row.archivedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek', dateStyle: 'short', timeStyle: 'short' })}</td>
            <td className="text-right">{row.parentInTrash ? (
              <span className="text-text-muted">Сначала восстановите «{row.parentInTrash}»</span>
            ) : <button type="button" className="text-primary hover:underline" disabled={restore.isPending}
              aria-label={`Восстановить категорию ${row.name}`} onClick={() => restore.mutate(row.id, { onSuccess: () =>
                push({ message: `Категория «${row.name}» восстановлена`, at: new Date().toISOString() }) })}>Восстановить</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {restore.isError && <p role="alert" className="py-2 text-danger">{apiError(restore.error)}</p>}
  </EditorPage>;
}

function MenuCategoryForm({
  category,
  position = 1,
  categoryCount = 1,
  stations,
  onClose,
}: {
  category?: AdminCategory;
  position?: number;
  categoryCount?: number;
  stations: PreparationStation[];
  onClose: () => void;
}) {
  const formId = useId();
  const { create, update } = useCategoryMutations();
  const { can } = usePermissions();
  const editable = can('actions.editMenu');
  const [name, setName] = useState(category?.name ?? '');
  const draft = useMenuCategoryDraft(category);
  const [selectedStation, setSelectedStation] = useState(category?.prepStation);
  const prepStation = selectedStation ?? stations.find((station) => station.isActive)?.id ?? 'none';
  const [initialPosition] = useState(position);
  const [newPosition, setNewPosition] = useState(String(position));
  const [error, setError] = useState('');
  const push = useNotifications((state) => state.push);
  const pending = create.isPending || update.isPending || draft.uploading;
  const close = () => { if (!pending) onClose(); };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editable || pending) return;
    if (!name.trim()) {
      setError('Укажите название категории.');
      return;
    }
    const nextPosition = Number(newPosition);
    if (category && (!Number.isInteger(nextPosition) || nextPosition < 1 || nextPosition > categoryCount)) {
      setError(`Укажите позицию от 1 до ${categoryCount}.`);
      return;
    }
    setError('');
    try {
      const body = { name: name.trim(), prepStation, ...draft.input() };
      if (category) await update.mutateAsync({
        id: category.id, ...body, ...(nextPosition !== initialPosition ? { position: nextPosition } : {}),
      });
      else await create.mutateAsync(body);
      push({ message: 'Категория сохранена', at: new Date().toISOString() });
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    }
  }
  const fields = (
    <form id={formId} onSubmit={save}>
      <fieldset disabled={!editable || pending} className="min-w-0 space-y-4">
        <CategoryModalField label="Название">
          <input aria-label="Название категории" className="input" value={name} maxLength={60}
            onChange={(event) => setName(event.target.value)} required autoFocus={editable} />
        </CategoryModalField>
        <CategoryModalField label="Станция">
          <Select ariaLabel="Станция категории" className="h-11 w-full" value={prepStation}
            onChange={setSelectedStation} options={routingOptions(stations, prepStation)} disabled={!editable || pending} />
        </CategoryModalField>
        <MenuCategoryFields editingId={category?.id} draft={draft} disabled={!editable || pending} />
        {category && <CategoryModalField label="Позиция в списке">
          <div className="flex items-center gap-3">
            <input aria-label="Позиция в списке" className="input max-w-24" type="number" inputMode="numeric"
              min={1} max={categoryCount} step={1} required value={newPosition}
              onChange={(event) => setNewPosition(event.target.value)} />
            <span className="text-text-muted">из {categoryCount}</span>
          </div>
        </CategoryModalField>}
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </form>
  );
  const footer = (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={close} disabled={pending}>
        {editable ? 'Отмена' : 'Закрыть'}
      </button>
      {editable && <button type="submit" form={formId} className="btn-primary btn-md" disabled={pending}>
        {pending ? 'Сохранение…' : 'Сохранить'}
      </button>}
    </div>
  );
  const title = category ? (editable ? 'Редактирование категории' : 'Категория') : 'Добавление категории';
  return <Modal open title={title} onClose={close} footer={footer}>{fields}</Modal>;
}

function CategoryModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5 text-sm text-text-secondary">
    <span>{label}</span>
    {children}
  </div>;
}

function DeleteCategorySheet({
  category,
  categories,
  onDone,
}: {
  category: AdminCategory;
  categories: AdminCategory[];
  onDone: () => void;
}) {
  const { remove } = useCategoryMutations();
  const push = useNotifications((state) => state.push);
  const moveOptions = menuCategoryOptions(categories).filter(({ value }) => value !== category.id);
  const strategyName = useId();
  const [strategy, setStrategy] = useState<'move' | 'delete'>('delete');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState('');
  const childrenByParent = new Map<string, AdminCategory[]>();
  for (const item of categories) {
    if (!item.parentId) continue;
    const children = childrenByParent.get(item.parentId);
    if (children) children.push(item);
    else childrenByParent.set(item.parentId, [item]);
  }
  const archivedIds = new Set([category.id]);
  let archivedPositions = category._count.dishes;
  for (const id of archivedIds) {
    for (const child of childrenByParent.get(id) ?? []) {
      if (archivedIds.has(child.id)) continue;
      archivedIds.add(child.id);
      archivedPositions += child._count.dishes;
    }
  }
  const hasDishes = category._count.dishes > 0;
  const canDelete = strategy === 'delete' || !!targetId;

  async function run() {
    if (!canDelete || remove.isPending) return;
    const playEffect = captureDeletionEffect(`menu-category-${category.id}`);
    setError('');
    try {
      await remove.mutateAsync({ id: category.id, strategy, targetCategoryId: strategy === 'move' ? targetId : undefined });
      playEffect?.();
      push({ message: 'Категория перемещена в корзину', at: new Date().toISOString() });
      onDone();
    } catch (failure) {
      setError(apiError(failure));
    }
  }

  return (
    <Modal open manageFocus title="Удалить категорию" onClose={() => !remove.isPending && onDone()} footer={
      <div className="flex gap-2">
        <button type="button" className="btn-secondary btn-lg flex-1" data-dialog-initial-focus disabled={remove.isPending} onClick={onDone}>
          Отмена
        </button>
        <button type="button" className="btn-danger btn-lg flex-1 font-semibold"
          disabled={remove.isPending || !canDelete} onClick={() => void run()}>
          {remove.isPending ? <Spinner /> : strategy === 'move' ? 'Перенести и удалить категорию' : 'Переместить в корзину'}
        </button>
      </div>
    }>
      <p className="text-sm text-text-secondary">Удалить категорию «{category.name}»?</p>
      <p className="mt-2 text-sm text-text-muted">Восстановить категорию из корзины можно в течение 30 дней.</p>
      <p className="mt-2 text-sm text-text-secondary">
        {strategy === 'delete' ? `Позиций в корзину: ${archivedPositions}. Подкатегорий: ${archivedIds.size - 1}.`
          : `Позиций для переноса: ${category._count.dishes}. В корзину попадёт только выбранная категория.`}
      </p>
      {strategy === 'move' && archivedIds.size > 1 && <p className="mt-2 text-sm text-text-secondary">
        Подкатегории со своими позициями переместятся в «{categories.find((item) => item.id === category.parentId)?.name ?? 'Главный экран'}».
      </p>}
      {hasDishes && <>
        <p className="mt-2 text-sm text-text-muted">История заказов и чеки сохранятся.</p>
        <fieldset disabled={remove.isPending} className="mt-3 space-y-2.5 text-sm">
          <legend className="mb-1 font-medium">Что сделать с позициями?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name={strategyName} checked={strategy === 'move'} onChange={() => setStrategy('move')} />
            Перенести в другую категорию
          </label>
          {strategy === 'move' && <Select ariaLabel="Категория для переноса" className="h-10 w-full"
            value={targetId} onChange={setTargetId} disabled={remove.isPending}
            options={[{ value: '', label: 'Выберите категорию' }, { value: '__main_screen__', label: 'Главный экран' }, ...moveOptions]} />}
          <label className="flex items-center gap-2">
            <input type="radio" name={strategyName} checked={strategy === 'delete'} onChange={() => setStrategy('delete')} />
            Переместить категорию и её позиции в корзину
          </label>
        </fieldset>
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Modal>
  );
}

interface SetCompDraft {
  uid: string;
  dishId: string;
  dishVariantId?: string;
  name: string;
  quantity: number;
  removable: boolean;
  replaceable: boolean;
}

function SetModal({
  set,
  stations,
  onClose,
}: {
  set: AdminDish | null;
  stations: PreparationStation[];
  onClose: () => void;
}) {
  const isEdit = !!set;
  const { can } = usePermissions();
  const editable = can('actions.editMenu');
  const { create, update } = useSetMutations();
  const push = useNotifications((s) => s.push);
  const [name, setName] = useState(set?.name ?? '');
  const [price, setPrice] = useState(set ? String(Number(set.price)) : '');
  const [tax, setTax] = useState(() => dishTaxValue(set ?? undefined));
  const [prepStation, setPrepStation] = useState(set?.prepStation ?? '');
  const [components, setComponents] = useState<SetCompDraft[]>(() =>
    (set?.setComponents ?? []).map((c) => ({
      uid: c.id,
      dishId: c.dish.id,
      dishVariantId: c.dishVariant?.id,
      name: c.dishVariant ? `${c.dish.name} ${c.dishVariant.name}` : c.dish.name,
      quantity: c.quantity,
      removable: c.removable,
      replaceable: c.replaceable,
    })),
  );
  const [search, setSearch] = useState('');
  const dishesQ = useAdminDishes('', search.trim());
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;

  // Каждый вариант блюда — отдельный кандидат: «Coca-Cola 0.5 л» и «Coca-Cola 1 л» — разные строки.
  type Candidate = { dishId: string; dishVariantId?: string; name: string };
  const candidates: Candidate[] = (dishesQ.data ?? [])
    .filter((d) => !d.isSet && d.isActive)
    .flatMap((d): Candidate[] =>
      d.variants.length > 0
        ? d.variants.map((v) => ({
            dishId: d.id,
            dishVariantId: v.id,
            name: `${d.name} ${v.name}`,
          }))
        : [{ dishId: d.id, name: d.name }],
    )
    .filter(
      (c) => !components.some((x) => x.dishId === c.dishId && x.dishVariantId === c.dishVariantId),
    );

  function addComp(c: Candidate) {
    setComponents((cur) => [
      ...cur,
      {
        uid: `tmp-${c.dishId}-${c.dishVariantId ?? ''}-${Date.now()}`,
        dishId: c.dishId,
        dishVariantId: c.dishVariantId,
        name: c.name,
        quantity: 1,
        removable: true,
        replaceable: true,
      },
    ]);
  }
  function patch(uid: string, p: Partial<SetCompDraft>) {
    setComponents((cur) => cur.map((c) => (c.uid === uid ? { ...c, ...p } : c)));
  }

  async function onSubmit() {
    if (!editable || pending) return;
    setError('');
    const priceNum = Number(price);
    if (!name.trim()) return setError('Укажите название сета');
    if (!Number.isFinite(priceNum) || priceNum <= 0)
      return setError('Цена сета должна быть больше 0');
    if (components.length === 0) return setError('Добавьте блюда в состав сета');
    const body = {
      name: name.trim(),
      price: priceNum,
      ...(tax !== dishTaxValue(set ?? undefined) ? dishTaxInput(tax) : {}),
      prepStation: prepStation || null,
      components: components.map((c) => ({
        dishId: c.dishId,
        dishVariantId: c.dishVariantId,
        quantity: c.quantity,
        removable: c.removable,
        replaceable: c.replaceable,
      })),
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: set!.id, ...body });
        push({ message: 'Сет обновлён', at: new Date().toISOString() });
      } else {
        await create.mutateAsync(body);
        push({ message: 'Сет создан', at: new Date().toISOString() });
      }
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }

  return (
    <EditorPage
      open
      onClose={onClose}
      title={isEdit ? (editable ? 'Изменить сет' : set.name) : 'Новый сет'}
      panelClassName="max-w-xl"
      footer={
        editable ? (
          <button
            className="btn-primary btn-lg w-full font-semibold"
            disabled={pending}
            onClick={onSubmit}
          >
            {pending ? <Spinner /> : isEdit ? 'Сохранить' : 'Создать сет'}
          </button>
        ) : undefined
      }
    >
      <fieldset disabled={!editable || pending} className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Название">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Сет-6"
            />
          </Field>
          <Field label="Цена (с)">
            <input
              className="input"
              type="number"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Куда отправлять сет">
          <Select
            className="h-11 w-full"
            value={prepStation}
            onChange={setPrepStation}
            options={[
              { value: '', label: 'По категории' },
              ...routingOptions(stations, prepStation),
            ]}
          />
        </Field>
        <Field label="Налог">
          <MenuTaxSelect value={tax} onChange={setTax} inherit disabled={!editable || pending}
            categoryTaxId={set?.category.taxId} />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-text-secondary">Состав сета</p>
          {components.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-3 text-sm text-text-muted">
              {editable ? 'Добавьте блюда из списка ниже' : 'Состав сета не задан'}
            </p>
          ) : (
            <div className="space-y-1.5">
              {components.map((c) => (
                <div
                  key={c.uid}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">
                    {c.name}
                  </span>
                  <input
                    className="input h-9 w-16 px-2 text-center"
                    type="number"
                    min="1"
                    value={c.quantity}
                    onChange={(e) =>
                      patch(c.uid, {
                        quantity: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                  <label className="flex items-center gap-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={c.removable}
                      onChange={(e) => patch(c.uid, { removable: e.target.checked })}
                    />
                    убирать
                  </label>
                  <label className="flex items-center gap-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={c.replaceable}
                      onChange={(e) => patch(c.uid, { replaceable: e.target.checked })}
                    />
                    заменять
                  </label>
                  {editable && (
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-danger hover:bg-danger/5"
                      onClick={() => setComponents((cur) => cur.filter((x) => x.uid !== c.uid))}
                      title="Убрать из состава"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {editable && (
          <div>
            <p className="mb-1.5 text-sm font-medium text-text-secondary">Добавить блюдо</p>
            <input
              className="input mb-2"
              placeholder="Поиск блюда"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {dishesQ.isPending ? (
              <Spinner />
            ) : dishesQ.isError ? (
              <ListLoadError
                error={dishesQ.error}
                onRetry={() => void dishesQ.refetch()}
                pending={dishesQ.isFetching}
              />
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <button
                    key={`${c.dishId}-${c.dishVariantId ?? ''}`}
                    type="button"
                    onClick={() => addComp(c)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-left transition-colors hover:border-primary/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px] text-text-primary">
                      {c.name}
                    </span>
                    <IconPlus className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                ))}
                {candidates.length === 0 && (
                  <p className="py-3 text-center text-sm text-text-muted">Блюда не найдены</p>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </fieldset>
    </EditorPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
    </div>
  );
}

function MenuActions({
  ariaLabel,
  options,
  onChange,
  disabled = false,
}: {
  ariaLabel: string;
  options: { value: string; label: string }[];
  onChange: (action: string) => void;
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusLast = useRef(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  function openMenu(last = false) {
    const rect = trigger.current!.getBoundingClientRect(),
      height = options.length * 40 + 8;
    focusLast.current = last;
    setPosition({
      left: Math.max(8, Math.min(rect.right - 192, window.innerWidth - 200)),
      top:
        rect.bottom + height + 8 > window.innerHeight
          ? Math.max(8, rect.top - height - 4)
          : rect.bottom + 4,
    });
  }
  function closeMenu() {
    setPosition(null);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (!position) return;
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    buttons?.[focusLast.current ? buttons.length - 1 : 0]?.focus();
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setPosition(null);
    };
    const close = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setPosition(null);
    };
    document.addEventListener('mousedown', outside);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [position]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={!!position}
        aria-controls={position ? menuId : undefined}
        disabled={disabled}
        className="row-action-icon"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openMenu(event.key === 'ArrowUp');
          }
        }}
        onClick={() => {
          if (position) {
            setPosition(null);
            return;
          }
          openMenu();
        }}
      >
        <IconEllipsis className="h-4 w-4" aria-hidden="true" />
      </button>
      {position &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={ariaLabel}
            className="fixed z-[80] w-48 border border-border bg-white py-1 shadow-lg"
            style={position}
            onBlur={(event) => {
              if (
                event.relatedTarget !== trigger.current &&
                !event.currentTarget.contains(event.relatedTarget as Node | null)
              )
                setPosition(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
              } else if (event.key === 'Tab') {
                closeMenu();
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const buttons = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
                );
                const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              }
            }}
          >
            {options
              .filter((option) => option.value)
              .map((option) => (
                <button
                  key={option.value}
                  role="menuitem"
                  type="button"
                  tabIndex={-1}
                  className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-background focus:bg-background focus:outline-none ${option.value === 'delete' ? 'text-danger' : 'text-text-secondary'}`}
                  onClick={() => {
                    closeMenu();
                    onChange(option.value);
                  }}
                >
                  {option.label}
                </button>
              ))}
          </div>,
          document.body,
        )}
    </>
  );
}
