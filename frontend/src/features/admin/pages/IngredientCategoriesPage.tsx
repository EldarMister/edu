import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { EditorPage } from './warehouse/EditorPage';
import { DocumentField } from './warehouse/WarehouseUi';
import { usePermissions } from '@/hooks/usePermissions';
import { api, apiError } from '@/lib/api';
import { useIngredients } from './warehouse/api';
import { QueryState } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';

export function IngredientCategoriesPage() {
  const query = useIngredients('');
  const qc = useQueryClient();
  const { can } = usePermissions();
  const [, setRoute] = useSearchParams();
  const [search, setSearch] = usePageFilter('search');
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const editing = editor?.type === 'ingredientCategory' ? editor.id : undefined;
  const [name, setName] = useState('');
  useEffect(() => { setName(editing ?? ''); }, [editing]);
  const groups = new Map<string, number>();
  for (const item of query.data ?? []) {
    if (!item.isPrepared && item.kind !== 'goods' && item.kind !== 'beverage' && item.category) {
      groups.set(item.category, (groups.get(item.category) ?? 0) + 1);
    }
  }
  const rows = [...groups].sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .filter(([category]) => category.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const rename = useMutation({
    mutationFn: () => api.post('/admin/warehouse/ingredients/categories/rename', { from: editing, to: name }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['admin', 'warehouse'] });
      closeEditor();
    },
  });
  if (editor?.type === 'ingredientCategory') {
    if (!can('actions.warehouseSettings')) {
      return <EditorPage title="Нет доступа" onClose={closeEditor}>
        <p role="alert" className="text-text-secondary">У вас нет доступа к редактированию категорий ингредиентов.</p>
      </EditorPage>;
    }
    if (!editing || (query.isSuccess && !groups.has(editing))) {
      return <EditorPage title="Категория не найдена" onClose={closeEditor}>
        <p role="alert" className="text-text-secondary">Категория по этой ссылке не найдена. Вернитесь к списку категорий.</p>
      </EditorPage>;
    }
    if (!query.isSuccess) {
      return <EditorPage title="Редактирование категории ингредиентов" onClose={closeEditor}>
        <QueryState pending={query.isPending} error={query.error} />
      </EditorPage>;
    }
  }
  return <>
    {!editing && <div className="overflow-hidden">
      <div className="poster-toolbar">
        <input aria-label="Поиск категории" className="input h-10 sm:max-w-xs" placeholder="Быстрый поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        {rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-background/40 text-xs text-text-muted"><tr><th className="p-4">Название</th><th className="p-4 text-right">Ингредиентов</th><th /></tr></thead>
          <tbody className="divide-y divide-border">{rows.map(([category, count]) => <tr key={category}>
            <td className="p-4"><button className="font-medium text-primary hover:underline" onClick={() => setRoute({ section: 'menu', view: 'ingredients', category })}>{category}</button></td>
            <td className="p-4 text-right">{count}</td>
            <td className="p-4 text-right">{can('actions.warehouseSettings') && <button className="text-primary" onClick={() => { rename.reset(); setName(category); openEditor({ type: 'ingredientCategory', id: category }); }}>Ред.</button>}</td>
          </tr>)}</tbody>
        </table></div> : <p className="p-8 text-center text-sm text-text-muted">Категории пока не добавлены. Укажите категорию в карточке ингредиента.</p>}
      </QueryState>
    </div>}
    {editing && can('actions.warehouseSettings') && <EditorPage onClose={closeEditor} title="Редактирование категории ингредиентов"
      footer={<button form="ingredient-category-editor" type="submit" className="btn-primary btn-md" disabled={!name.trim() || rename.isPending}>Сохранить</button>}>
      <form id="ingredient-category-editor" onSubmit={(e) => { e.preventDefault(); rename.mutate(); }} className="poster-form poster-form--directory space-y-4">
        <DocumentField label="Название"><input autoFocus aria-label="Название категории" className="input w-full" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></DocumentField>
        {rename.error && <p role="alert" className="text-sm text-danger">{apiError(rename.error)}</p>}
      </form>
    </EditorPage>}
  </>;
}
