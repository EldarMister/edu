import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Select } from '@/components/Select';
import { money } from '@/lib/format';
import { ItemCard } from './ItemCard';
import {
  PROCESSING_METHODS,
  useIngredients,
  type Ingredient,
  type RecipeItem,
  type RecipeRowInput,
} from './api';
import { ALL_UNITS, unitsForType, type UnitCode } from './units';

export type RecipeDraftRow = RecipeRowInput & {
  ingredientId: string;
  name: string;
  unit?: UnitCode;
  unitType: Ingredient['unitType'];
  pricePerUnit?: number | null;
};
export function recipeDraftRows(items: RecipeItem[]): RecipeDraftRow[] {
  return items.map((row) => ({
    ingredientId: row.ingredientId,
    name: row.name,
    unitType: row.unitType,
    amount: row.amount,
    unit: row.amountUnit,
    netAmount: row.netAmount ?? undefined,
    lossPercent: row.lossPercent,
    processingMethod: row.processingMethod,
    variantAmounts: row.variantAmounts,
    fromCommonWarehouse: row.fromCommonWarehouse,
    warehouseId: row.warehouseId,
    pricePerUnit: row.avgCost,
  }));
}
export function recipeDraftPayload(rows: RecipeDraftRow[]) {
  return rows.map(({ name: _name, unitType: _type, pricePerUnit: _price, ...row }) => row);
}

function unitFactor(unit: UnitCode) {
  return ALL_UNITS.find((value) => value.code === unit)!.factor;
}

function ingredientPrice(item: Ingredient) {
  return item.isPrepared && item.preparationMode === 'virtual' ? item.recipeUnitCost : item.avgCost;
}

function lineCost(row: RecipeDraftRow, ingredient?: Ingredient) {
  if (!Number.isFinite(row.amount) || row.amount <= 0) return null;
  let price = row.pricePerUnit;
  // The saved recipe's rate belongs to the selected warehouse, including an unknown rate.
  if (price === undefined && ingredient && !row.warehouseId && !row.fromCommonWarehouse) {
    const displayPrice = ingredientPrice(ingredient);
    if (displayPrice != null) {
      price = displayPrice * unitFactor(row.unit ?? ingredient.displayUnit) / unitFactor(ingredient.displayUnit);
    }
  }
  return price != null && Number.isFinite(price) && price >= 0 ? row.amount * price : null;
}

export function recipeDraftCost(rows: readonly RecipeDraftRow[], ingredients: readonly Ingredient[] = []) {
  const ingredientsById = new Map(ingredients.map((item) => [item.id, item]));
  let complete = rows.length > 0;
  let total = 0;
  for (const row of rows) {
    const cost = lineCost(row, ingredientsById.get(row.ingredientId));
    if (cost == null) complete = false;
    else total += cost;
  }
  return { total, complete };
}

export function RecipeDraftFields({
  rows,
  onChange,
  variants = [],
  showCosts = true,
  allowCreate = true,
}: {
  rows: RecipeDraftRow[];
  onChange: (rows: RecipeDraftRow[]) => void;
  variants?: { id?: string; name: string }[];
  showCosts?: boolean;
  allowCreate?: boolean;
}) {
  const ingredients = useIngredients('');
  const [createIngredient, setCreateIngredient] = useState(false);
  const available = (ingredients.data ?? []).filter(
    (item) => item.isActive && !rows.some((row) => row.ingredientId === item.id),
  );
  function add(item: Ingredient) {
    onChange([
      ...rows,
      {
        ingredientId: item.id,
        name: item.name,
        unitType: item.unitType,
        amount: 0,
        unit: item.displayUnit,
        netAmount: 0,
        pricePerUnit: ingredientPrice(item) ?? null,
      },
    ]);
  }
  function patch(index: number, value: Partial<RecipeDraftRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...value } : row)));
  }
  const { total, complete } = recipeDraftCost(rows);
  return (
    <section className="min-w-0 w-full space-y-4 border-t border-border pt-7">
      <h3 className="text-lg font-semibold">Состав техкарты</h3>
      {rows.length > 0 && <div className="min-w-0 w-full overflow-x-auto">
        <table className="w-full min-w-[700px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th className="py-3 pr-3 font-medium">Ингредиент / полуфабрикат</th>
              <th className="px-2 font-medium">Обработка</th>
              <th className="px-2 font-medium">Брутто</th>
              <th className="px-2 font-medium">Нетто</th>
              <th className="px-2 font-medium">Ед.</th>
              {showCosts && <th className="px-2 text-right font-medium">Себестоимость</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.ingredientId} className="border-b border-border align-top">
                <td className="py-3 pr-3">
                  <div className="pt-2 font-medium">{row.name}</div>
                  {variants.some((variant) => variant.id) && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-text-muted">
                        Нормы по вариантам
                      </summary>
                      <div className="mt-2 space-y-2">
                        {variants
                          .filter((variant) => variant.id)
                          .map((variant) => (
                            <label key={variant.id} className="flex items-center gap-2">
                              {variant.name}
                              <input
                                aria-label={`Расход ${row.name}: ${variant.name}`}
                                className="input h-8 w-24"
                                type="number"
                                min="0"
                                step="any"
                                value={row.variantAmounts?.[variant.id!] ?? ''}
                                placeholder={String(row.amount)}
                                onChange={(event) => {
                                  const values = { ...row.variantAmounts };
                                  if (event.target.value === '') delete values[variant.id!];
                                  else values[variant.id!] = Number(event.target.value);
                                  patch(index, { variantAmounts: values });
                                }}
                              />
                            </label>
                          ))}
                      </div>
                    </details>
                  )}
                </td>
                <td className="px-2 py-3">
                  <select
                    aria-label={`Обработка ${row.name}`}
                    className="input h-10 min-w-28"
                    value={row.processingMethod ?? ''}
                    onChange={(event) => {
                      const method = event.target.value as RecipeDraftRow['processingMethod'];
                      const ingredient = ingredients.data?.find(
                        (item) => item.id === row.ingredientId,
                      );
                      const loss = method ? (ingredient?.processingLosses?.[method] ?? 0) : 0;
                      patch(index, {
                        processingMethod: method || null,
                        lossPercent: loss,
                        netAmount: row.amount * (1 - loss / 100),
                      });
                    }}
                  >
                    <option value="">Без обработки</option>
                    {PROCESSING_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-3">
                  <input
                    aria-label={`Брутто ${row.name}`}
                    className="input h-10 w-24"
                    type="number"
                    min="0"
                    step="any"
                    value={row.amount}
                    onChange={(event) => {
                      const amount = Number(event.target.value);
                      patch(index, {
                        amount,
                        netAmount: Number((amount * (1 - (row.lossPercent ?? 0) / 100)).toFixed(6)),
                      });
                    }}
                  />
                </td>
                <td className="px-2 py-3">
                  <input
                    aria-label={`Нетто ${row.name}`}
                    className="input h-10 w-24"
                    type="number"
                    min="0"
                    max={row.amount}
                    step="any"
                    value={row.netAmount ?? row.amount}
                    onChange={(event) => {
                      const netAmount = Number(event.target.value);
                      patch(index, {
                        netAmount,
                        lossPercent: row.amount
                          ? Math.max(0, 100 - (netAmount / row.amount) * 100)
                          : 0,
                      });
                    }}
                  />
                </td>
                <td className="px-2 py-3">
                  <select
                    aria-label={`Единица ${row.name}`}
                    className="input h-10 w-20"
                    value={row.unit}
                    onChange={(event) => {
                      const unit = event.target.value as UnitCode;
                      const factor = (row.unit ? unitFactor(row.unit) : 1) / unitFactor(unit);
                      patch(index, {
                        unit,
                        amount: row.amount * factor,
                        netAmount: (row.netAmount ?? row.amount) * factor,
                        pricePerUnit: row.pricePerUnit == null ? null : row.pricePerUnit / factor,
                        variantAmounts: Object.fromEntries(
                          Object.entries(row.variantAmounts ?? {}).map(([id, value]) => [
                            id,
                            value * factor,
                          ]),
                        ),
                      });
                    }}
                  >
                    {unitsForType(row.unitType).map((unit) => (
                      <option key={unit.value} value={unit.value}>
                        {unit.label}
                      </option>
                    ))}
                  </select>
                </td>
                {showCosts && (
                  <td className="px-2 py-5 text-right">
                    {row.pricePerUnit == null ? '—' : money(row.amount * row.pricePerUnit)}
                  </td>
                )}
                <td className="py-3 pl-2">
                  <button
                    type="button"
                    aria-label={`Убрать ${row.name}`}
                    className="btn-ghost btn-md text-danger"
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      <div className={rows.length ? 'flex flex-wrap items-center gap-3' : 'flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-background p-4'}>
        {!rows.length && (
          <p className="w-full text-sm text-text-muted">
            Добавьте ингредиенты, полуфабрикаты и расходники, которые списываются на одну порцию.
          </p>
        )}
        <div className="w-full min-w-0 sm:max-w-sm">
          <Select
            ariaLabel="Добавить компонент"
            className="h-11 w-full"
            value=""
            onChange={(id) => {
              const item = available.find((value) => value.id === id);
              if (item) add(item);
            }}
            options={[
              { value: '', label: 'Добавить компонент…' },
              ...available.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            ]}
          />
        </div>
        {allowCreate && (
          <button
            className="btn-ghost btn-md text-primary"
            type="button"
            onClick={() => setCreateIngredient(true)}
          >
            + Новый ингредиент
          </button>
        )}
        {showCosts && (
          <span className="ml-auto text-sm">
            Себестоимость: <strong>{complete ? money(total) : 'не рассчитана'}</strong>
          </span>
        )}
      </div>
      {createIngredient && createPortal(
        <ItemCard
          compact
          defaultKind="raw"
          onClose={() => setCreateIngredient(false)}
          onSaved={(item) => {
            add(item);
            setCreateIngredient(false);
          }}
        />,
        document.body,
      )}
    </section>
  );
}
