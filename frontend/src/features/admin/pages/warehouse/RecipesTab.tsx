import { useEditorRoute, usePageFilter } from './workspace-route';
import { usePermissions } from '@/hooks/usePermissions';
import { Select } from '@/components/Select';
import { Spinner } from '@/components/Spinner';
import { apiError } from '@/lib/api';
import { useIngredients, useWarehouseDishes, type Ingredient } from './api';
import { StaffRecipePage } from './StaffRecipePage';
export function RecipesTab({
  onPreparation,
  dishesOnly = false,
}: {
  onPreparation: (item: Ingredient) => void;
  dishesOnly?: boolean;
}) {
  const [search, setSearch] = usePageFilter('search');
  const [kind, setKind] = usePageFilter('kind');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const { can } = usePermissions();
  const dishes = useWarehouseDishes(search);
  const ingredients = useIngredients(search);
  const prepared = (ingredients.data ?? []).filter((i) => i.isPrepared);
  if (editor?.type === 'recipe' && editor.id)
    return (
      <StaffRecipePage
        dishId={editor.id}
        onClose={closeEditor}
        onOpenDish={(id) => openEditor({ type: 'recipe', id })}
      />
    );
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
            .filter((d) => (d.catalogKind ? d.catalogKind === 'recipe' : !d.hasDirectStock))
            .map((d) => (
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm hover:bg-background"
                key={d.id}
                onClick={() => openEditor({ type: 'recipe', id: d.id })}
              >
                <span>
                  <span className="block font-medium text-text-primary">{d.name}</span>
                  <span className="text-xs text-text-muted">
                    {d.category?.name ?? (d.isSet ? 'Сет' : 'Блюдо')} · меню
                  </span>
                </span>
                <span className="text-primary">
                  {can('actions.warehouseCosts') ? 'Состав и себестоимость →' : 'Состав →'}
                </span>
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
                  {item.preparationMode === 'virtual'
                    ? 'состав при продаже'
                    : 'производство партиями'}
                </span>
              </span>
              <span className="text-primary">Рецептура и выход →</span>
            </button>
          ))}
      </div>
      {dishes.isSuccess && ingredients.isSuccess && !dishes.data?.length && !prepared.length && (
        <p className="p-8 text-sm text-text-muted">Здесь появятся техкарты, добавленные в меню.</p>
      )}
    </div>
  );
}
