import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useIngredients, useWarehouseDishes, type Ingredient } from './api';
import { RecipeEditor } from './RecipeEditor';
export function RecipesTab({
  onPreparation,
  dishesOnly = false,
}: {
  onPreparation: (item: Ingredient) => void;
  dishesOnly?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [dish, setDish] = useState<{ id: string; name: string; price: string } | null>(null);
  const dishes = useWarehouseDishes(search);
  const ingredients = useIngredients(search);
  const prepared = (ingredients.data ?? []).filter((i) => i.isPrepared);
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap gap-2 border-b border-border p-4">
        <input
          className="input h-10 flex-1 sm:max-w-xs"
          aria-label="Поиск техкарты"
          placeholder="Блюдо, напиток или заготовка"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!dishesOnly && (
          <Select
            ariaLabel="Вид техкарты"
            className="h-10 min-w-44"
            value={kind}
            onChange={setKind}
            options={[
              { value: '', label: 'Все техкарты' },
              { value: 'dish', label: 'Блюда и напитки меню' },
              { value: 'preparation', label: 'Заготовки' },
            ]}
          />
        )}
      </div>
      {(dishes.isPending || ingredients.isPending) && (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      )}
      {(dishes.isError || ingredients.isError) && (
        <p role="alert" className="p-4 text-danger">
          {apiError(dishes.error ?? ingredients.error)}
        </p>
      )}
      <div className="divide-y divide-border">
        {kind !== 'preparation' &&
          (dishes.data ?? [])
            .filter((d) => !d.hasDirectStock)
            .map((d) => (
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm hover:bg-background"
                key={d.id}
                onClick={() => setDish(d)}
              >
                <span>
                  <span className="block font-medium text-text-primary">{d.name}</span>
                  <span className="text-xs text-text-muted">
                    {d.category?.name ?? (d.isSet ? 'Сет' : 'Блюдо')} · меню
                  </span>
                </span>
                <span className="text-primary">Состав и себестоимость →</span>
              </button>
            ))}
        {!dishesOnly &&
          kind !== 'dish' &&
          prepared.map((item) => (
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm hover:bg-background"
              key={item.id}
              onClick={() => onPreparation(item)}
            >
              <span>
                <span className="block font-medium text-text-primary">{item.name}</span>
                <span className="text-xs text-text-muted">
                  Заготовка ·{' '}
                  {item.preparationMode === 'virtual' ? 'состав при продаже' : 'производство партиями'}
                </span>
              </span>
              <span className="text-primary">Рецептура и выход →</span>
            </button>
          ))}
      </div>
      {dishes.isSuccess && ingredients.isSuccess && !dishes.data?.length && !prepared.length && (
        <p className="p-8 text-sm text-text-muted">
          Создайте блюдо в меню или добавьте полуфабрикат в «Товары и остатки», затем заполните его состав
          здесь.
        </p>
      )}
      {dish && (
        <Modal open title={dish.name} onClose={() => setDish(null)} panelClassName="max-w-4xl">
          <RecipeEditor dishId={dish.id} price={Number(dish.price)} />
        </Modal>
      )}
    </div>
  );
}
