import { useDeferredValue } from 'react';
import { Link } from 'react-router-dom';
import { Select } from '@/components/Select';
import { usePermissions } from '@/hooks/usePermissions';
import { apiError } from '@/lib/api';
import { WorkspacePending } from '../components/WorkspacePending';
import { useAdminCategories } from '../api';
import { financeMoney } from './finance/finance-format';
import { WorkspaceHeaderCount } from './WorkspaceHeader';
import { WorkspaceSearch } from './WorkspaceSearch';
import { costPercent, menuOutputLabel, useMenuCosts, type MenuCostRow } from './menu-cost-api';
import { usePageFilters } from './warehouse/workspace-route';

const pageSize = 25;

export function MenuFoodCostPage({ onOpen }: { onOpen: (row: MenuCostRow) => void }) {
  const { can, canAction } = usePermissions();
  const [filters, setFilters] = usePageFilters({ foodSearch: '', foodCategory: '', foodPage: '1' });
  const search = useDeferredValue(filters.foodSearch);
  const page = Math.max(1, Number.parseInt(filters.foodPage, 10) || 1);
  const categories = useAdminCategories();
  const costs = useMenuCosts({
    search: search.trim() || undefined, categoryId: filters.foodCategory || undefined,
    offset: (page - 1) * pageSize, limit: pageSize,
  }, true);
  const rows = costs.data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((costs.data?.total ?? 0) / pageSize));
  const hasAnotherPage = page < pages;
  const hasActual = can('sections.statistics') && canAction('warehouseReports');
  const selectPage = (next: number) => setFilters({ foodPage: String(next) });
  const label = (row: MenuCostRow) => row.variantName ? `${row.dishName} · ${row.variantName}` : row.dishName;
  const open = (row: MenuCostRow) => <button type="button" className="text-left font-medium text-primary hover:underline"
    onClick={() => onOpen(row)}>{label(row)}</button>;
  return <section aria-label="Фудкост меню" className="min-w-0 space-y-3">
    <WorkspaceHeaderCount count={costs.data?.total} />
    <div className="poster-toolbar">
      <WorkspaceSearch label="Поиск по меню" value={filters.foodSearch}
        onChange={(foodSearch) => setFilters({ foodSearch, foodPage: '1' })} />
      <Select ariaLabel="Категория меню" className="h-9" value={filters.foodCategory}
        onChange={(foodCategory) => setFilters({ foodCategory, foodPage: '1' })}
        options={[{ value: '', label: 'Все категории' }, ...(categories.data ?? []).map(({ id, name }) => ({ value: id, label: name }))]} />
      {hasActual && <Link className="btn-secondary btn-md ml-auto" to="?section=stats&view=products">Фактический фудкост продаж</Link>}
    </div>
    <p className="text-sm text-text-secondary">
      Фудкост рассчитан по текущей себестоимости со складов списания и цене меню. Наценка и валовая прибыль учитывают налог.
    </p>
    {costs.isPending ? <WorkspacePending /> : costs.isError ? <div role="alert" className="flex flex-wrap items-center gap-3 py-4 text-sm">
      <p className="text-danger">{apiError(costs.error)}</p>
      <button type="button" className="text-primary hover:underline" onClick={() => void costs.refetch()}>Повторить</button>
    </div> : rows.length === 0 ? <p className="py-10 text-center text-sm text-text-muted">Позиции меню не найдены.</p> : <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-white md:block">
        <table className="poster-table w-full min-w-[870px] text-sm">
          <thead className="text-xs text-text-muted">
            <tr>
              {['Позиция', 'Категория', 'Выход', 'Себестоимость', 'Цена', 'Фудкост', 'Наценка', 'Валовая прибыль'].map((heading, index) =>
                <th key={heading} scope="col" className={`px-4 py-3 font-medium ${index > 1 ? 'text-right' : 'text-left'}`}>{heading}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={rowKey(row)} className="border-t border-border">
              <td className="px-4 py-3">{open(row)}<CostIssue row={row} /></td>
              <td className="px-4 py-3 text-text-secondary">{row.categoryName || '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right">{menuOutputLabel(row.output)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{financeMoney(row.foodCost)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{financeMoney(row.price)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{percentLabel(row.foodCostPercent)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{percentLabel(row.markupPercent)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{financeMoney(row.marginAmount)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border bg-white md:hidden">
        {rows.map((row) => <li key={rowKey(row)} className="space-y-2 p-3 text-sm">
          {open(row)}
          <p className="text-xs text-text-muted">{row.categoryName || '—'} · {menuOutputLabel(row.output)}</p>
          <dl className="grid grid-cols-2 gap-2">
            <CostValue label="Себестоимость" value={financeMoney(row.foodCost)} />
            <CostValue label="Цена" value={financeMoney(row.price)} />
            <CostValue label="Фудкост" value={percentLabel(row.foodCostPercent)} />
            <CostValue label="Наценка" value={percentLabel(row.markupPercent)} />
            <CostValue label="Валовая прибыль" value={financeMoney(row.marginAmount)} />
          </dl>
          <CostIssue row={row} />
        </li>)}
      </ul>
    </>}
    {(page > 1 || hasAnotherPage) && <nav aria-label="Страницы расчёта фудкоста" className="flex justify-end gap-2 text-sm">
      <button type="button" className="btn-secondary btn-md" aria-label="Предыдущая страница" disabled={page <= 1}
        onClick={() => selectPage(page - 1)}>‹</button>
      <span className="self-center">Страница {page} из {pages}</span>
      <button type="button" className="btn-secondary btn-md" aria-label="Следующая страница" disabled={!hasAnotherPage}
        onClick={() => selectPage(page + 1)}>›</button>
    </nav>}
  </section>;
}

function rowKey(row: MenuCostRow) { return row.dishId + ':' + (row.variantId ?? 'base'); }
function percentLabel(value: number | null) { return value == null ? '—' : costPercent(value); }

function CostIssue({ row }: { row: MenuCostRow }) {
  if (row.foodCost != null) return null;
  return <p className="mt-1 text-xs text-text-muted">{row.missingCosts.length
    ? `Нет стоимости: ${row.missingCosts.join(', ')}`
    : 'Состав или складской учёт не настроен'}</p>;
}

function CostValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-text-muted">{label}</dt><dd className="tabular-nums">{value}</dd></div>;
}
