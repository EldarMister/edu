import { useState } from 'react';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { money } from '@/lib/format';
import { ITEM_KINDS, qty, useIngredients, type Ingredient } from './api';
import { QueryState } from './WarehouseUi';
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
}: {
  warehouseId?: string;
  filter: StockFilter;
  onFilter: (v: StockFilter) => void;
  onOpen: (i: Ingredient) => void;
  onCreate: () => void;
  onHistory: (id: string) => void;
  onProduce: (i: Ingredient) => void;
  catalogue?: false | 'ingredients' | 'preparations';
}) {
  const { can } = usePermissions();
  const costs = can('actions.warehouseCosts');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const query = useIngredients(search, warehouseId);
  const rows = (query.data ?? []).filter(
    (i) =>
      (catalogue === 'preparations'
        ? i.isPrepared
        : catalogue === 'ingredients'
          ? !i.isPrepared && i.kind !== 'goods' && i.kind !== 'beverage'
          : true) &&
      (!kind || i.kind === kind) &&
      (!category || i.category === category) &&
      (!filter || (filter === 'empty' ? i.stock <= 0 : i.isLow && i.stock > 0)),
  );
  const categories = [...new Set((query.data ?? []).flatMap((i) => (i.category ? [i.category] : [])))].sort();
  const type = (i: Ingredient) =>
    ITEM_KINDS.find((k) => k.value === i.kind)?.label ?? (i.isPrepared ? 'Полуфабрикат' : 'Ингредиент');
  const stock = (i: Ingredient) => (i.preparationMode === 'virtual' ? 'По рецепту' : qty(i.stock, i.unit));
  const actions = (i: Ingredient) => (
    <div className="flex flex-wrap justify-end gap-2">
      {can('actions.warehouseReports') && costs && (
        <button className="btn-ghost btn-md" onClick={() => onHistory(i.id)}>
          История
        </button>
      )}
      {i.isPrepared && i.preparationMode !== 'virtual' && can('actions.warehouseProduce') && (
        <button className="btn-secondary btn-md" onClick={() => onProduce(i)}>
          Приготовить
        </button>
      )}
    </div>
  );
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <input
          aria-label="Поиск позиции"
          className="input h-10 min-w-40 flex-1 sm:max-w-xs"
          placeholder="Поиск по названию или штрихкоду"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!catalogue && (
          <Select
            ariaLabel="Тип"
            className="h-10 min-w-36"
            value={kind}
            onChange={setKind}
            options={[{ value: '', label: 'Все типы' }, ...ITEM_KINDS]}
          />
        )}
        <Select
          ariaLabel="Категория"
          className="h-10 min-w-36"
          value={category}
          onChange={setCategory}
          options={[
            { value: '', label: 'Все категории' },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
        />
        <Select
          ariaLabel="Остатки"
          className="h-10 min-w-36"
          value={filter}
          onChange={(v) => onFilter(v as StockFilter)}
          options={[
            { value: '', label: 'Все остатки' },
            { value: 'low', label: 'Ниже лимита' },
            { value: 'empty', label: 'Закончилось' },
          ]}
        />
        {can('actions.warehouseReceive') && (
          <button className="btn-primary btn-md ml-auto" onClick={onCreate}>
            {catalogue ? '+ Добавить' : 'Открыть каталог'}
          </button>
        )}
      </div>
      <QueryState pending={query.isPending} error={query.error} empty={query.isSuccess && !rows.length}>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-background/40 text-xs text-text-muted">
              <tr>
                <th className="p-3">Название</th>
                <th className="p-3">Тип</th>
                <th className="p-3">Категория</th>
                <th className="p-3 text-right">Остаток</th>
                {costs && (
                  <>
                    <th className="p-3 text-right">Себестоимость</th>
                    <th className="p-3 text-right">Сумма</th>
                  </>
                )}
                <th className="p-3 text-right">Лимит</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-background/60">
                  <td className="p-3">
                    <button
                      className="text-left font-medium text-text-primary hover:text-primary"
                      onClick={() => onOpen(i)}
                    >
                      {i.name}
                    </button>
                  </td>
                  <td className="p-3 text-text-muted">{type(i)}</td>
                  <td className="p-3">{i.category || '—'}</td>
                  <td
                    className={`p-3 text-right whitespace-nowrap ${i.stock <= 0 ? 'text-danger' : i.isLow ? 'text-warning' : ''}`}
                  >
                    {stock(i)}
                  </td>
                  {costs && (
                    <>
                      <td className="p-3 text-right whitespace-nowrap">
                        {i.avgCost != null ? money(i.avgCost) : '—'}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {i.avgCost != null ? money(i.stock * i.avgCost) : '—'}
                      </td>
                    </>
                  )}
                  <td className="p-3 text-right">{qty(i.lowStockThreshold, i.unit)}</td>
                  <td className="p-3">{actions(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border md:hidden">
          {rows.map((i) => (
            <article key={i.id} className="space-y-3 p-4">
              <button className="text-left font-semibold text-primary" onClick={() => onOpen(i)}>
                {i.name}
              </button>
              <p className="text-xs text-text-muted">
                {type(i)}
                {i.category ? ` · ${i.category}` : ''}
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span>Остаток</span>
                <span className={`text-right ${i.isLow ? 'text-danger' : ''}`}>{stock(i)}</span>
                {costs && (
                  <>
                    <span>Стоимость / сумма</span>
                    <span className="text-right">
                      {i.avgCost != null
                        ? `${money(i.avgCost)} / ${money(i.stock * i.avgCost)}`
                        : 'Не задана'}
                    </span>
                  </>
                )}
                <span>Лимит</span>
                <span className="text-right">{qty(i.lowStockThreshold, i.unit)}</span>
              </div>
              {actions(i)}
            </article>
          ))}
        </div>
        {costs && rows.length > 0 && (
          <div className="border-t border-border p-4 text-right text-sm font-semibold">
            {rows.some((i) => i.avgCost == null && i.stock !== 0) ? 'Известная стоимость' : 'Итого'}:{' '}
            {money(rows.reduce((s, i) => s + i.stock * (i.avgCost ?? 0), 0))}
            {rows.some((i) => i.avgCost == null && i.stock !== 0) && (
              <p className="mt-1 text-xs font-normal text-warning">
                Для части позиций стоимость неизвестна. Итог неполный.
              </p>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}
