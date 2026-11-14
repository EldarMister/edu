import { RecipesTab } from './RecipesTab';
import { MenuStockCatalogue } from './MenuStockCatalogue';
import { WAREHOUSE_NAV, type WarehouseView } from './navigation';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { usePageFilter, useWorkspaceScroll } from './workspace-route';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { homeForRole } from '@/routes/ProtectedRoute';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { WarehouseSection } from './WarehouseSection';
import {
  WorkspaceHeaderProvider,
  WorkspaceTitleSlot,
  WorkspaceActionsSlot,
} from '../WorkspaceHeader';
import './poster-workspace.css';
export function WarehouseStaffApp() {
  const user = useAuth((s) => s.user);
  const { canSection } = usePermissions();
  const [params, setParams] = useSearchParams();
  const section = params.get('section') ?? 'recipes';
  const [view, setView] = usePageFilter('view', 'balances');
  const editorOpen = !!params.get('editor');
  const title =
    section === 'recipes'
      ? 'Техкарты меню'
      : section === 'preparations'
        ? 'Полуфабрикаты'
        : (WAREHOUSE_NAV.find((item) => item.key === view)?.label ?? 'Склад');
  useWorkspaceScroll();
  const setSection = (next: string) => setParams({ section: next });
  if (!user) return null;
  if (!canSection('warehouse')) return <Navigate to={homeForRole(user.role)} replace />;
  return (
    <WorkspaceHeaderProvider>
      <div className="poster-workspace flex h-dvh flex-col overflow-hidden bg-white">
        <header className="workspace-header flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-white">
          <div className="flex min-w-0 items-center gap-3">
            {!editorOpen && (
              <Link to={homeForRole(user.role)} className="btn-secondary btn-md shrink-0">
                ← К заказам
              </Link>
            )}
            <WorkspaceTitleSlot>
              <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
            </WorkspaceTitleSlot>
          </div>
          <div className="flex items-center gap-3">
            <WorkspaceActionsSlot />
            <ConnectionStatus />
          </div>
        </header>
        <main className="workspace-main app-scrollbar-subtle min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
          {!editorOpen && (
            <nav aria-label="Разделы склада" className="mb-4 flex flex-wrap gap-2">
              {(
                [
                  { key: 'recipes', label: 'Техкарты меню' },
                  { key: 'preparations', label: 'Полуфабрикаты' },
                  { key: 'warehouse', label: 'Склад' },
                ] as const
              ).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-current={section === s.key ? 'page' : undefined}
                  className={`${section === s.key ? 'btn-primary' : 'btn-secondary'} btn-md`}
                  onClick={() => setSection(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </nav>
          )}
          {section === 'recipes' && (
            <RecipesTab dishesOnly onPreparation={() => setSection('preparations')} />
          )}
          {section === 'preparations' && <MenuStockCatalogue view="preparations" />}
          {section === 'warehouse' && (
            <WarehouseSection view={view as WarehouseView} onView={setView} staffMode />
          )}
        </main>
      </div>
    </WorkspaceHeaderProvider>
  );
}
