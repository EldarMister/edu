import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { balanceMoney as money, balanceQuantity as qty } from './balance-format';
import { Select } from '@/components/Select';
import type { AdminDish } from '../../api';
import { PROCESSING_METHODS, useIngredient, usePreparationRecipe, useRecipe } from './api';
import { normalizeUnitLabel, unitLabel } from './units';
import { QueryState } from './WarehouseUi';

export function CatalogueUsage({ id, prepared }: { id: string; prepared: boolean }) {
  const query = useIngredient(id);
  const item = query.data;
  const { can, canSection } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const location = useLocation();
  return (
    <CatalogueState pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
      {item && (
        <>
          {!prepared && (
            <>
              <h3 className="mb-3 font-medium">Остатки на складах</h3>
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
            </>
          )}
          <h3 className={`${prepared ? '' : 'mt-5 '}mb-3 font-medium`}>Используется в тех. картах:</h3>
          {item.usedInDishes.length ? (
            <table className="poster-table poster-catalogue-detail-table w-full">
              <thead><tr><th>Название</th></tr></thead>
              <tbody>{item.usedInDishes.map((dish) => <tr key={dish.id}><td>
                {canSection('menu') ? <Link className="text-primary hover:underline"
                  to={{ pathname: location.pathname, search: new URLSearchParams({ section: 'menu', view: 'recipes', editor: 'entry', id: dish.id }).toString() }}
                  state={{ editorFrom: location.pathname + location.search }}>
                  {dish.name}
                </Link> : dish.name}
              </td></tr>)}</tbody>
            </table>
          ) : <p className="text-sm text-text-muted">Пока не используется в тех. картах.</p>}
        </>
      )}
    </CatalogueState>
  );
}

export function DishComposition({ dish }: { dish: AdminDish }) {
  const [variantId, setVariantId] = useState(dish.variants[0]?.id ?? '');
  const query = useRecipe(dish.id, variantId || undefined);
  const costs = usePermissions().can('actions.warehouseCosts');
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        <h3 className="font-medium">Состав</h3>
        {dish.variants.length > 0 && <Select ariaLabel="Вариант техкарты" className="w-56"
          value={variantId} onChange={setVariantId}
          options={dish.variants.map((variant) => ({ value: variant.id, label: variant.name }))} />}
      </div>
      <CatalogueState pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
        {query.data && <div className="overflow-x-auto">
          <table className="poster-table poster-catalogue-detail-table w-full min-w-[620px]">
            <thead><tr><th>Продукты</th><th>Метод приготовления</th><th className="text-right">Брутто</th><th className="text-right">Нетто</th>{costs && <th className="text-right">Себестоимость</th>}</tr></thead>
            <tbody>
              {query.data.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}<span className="text-text-muted">, {item.unit}</span></td>
                  <td>{PROCESSING_METHODS.find((method) => method.value === item.processingMethod)?.label ?? '—'}</td>
                  <td className="text-right whitespace-nowrap">{qty(item.amount, item.unit, item.unitType)}</td>
                  <td className="text-right whitespace-nowrap">{qty(!variantId && item.netAmount != null ? item.netAmount : item.amount * (1 - (item.lossPercent ?? 0) / 100), item.unit, item.unitType)}</td>
                  {costs && <td className="text-right whitespace-nowrap">{item.lineCost == null ? '—' : money(item.lineCost)}</td>}
                </tr>
              ))}
              {!query.data.items.length && <tr><td colSpan={costs ? 5 : 4}>Состав пока не задан.</td></tr>}
            </tbody>
            {query.data.items.length > 0 && <tfoot><tr>
              <td colSpan={4}>
                {query.data.metadata?.outputQuantity != null
                  ? `Выход: ${qty(query.data.metadata.outputQuantity, query.data.metadata.outputUnit ? normalizeUnitLabel(query.data.metadata.outputUnit) : '')}`
                  : 'Итого'}
              </td>
              {costs && <td className="text-right whitespace-nowrap">{query.data.foodCost == null ? '—' : money(query.data.foodCost)}</td>}
            </tr></tfoot>}
          </table>
          {costs && !!query.data.missingCosts?.length && <p className="mt-2 text-xs text-text-muted">Нет закупочной цены: {query.data.missingCosts.join(', ')}.</p>}
        </div>}
      </CatalogueState>
    </>
  );
}

export function PreparationComposition({ id, warehouseId }: { id: string; warehouseId?: string }) {
  const query = usePreparationRecipe(id, warehouseId);
  const costs = usePermissions().can('actions.warehouseCosts');
  return (
    <CatalogueState pending={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
      {query.data && (
        <>
          <h3 className="mb-3 font-medium">Состав</h3>
          <div className="overflow-x-auto">
            <table className="poster-table poster-catalogue-detail-table w-full min-w-[620px]">
              <thead><tr><th>Продукты</th><th>Метод приготовления</th><th className="text-right">Брутто</th><th className="text-right">Нетто</th>{costs && <th className="text-right">Себестоимость</th>}</tr></thead>
              <tbody>
                {query.data.items.map((item) => (
                  <tr key={item.ingredientId}>
                    <td>{item.name}<span className="text-text-muted">, {unitLabel(item.unit)}</span></td>
                    <td>{PROCESSING_METHODS.find((method) => method.value === item.processingMethod)?.label ?? '—'}</td>
                    <td className="text-right whitespace-nowrap">{qty(item.quantity, unitLabel(item.unit))}</td>
                    <td className="text-right whitespace-nowrap">{qty(item.netAmount ?? item.quantity * (1 - (item.lossPercent ?? 0) / 100), unitLabel(item.unit))}</td>
                    {costs && <td className="text-right whitespace-nowrap">{item.lineCost == null ? '—' : money(item.lineCost)}</td>}
                  </tr>
                ))}
                {!query.data.items.length && <tr><td colSpan={costs ? 5 : 4}>Состав пока не задан.</td></tr>}
              </tbody>
              <tfoot><tr>
                <td colSpan={3} />
                <td className="text-right whitespace-nowrap">Выход: {qty(query.data.outputQuantity, unitLabel(query.data.outputUnit))}</td>
                {costs && <td className="text-right whitespace-nowrap">{query.data.totalCost == null ? '—' : money(query.data.totalCost)}</td>}
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
