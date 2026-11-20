import { useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/Modal';
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

type GroupSettings = Pick<ModifierDraftGroup, 'name' | 'minSelections' | 'maxSelections'>;

function isSingleChoice(group: GroupSettings) {
  return group.minSelections === 1 && group.maxSelections === 1;
}

function selectionLabel(group: GroupSettings) {
  if (isSingleChoice(group)) return 'Только один';
  const minimum = group.minSelections > 0 ? `от ${group.minSelections}` : 'необязательно';
  return group.maxSelections == null ? `Несколько · ${minimum}` : `Несколько · ${minimum} · до ${group.maxSelections}`;
}

function ModifierGroupDialog({
  group,
  onClose,
  onSave,
}: {
  group?: ModifierDraftGroup;
  onClose: () => void;
  onSave: (settings: GroupSettings) => void;
}) {
  const formId = useId();
  const [name, setName] = useState(group?.name ?? '');
  const [single, setSingle] = useState(!group || isSingleChoice(group));
  const [min, setMin] = useState(group && !isSingleChoice(group) ? String(group.minSelections) : '0');
  const [max, setMax] = useState(group && !isSingleChoice(group) ? String(group.maxSelections ?? '') : '');
  const minSelections = single ? 1 : Number(min);
  const maxSelections = single ? 1 : max === '' ? null : Number(max);
  const validRange = Number.isInteger(minSelections) && minSelections >= 0 && minSelections <= 100
    && (maxSelections === null || (
      Number.isInteger(maxSelections) && maxSelections >= Math.max(1, minSelections) && maxSelections <= 100
    ));
  const canSave = !!name.trim() && validRange;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (canSave) onSave({ name: name.trim(), minSelections, maxSelections });
  }

  return <Modal open title={group ? 'Изменение набора модификаторов' : 'Добавление набора модификаторов'} onClose={onClose}
    panelClassName="max-w-lg"
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={onClose}>Отмена</button>
      <button type="submit" form={formId} className="btn-primary btn-md" disabled={!canSave}>
        {group ? 'Применить' : 'Добавить набор'}
      </button>
    </div>}
  >
    <form id={formId} className="space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium text-text-secondary">
        Название набора
        <input className="input mt-1.5" autoFocus required maxLength={120} value={name}
          placeholder="Например, молоко для кофе" onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-text-secondary">Сколько можно выбрать при заказе</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${single ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <input className="mt-1 self-start" type="radio" name={`${formId}-mode`} checked={single} onChange={() => setSingle(true)} />
            <span>
              <span className="block text-sm font-semibold">Только один</span>
              <span className="mt-1 block text-xs text-text-muted">Обязательный выбор одного варианта</span>
            </span>
          </label>
          <label className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${!single ? 'border-primary bg-primary/5' : 'border-border'}`}>
            <input className="mt-1 self-start" type="radio" name={`${formId}-mode`} checked={!single} onChange={() => setSingle(false)} />
            <span>
              <span className="block text-sm font-semibold">Несколько</span>
              <span className="mt-1 block text-xs text-text-muted">Можно задать минимум и максимум</span>
            </span>
          </label>
        </div>
        {!single && <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-medium text-text-secondary">
            Минимум
            <input className="input mt-1.5" type="number" min="0" max="100" value={min}
              onChange={(event) => setMin(event.target.value)} />
          </label>
          <label className="text-sm font-medium text-text-secondary">
            Максимум
            <input className="input mt-1.5" type="number" min="1" max="100" value={max}
              placeholder="Без ограничения" onChange={(event) => setMax(event.target.value)} />
          </label>
        </div>}
        {!validRange && <p role="alert" className="text-sm text-danger">Минимум от 0 до 100, максимум от 1 до 100. Максимум должен быть не меньше минимума.</p>}
      </fieldset>
    </form>
  </Modal>;
}

export function ModifierDraftFields({
  value,
  onChange,
}: {
  value: ModifierDraft;
  onChange: (value: ModifierDraft) => void;
}) {
  const [editedGroup, setEditedGroup] = useState<{ index: number } | 'new' | null>(null);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const ingredients = useIngredients('', undefined, value.groups.length > 0).data ?? [];
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const ingredientOptions = [
    { value: '', label: 'Без списания' },
    ...ingredients.map((ingredient) => ({ value: ingredient.id, label: ingredient.name })),
  ];
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
  function closeGroupDialog() {
    setEditedGroup(null);
    dialogTrigger.current?.focus({ preventScroll: true });
  }
  function saveGroup(settings: GroupSettings) {
    if (editedGroup === 'new') {
      onChange({ ...value, groups: [...value.groups, { ...settings, options: [{ name: '', price: 0 }] }] });
    } else if (editedGroup) {
      group(editedGroup.index, settings);
    }
    closeGroupDialog();
  }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Модификаторы</h3>
          <p className="mt-1 text-sm text-text-muted">Добавки и варианты, которые выбирают при заказе.</p>
        </div>
        <button type="button" className="btn-secondary btn-md" disabled={value.groups.length >= 30}
          onClick={(event) => {
            dialogTrigger.current = event.currentTarget;
            setEditedGroup('new');
          }}>
          + Добавить набор
        </button>
      </div>
      {value.groups.map((item, index) => (
        <div key={item.id ?? index} className="space-y-3 rounded-xl border border-border bg-background/40 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="break-words font-semibold text-text-primary">{item.name}</h4>
              <p className="text-xs text-text-muted">{selectionLabel(item)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-ghost btn-md"
                aria-label={`Настроить набор «${item.name}»`}
                onClick={(event) => {
                  dialogTrigger.current = event.currentTarget;
                  setEditedGroup({ index });
                }}>
                Настроить
              </button>
              <button
                type="button"
                className="btn-ghost btn-md text-danger"
                aria-label={`Удалить набор «${item.name}»`}
                onClick={() =>
                  onChange({
                    ...value,
                    groups: value.groups.filter((_, i) => i !== index),
                  })
                }
              >
                Удалить набор
              </button>
            </div>
          </div>
          {item.options.map((entry, optionIndex) => {
            const ingredient = entry.ingredientId ? ingredientsById.get(entry.ingredientId) : undefined;
            return (
              <div
                key={entry.id ?? optionIndex}
                className="relative grid grid-cols-2 items-end gap-2 rounded-lg border border-border bg-card p-3 pr-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.75fr)_minmax(0,1.25fr)_minmax(0,.65fr)_minmax(0,.65fr)]"
              >
                <label className="min-w-0 space-y-1 text-xs text-text-muted">
                  <span className="block">Название модификатора</span>
                  <input
                    className="input"
                    value={entry.name}
                    maxLength={120}
                    placeholder="Например, миндальное"
                    onChange={(event) => option(index, optionIndex, { name: event.target.value })}
                  />
                </label>
                <label className="min-w-0 space-y-1 text-xs text-text-muted">
                  <span className="block">Доплата, с</span>
                  <input
                    aria-label={`Цена ${entry.name || optionIndex + 1}`}
                    className="input"
                    type="number"
                    min="0"
                    max="1000000"
                    step="0.01"
                    value={entry.price}
                    onChange={(event) => option(index, optionIndex, { price: Number(event.target.value) })}
                  />
                </label>
                <div className="col-span-2 min-w-0 space-y-1 lg:col-span-1">
                  <span className="block text-xs text-text-muted">Списывать со склада</span>
                  <Select
                    className="h-11 w-full"
                    ariaLabel={`Складская позиция ${entry.name || optionIndex + 1}`}
                    value={entry.ingredientId ?? ''}
                    onChange={(id) => {
                      const selected = ingredientsById.get(id);
                      option(index, optionIndex, {
                        ingredientId: id || null,
                        unit: selected?.displayUnit,
                        amount: id ? entry.amount || 1 : 0,
                      });
                    }}
                    options={ingredientOptions}
                  />
                </div>
                {entry.ingredientId && (
                  <>
                    <label className="min-w-0 space-y-1 text-xs text-text-muted">
                      <span className="block">Расход</span>
                      <input
                        aria-label={`Расход ${entry.name || optionIndex + 1}`}
                        className="input"
                        type="number"
                        min="0.001"
                        step="any"
                        value={entry.amount ?? 1}
                        onChange={(event) => option(index, optionIndex, { amount: Number(event.target.value) })}
                      />
                    </label>
                    <div className="min-w-0 space-y-1">
                      <span className="block text-xs text-text-muted">Единица</span>
                      <Select
                        ariaLabel={`Единица ${entry.name || optionIndex + 1}`}
                        className="h-11 w-full"
                        value={entry.unit ?? ''}
                        onChange={(unit) => option(index, optionIndex, { unit })}
                        options={unitsForType(ingredient?.unitType ?? 'count')}
                      />
                    </div>
                  </>
                )}
                <button
                  type="button"
                  className="btn-ghost absolute right-1 top-2 h-8 w-8 text-danger"
                  aria-label={`Удалить добавку ${entry.name || optionIndex + 1}`}
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
            disabled={item.options.length >= 100}
            onClick={() =>
              group(index, {
                options: [...item.options, { name: '', price: 0 }],
              })
            }
          >
            + Добавить модификатор
          </button>
        </div>
      ))}
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
      {editedGroup && createPortal(
        <ModifierGroupDialog group={editedGroup === 'new' ? undefined : value.groups[editedGroup.index]}
          onClose={closeGroupDialog} onSave={saveGroup} />,
        document.body,
      )}
    </section>
  );
}
