import type { EntryKind, FinanceCategory } from './api';

export function categoryAccepts(category: FinanceCategory, kind: EntryKind) {
  return (kind === 'income' || kind === 'expense') && (category.kind === kind || category.kind === 'both');
}

export function categoryAncestors(category: FinanceCategory, byId: Map<string, FinanceCategory>) {
  const ancestors: FinanceCategory[] = [];
  const visited = new Set([category.id]);
  for (let id = category.parentId; id && !visited.has(id);) {
    const parent = byId.get(id);
    if (!parent) break;
    visited.add(id);
    ancestors.push(parent);
    id = parent.parentId;
  }
  return ancestors;
}

export function categoryOptions(categories: FinanceCategory[], accept = (_category: FinanceCategory) => true) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return categories.filter(accept).map((category) => ({
    value: category.id,
    label: [...categoryAncestors(category, byId).reverse().map(({ name }) => name), category.name].join(' / '),
  })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}
