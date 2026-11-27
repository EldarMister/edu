import { Navigate, useSearchParams } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { IngredientCategoriesPage } from './IngredientCategoriesPage';
import { MenuCategoriesPage } from './MenuPage';
import { WorkspaceSearch } from './WorkspaceSearch';
import { useEditorRoute, usePageFilters } from './warehouse/workspace-route';

export function MenuCategoryWorkspace() {
  const [params] = useSearchParams();
  const { canSection } = usePermissions();
  const [{ categoryType, search }, update] = usePageFilters({ categoryType: 'menu', search: '', sort: 'asc' });
  const { editor } = useEditorRoute();
  const canViewIngredients = canSection('warehouse');
  if (params.get('view') === 'ingredientCategories') {
    const next = new URLSearchParams(params);
    next.set('view', 'categories');
    if (canViewIngredients) next.set('categoryType', 'ingredients');
    return <Navigate replace to={{ search: next.toString() }} />;
  }
  const showIngredients = canViewIngredients && editor?.type !== 'categoryTrash'
    && (categoryType === 'ingredients' || editor?.type === 'ingredientCategory');
  return <>
    {!editor && <div className="mb-4 flex flex-wrap items-center gap-2">
      <WorkspaceSearch className="min-w-28 !w-auto flex-1 sm:!w-60 sm:flex-none [&>.input]:h-10"
        label="Поиск категорий" value={search} onChange={(value) => update({ search: value })} />
      {canViewIngredients && <nav aria-label="Типы категорий" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!showIngredients}
          className={`btn-md !h-10 max-sm:!px-2 max-sm:!text-xs ${showIngredients ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => update({ categoryType: 'menu', search: '', sort: 'asc' })}>Товары и блюда</button>
        <button type="button" aria-pressed={showIngredients}
          className={`btn-md !h-10 max-sm:!px-2 max-sm:!text-xs ${showIngredients ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => update({ categoryType: 'ingredients', search: '', sort: 'asc' })}>Ингредиенты</button>
      </nav>}
    </div>}
    {showIngredients ? <IngredientCategoriesPage search={search} /> : <MenuCategoriesPage search={search} clearSearch={() => update({ search: '' })} />}
  </>;
}
