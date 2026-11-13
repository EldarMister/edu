import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@/components/Select';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { api, apiError } from '@/lib/api';
import { costLabel } from './cost-format';
import { money } from '@/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { ModifierEditor } from './ModifierEditor';
import { Field, ItemCard } from './ItemCard';
import {
  PROCESSING_METHODS,
  type ProcessingMethod,
  useRecipe,
  useRecipeMutations,
  useIngredients,
  useWarehouseLocations,
  qty,
  type Recipe,
  type RecipeItem,
  type RecipeRowInput,
} from './api';
import { unitsForType, UNIT_OPTIONS, type UnitCode } from './units';

export function RecipeEditor({ dishId, price }: { dishId: string; price: number }) {
  const [history, setHistory] = useState(false);
  const [child, setChild] = useState<{ id: string; name: string } | null>(null);
  const [variant, setVariant] = useState('');
  const [editing, setEditing] = useState<RecipeItem | 'new' | null>(null);
  const [error, setError] = useState('');
  const recipeQ = useRecipe(dishId, variant || undefined);
  const recipe = recipeQ.data;
  const { removeItem } = useRecipeMutations(dishId);
  const { can } = usePermissions();
  const edit = can('actions.warehouseRecipes');
  const costs = can('actions.warehouseCosts');
  async function remove(item: RecipeItem) {
    setError('');
    try {
      await removeItem.mutateAsync(item.id);
    } catch (err) {
      setError(apiError(err));
    }
  }
  if (recipeQ.isPending)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );
  if (recipeQ.isError)
    return (
      <p role="alert" className="text-danger">
        {apiError(recipeQ.error)}
      </p>
    );
  if (!recipe) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-text-primary">Состав и себестоимость</h4>
          <button type="button" className="text-xs text-primary" onClick={() => setHistory(true)}>
            {recipe.dishName} · версия {recipe.version ?? 1} · История
          </button>
        </div>
        <button type="button" className="btn-secondary btn-md print:hidden" onClick={() => window.print()}>
          Печать техкарты
        </button>
      </div>
      {!!recipe.variants?.length && (
        <Select
          ariaLabel="Вариант блюда для калькуляции"
          className="h-10 w-full"
          value={variant}
          onChange={(v) => {
            setVariant(v);
            setEditing(null);
          }}
          options={[
            { value: '', label: 'Базовая порция' },
            ...recipe.variants.map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
      )}
      {costs && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cost label="Цена продажи" value={money(recipe.price ?? price)} />
          <Cost label="Прямая себестоимость" value={costLabel(recipe.foodCost)} />
          <Cost
            label="Маржа по продуктам"
            value={
              recipe.marginAmount == null || recipe.marginPercent == null
                ? 'Неизвестно'
                : `${money(recipe.marginAmount)} · ${recipe.marginPercent.toFixed(1)}%`
            }
          />
          <Cost
            label="Доля себестоимости"
            value={recipe.foodCostPercent == null ? 'Неизвестно' : `${recipe.foodCostPercent.toFixed(1)}%`}
          />
        </div>
      )}
      {!!recipe.missingCosts?.length && costs && (
        <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm">
          Расчёт неполный: закупочная цена неизвестна для {recipe.missingCosts.join(', ')}.
        </p>
      )}
      {recipe.accountingConfigured === false && (
        <p className="rounded-lg bg-warning/10 p-3 text-sm">
          Складской учёт для блюда не настроен. Добавьте состав или выберите готовый товар для прямой продажи.
        </p>
      )}
      <RecipeSettings
        key={`${dishId}:${variant}:${recipe.version}`}
        recipe={recipe}
        variantId={variant || undefined}
        editable={edit}
      />
      {!!recipe.components?.length && !recipe.stockIngredientId && (
        <div className="rounded-xl border border-border p-3">
          <h4 className="font-semibold">Состав сета из меню</h4>
          <p className="mt-1 text-xs text-text-muted">
            Расход рассчитывается по тем же блюдам, заменам и исключениям, которые выбраны в заказе.
          </p>
          {recipe.components.map((component) => (
            <button
              type="button"
              key={`${component.dishId}:${component.variantId ?? ''}`}
              className="flex w-full justify-between gap-2 border-t border-border py-3 text-left text-sm"
              onClick={() => setChild({ id: component.dishId, name: component.dishName })}
            >
              <span>
                {component.dishName} × {component.quantity}
              </span>
              <span>
                {component.accountingConfigured
                  ? costs
                    ? costLabel(component.foodCost)
                    : 'Открыть состав'
                  : 'Учёт не настроен'}{' '}
                →
              </span>
            </button>
          ))}
        </div>
      )}
      {!recipe.stockIngredientId && !recipe.components?.length && (
        <>
          <div className="rounded-xl border border-border">
            <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_150px] gap-2 border-b border-border bg-background/50 p-3 text-xs text-text-muted md:grid">
              <span>Ингредиент</span>
              <span>Обработка</span>
              <span>Брутто</span>
              <span>Нетто</span>
              <span>{costs ? 'Себестоимость' : ''}</span>
              <span />
            </div>
            {recipe.items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-2 items-center gap-2 border-b border-border p-3 text-sm last:border-0 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_150px]"
              >
                <div className="col-span-2 md:col-span-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-text-muted">
                    {item.fromCommonWarehouse
                      ? 'Основной склад'
                      : item.warehouseId
                        ? 'Выбранный склад'
                        : 'Склад станции'}
                  </p>
                </div>
                <span>
                  {PROCESSING_METHODS.find((m) => m.value === item.processingMethod)?.label ??
                    'Без обработки'}
                </span>
                <span>
                  <span className="text-text-muted md:hidden">Брутто: </span>
                  {qty(item.amount, item.unit)}
                </span>
                <span>
                  <span className="text-text-muted md:hidden">Нетто: </span>
                  {qty(item.netAmount ?? item.amount, item.unit)}
                  {item.lossPercent ? ` (−${item.lossPercent}%)` : ''}
                </span>
                <span>{costs ? costLabel(item.lineCost) : ''}</span>
                {edit && (
                  <div className="col-span-2 flex gap-2 md:col-span-1">
                    <button className="btn-ghost btn-md" onClick={() => setEditing(item)}>
                      Изменить
                    </button>
                    <button
                      className="btn-ghost btn-md"
                      disabled={removeItem.isPending}
                      aria-label={`Удалить ${item.name}`}
                      onClick={() => void remove(item)}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!recipe.items.length && (
              <p className="p-4 text-sm text-text-muted">
                Добавьте ингредиенты или полуфабрикаты и расход на порцию.
              </p>
            )}
            <div className="flex flex-wrap justify-between gap-2 border-t border-border bg-background/40 p-3 text-sm font-semibold">
              <span>
                Выход:{' '}
                {recipe.metadata?.outputQuantity != null
                  ? qty(recipe.metadata.outputQuantity, recipe.metadata.outputUnit ?? 'г')
                  : 'не задан'}
              </span>
              {costs && <span>Итого себестоимость: {costLabel(recipe.foodCost)}</span>}
            </div>
          </div>
          {edit && (
            <button
              type="button"
              className="btn-primary btn-md print:hidden"
              onClick={() => setEditing('new')}
            >
              + Добавить ингредиент
            </button>
          )}
        </>
      )}
      {editing && (
        <RecipeLineModal
          key={editing === 'new' ? 'new' : editing.id}
          dishId={dishId}
          recipe={recipe}
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Модификаторы и исключения</summary>
        <div className="mt-4">
          <ModifierEditor dishId={dishId} />
        </div>
      </details>
      {costs && (
        <p className="text-xs text-text-muted">
          Маржа по продуктам не включает зарплату, аренду и другие расходы. Фактическая себестоимость
          проданных порций хранится в отчёте «Себестоимость продаж».
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {history && <RecipeHistory dishId={dishId} onClose={() => setHistory(false)} />}
      {child && (
        <Modal open title={child.name} onClose={() => setChild(null)} panelClassName="max-w-4xl">
          <RecipeEditor dishId={child.id} price={0} />
        </Modal>
      )}
    </div>
  );
}
function Cost({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 font-semibold text-text-primary">{value}</p>
    </div>
  );
}

function RecipeSettings({
  recipe,
  editable,
  variantId,
}: {
  recipe: Recipe;
  editable: boolean;
  variantId?: string;
}) {
  const { can } = usePermissions();
  const canReceive = can('actions.warehouseReceive');
  const ingredients = useIngredients('');
  const { settings } = useRecipeMutations(recipe.dishId);
  const [direct, setDirect] = useState(recipe.stockIngredientId ?? '');
  const [createItem, setCreateItem] = useState(false);
  const current = (ingredients.data ?? []).find((i) => i.id === direct);
  const [quantity, setQuantity] = useState(String(recipe.stockAmount ?? 1));
  const [instructions, setInstructions] = useState(recipe.metadata?.instructions ?? '');
  const [output, setOutput] = useState(String(recipe.metadata?.outputQuantity ?? ''));
  const [unit, setUnit] = useState(recipe.metadata?.outputUnit ?? 'g');
  const [photo, setPhoto] = useState(recipe.metadata?.photoUrl ?? '');
  const [error, setError] = useState('');
  async function save() {
    if (settings.isPending) return;
    setError('');
    try {
      await settings.mutateAsync({
        variantId,
        stockIngredientId: direct || null,
        stockAmount: direct ? Number(quantity) : undefined,
        stockUnit: current?.baseUnit,
        metadata: {
          instructions,
          outputQuantity: output ? Number(output) : undefined,
          outputUnit: unit,
          photoUrl: photo,
        },
      });
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <details className="rounded-xl border border-border p-3 print:open">
      <summary className="cursor-pointer text-sm font-medium">
        {recipe.stockIngredientId ? 'Прямая продажа готового товара' : 'Выход, инструкция и способ списания'}
      </summary>
      <div className="mt-3 space-y-3">
        <Field label="Способ списания">
          <Select
            ariaLabel="Способ списания"
            className="h-10 w-full"
            disabled={!editable}
            value={direct}
            onChange={(v) => {
              setDirect(v);
              setQuantity('1');
            }}
            options={[
              { value: '', label: 'Ингредиенты по техкарте' },
              ...(ingredients.data ?? []).map((i) => ({ value: i.id, label: `Готовый товар: ${i.name}` })),
            ]}
          />
        </Field>
        {editable && canReceive && (
          <button type="button" className="btn-secondary btn-md" onClick={() => setCreateItem(true)}>
            + Новый готовый товар
          </button>
        )}
        {createItem && (
          <ItemCard
            defaultKind="goods"
            onClose={() => setCreateItem(false)}
            onSaved={(item) => {
              setDirect(item.id);
              setQuantity('1');
            }}
          />
        )}
        {direct && (
          <Field
            label={`Расход готового товара на продажу, ${UNIT_OPTIONS.find((u) => u.value === current?.baseUnit)?.label ?? ''}`}
          >
            <input
              className="input w-full"
              type="number"
              min="0"
              step="any"
              disabled={!editable}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Выход готового блюда">
            <input
              className="input w-full"
              type="number"
              min="0"
              step="any"
              disabled={!editable}
              value={output}
              onChange={(e) => setOutput(e.target.value)}
            />
          </Field>
          <Field label="Единица выхода">
            <Select
              ariaLabel="Единица выхода"
              className="h-10 w-full"
              disabled={!editable}
              value={unit}
              onChange={setUnit}
              options={UNIT_OPTIONS}
            />
          </Field>
        </div>
        <Field label="Инструкция приготовления">
          <textarea
            className="input min-h-24 w-full"
            disabled={!editable}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <Field label="Ссылка на фото">
          <input
            className="input w-full"
            type="url"
            disabled={!editable}
            value={photo}
            onChange={(e) => setPhoto(e.target.value)}
          />
        </Field>
        {recipe.metadata?.photoUrl && /^https?:\/\//.test(recipe.metadata.photoUrl) && (
          <img
            src={recipe.metadata.photoUrl}
            alt={recipe.dishName}
            className="max-h-48 rounded-lg object-contain"
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {editable && (
          <button
            type="button"
            className="btn-secondary btn-md"
            disabled={settings.isPending || (!!direct && !(Number(quantity) > 0))}
            onClick={() => void save()}
          >
            Сохранить настройки техкарты
          </button>
        )}
      </div>
    </details>
  );
}
function RecipeLineModal({
  dishId,
  recipe,
  item,
  onClose,
}: {
  dishId: string;
  recipe: Recipe;
  item?: RecipeItem;
  onClose: () => void;
}) {
  const ingredients = useIngredients('');
  const locations = useWarehouseLocations();
  const mutations = useRecipeMutations(dishId);
  const { can } = usePermissions();
  const [id, setId] = useState(item?.ingredientId ?? '');
  const [createItem, setCreateItem] = useState(false);
  const [amount, setAmount] = useState(String(item?.amount ?? ''));
  const [unit, setUnit] = useState<UnitCode>(item?.amountUnit ?? 'g');
  const [warehouse, setWarehouse] = useState(
    item?.warehouseId ?? (item?.fromCommonWarehouse ? 'common' : ''),
  );
  const [net, setNet] = useState(String(item?.netAmount ?? ''));
  const [loss, setLoss] = useState(String(item?.lossPercent ?? 0));
  const [method, setMethod] = useState<ProcessingMethod | ''>(item?.processingMethod ?? '');
  const [variants, setVariants] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(item?.variantAmounts ?? {}).map(([id, n]) => [id, String(n)])),
  );
  const [error, setError] = useState('');
  const selected = (ingredients.data ?? []).find((i) => i.id === id);
  const used = new Set(recipe.items.filter((i) => i.id !== item?.id).map((i) => i.ingredientId));
  const busy = mutations.addItem.isPending || mutations.updateItem.isPending;
  async function save() {
    if (busy) return;
    setError('');
    try {
      const body: RecipeRowInput = {
        amount: Number(amount),
        processingMethod: method || null,
        unit,
        fromCommonWarehouse: warehouse === 'common',
        warehouseId: warehouse && warehouse !== 'common' ? warehouse : null,
        netAmount: net === '' ? undefined : Number(net),
        lossPercent: Number(loss || 0),
        variantAmounts: Object.fromEntries(
          Object.entries(variants)
            .filter(([, v]) => v !== '')
            .map(([id, v]) => [id, Number(v)]),
        ),
      };
      if (item) await mutations.updateItem.mutateAsync({ id: item.id, ...body });
      else await mutations.addItem.mutateAsync({ ingredientId: id, ...body });
      onClose();
    } catch (err) {
      setError(apiError(err));
    }
  }
  return (
    <section className="rounded-xl border border-primary/30 bg-background/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-semibold">{item ? 'Изменить ингредиент' : 'Добавить ингредиент'}</h4>
        <button className="btn-ghost btn-md" onClick={onClose}>
          Отмена
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Товар">
          <Select
            ariaLabel="Ингредиент"
            className="h-10 w-full"
            value={id}
            disabled={!!item}
            onChange={(v) => {
              setId(v);
              setUnit((ingredients.data ?? []).find((i) => i.id === v)?.displayUnit ?? 'g');
            }}
            options={(ingredients.data ?? [])
              .filter((i) => !used.has(i.id))
              .map((i) => ({ value: i.id, label: i.name }))}
          />
        </Field>
        {!item && can('actions.warehouseReceive') && (
          <button type="button" className="btn-secondary btn-md self-end" onClick={() => setCreateItem(true)}>
            + Новый ингредиент
          </button>
        )}
        {createItem && (
          <ItemCard
            onClose={() => setCreateItem(false)}
            onSaved={(ingredient) => {
              setId(ingredient.id);
              setUnit(ingredient.displayUnit);
            }}
          />
        )}
        <Field label="Способ обработки">
          <Select
            ariaLabel="Способ обработки"
            className="h-10 w-full"
            value={method}
            options={[{ value: '', label: 'Без обработки' }, ...PROCESSING_METHODS]}
            onChange={(v) => {
              const percent = v ? (selected?.processingLosses?.[v as ProcessingMethod] ?? 0) : 0;
              setMethod(v as ProcessingMethod | '');
              setLoss(String(percent));
              setNet(String(Number(amount) * (1 - percent / 100)));
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Расход брутто на порцию">
            <input
              className="input w-full"
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setNet(String(Number(e.target.value) * (1 - Number(loss) / 100)));
              }}
            />
          </Field>
          <Field label="Единица">
            <Select
              ariaLabel="Единица ингредиента"
              className="h-10 w-full"
              value={unit}
              onChange={(v) => setUnit(v as UnitCode)}
              options={selected ? unitsForType(selected.unitType) : UNIT_OPTIONS}
            />
          </Field>
        </div>
        {selected && can('actions.warehouseCosts') && (
          <p className="text-sm text-text-secondary">
            Стоимость строки по среднему остатку:{' '}
            {selected.avgCost == null
              ? 'Неизвестно'
              : money(
                  (Number(amount || 0) * selected.avgCost * (unit === 'kg' || unit === 'l' ? 1000 : 1)) /
                    (selected.displayUnit === 'kg' || selected.displayUnit === 'l' ? 1000 : 1),
                )}
            . Точная стоимость после сохранения учитывает склад списания.
          </p>
        )}
        <Field label="Откуда списывать">
          <Select
            ariaLabel="Склад ингредиента"
            className="h-10 w-full"
            value={warehouse}
            onChange={setWarehouse}
            options={[
              { value: '', label: 'Склад станции приготовления' },
              { value: 'common', label: 'Основной склад' },
              ...(locations.data?.locations ?? [])
                .filter((l) => !l.isDefault)
                .map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        </Field>
        <details open className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm">Нетто, потери и размеры порции</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Нетто после обработки">
              <input
                className="input w-full"
                type="number"
                min="0"
                step="any"
                value={net}
                onChange={(e) => {
                  setNet(e.target.value);
                  setLoss(
                    String(Number(amount) > 0 ? (1 - Number(e.target.value) / Number(amount)) * 100 : 0),
                  );
                }}
              />
            </Field>
            <Field label="Потери при обработке, %">
              <input
                className="input w-full"
                type="number"
                min="0"
                max="99.99"
                step="any"
                value={loss}
                onChange={(e) => {
                  setLoss(e.target.value);
                  setNet(String(Number(amount) * (1 - Number(e.target.value) / 100)));
                }}
              />
            </Field>
            {recipe.variants?.map((v) => (
              <Field key={v.id} label={`Брутто: ${v.name}`}>
                <input
                  className="input w-full"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Как базовая порция"
                  value={variants[v.id] ?? ''}
                  onChange={(e) => setVariants((current) => ({ ...current, [v.id]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
        </details>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="button"
          className="btn-primary btn-lg w-full"
          disabled={busy || !id || !(Number(amount) > 0)}
          onClick={() => void save()}
        >
          Сохранить ингредиент
        </button>
      </div>
    </section>
  );
}

interface Revision {
  id: string;
  version: number;
  createdAt: string;
  snapshot: {
    metadata?: { instructions?: string };
    stockIngredientId?: string;
    stockAmount?: string;
    items?: {
      ingredientId: string;
      amount: string;
      amountUnit: UnitCode;
      netAmount?: string;
      lossPercent?: string;
    }[];
  };
}
function RecipeHistory({ dishId, onClose }: { dishId: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['admin', 'warehouse', 'revisions', dishId],
    queryFn: async () =>
      (await api.get<Revision[]>(`/admin/warehouse/dishes/${dishId}/recipe-revisions`)).data,
  });
  const ingredients = useIngredients('');
  const names = new Map((ingredients.data ?? []).map((i) => [i.id, i.name]));
  return (
    <Modal open title="История рецептуры" onClose={onClose} panelClassName="max-w-xl">
      {query.isPending && <Spinner />}
      {query.isError && (
        <p role="alert" className="text-danger">
          {apiError(query.error)}
        </p>
      )}
      {query.data?.length === 0 && (
        <p className="text-sm text-text-muted">
          Предыдущих версий ещё нет. При изменении состава текущая версия сохранится здесь.
        </p>
      )}
      <div className="space-y-3">
        {query.data?.map((version) => (
          <details key={version.id} className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Версия {version.version} · {new Date(version.createdAt).toLocaleString('ru-RU')}
            </summary>
            <div className="mt-3 space-y-2 text-sm">
              {version.snapshot.stockIngredientId && (
                <p>Прямая продажа: {names.get(version.snapshot.stockIngredientId) ?? 'Архивный товар'}</p>
              )}
              {version.snapshot.items?.map((item) => (
                <div key={item.ingredientId} className="flex justify-between gap-2">
                  <span>{names.get(item.ingredientId) ?? 'Архивный товар'}</span>
                  <span>
                    {qty(
                      Number(item.amount) / (item.amountUnit === 'kg' || item.amountUnit === 'l' ? 1000 : 1),
                      UNIT_OPTIONS.find((u) => u.value === item.amountUnit)?.label ?? item.amountUnit,
                    )}
                  </span>
                </div>
              ))}
              {version.snapshot.metadata?.instructions && (
                <p className="whitespace-pre-wrap text-text-secondary">
                  {version.snapshot.metadata.instructions}
                </p>
              )}
              {!version.snapshot.stockIngredientId && !version.snapshot.items?.length && (
                <p className="text-text-muted">Состав не был заполнен</p>
              )}
            </div>
          </details>
        ))}
      </div>
    </Modal>
  );
}
