import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useNotifications } from '@/store/notifications';
import { Spinner } from '@/components/Spinner';
import { Select } from '@/components/Select';
import { EditorPage, useEditorDirty } from './EditorPage';
import { RecipeDraftFields } from './RecipeDraftFields';
import { recipeDraftPayload, recipeDraftRows, recipePreviewItems, validRecipeRows } from './recipe-draft-values';
import { RecipeCostSummary } from './RecipeCostSummary';
import { useRecipePreview, type RecipePreview } from './recipe-preview-api';
import type { ModifierDraft } from './ModifierDraftFields';
import { PROCESSING_METHODS, type Recipe, type RecipeMetadata, qty } from './api';
import { costLabel } from './cost-format';
import { unitLabel } from './units';

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
  const [variantId, setVariantId] = useState('');
  const variants = recipe.variants ?? [];
  const modifiers = baseline.modifiers;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const snapshot = JSON.stringify([rows, metadata]);
  const [original] = useState(snapshot);
  const { markSaved } = useEditorDirty(editable && original !== snapshot);
  const validRows = validRecipeRows(rows);
  const preview = useRecipePreview(!editable || validRows ? {
    dishId: recipe.dishId,
    variantId: variantId || undefined,
    metadata: { outputQuantity: metadata.outputQuantity, outputUnit: metadata.outputUnit },
    items: !recipe.stockIngredientId && !recipe.isSet && recipe.catalogKind === 'recipe'
      ? recipePreviewItems(rows, variants.map(({ id }) => id)) : [],
  } : null);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editable || submitting.current) return;
    if (!validRows) {
      setError('Проверьте нормы техкарты. Брутто должно быть больше нуля, нетто не больше брутто, а потери от 0 до 100%.');
      return;
    }
    setError('');
    submitting.current = true;
    setPending(true);
    try {
      await api.put(`/admin/warehouse/dishes/${recipe.dishId}/recipe-draft`, {
        expectedVersion: recipe.version,
        items: recipeDraftPayload(rows),
        metadata,
      });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
      push({ message: 'Техкарта сохранена', at: new Date().toISOString() });
      markSaved();
      onClose();
    } catch (failure) {
      setError(apiError(failure));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <EditorPage
      title={recipe.dishName}
      onClose={() => { if (!submitting.current) onClose(); }}
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
        {(costs || preview.data?.stockItem || variants.length > 0) && <section className="space-y-3 rounded-xl border border-border p-4">
          {variants.length > 0 && <Select ariaLabel="Вариант техкарты" className="h-10 w-full sm:max-w-sm" value={variantId}
            options={[{ value: '', label: 'Базовая норма' }, ...variants.map(({ id, name }) => ({ value: id, label: name }))]}
            onChange={setVariantId} />}
          <RecipeCostSummary preview={preview} showCosts={costs} showError={!editable} showMissing={!editable}
            showPriceMetrics={!variants.length || !!variantId} />
        </section>}
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
              disabled={pending}
              allowCreate={false}
              preview={preview}
              previewVariant={variantId || undefined}
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
            {!!recipe.items.length && !preview.data?.stockItem && <RecipeReadOnly recipe={recipe} costs={costs} preview={preview.data} />}
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
            {!recipe.items.length && !recipe.components?.length && !recipe.stockItem && !preview.data?.stockItem && (
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
function RecipeReadOnly({ recipe, costs, preview }: { recipe: Recipe; costs: boolean; preview?: RecipePreview }) {
  const calculated = new Map(preview?.items.map((row) => [row.ingredientId, row]));
  return (
    <section className="min-w-0 w-full space-y-3">
      <h3 className="text-lg font-semibold">Состав техкарты</h3>
      <div className="min-w-0 w-full overflow-x-auto">
        <table className="w-full min-w-[550px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="py-3 pr-3">Ингредиент</th>
              <th className="px-3">Склад</th>
              <th className="px-3">Обработка</th>
              <th className="px-3">Брутто</th>
              <th className="px-3">Нетто</th>
              {costs && <th className="pl-3 text-right">Себестоимость</th>}
            </tr>
          </thead>
          <tbody>
            {recipe.items.map((row) => {
              const source = calculated.get(row.ingredientId);
              const unit = source ? unitLabel(source.amountUnit) : row.unit;
              const gross = source?.amount ?? row.amount;
              const net = source ? source.netAmount : row.netAmount;
              return <tr className="border-b border-border" key={row.id}>
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
                <td className="px-3">{source?.warehouseName ?? '—'}</td>
                <td className="px-3">
                  {PROCESSING_METHODS.find((method) => method.value === row.processingMethod)
                    ?.label ?? 'Без обработки'}
                </td>
                <td className="px-3">{qty(gross, unit)}</td>
                <td className="px-3">{net == null ? '—' : qty(net, unit)}</td>
                {costs && <td className="pl-3 text-right">{costLabel(source?.lineCost)}</td>}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
