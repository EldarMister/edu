import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { api, apiError } from '@/lib/api';
import type { CartLine } from '@/types';
import type { CartModifiers } from './cart';

type Option = { id: string; name: string; price: number; maxQuantity: number };
type Configuration = { groups: { id: string; name: string; minSelections: number; maxSelections: number | null; options: Option[] }[]; excludableIngredients: { id: string; name: string }[] };

export function ModifierPicker({ line, onClose, onConfirm }: { line: CartLine; onClose: () => void; onConfirm: (modifiers: CartModifiers) => void }) {
  const query = useQuery({ queryKey: ['dish-modifiers', line.dish.id], queryFn: async ({ signal }) => (await api.get<Configuration>(`/dishes/${line.dish.id}/modifiers`, { signal })).data, staleTime: 0 });
  const [selected, setSelected] = useState<Record<string, number>>(() => Object.fromEntries((line.modifierSelections ?? []).map((option) => [option.optionId, option.quantity])));
  const [excluded, setExcluded] = useState<string[]>(line.excludedIngredientIds ?? []);
  const data = query.data;
  const groupsValid = data?.groups.every((group) => {
    const count = group.options.reduce((sum, option) => sum + (selected[option.id] ?? 0), 0);
    return group.options.every((option) => (selected[option.id] ?? 0) <= option.maxQuantity) && count >= group.minSelections && (group.maxSelections == null || count <= group.maxSelections);
  });
  const choices = data?.groups.flatMap((group) => group.options.filter((option) => selected[option.id] > 0).map((option) => ({ optionId: option.id, name: option.name, quantity: selected[option.id], price: option.price }))) ?? [];
  const extra = choices.reduce((sum, option) => sum + option.price * option.quantity, 0);
  return <Modal open onClose={onClose} title={line.dish.name} footer={<button type="button" className="btn-primary w-full" disabled={!data || !groupsValid || query.isFetching} onClick={() => onConfirm({ modifierSelections: choices, excludedIngredientIds: excluded.filter((id) => data!.excludableIngredients.some((item) => item.id === id)), excludedIngredientNames: data!.excludableIngredients.filter((item) => excluded.includes(item.id)).map((item) => item.name) })}>Добавить{extra > 0 ? ` · +${extra.toLocaleString('ru-RU')}` : ''}</button>}>
    {query.isPending && <p role="status">Загружаем добавки…</p>}
    {query.isError && <div role="alert"><p>{apiError(query.error)}</p><button type="button" className="btn-secondary mt-2" onClick={() => void query.refetch()}>Повторить</button></div>}
    <div className="space-y-5">{data?.groups.map((group) => {
      const count = group.options.reduce((sum, option) => sum + (selected[option.id] ?? 0), 0);
      return <fieldset key={group.id}><legend className="font-semibold">{group.name}</legend><p className="mb-2 text-sm text-text-muted">{group.minSelections > 0 ? `Не менее ${group.minSelections}` : 'По желанию'}{group.maxSelections != null ? `, не более ${group.maxSelections}` : ''}</p>
        <div className="divide-y divide-border">{group.options.map((option) => <div key={option.id} className="flex items-center justify-between gap-3 py-2"><span>{option.name}{option.price > 0 && <span className="ml-2 text-text-muted">+{option.price.toLocaleString('ru-RU')}</span>}</span><div className="flex items-center gap-3"><button type="button" className="btn-secondary h-9 w-9 p-0" aria-label={`Убрать ${option.name}`} disabled={!selected[option.id]} onClick={() => setSelected((previous) => ({ ...previous, [option.id]: Math.max(0, (previous[option.id] ?? 0) - 1) }))}>−</button><output aria-label={`Количество ${option.name}`}>{selected[option.id] ?? 0}</output><button type="button" className="btn-secondary h-9 w-9 p-0" aria-label={`Добавить ${option.name}`} disabled={(selected[option.id] ?? 0) >= option.maxQuantity || (group.maxSelections != null && count >= group.maxSelections)} onClick={() => setSelected((previous) => ({ ...previous, [option.id]: (previous[option.id] ?? 0) + 1 }))}>+</button></div></div>)}</div>
      </fieldset>;
    })}{!!data?.excludableIngredients.length && <fieldset><legend className="mb-2 font-semibold">Убрать из блюда</legend><div className="space-y-2">{data.excludableIngredients.map((ingredient) => <label key={ingredient.id} className="flex items-center gap-3 py-1"><input type="checkbox" checked={excluded.includes(ingredient.id)} onChange={(event) => setExcluded((previous) => event.target.checked ? [...previous, ingredient.id] : previous.filter((id) => id !== ingredient.id))} />Без {ingredient.name}</label>)}</div></fieldset>}</div>
  </Modal>;
}
