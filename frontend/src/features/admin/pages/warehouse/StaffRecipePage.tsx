import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { Spinner } from '@/components/Spinner';
import { EditorPage } from './EditorPage';
import { RecipeDraftFields, recipeDraftPayload, recipeDraftRows } from './RecipeDraftFields';
import type { ModifierDraft } from './ModifierDraftFields';
import { PROCESSING_METHODS, type Recipe, type RecipeMetadata, qty } from './api';
import { costLabel } from './cost-format';

interface StaffRecipeData {
  recipe: Recipe & {
    isSet: boolean;
    catalogKind: 'goods' | 'recipe';
    stockItem?: { name: string; amount: number; unit: string } | null;
  };
  modifiers: ModifierDraft;
}
export function StaffRecipePage({
  dishId,
  onClose,
  onOpenDish,
}: {
  dishId: string;
  onClose: () => void;
  onOpenDish: (id: string) => void;
}) {
  const query = useQuery({
    queryKey: ['admin', 'warehouse', 'recipe-draft', dishId],
    queryFn: () =>
      api
        .get<StaffRecipeData>(`/admin/warehouse/dishes/${dishId}/recipe-draft`)
        .then((response) => response.data),
  });
  if (query.isPending)
    return (
      <EditorPage title="Техкарта" onClose={onClose}>
        <Spinner />
      </EditorPage>
    );
  if (query.isError)
    return (
      <EditorPage title="Техкарта" onClose={onClose}>
        <p role="alert" className="text-danger">
          {apiError(query.error)}
        </p>
        <button className="btn-secondary btn-md mt-4" onClick={() => query.refetch()}>
          Повторить
        </button>
      </EditorPage>
    );
  return (
    <StaffRecipeForm key={dishId} initial={query.data} onClose={onClose} onOpenDish={onOpenDish} />
  );
}

function StaffRecipeForm({
  initial,
  onClose,
  onOpenDish,
}: {
  initial: StaffRecipeData;
  onClose: () => void;
  onOpenDish: (id: string) => void;
}) {
  const [baseline] = useState(initial);
  const recipe = baseline.recipe;
  const { can } = usePermissions();
  const editable =
    can('actions.warehouseRecipes') &&
    !recipe.isSet &&
    recipe.catalogKind === 'recipe' &&
    !recipe.stockIngredientId;
  const costs = can('actions.warehouseCosts');
  const queryClient = useQueryClient();
  const push = useNotifications((state) => state.push);
  const [rows, setRows] = useState(() => recipeDraftRows(recipe.items));
  const [metadata, setMetadata] = useState<RecipeMetadata>(() => recipe.metadata ?? {});
  const modifiers = baseline.modifiers;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editable || pending) return;
    if (rows.some((row) => row.amount <= 0 || (row.netAmount ?? row.amount) > row.amount)) {
      setError('Укажите брутто больше нуля. Нетто не должно превышать брутто.');
      return;
    }
    setError('');
    setPending(true);
    try {
      await api.put(`/admin/warehouse/dishes/${recipe.dishId}/recipe-draft`, {
        expectedVersion: recipe.version,
        items: recipeDraftPayload(rows),
        metadata,
      });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      push({ message: 'Техкарта сохранена', at: new Date().toISOString() });
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      setPending(false);
    }
  }
  return (
    <EditorPage
      title={recipe.dishName}
      onClose={onClose}
      footer={
        editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              form="staff-recipe"
              className="btn-primary btn-md"
              disabled={pending}
            >
              {pending ? 'Сохранение…' : 'Сохранить'}
            </button>
            <button className="btn-ghost btn-md" onClick={onClose} disabled={pending}>
              Отмена
            </button>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        ) : undefined
      }
    >
      <form id="staff-recipe" className="min-w-0 w-full space-y-6" onSubmit={save}>
        {recipe.stockItem && (
          <p className="border-b border-border pb-4 text-sm">
            При продаже списывается: <strong>{recipe.stockItem.name}</strong> ·{' '}
            {qty(recipe.stockItem.amount, recipe.stockItem.unit)}
          </p>
        )}
        {!!recipe.components?.length && (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Состав сета</h3>
            <p className="text-sm text-text-muted">
              Расход сырья определяется техкартами блюд в составе сета.
            </p>
            <div className="divide-y divide-border">
              {recipe.components.map((component) => (
                <button
                  key={`${component.dishId}:${component.variantId ?? ''}`}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-4 text-left text-sm"
                  onClick={() => onOpenDish(component.dishId)}
                >
                  <span className="font-medium text-primary">
                    {component.dishName} × {component.quantity}
                  </span>
                  <span>{costs ? costLabel(component.foodCost) : 'Открыть состав'} →</span>
                </button>
              ))}
            </div>
          </section>
        )}
        {editable ? (
          <fieldset disabled={pending} className="min-w-0 w-full space-y-6">
            <RecipeDraftFields
              rows={rows}
              onChange={setRows}
              variants={recipe.variants}
              showCosts={costs}
              allowCreate={false}
            />
            <div className="grid min-w-0 gap-5 md:max-w-3xl">
              <label className="grid gap-2 md:grid-cols-[190px_minmax(0,1fr)]">
                <span className="pt-2 text-sm text-text-secondary">Выход готового блюда</span>
                <span className="flex gap-2">
                  <input
                    aria-label="Выход готового блюда"
                    className="input w-32"
                    type="number"
                    min="0.001"
                    step="any"
                    value={metadata.outputQuantity ?? ''}
                    onChange={(event) =>
                      setMetadata((value) => ({
                        ...value,
                        outputQuantity: event.target.value ? Number(event.target.value) : undefined,
                      }))
                    }
                  />
                  <input
                    aria-label="Единица выхода"
                    className="input w-24"
                    value={metadata.outputUnit ?? ''}
                    onChange={(event) =>
                      setMetadata((value) => ({ ...value, outputUnit: event.target.value }))
                    }
                    placeholder="г"
                  />
                </span>
              </label>
              <label className="grid gap-2 md:grid-cols-[190px_minmax(0,1fr)]">
                <span className="pt-2 text-sm text-text-secondary">Способ приготовления</span>
                <textarea
                  aria-label="Способ приготовления"
                  className="input min-h-28"
                  value={metadata.instructions ?? ''}
                  onChange={(event) =>
                    setMetadata((value) => ({ ...value, instructions: event.target.value }))
                  }
                />
              </label>
            </div>
          </fieldset>
        ) : (
          <>
            {!!recipe.items.length && <RecipeReadOnly recipe={recipe} costs={costs} />}
            {recipe.metadata?.outputQuantity != null && (
              <p className="text-sm">
                Выход:{' '}
                <strong>
                  {qty(recipe.metadata.outputQuantity, recipe.metadata.outputUnit ?? '')}
                </strong>
              </p>
            )}
            {!!recipe.metadata?.instructions && (
              <section>
                <h3 className="mb-2 text-base font-semibold">Способ приготовления</h3>
                <p className="whitespace-pre-wrap text-sm">{recipe.metadata.instructions}</p>
              </section>
            )}
            {!recipe.items.length && !recipe.components?.length && !recipe.stockItem && (
              <p className="text-sm text-text-muted">Состав этой техкарты ещё не заполнен.</p>
            )}
          </>
        )}
        {!!modifiers.groups.length && (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Модификаторы</h3>
            {modifiers.groups.map((group, index) => (
              <div key={group.id ?? index}>
                <h4 className="font-medium">{group.name}</h4>
                <p className="mt-1 text-sm text-text-secondary">
                  {group.options
                    .filter((option) => option.isActive !== false)
                    .map((option) => option.name)
                    .join(', ')}
                </p>
              </div>
            ))}
          </section>
        )}
      </form>
    </EditorPage>
  );
}
function RecipeReadOnly({ recipe, costs }: { recipe: Recipe; costs: boolean }) {
  return (
    <section className="min-w-0 w-full space-y-3">
      <h3 className="text-lg font-semibold">Состав техкарты</h3>
      <div className="min-w-0 w-full overflow-x-auto">
        <table className="w-full min-w-[550px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="py-3 pr-3">Ингредиент</th>
              <th className="px-3">Обработка</th>
              <th className="px-3">Брутто</th>
              <th className="px-3">Нетто</th>
              {costs && <th className="pl-3 text-right">Себестоимость</th>}
            </tr>
          </thead>
          <tbody>
            {recipe.items.map((row) => (
              <tr className="border-b border-border" key={row.id}>
                <td className="py-4 pr-3">
                  <span className="font-medium">{row.name}</span>
                  {recipe.variants?.map(
                    (variant) =>
                      row.variantAmounts?.[variant.id] != null && (
                        <p key={variant.id} className="mt-1 text-xs text-text-muted">
                          {variant.name}: {qty(row.variantAmounts[variant.id], row.unit)}
                        </p>
                      ),
                  )}
                </td>
                <td className="px-3">
                  {PROCESSING_METHODS.find((method) => method.value === row.processingMethod)
                    ?.label ?? 'Без обработки'}
                </td>
                <td className="px-3">{qty(row.amount, row.unit)}</td>
                <td className="px-3">{qty(row.netAmount ?? row.amount, row.unit)}</td>
                {costs && <td className="pl-3 text-right">{costLabel(row.lineCost)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {costs && (
        <p className="text-right text-sm">
          Себестоимость: <strong>{costLabel(recipe.foodCost)}</strong>
        </p>
      )}
    </section>
  );
}
