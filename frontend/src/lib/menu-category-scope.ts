export function menuCategoryScope(categories: { id: string; ancestorIds?: string[] }[], selected: string) {
  return new Set([selected, ...categories.filter((category) => category.ancestorIds?.includes(selected)).map(({ id }) => id)]);
}

type MenuCategory = { id: string; name: string; parentId?: string | null };

export function menuCategoryOptions(categories: MenuCategory[], { excludeId, includeMain = false }: {
  excludeId?: string; includeMain?: boolean;
} = {}) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return categories.flatMap((category) => {
    if (category.id.startsWith('menu-root:')) return includeMain ? [{ value: category.id, label: category.name }] : [];
    const path: string[] = [];
    const visited = new Set<string>();
    let current: MenuCategory | undefined = category;
    while (current && !current.id.startsWith('menu-root:')) {
      if (current.id === excludeId || visited.has(current.id)) return [];
      visited.add(current.id);
      path.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return [{ value: category.id, label: path.join(' / ') }];
  });
}
