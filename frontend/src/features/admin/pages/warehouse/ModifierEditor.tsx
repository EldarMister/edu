import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '@/lib/api';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { useIngredients, useWarehouseLocations } from './api';
import { unitsForType } from './units';
import { Field } from './ItemCard';
import { QueryState, DocumentFooter } from './WarehouseUi';
type Option = {
  id?: string;
  name: string;
  price: number;
  ingredientId?: string;
  amount?: number;
  unit?: string;
  fromCommonWarehouse?: boolean;
  warehouseId?: string | null;
  maxQuantity?: number;
  isActive?: boolean;
  sortOrder?: number;
};
type Group = {
  id?: string;
  name: string;
  minSelections: number;
  maxSelections?: number;
  sortOrder?: number;
  options: Option[];
};
type Data = {
  allowIngredientExclusions: boolean;
  groups: Group[];
  excludableIngredients?: { id: string; name: string }[];
};
export function ModifierEditor({ dishId }: { dishId: string }) {
  const q = useQuery({
    queryKey: ['admin', 'warehouse', 'modifiers', dishId],
    queryFn: () => api.get<Data>(`/admin/warehouse/dishes/${dishId}/modifiers`).then((r) => r.data),
  });
  return (
    <QueryState pending={q.isPending} error={q.error}>
      {q.data && <ModifierForm key={dishId} dishId={dishId} data={q.data} />}
    </QueryState>
  );
}
function ModifierForm({ dishId, data }: { dishId: string; data: Data }) {
  const { can } = usePermissions();
  const editable = can('actions.warehouseRecipes');
  const ingredients = useIngredients('');
  const locations = useWarehouseLocations();
  const qc = useQueryClient();
  const [allow, setAllow] = useState(data.allowIngredientExclusions);
  const [groups, setGroups] = useState<
    (Omit<Group, 'options'> & { key: string; options: (Option & { key: string })[] })[]
  >(() =>
    data.groups.map((g) => ({
      ...g,
      key: g.id ?? crypto.randomUUID(),
      options: g.options.map((o) => ({ ...o, key: o.id ?? crypto.randomUUID() })),
    })),
  );
  const mutation = useMutation({
    mutationFn: (body: Data) =>
      api.put<Data>(`/admin/warehouse/dishes/${dishId}/modifiers`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'warehouse'] }),
  });
  const [saved, setSaved] = useState(false);
  function updateGroup(key: string, patch: Partial<Group>) {
    setSaved(false);
    setGroups((v) => v.map((g) => (g.key === key ? { ...g, ...patch, options: g.options } : g)));
  }
  function updateOption(gkey: string, key: string, patch: Partial<Option>) {
    setSaved(false);
    setGroups((v) =>
      v.map((g) =>
        g.key === gkey
          ? { ...g, options: g.options.map((o) => (o.key === key ? { ...o, ...patch } : o)) }
          : g,
      ),
    );
  }
  async function save() {
    const body = {
      allowIngredientExclusions: allow,
      groups: groups.map(({ key: _key, ...g }, sortOrder) => ({
        ...g,
        sortOrder,
        options: g.options.map(({ key: _option, ...o }, order) => ({
          ...o,
          sortOrder: order,
          ingredientId: o.ingredientId || undefined,
          warehouseId: o.warehouseId || null,
        })),
      })),
    };
    try {
      const result = await mutation.mutateAsync(body);
      setGroups(
        result.groups.map((g) => ({
          ...g,
          key: g.id ?? crypto.randomUUID(),
          options: g.options.map((o) => ({ ...o, key: o.id ?? crypto.randomUUID() })),
        })),
      );
      setSaved(true);
    } catch {
      /* error rendered */
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Добавки меняют цену заказа и расход выбранного ингредиента. Исключения убирают ингредиент из состава
        порции.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={!editable}
          checked={allow}
          onChange={(e) => {
            setAllow(e.target.checked);
            setSaved(false);
          }}
        />
        Разрешить исключать ингредиенты
      </label>
      {allow && (
        <p className="text-xs text-text-muted">
          Доступны:{' '}
          {data.excludableIngredients?.map((i) => i.name).join(', ') || 'добавьте ингредиенты в состав блюда'}
        </p>
      )}
      {groups.map((g) => (
        <section key={g.key} className="rounded-xl border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto]">
            <Field label="Группа модификаторов">
              <input
                className="input w-full"
                disabled={!editable}
                value={g.name}
                onChange={(e) => updateGroup(g.key, { name: e.target.value })}
              />
            </Field>
            <Field label="Минимум выборов">
              <input
                type="number"
                min="0"
                className="input w-full"
                disabled={!editable}
                value={g.minSelections}
                onChange={(e) => updateGroup(g.key, { minSelections: Number(e.target.value) })}
              />
            </Field>
            <Field label="Максимум выборов">
              <input
                type="number"
                min="1"
                className="input w-full"
                disabled={!editable}
                value={g.maxSelections ?? ''}
                onChange={(e) =>
                  updateGroup(g.key, { maxSelections: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </Field>
            {editable && (
              <button
                className="btn-ghost btn-md self-end"
                onClick={() => setGroups((v) => v.filter((x) => x.key !== g.key))}
              >
                Удалить группу
              </button>
            )}
          </div>
          <div className="mt-3 space-y-3">
            {g.options.map((o) => {
              const ingredient = ingredients.data?.find((i) => i.id === o.ingredientId);
              const change = (patch: Partial<Option>) => updateOption(g.key, o.key, patch);
              return (
                <div key={o.key} className="space-y-2 border-t border-border pt-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.5fr_110px_100px_auto]">
                    <Field label="Название добавки">
                      <input
                        className="input w-full"
                        value={o.name}
                        disabled={!editable}
                        onChange={(e) => change({ name: e.target.value })}
                      />
                    </Field>
                    <Field label="Цена, сом">
                      <input
                        className="input w-full"
                        type="number"
                        min="0"
                        step="any"
                        value={o.price}
                        disabled={!editable}
                        onChange={(e) => change({ price: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Макс. порций">
                      <input
                        className="input w-full"
                        type="number"
                        min="1"
                        value={o.maxQuantity ?? 1}
                        disabled={!editable}
                        onChange={(e) => change({ maxQuantity: Number(e.target.value) })}
                      />
                    </Field>
                    {editable && (
                      <button
                        className="btn-ghost btn-md self-end"
                        onClick={() =>
                          setGroups((v) =>
                            v.map((x) =>
                              x.key === g.key
                                ? { ...x, options: x.options.filter((i) => i.key !== o.key) }
                                : x,
                            ),
                          )
                        }
                      >
                        Убрать
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1.5fr_100px_90px_1fr]">
                    <Field label="Что списывать">
                      <Select
                        className="h-10 w-full"
                        ariaLabel="Складская позиция добавки"
                        disabled={!editable}
                        value={o.ingredientId ?? ''}
                        options={[
                          { value: '', label: 'Без складского расхода' },
                          ...(ingredients.data ?? []).map((i) => ({ value: i.id, label: i.name })),
                        ]}
                        onChange={(v) =>
                          change({
                            ingredientId: v,
                            unit: ingredients.data?.find((i) => i.id === v)?.displayUnit ?? 'pcs',
                            amount: 1,
                          })
                        }
                      />
                    </Field>
                    {o.ingredientId && (
                      <>
                        <Field label="Расход">
                          <input
                            className="input w-full"
                            type="number"
                            min="0"
                            step="any"
                            disabled={!editable}
                            value={o.amount ?? ''}
                            onChange={(e) => change({ amount: Number(e.target.value) })}
                          />
                        </Field>
                        <Field label="Единица">
                          <Select
                            className="h-10 w-full"
                            ariaLabel="Единица добавки"
                            disabled={!editable}
                            value={o.unit ?? 'pcs'}
                            options={unitsForType(ingredient?.unitType ?? 'count')}
                            onChange={(unit) => change({ unit })}
                          />
                        </Field>
                        <Field label="Склад списания">
                          <Select
                            className="h-10 w-full"
                            ariaLabel="Склад добавки"
                            disabled={!editable}
                            value={o.fromCommonWarehouse ? 'common' : (o.warehouseId ?? '')}
                            options={[
                              { value: '', label: 'Склад станции' },
                              { value: 'common', label: 'Основной склад' },
                              ...(locations.data?.locations ?? []).map((l) => ({
                                value: l.id,
                                label: l.name,
                              })),
                            ]}
                            onChange={(v) =>
                              change({
                                fromCommonWarehouse: v === 'common',
                                warehouseId: v === 'common' ? null : v || null,
                              })
                            }
                          />
                        </Field>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {editable && (
            <button
              className="btn-secondary btn-md mt-3"
              onClick={() =>
                setGroups((v) =>
                  v.map((x) =>
                    x.key === g.key
                      ? {
                          ...x,
                          options: [
                            ...x.options,
                            { key: crypto.randomUUID(), name: '', price: 0, maxQuantity: 1, isActive: true },
                          ],
                        }
                      : x,
                  ),
                )
              }
            >
              + Вариант добавки
            </button>
          )}
        </section>
      ))}
      {editable && (
        <button
          className="btn-secondary btn-md"
          onClick={() =>
            setGroups((v) => [
              ...v,
              { key: crypto.randomUUID(), name: '', minSelections: 0, maxSelections: 1, options: [] },
            ])
          }
        >
          + Группа модификаторов
        </button>
      )}
      {mutation.isError && (
        <p role="alert" className="text-danger text-sm">
          {apiError(mutation.error)}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success">
          Модификаторы сохранены
        </p>
      )}
      {editable && (
        <DocumentFooter>
          <button
            className="btn-primary btn-md"
            onClick={() => void save()}
            disabled={
              mutation.isPending ||
              groups.some((g) => !g.name.trim() || !g.options.length || g.options.some((o) => !o.name.trim()))
            }
          >
            Сохранить модификаторы
          </button>
        </DocumentFooter>
      )}
    </div>
  );
}
