import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { balanceMoney as money, balanceQuantity as qty } from './balance-format';
import { Select } from '@/components/Select';
import type { AdminDish } from '../../api';
import { useIngredient, usePreparationRecipe, useRecipe, type IngredientDetails, type IngredientUsage, type Recipe } from './api';
import { recipeProcessingLabel } from './RecipeProcessingFields';
import { RecipeHistoryDrawer } from './RecipeHistoryDrawer';
import { PreparationPrintButton } from './PreparationPrintButton';
import { PreparationCost } from './PreparationCost';
import { normalizeUnitLabel, unitLabel } from './units';
import { recipeQuantity } from './recipe-draft-values';
import { QueryState } from './WarehouseUi';

export function CatalogueUsage({ id, prepared }: { id: string; prepared: boolean }) {
  const query = useIngredient(id);
  const item = query.data;
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  return (
    <CatalogueState pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
      {item && (
        <>
          <IngredientUsageTable item={item} />
          {!prepared && (
            <details className="mt-4">
              <summary className="mb-3 cursor-pointer text-sm text-primary">Остатки на складах</summary>
              <div className="overflow-x-auto"><table className="poster-table poster-catalogue-detail-table w-full min-w-[400px]">
                <thead><tr><th>Склад</th><th className="text-right">Остатки</th>{costs && <th className="text-right">Себестоимость</th>}</tr></thead>
                <tbody>
                  {item.balances.map((balance) => (
                    <tr key={balance.warehouseId}>
                      <td>{balance.warehouseName}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{qty(balance.stock, item.unit, item.unitType)}</td>
                      {costs && <td className="text-right whitespace-nowrap tabular-nums">{balance.avgCost == null ? '—' : money(balance.avgCost)}</td>}
                    </tr>
                  ))}
                  {!item.balances.length && <tr><td colSpan={costs ? 3 : 2}>Остатков по складам пока нет.</td></tr>}
                </tbody>
              </table></div>
            </details>
          )}
        </>
      )}
    </CatalogueState>
  );
}

const usageGroups: { title: string; kinds: IngredientUsage['kind'][]; composition?: boolean }[] = [
  { title: 'Используется в полуфабрикатах', kinds: ['preparation'], composition: true },
  { title: 'Используется в техкартах', kinds: ['recipe'], composition: true },
  { title: 'Прямая продажа', kinds: ['stock', 'variant'] },
  { title: 'Используется в модификаторах', kinds: ['modifier'] },
];

function MenuUsageLink({ id, kind, variantId, children }: {
  id: string; kind: 'recipe' | 'goods' | 'set' | 'preparation'; variantId?: string | null; children: ReactNode;
}) {
  const { canSection } = usePermissions();
  const location = useLocation();
  if (!canSection('menu')) return children;
  const view = kind === 'preparation' ? 'preparations' : kind === 'goods' ? 'goods' : 'recipes';
  const editor = kind === 'set' || kind === 'preparation' ? kind : 'entry';
  const search = new URLSearchParams({ section: 'menu', view, editor, id });
  if (variantId) {
    search.set('itemId', variantId);
    if (kind === 'recipe') search.set('action', 'recipe');
  }
  return <Link className="text-primary hover:underline" to={{ pathname: location.pathname, search: search.toString() }}
    state={{ editorFrom: location.pathname + location.search }}>{children}</Link>;
}

export function IngredientUsageTable({ item }: { item: IngredientDetails }) {
  const rows = item.usage;
  const costs = usePermissions().can('actions.warehouseCosts');
  const title = <h3 className="mb-3 font-medium">Где используется</h3>;
  if (!rows && item.usedInDishes?.length) return <>
    {title}
    <ul className="space-y-2 text-sm">{item.usedInDishes.map((dish) => <li key={dish.id}>
      <MenuUsageLink id={dish.id} kind="recipe">{dish.name}</MenuUsageLink>
    </li>)}</ul>
  </>;
  if (!rows?.length) return <p className="text-sm text-text-muted">Пока нигде не используется.</p>;
  return <div className="space-y-5">{usageGroups.map((group) => {
    const entries = rows.filter((row) => group.kinds.includes(row.kind));
    if (!entries.length) return null;
    return <section key={group.title}><h3 className="mb-2 font-medium">{group.title}</h3>
      <div className="overflow-x-auto"><table className="poster-table poster-catalogue-detail-table w-full min-w-[440px]">
      <thead><tr><th scope="col">Название</th><th scope="col" className="text-right">{group.composition ? 'Брутто' : 'Количество'}</th>
        {group.composition && <th scope="col" className="text-right">Нетто</th>}
        {group.composition && costs && <th scope="col" className="text-right">Цена, с</th>}</tr></thead>
      <tbody>{entries.map((row) => <tr key={`${row.kind}:${row.sourceId}`}>
        <td><MenuUsageLink id={row.targetId} variantId={row.variantId}
          kind={row.kind === 'preparation' ? 'preparation' : row.isSet ? 'set' : row.catalogKind === 'goods' ? 'goods' : 'recipe'}>
          {row.name}</MenuUsageLink>{row.label && <span className="ml-2 text-xs text-text-muted">{row.label}</span>}
          {!row.active && <span className="ml-2 text-xs text-text-muted">Неактивно</span>}</td>
        <td className="whitespace-nowrap text-right tabular-nums">{row.quantity == null || !row.unit ? '—' : recipeQuantity(row.quantity, row.unit)}</td>
        {group.composition && <td className="whitespace-nowrap text-right tabular-nums">{row.netQuantity == null || !row.netUnit ? '—' : recipeQuantity(row.netQuantity, row.netUnit)}</td>}
        {group.composition && costs && <td className="whitespace-nowrap text-right tabular-nums">{row.lineCost == null ? '—' : money(row.lineCost)}</td>}
      </tr>)}</tbody>
    </table></div></section>;
  })}</div>;
}

export function DishComposition({ dish }: { dish: AdminDish }) {
  const [variantId, setVariantId] = useState(dish.variants[0]?.id ?? '');
  const [historyOpen, setHistoryOpen] = useState(false);
  const query = useRecipe(dish.id, variantId || undefined);
  const { can, canSection } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const canReadHistory = canSection('warehouse');
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <h3 className="font-medium">Состав</h3>
        {dish.variants.length > 0 && <Select ariaLabel="Вариант техкарты" className="w-56"
          value={variantId} onChange={setVariantId}
          options={[{ value: '', label: 'Общий состав' }, ...dish.variants.map((variant) => ({ value: variant.id, label: variant.name }))]} />}
        {canReadHistory && <button type="button" className="btn-secondary btn-md ml-auto" onClick={() => setHistoryOpen(true)}>История состава</button>}
      </div>
      <CatalogueState pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
        {query.data && <DishRecipeDetails recipe={query.data} costs={costs} />}
      </CatalogueState>
      {canReadHistory && historyOpen && <RecipeHistoryDrawer dishId={dish.id} name={dish.name} isSet={dish.isSet === true} onClose={() => setHistoryOpen(false)} />}
    </>
  );
}

function DishRecipeDetails({ recipe, costs }: { recipe: Recipe; costs: boolean }) {
  const { items, stockItem, components, metadata, foodCost } = recipe;
  const output = recipe.output === undefined && metadata?.outputQuantity != null
    ? { amount: metadata.outputQuantity, unit: metadata.outputUnit ?? '' }
    : recipe.output;
  const hasDetails = !!stockItem || !!components?.length || !!items.length;
  const knownCost = (cost: number | null) => cost == null ? 'Не рассчитана' : money(cost);
  return <>
    {stockItem ? <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div><dt className="text-text-muted">Списывается при продаже</dt><dd className="font-medium">
        {stockItem.kind === 'preparation' || stockItem.kind === 'prepared_dish'
          ? <MenuUsageLink kind="preparation" id={stockItem.id}>{stockItem.name}</MenuUsageLink>
          : stockItem.name}</dd></div>
      <div><dt className="text-text-muted">Склад</dt><dd>{stockItem.warehouseName ?? 'По маршруту блюда'}</dd></div>
      <div><dt className="text-text-muted">Количество</dt><dd>{recipeQuantity(stockItem.amount, normalizeUnitLabel(stockItem.unit))}</dd></div>
      {costs && <div><dt className="text-text-muted">Себестоимость</dt><dd>{knownCost(foodCost)}</dd></div>}
    </dl> : components?.length ? <div className="overflow-x-auto">
      <table className="poster-table poster-catalogue-detail-table w-full min-w-[400px]">
        <thead><tr><th scope="col">Блюдо в сете</th><th scope="col" className="text-right">Количество</th>
          {costs && <th scope="col" className="text-right">Себестоимость строки</th>}</tr></thead>
        <tbody>{components.map((item, index) => <tr key={`${item.dishId}:${item.variantId ?? ''}:${index}`}>
          <td><MenuUsageLink id={item.dishId} kind="recipe" variantId={item.variantId}>{item.dishName}</MenuUsageLink>
            {item.variantName && <span className="ml-2 text-xs text-text-muted">{item.variantName}</span>}
            {!item.accountingConfigured && <span className="ml-2 text-xs text-text-muted">Складской учёт не настроен</span>}</td>
          <td className="text-right tabular-nums">{item.quantity}</td>
          {costs && <td className="whitespace-nowrap text-right">{knownCost(item.foodCost)}</td>}
        </tr>)}</tbody>
        {costs && <tfoot><tr><td colSpan={2}>Итого</td><td className="whitespace-nowrap text-right">{knownCost(foodCost)}</td></tr></tfoot>}
      </table>
    </div> : items.length ? <div className="overflow-x-auto">
      <table className="poster-table poster-catalogue-detail-table w-full min-w-[650px]">
        <thead><tr><th scope="col">Продукты</th><th scope="col">Склад</th><th scope="col">Обработка</th>
          <th scope="col" className="text-right">Брутто</th><th scope="col" className="text-right">Нетто</th>
          {costs && <th scope="col" className="text-right">Себестоимость</th>}</tr></thead>
        <tbody>{items.map((item) => {
          const net = item.netAmount ?? item.amount * (1 - (item.lossPercent ?? 0) / 100);
          return <tr key={item.id}>
            <td>{item.name}</td><td>{item.warehouseName ?? (item.fromCommonWarehouse ? 'Основной склад' : 'По маршруту блюда')}</td>
            <td>{recipeProcessingLabel(item) || '—'}</td>
            <td className="whitespace-nowrap text-right">{recipeQuantity(item.amount, item.unit)}</td>
            <td className="whitespace-nowrap text-right">{item.netWeightGrams == null ? recipeQuantity(net, item.unit) : <>
              {recipeQuantity(item.netWeightGrams, 'г')}
              <span className="block text-xs text-text-muted">{recipeQuantity(net, item.unit)}</span>
            </>}</td>
            {costs && <td className="whitespace-nowrap text-right">{knownCost(item.lineCost)}</td>}
          </tr>;
        })}</tbody>
        {(costs || output) && <tfoot><tr><td colSpan={5}>
          {output ? `Выход ${recipeQuantity(output.amount, output.unit ? normalizeUnitLabel(output.unit) : '')}` : 'Итого'}
        </td>{costs && <td className="whitespace-nowrap text-right">{knownCost(foodCost)}</td>}</tr></tfoot>}
      </table>
    </div> : <p className="text-sm text-text-muted">Состав пока не задан.</p>}
    {hasDetails && costs && !!recipe.missingCosts?.length && <p className="mt-2 text-xs text-text-muted">
      Нет данных для расчёта: {recipe.missingCosts.join(', ')}.</p>}
  </>;
}

export function PreparationComposition({ id, warehouseId }: { id: string; warehouseId?: string }) {
  const query = usePreparationRecipe(id, warehouseId);
  const costs = usePermissions().can('actions.warehouseCosts');
  return (
    <CatalogueState pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
      {query.data && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">Состав</h3>
            <PreparationPrintButton recipe={query.data} />
          </div>
          <div className="overflow-x-auto">
            <table className="poster-table poster-catalogue-detail-table w-full min-w-[620px]">
              <thead><tr><th>Ингредиент</th><th className="text-right">Брутто</th><th className="text-right">Нетто</th>{costs && <th className="text-right">Себестоимость</th>}</tr></thead>
              <tbody>
                {query.data.items.map((item) => {
                  const unit = unitLabel(item.unit);
                  const net = item.netAmount ?? item.quantity * (1 - (item.lossPercent ?? 0) / 100);
                  return <tr key={item.ingredientId}>
                      <td>{item.name}{recipeProcessingLabel(item) && <span className="ml-2 text-xs text-text-muted">{recipeProcessingLabel(item)}</span>}</td>
                      <td className="text-right whitespace-nowrap">{qty(item.quantity, unit)}</td>
                      <td className="text-right whitespace-nowrap">{item.netWeightGrams == null ? qty(net, unit) : recipeQuantity(item.netWeightGrams, 'г')}</td>
                      {costs && <td className="text-right whitespace-nowrap"><PreparationCost value={item.lineCost} known={item.knownLineCost} /></td>}
                    </tr>;
                })}
                {!query.data.items.length && <tr><td colSpan={costs ? 4 : 3}>Состав пока не задан.</td></tr>}
              </tbody>
              <tfoot><tr>
                <td colSpan={2} />
                <td className="text-right whitespace-nowrap">Выход: {qty(query.data.outputQuantity, unitLabel(query.data.outputUnit))}</td>
                {costs && <td className="text-right whitespace-nowrap"><PreparationCost value={query.data.totalCost} known={query.data.knownTotalCost} /></td>}
              </tr></tfoot>
            </table>
          </div>
          {costs && !!query.data.missingCosts?.length && <p className="mt-2 text-xs text-text-muted">Нет закупочной цены: {query.data.missingCosts.join(', ')}.</p>}
        </>
      )}
    </CatalogueState>
  );
}

function CatalogueState({ pending, error, onRetry, children }: {
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
}) {
  return <>
    <QueryState pending={pending} error={error}>{children}</QueryState>
    {!!error && <button type="button" className="text-sm text-primary hover:underline" onClick={onRetry}>Повторить загрузку</button>}
  </>;
}
