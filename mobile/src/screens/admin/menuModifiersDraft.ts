import type { MenuEntryModifiers, MenuModifierGroup, MenuModifierOption } from '@/services/api/menuEntries';

export type ModifierOptionDraft = Omit<MenuModifierOption, 'price' | 'amount'> & { price: string; amount: string };
export type ModifierGroupDraft = Omit<MenuModifierGroup, 'minSelections' | 'maxSelections' | 'options'> & {
  minSelections: string; maxSelections: string; options: ModifierOptionDraft[];
};
export type MenuModifiersDraft = { allowIngredientExclusions: boolean; groups: ModifierGroupDraft[] };

export function initialModifiersDraft(saved?: MenuEntryModifiers): MenuModifiersDraft {
  return {
    allowIngredientExclusions: saved?.allowIngredientExclusions ?? false,
    groups: (saved?.groups ?? []).map(({ options, minSelections, maxSelections, ...group }) => ({
      ...group,
      minSelections: String(minSelections),
      maxSelections: String(maxSelections ?? ''),
      options: options.map(({ price, amount, ...option }) => ({ ...option, price: String(price), amount: String(amount ?? '') })),
    })),
  };
}

function decimal(value: string) {
  const normalized = value.trim().replace(',', '.');
  return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}

export function modifierDraftPayload(draft: MenuModifiersDraft): { value: MenuEntryModifiers } | { error: string } {
  const groups: MenuModifierGroup[] = [];
  for (const group of draft.groups) {
    const name = group.name.trim();
    if (!name) return { error: 'Укажите название каждого набора модификаторов' };
    const min = group.minSelections ? decimal(group.minSelections) : 0;
    const max = group.maxSelections ? decimal(group.maxSelections) : null;
    if (!Number.isInteger(min) || min < 0 || min > 100 ||
        max !== null && (!Number.isInteger(max) || max < Math.max(1, min) || max > 100)) {
      return { error: `Проверьте пределы выбора в наборе «${name}»` };
    }

    const options: MenuModifierOption[] = [];
    for (const option of group.options) {
      const optionName = option.name.trim();
      const price = decimal(option.price);
      const amount = option.ingredientId ? decimal(option.amount) : undefined;
      if (!optionName || !Number.isFinite(price) || price < 0 || price > 1_000_000) {
        return { error: `Проверьте название и доплату модификатора в наборе «${name}»` };
      }
      if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0 || !option.unit)) {
        return { error: `Укажите расход и единицу для «${optionName}»` };
      }
      options.push({ ...option, name: optionName, price, amount });
    }
    const capacity = options.reduce((sum, option) => sum + (option.isActive === false ? 0 : option.maxQuantity ?? 1), 0);
    if (capacity < min) return { error: `В наборе «${name}» недостаточно доступных модификаторов` };
    groups.push({ ...group, name, minSelections: min, maxSelections: max, options });
  }
  return { value: { allowIngredientExclusions: draft.allowIngredientExclusions, groups } };
}
