import { Navigate, useSearchParams } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { IngredientCategoriesPage } from './IngredientCategoriesPage';
import { MenuCategoriesPage } from './MenuPage';
import { useEditorRoute, usePageFilters } from './warehouse/workspace-route';

export function MenuCategoryWorkspace() {
  const [params] = useSearchParams();
  const { canSection } = usePermissions();
  const [{ categoryType }, update] = usePageFilters({ categoryType: 'menu', search: '', sort: 'asc' });
  const { editor } = useEditorRoute();
  const canViewIngredients = canSection('warehouse');
  if (params.get('view') === 'ingredientCategories') {
    const next = new URLSearchParams(params);
    next.set('view', 'categories');
    if (canViewIngredients) next.set('categoryType', 'ingredients');
    return <Navigate replace to={{ search: next.toString() }} />;
  }
  const showIngredients = canViewIngredients && (categoryType === 'ingredients' || editor?.type === 'ingredientCategory');
  return <>
    {canViewIngredients && !editor && <nav aria-label="Типы категорий" className="mb-4 flex flex-wrap gap-2">
      <button type="button" aria-pressed={!showIngredients} className={!showIngredients ? 'btn-primary btn-md' : 'btn-secondary btn-md'}
        onClick={() => update({ categoryType: 'menu', search: '', sort: 'asc' })}>Товары и блюда</button>
      <button type="button" aria-pressed={showIngredients} className={showIngredients ? 'btn-primary btn-md' : 'btn-secondary btn-md'}
        onClick={() => update({ categoryType: 'ingredients', search: '', sort: 'asc' })}>Ингредиенты</button>
    </nav>}
    {showIngredients ? <IngredientCategoriesPage /> : <MenuCategoriesPage />}
  </>;
}
