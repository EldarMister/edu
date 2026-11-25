import { useState, type ReactNode } from 'react';
import { RowIconButton } from '../../components/RowIconButton';
import { Modal } from '@/components/Modal';
import { Select } from '@/components/Select';
import { apiError } from '@/lib/api';
import { WorkspaceHeaderCount } from '../WorkspaceHeader';
import { QueryState } from '../warehouse/WarehouseUi';
import { FinanceRegister } from './FinanceRegister';
import { RowActionMenu } from '../../components/RowActionMenu';
import { useFinanceCategoryRemoval, useFinanceWrites, type FinanceCategory } from './api';
import { categoryAccepts, categoryAncestors, categoryOptions } from './category-options';

const categoryType = { income: 'Только доходы', expense: 'Только расходы', both: 'Доходы и расходы' };

export function CategoryDirectory({ categories, employees, positions, search, kind, ascending, toggleSort, filters, add, edit }: {
  categories: FinanceCategory[];
  employees: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  search: string;
  kind: string;
  ascending: boolean;
  toggleSort: () => void;
  filters: ReactNode;
  add: ReactNode;
  edit?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [removing, setRemoving] = useState<FinanceCategory | null>(null);
  const { setCategoryVisibility } = useFinanceWrites();
  const byId = new Map(categories.map((category) => [category.id, category]));
  const descendants = new Map<string | null, FinanceCategory[]>();
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name, 'ru') * (ascending ? 1 : -1));
  for (const category of sorted) {
    const parent = category.parentId && byId.has(category.parentId) ? category.parentId : null;
    descendants.set(parent, [...(descendants.get(parent) ?? []), category]);
  }
  const term = search.trim().toLocaleLowerCase('ru');
  const matching = categories.filter((category) => (!kind || (kind === 'both' ? category.kind === 'both'
    : (kind === 'income' || kind === 'expense') && categoryAccepts(category, kind)))
    && category.name.toLocaleLowerCase('ru').includes(term));
  const visible = new Set(matching.flatMap((category) => [category.id, ...categoryAncestors(category, byId).map(({ id }) => id)]));
  const filtered = !!(term || kind);
  const employeeNames = new Map(employees.map(({ id, name }) => [id, name]));
  const positionNames = new Map(positions.map(({ id, name }) => [id, name]));
  function flatten(parent: string | null, depth: number): { category: FinanceCategory; depth: number; hasChildren: boolean; open: boolean }[] {
    return (descendants.get(parent) ?? []).filter(({ id }) => visible.has(id)).flatMap((category) => {
      const hasChildren = !!descendants.get(category.id)?.some(({ id }) => visible.has(id));
      const open = hasChildren && (filtered || expanded.includes(category.id));
      return [{ category, depth, hasChildren, open }, ...(open ? flatten(category.id, depth + 1) : [])];
    });
  }

  return <>
    <WorkspaceHeaderCount count={matching.length} />
    {setCategoryVisibility.error && <p role="alert" className="mb-2 text-sm text-danger">{apiError(setCategoryVisibility.error)}</p>}
    <FinanceRegister title="Категории" columns={[
      { key: 'name', label: 'Название', width: '37%', sort: { ascending, toggle: toggleSort } },
      { key: 'type', label: 'Допустимые транзакции', width: '22%' },
      { key: 'pos', label: 'Показывать на кассе', width: '19%' },
      { key: 'pnl', label: 'Отображать в P&L' },
      { key: 'access', label: 'Дополнительный доступ' },
    ]} reportActions={false} filters={filters} tools={add}
      rows={flatten(null, 0).map(({ category, depth, hasChildren, open }) => {
        const delegates = [
          ...category.positionIds.map((id) => positionNames.get(id)), ...category.userIds.map((id) => employeeNames.get(id)),
        ].filter(Boolean);
        const access = delegates.length ? delegates.join(', ') : '—';
        const toggle = () => setExpanded((current) => open ? current.filter((id) => id !== category.id) : [...current, category.id]);
        return { id: category.id, values: {
          name: { value: category.name, display: <span className="finance-category-name" style={{ paddingInlineStart: Math.min(depth, 6) * 20 }}>
            {hasChildren && !filtered ? <button type="button" className="finance-category-expander text-text-muted"
              aria-expanded={open} aria-label={(open ? 'Свернуть ' : 'Раскрыть ') + category.name}
              onClick={toggle}>{open ? '⌄' : '›'}</button>
              : <span className="finance-category-expander" aria-hidden="true">{hasChildren && '⌄'}</span>}{category.name}
          </span> },
          type: { value: categoryType[category.kind] },
          pnl: { value: category.showInProfitLoss !== false ? 'Да' : 'Нет', display: edit && <button type="button" role="switch"
            aria-label={'Отображать в P&L — ' + category.name} aria-checked={category.showInProfitLoss !== false}
            disabled={setCategoryVisibility.isPending} className="finance-category-switch"
            onClick={() => setCategoryVisibility.mutate({ id: category.id, showInProfitLoss: category.showInProfitLoss === false })}><span /></button> },
          pos: { value: category.showOnPos ? 'Да' : 'Нет', display: edit && <button type="button" role="switch"
            aria-label={'Показывать на кассе: ' + category.name} aria-checked={!!category.showOnPos}
            disabled={setCategoryVisibility.isPending} className="finance-category-switch"
            onClick={() => setCategoryVisibility.mutate({ id: category.id, showOnPos: !category.showOnPos })}><span /></button> },
          access: { value: access, display: <span className="text-text-secondary">{access}</span> },
        }, action: edit && <div className="flex items-center justify-end gap-2">
          <RowIconButton icon="edit" label={'Редактировать ' + category.name} onClick={() => edit(category.id)} />
          <RowActionMenu label={category.name} action="Удалить" onAction={() => setRemoving(category)} />
        </div> };
      })} empty="Категории транзакций не найдены" />
    {removing && <CategoryRemovalDialog key={removing.id} category={removing} categories={categories} onClose={() => setRemoving(null)} />}
  </>;
}

function CategoryRemovalDialog({ category, categories, onClose }: {
  category: FinanceCategory; categories: FinanceCategory[]; onClose: () => void;
}) {
  const plan = useFinanceCategoryRemoval(category.id);
  const { deleteCategory } = useFinanceWrites();
  const [replacementId, setReplacementId] = useState('');
  const replacementIds = new Set(plan.data?.replacementIds);
  const choices = categoryOptions(categories, ({ id }) => replacementIds.has(id));
  const valid = plan.data && (plan.data.entryCount === 0 || replacementIds.has(replacementId));
  const close = () => { if (!deleteCategory.isPending) onClose(); };

  return <Modal open title="Удаление категории" onClose={close} footer={<div className="flex justify-end gap-2">
    <button type="button" className="btn-secondary btn-md" disabled={deleteCategory.isPending} onClick={close}>Отмена</button>
    <button type="button" className="btn-danger btn-md" disabled={!valid || plan.isError || deleteCategory.isPending}
      onClick={() => deleteCategory.mutate({ id: category.id, replacementId: replacementId || undefined }, { onSuccess: onClose })}>
      Удалить
    </button>
  </div>}>
    <div className="space-y-3">
      <p>Удалить категорию «{category.name}»?</p>
      <QueryState pending={plan.isPending} error={plan.error} />
      {plan.data && <>
        {plan.data.entryCount > 0 && <>
          <p className="text-text-secondary">Выберите, куда перенести транзакции. Суммы и остатки по счетам сохранятся.</p>
          {choices.length > 0 ? <Select value={replacementId} onChange={setReplacementId} options={choices}
            ariaLabel="Категория для переноса" placeholder="Выберите категорию" disabled={deleteCategory.isPending} />
            : <p role="alert" className="text-danger">Сначала создайте категорию, подходящую для переноса транзакций.</p>}
        </>}
        {plan.data.childCount > 0 && <p className="text-text-secondary">Подкатегории перейдут на уровень выше.</p>}
      </>}
      {deleteCategory.error && <p role="alert" className="text-danger">{apiError(deleteCategory.error)}</p>}
    </div>
  </Modal>;
}
