import { useEffect, useId, useState } from 'react';
import { RowIconButton } from '../components/RowIconButton';
import { RowActionMenu } from '../components/RowActionMenu';
import { useSearchParams } from 'react-router-dom';
import { EditorPage } from './warehouse/EditorPage';
import { DocumentField } from './warehouse/WarehouseUi';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { useIngredientCategories, useIngredientCategoryMutations } from './warehouse/api';
import { NewIngredientCategory } from './warehouse/NewIngredientCategory';
import { RemoveDirectoryEntry } from './warehouse/RemoveDirectoryEntry';
import { QueryState } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilter } from './warehouse/workspace-route';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';

export function IngredientCategoriesPage() {
  const query = useIngredientCategories();
  const { save: rename, remove } = useIngredientCategoryMutations();
  const { can } = usePermissions();
  const [, setRoute] = useSearchParams();
  const [search, setSearch] = usePageFilter('search');
  const [sort, setSort] = usePageFilter('sort', 'asc');
  const formId = useId();
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const editing = editor?.type === 'ingredientCategory' ? editor.id : undefined;
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => { setName(editing ?? ''); }, [editing]);
  const rows = (query.data ?? []).filter(({ name }) => name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') * (sort === 'desc' ? -1 : 1));
  if (editor?.type === 'ingredientCategory') {
    if (!can('actions.warehouseSettings')) {
      return <EditorPage title="Нет доступа" onClose={closeEditor}>
        <p role="alert" className="text-text-secondary">У вас нет доступа к редактированию категорий ингредиентов.</p>
      </EditorPage>;
    }
    if (!editing || (query.isSuccess && !rename.isPending && !query.data.some(({ name }) => name === editing))) {
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
    {!editing && <div>
      <WorkspaceHeaderCount count={query.data?.length} />
      <WorkspaceHeaderActions>
        {can('actions.warehouseSettings') && <button type="button" className="btn-primary btn-md"
          onClick={() => setCreating(true)}>Добавить категорию</button>}
      </WorkspaceHeaderActions>
      <div className="poster-toolbar">
        <WorkspaceSearch label="Поиск категории" value={search} onChange={setSearch} />
      </div>
      <QueryState pending={query.isPending} error={query.error}>
        <div className="overflow-x-auto"><table className="poster-table poster-directory-table poster-directory-table--categories w-full min-w-[480px]">
          <colgroup><col style={{ width: '46%' }} /><col /><col style={{ width: 112 }} /></colgroup>
          <thead><tr>
            <th aria-sort={sort === 'desc' ? 'descending' : 'ascending'}>
              <button type="button" className="inline-flex items-center gap-2" onClick={() => setSort(sort === 'desc' ? 'asc' : 'desc')}
                aria-label={`Сортировать категории: ${sort === 'desc' ? 'от А до Я' : 'от Я до А'}`}>
                Категория <span aria-hidden="true">{sort === 'desc' ? '↓' : '↑'}</span>
              </button>
            </th>
            <th>Кол-во ингредиентов</th><th><span className="sr-only">Действия</span></th>
          </tr></thead>
          <tbody>{rows.map(({ name: category, count }) => <tr key={category}>
            <td><button type="button" className="block max-w-full truncate text-left text-primary" title={category} onClick={() => setRoute({ section: 'menu', view: 'ingredients', category })}>{category}</button></td>
            <td className="tabular-nums">{count}</td>
            <td>{can('actions.warehouseSettings') && <div className="poster-row-actions"><RowIconButton icon="edit"
              label={`Редактировать категорию: ${category}`} onClick={() => { rename.reset(); setName(category); openEditor({ type: 'ingredientCategory', id: category }); }} />
              <RowActionMenu label={category} action="Удалить" onAction={() => { remove.reset(); setRemoving(category); }} />
            </div>}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={3} className="poster-directory-empty text-center text-text-muted">
            {search ? 'Категории не найдены' : 'Категории пока не добавлены.'}
          </td></tr>}
          </tbody>
        </table></div>
      </QueryState>
    </div>}
    {editing && can('actions.warehouseSettings') && <EditorPage onClose={closeEditor} title="Редактирование категории ингредиентов"
      footer={<button form={formId} type="submit" className="btn-primary btn-md" disabled={!name.trim() || rename.isPending}>Сохранить</button>}>
      <form id={formId} onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && !rename.isPending) rename.mutate({ name, from: editing }, { onSuccess: closeEditor });
      }} className="poster-form poster-form--directory space-y-4">
        <DocumentField label="Название"><input aria-label="Название категории" className="input w-full" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} /></DocumentField>
        {rename.error && <p role="alert" className="text-sm text-danger">{apiError(rename.error)}</p>}
      </form>
    </EditorPage>}
    {creating && <NewIngredientCategory onClose={() => setCreating(false)} />}
    {removing && <RemoveDirectoryEntry title="Удалить категорию ингредиентов?" pending={remove.isPending} error={remove.error}
      onClose={() => setRemoving(null)} onRemove={() => remove.mutate(removing, { onSuccess: () => setRemoving(null) })}>
      После удаления категории «{removing}» её ингредиенты будут без категории.
    </RemoveDirectoryEntry>}
  </>;
}
