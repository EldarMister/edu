import { Select } from '@/components/Select';
import { useIngredients } from './api';
import { unitsForType } from './units';

export interface ModifierDraftOption {
  id?: string;
  name: string;
  price: number;
  ingredientId?: string | null;
  amount?: number;
  unit?: string;
  fromCommonWarehouse?: boolean;
  warehouseId?: string | null;
  maxQuantity?: number;
  isActive?: boolean;
  sortOrder?: number;
}
export interface ModifierDraftGroup {
  id?: string;
  name: string;
  minSelections: number;
  maxSelections?: number | null;
  sortOrder?: number;
  options: ModifierDraftOption[];
}
export interface ModifierDraft {
  allowIngredientExclusions: boolean;
  groups: ModifierDraftGroup[];
}
export function ModifierDraftFields({
  value,
  onChange,
}: {
  value: ModifierDraft;
  onChange: (value: ModifierDraft) => void;
}) {
  const ingredients = useIngredients('').data ?? [];
  function group(index: number, patch: Partial<ModifierDraftGroup>) {
    onChange({
      ...value,
      groups: value.groups.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }
  function option(index: number, optionIndex: number, patch: Partial<ModifierDraftOption>) {
    group(index, {
      options: value.groups[index].options.map((item, i) =>
        i === optionIndex ? { ...item, ...patch } : item,
      ),
    });
  }
  return (
    <section className="space-y-4 border-t border-border pt-7">
      <h3 className="text-lg font-semibold">Модификаторы</h3>
      <p className="text-sm text-text-muted">
        Добавки и варианты, которые выбирает гость при заказе.
      </p>
      {value.groups.map((item, index) => (
        <div key={item.id ?? index} className="space-y-3 border-b border-border pb-5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              aria-label="Название группы модификаторов"
              className="input max-w-sm"
              placeholder="Например, молоко для кофе"
              value={item.name}
              onChange={(event) => group(index, { name: event.target.value })}
            />
            <button
              type="button"
              className="btn-ghost btn-md text-danger"
              onClick={() =>
                onChange({
                  ...value,
                  groups: value.groups.filter((_, i) => i !== index),
                })
              }
            >
              Удалить группу
            </button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              Минимум
              <input
                className="input h-9 w-20"
                type="number"
                min="0"
                value={item.minSelections}
                onChange={(event) => group(index, { minSelections: Number(event.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2">
              Максимум
              <input
                className="input h-9 w-20"
                type="number"
                min="1"
                placeholder="Любой"
                value={item.maxSelections ?? ''}
                onChange={(event) =>
                  group(index, {
                    maxSelections: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </label>
          </div>
          {item.options.map((entry, optionIndex) => {
            const ingredient = ingredients.find((candidate) => candidate.id === entry.ingredientId);
            return (
              <div
                key={entry.id ?? optionIndex}
                className="grid grid-cols-[1fr_100px_36px] gap-2 md:grid-cols-[minmax(120px,1fr)_110px_minmax(180px,1fr)_100px_80px_36px]"
              >
                <input
                  aria-label="Название модификатора"
                  className="input"
                  value={entry.name}
                  placeholder="Название добавки"
                  onChange={(event) => option(index, optionIndex, { name: event.target.value })}
                />
                <input
                  aria-label={`Цена ${entry.name}`}
                  className="input"
                  type="number"
                  min="0"
                  step="any"
                  value={entry.price}
                  onChange={(event) =>
                    option(index, optionIndex, {
                      price: Number(event.target.value),
                    })
                  }
                />
                <div className="col-span-2 md:col-span-1">
                  <Select
                    className="h-11 w-full"
                    value={entry.ingredientId ?? ''}
                    onChange={(id) => {
                      const selected = ingredients.find((candidate) => candidate.id === id);
                      option(index, optionIndex, {
                        ingredientId: id || null,
                        unit: selected?.displayUnit,
                        amount: id ? entry.amount || 1 : 0,
                      });
                    }}
                    options={[
                      { value: '', label: 'Без списания' },
                      ...ingredients.map((candidate) => ({
                        value: candidate.id,
                        label: candidate.name,
                      })),
                    ]}
                  />
                </div>
                {entry.ingredientId ? (
                  <>
                    <input
                      aria-label={`Расход ${entry.name}`}
                      className="input"
                      type="number"
                      min="0.001"
                      step="any"
                      value={entry.amount ?? 1}
                      onChange={(event) =>
                        option(index, optionIndex, {
                          amount: Number(event.target.value),
                        })
                      }
                    />
                    <select
                      aria-label={`Единица ${entry.name}`}
                      className="input"
                      value={entry.unit}
                      onChange={(event) => option(index, optionIndex, { unit: event.target.value })}
                    >
                      {unitsForType(ingredient?.unitType ?? 'count').map((unit) => (
                        <option key={unit.value} value={unit.value}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <span />
                    <span />
                  </>
                )}
                <button
                  type="button"
                  className="btn-ghost text-danger"
                  aria-label={`Удалить добавку ${entry.name}`}
                  onClick={() =>
                    group(index, {
                      options: item.options.filter((_, i) => i !== optionIndex),
                    })
                  }
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="btn-ghost btn-md text-primary"
            onClick={() =>
              group(index, {
                options: [...item.options, { name: '', price: 0 }],
              })
            }
          >
            + Добавить вариант
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary btn-md"
        onClick={() =>
          onChange({
            ...value,
            groups: [
              ...value.groups,
              { name: '', minSelections: 0, options: [{ name: '', price: 0 }] },
            ],
          })
        }
      >
        + Группа модификаторов
      </button>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.allowIngredientExclusions}
          onChange={(event) =>
            onChange({
              ...value,
              allowIngredientExclusions: event.target.checked,
            })
          }
        />
        Разрешить убрать ингредиент из порции
      </label>
    </section>
  );
}
