import { useState } from 'react';
import { RecipesTab } from './RecipesTab';
import { MenuStockCatalogue } from './MenuStockCatalogue';
import type { WarehouseView } from './navigation';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { homeForRole } from '@/routes/ProtectedRoute';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { WarehouseSection } from './WarehouseSection';
export function WarehouseStaffApp() {
  const user = useAuth((s) => s.user);
  const { canSection } = usePermissions();
  const [section, setSection] = useState<'recipes' | 'preparations' | 'warehouse'>('recipes');
  const [view, setView] = useState<WarehouseView>('balances');
  if (!user) return null;
  if (!canSection('warehouse')) return <Navigate to={homeForRole(user.role)} replace />;
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white p-4">
        <div className="flex items-center gap-3">
          <Link to={homeForRole(user.role)} className="btn-secondary btn-md">
            ← К заказам
          </Link>
          <h1 className="text-lg font-semibold">Склад и техкарты</h1>
        </div>
        <ConnectionStatus />
      </header>
      <main className="mx-auto w-full max-w-7xl p-4">
        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              { key: 'recipes', label: 'Техкарты меню' },
              { key: 'preparations', label: 'Полуфабрикаты' },
              { key: 'warehouse', label: 'Склад' },
            ] as const
          ).map((s) => (
            <button
              key={s.key}
              className={`${section === s.key ? 'btn-primary' : 'btn-secondary'} btn-md`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {section === 'recipes' && <RecipesTab dishesOnly onPreparation={() => setSection('preparations')} />}
        {section === 'preparations' && <MenuStockCatalogue view="preparations" />}
        {section === 'warehouse' && <WarehouseSection view={view} onView={setView} staffMode />}
      </main>
    </div>
  );
}
