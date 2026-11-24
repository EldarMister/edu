import { useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { money } from '@/lib/format';
import { useIngredients, type Ingredient } from './api';
import { recipeQuantity } from './recipe-draft-values';
import { ALL_UNITS, normalizeUnitLabel, unitsForType } from './units';

export interface ModifierDraftOption {
  id?: string;
  name: string;
  price: number;
  ingredientId?: string | null;
  replacesIngredientId?: string | null;
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
  excludableIngredientIds?: string[] | null;
  groups: ModifierDraftGroup[];
}

type GroupSettings = Pick<ModifierDraftGroup, 'name' | 'minSelections' | 'maxSelections'>;
type OptionEditor = { groupIndex: number; optionIndex?: number };
type IngredientTarget = { id: string; name: string };

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

function ModifierOptionDialog({ option, ingredients, targets, onClose, onSave }: {
  option?: ModifierDraftOption;
  ingredients: readonly Ingredient[];
  targets: readonly IngredientTarget[];
  onClose: () => void;
  onSave: (option: ModifierDraftOption) => void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState(() => option ?? { name: '', price: 0 });
  const [priceInput, setPriceInput] = useState(String(option?.price ?? 0));
  const [amountInput, setAmountInput] = useState(String(option?.amount ?? 1));
  const ingredient = ingredients.find(({ id }) => id === draft.ingredientId);
  const unit = draft.unit ?? ingredient?.displayUnit ?? 'pcs';
  const amount = Number(amountInput);
  const price = Number(priceInput);
  const factor = ALL_UNITS.find(({ code }) => code === unit)?.factor ?? 1;
  const amountBase = Math.round(amount * factor * 1000) / 1000;
  const canSave = !!draft.name.trim() && priceInput !== '' && Number.isFinite(price) && price >= 0 && price <= 1000000
    && (!draft.ingredientId || (amountBase > 0 && amountBase < 100000000000));
  const ingredientOptions = [
    { value: '', label: 'Без списания' },
    ...ingredients.map(({ id, name }) => ({ value: id, label: name })),
    ...(draft.ingredientId && !ingredient ? [{ value: draft.ingredientId, label: 'Складская позиция недоступна' }] : []),
  ];
  const replacementOptions = targets.filter(({ id, name }) => id !== draft.ingredientId && !!name)
    .map(({ id, name }) => ({ value: id, label: name }));
  const unitOptions = unitsForType(ingredient?.unitType ?? 'count');

  function patch(next: Partial<ModifierDraftOption>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function chooseIngredient(id: string) {
    const selected = ingredients.find((item) => item.id === id);
    patch({ ingredientId: id || null, unit: selected?.displayUnit,
      ...((!id || id === draft.replacesIngredientId) && { replacesIngredientId: null }) });
    setAmountInput(id ? (Number(amountInput) ? amountInput : '1') : '0');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (canSave) onSave({ ...draft, name: draft.name.trim(), price,
      ...(draft.ingredientId && { amount, unit }),
      ...(!draft.ingredientId && draft.ingredientId !== undefined && { amount: 0 }),
    });
  }

  return <Modal open manageFocus title={option ? 'Редактирование модификатора' : 'Добавление модификатора'} onClose={onClose}
    panelClassName="max-w-md" footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={onClose}>Отмена</button>
      <button type="submit" form={formId} className="btn-primary btn-md" disabled={!canSave}>
        {option ? 'Применить' : 'Добавить модификатор'}
      </button>
    </div>}>
    <form id={formId} className="space-y-3" onSubmit={submit}>
      <label className="block text-sm text-text-secondary">
        Название модификатора
        <input className="input mt-1" data-dialog-initial-focus required maxLength={120} value={draft.name}
          placeholder="Например, миндальное молоко" onChange={(event) => patch({ name: event.target.value })} />
      </label>
      <label className="block text-sm text-text-secondary">
        Доплата, с
        <input className="input mt-1" type="number" required min="0" max="1000000" step="0.01" value={priceInput}
          onChange={(event) => setPriceInput(event.target.value)} />
      </label>
      <div className="space-y-1 text-sm text-text-secondary">
        <span>Списывать со склада</span>
        <Select searchable ariaLabel="Складская позиция модификатора" className="h-10 w-full"
          value={draft.ingredientId ?? ''} options={ingredientOptions} onChange={chooseIngredient} />
      </div>
      {draft.ingredientId && <>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-text-secondary">
            Расход
            <input className="input mt-1" type="number" required min="0" step="any" value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)} />
          </label>
          <div className="space-y-1 text-sm text-text-secondary">
            <span>Единица</span>
            <Select ariaLabel="Единица расхода" className="h-10 w-full" value={unit}
              onChange={(unit) => patch({ unit })} options={unitOptions.some(({ value }) => value === unit) ? unitOptions
                : [{ value: unit, label: normalizeUnitLabel(unit) }, ...unitOptions]} />
          </div>
        </div>
        {(replacementOptions.length > 0 || draft.replacesIngredientId) && <div className="space-y-1 text-sm text-text-secondary">
          <span>Заменяемый ингредиент</span>
          <Select ariaLabel="Заменяемый ингредиент" className="h-10 w-full" value={draft.replacesIngredientId ?? ''}
            onChange={(id) => patch({ replacesIngredientId: id || null, ...(id && { maxQuantity: 1 }) })}
            options={[{ value: '', label: 'Без замены' }, ...replacementOptions,
              ...(draft.replacesIngredientId && !replacementOptions.some(({ value }) => value === draft.replacesIngredientId)
                ? [{ value: draft.replacesIngredientId, label: 'Ингредиент недоступен' }] : []),
            ]} />
        </div>}
      </>}
    </form>
  </Modal>;
}

export function ModifierDraftFields({
  value,
  onChange,
  recipeIngredientIds = [],
}: {
  value: ModifierDraft;
  onChange: (value: ModifierDraft) => void;
  recipeIngredientIds?: readonly string[];
}) {
  const [editedGroup, setEditedGroup] = useState<{ index: number } | 'new' | null>(null);
  const [editedOption, setEditedOption] = useState<OptionEditor | null>(null);
  const [editingExclusions, setEditingExclusions] = useState(false);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const ingredientsQuery = useIngredients('', undefined, value.groups.length > 0 || value.allowIngredientExclusions);
  const ingredients = ingredientsQuery.data ?? [];
  const ingredientsById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const recipeIds = [...new Set(recipeIngredientIds.filter(Boolean))];
  const allowlist = value.excludableIngredientIds;
  const eligible = allowlist == null ? recipeIds : recipeIds.filter((id) => allowlist.includes(id));
  const exclusionOptions = recipeIds.map((id) => ({ id, name: ingredientsById.get(id)?.name ?? '' }));
  function group(index: number, patch: Partial<ModifierDraftGroup>) {
    onChange({
      ...value,
      groups: value.groups.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }
  function closeGroupDialog() {
    setEditedGroup(null);
    dialogTrigger.current?.focus({ preventScroll: true });
  }
  function saveGroup(settings: GroupSettings) {
    if (editedGroup === 'new') {
      onChange({ ...value, groups: [...value.groups, { ...settings, options: [] }] });
    } else if (editedGroup) {
      group(editedGroup.index, settings);
    }
    closeGroupDialog();
  }
  function saveOption(option: ModifierDraftOption) {
    if (!editedOption) return;
    const { groupIndex, optionIndex } = editedOption;
    const options = value.groups[groupIndex].options;
    group(groupIndex, { options: optionIndex == null ? [...options, option] : options.map((item, index) => index === optionIndex ? option : item) });
    setEditedOption(null);
  }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Модификаторы</h3>
          <p className="mt-1 text-sm text-text-muted">Добавки и исключения для заказа.</p>
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
          {item.options.length > 0 && <ul className="divide-y divide-border border-t border-border">
            {item.options.map((entry, optionIndex) => {
              const ingredient = entry.ingredientId ? ingredientsById.get(entry.ingredientId) : undefined;
              const replaces = entry.replacesIngredientId ? ingredientsById.get(entry.replacesIngredientId)?.name : undefined;
              const label = entry.name || 'Модификатор ' + (optionIndex + 1);
              const amount = entry.ingredientId ? recipeQuantity(entry.amount ?? 1, normalizeUnitLabel(entry.unit ?? ingredient?.displayUnit)) : null;
              return <li key={entry.id ?? optionIndex} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <div className="min-w-0 grow">
                  <span className="block break-words text-sm font-medium">{label}</span>
                  {amount && <p className="break-words text-xs text-text-muted">
                    {entry.replacesIngredientId && ('Замена: ' + (replaces ?? 'Недоступная позиция') + ' → ')}
                    {ingredient?.name ?? 'Недоступная позиция'} · {amount}
                  </p>}
                </div>
                <span className="text-sm text-text-secondary">{entry.price > 0 ? '+' + money(entry.price) : 'Без доплаты'}</span>
                <div className="flex gap-1">
                  <button type="button" className="btn-ghost h-8 px-2 text-primary"
                    aria-label={'Изменить модификатор «' + label + '»'}
                    onClick={() => setEditedOption({ groupIndex: index, optionIndex })}>Изменить</button>
                  <button type="button" className="btn-ghost h-8 px-2 text-danger"
                    aria-label={'Удалить модификатор «' + label + '»'}
                    onClick={() => group(index, { options: item.options.filter((_, i) => i !== optionIndex) })}>×</button>
                </div>
              </li>;
            })}
          </ul>}
          <button type="button" className="btn-ghost btn-md text-primary" disabled={item.options.length >= 100}
            onClick={() => setEditedOption({ groupIndex: index })}>+ Добавить модификатор</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.allowIngredientExclusions}
          onChange={(event) =>
            onChange({
              ...value,
              allowIngredientExclusions: event.target.checked,
              excludableIngredientIds: event.target.checked ? value.excludableIngredientIds ?? [] : value.excludableIngredientIds,
            })
          }
        />
        Разрешить убрать ингредиент из порции
        </label>
        {value.allowIngredientExclusions && <button type="button" className="btn-ghost btn-md text-primary"
          disabled={!recipeIds.length || ingredientsQuery.isPending}
          onClick={(event) => { dialogTrigger.current = event.currentTarget; setEditingExclusions(true); }}>
          Выбрать ингредиенты · {eligible.length}
        </button>}
      </div>
      {editedGroup && createPortal(
        <ModifierGroupDialog group={editedGroup === 'new' ? undefined : value.groups[editedGroup.index]}
          onClose={closeGroupDialog} onSave={saveGroup} />,
        document.body,
      )}
      {editedOption && createPortal(<ModifierOptionDialog
        option={editedOption.optionIndex == null ? undefined : value.groups[editedOption.groupIndex].options[editedOption.optionIndex]}
        ingredients={ingredients} targets={exclusionOptions} onClose={() => setEditedOption(null)} onSave={saveOption} />,
      document.body)}
      {editingExclusions && createPortal(<ExclusionDialog options={exclusionOptions} selectedIds={eligible}
        onClose={() => { setEditingExclusions(false); dialogTrigger.current?.focus({ preventScroll: true }); }}
        onSave={(excludableIngredientIds) => {
          onChange({ ...value, excludableIngredientIds });
          setEditingExclusions(false);
          dialogTrigger.current?.focus({ preventScroll: true });
        }} />, document.body)}
    </section>
  );
}

function ExclusionDialog({ options, selectedIds, onClose, onSave }: {
  options: readonly { id: string; name: string }[];
  selectedIds: readonly string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState(selectedIds);
  return <Modal open manageFocus title="Что можно убрать из порции" onClose={onClose} panelClassName="max-w-md"
    footer={<div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn-secondary btn-md" onClick={onClose}>Отмена</button>
      <button type="button" className="btn-primary btn-md" onClick={() => onSave(options.filter(({ id }) => selected.includes(id)).map(({ id }) => id))}>
        Применить
      </button>
    </div>}>
    <fieldset className="space-y-2.5 py-1">
      <legend className="sr-only">Разрешённые исключения</legend>
      <p className="text-sm text-text-muted">Исключение ингредиента не меняет цену блюда.</p>
      {options.map(({ id, name }) => <label key={id} className="flex min-h-9 items-center gap-2 text-sm">
        <input type="checkbox" checked={selected.includes(id)} disabled={!name && !selected.includes(id)}
          onChange={(event) => setSelected((current) => event.target.checked ? [...current, id] : current.filter((entry) => entry !== id))} />
        {name || 'Недоступная позиция'}
      </label>)}
    </fieldset>
  </Modal>;
}
