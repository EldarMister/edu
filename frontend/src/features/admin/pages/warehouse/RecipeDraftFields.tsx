import { useState } from 'react';
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
        pricePerUnit:
          item.isPrepared && item.preparationMode === 'virtual'
            ? item.recipeUnitCost
            : item.avgCost,
      },
    ]);
  }
  function patch(index: number, value: Partial<RecipeDraftRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...value } : row)));
  }
  const known = rows.length > 0 && rows.every((row) => row.pricePerUnit != null);
  const total = rows.reduce((sum, row) => sum + row.amount * (row.pricePerUnit ?? 0), 0);
  return (
    <section className="min-w-0 w-full space-y-4 border-t border-border pt-7">
      <h3 className="text-lg font-semibold">Состав техкарты</h3>
      <div className="min-w-0 w-full overflow-x-auto">
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
                      const factor =
                        (ALL_UNITS.find((value) => value.code === row.unit)?.factor ?? 1) /
                        (ALL_UNITS.find((value) => value.code === unit)?.factor ?? 1);
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
        {!rows.length && (
          <p className="py-5 text-sm text-text-muted">
            Добавьте ингредиенты, которые списываются при продаже одной порции.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-56 flex-1 sm:max-w-sm">
          <Select
            className="h-11 w-full"
            value=""
            onChange={(id) => {
              const item = available.find((value) => value.id === id);
              if (item) add(item);
            }}
            options={[
              { value: '', label: 'Добавить ингредиент…' },
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
            Себестоимость: <strong>{known ? money(total) : 'не рассчитана'}</strong>
          </span>
        )}
      </div>
      {createIngredient && (
        <ItemCard
          compact
          defaultKind="raw"
          onClose={() => setCreateIngredient(false)}
          onSaved={(item) => {
            add(item);
            setCreateIngredient(false);
          }}
        />
      )}
    </section>
  );
}
