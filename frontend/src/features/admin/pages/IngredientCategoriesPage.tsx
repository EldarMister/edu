import { useEffect, useId, useState } from 'react';
import { ColumnButton } from '../components/ColumnControl';
import { IconExport, IconPrinter } from '../components/icons';
import { RowIconButton } from '../components/RowIconButton';
import { RowActionMenu } from '../components/RowActionMenu';
import { useSearchParams } from 'react-router-dom';
import { EditorPage } from './warehouse/EditorPage';
import { DocumentField } from './warehouse/WarehouseUi';
import { usePermissions } from '@/hooks/usePermissions';
import { useColumnPreference } from '@/hooks/useColumnPreference';
import { apiError } from '@/lib/api';
import { useIngredientCategories, useIngredientCategoryMutations, type IngredientCategory } from './warehouse/api';
import { balanceMoney, balanceQuantity } from './warehouse/balance-format';
import { visibleWarehouseColumns, WarehouseColumnSettings } from './warehouse/WarehouseColumnSettings';
import { exportCsv, printReport } from '@/lib/report-output';
import { NewIngredientCategory } from './warehouse/NewIngredientCategory';
import { RemoveDirectoryEntry } from './warehouse/RemoveDirectoryEntry';
import { QueryState } from './warehouse/WarehouseUi';
import { useEditorRoute, usePageFilters } from './warehouse/workspace-route';
import { WorkspaceHeaderActions, WorkspaceHeaderCount } from './WorkspaceHeader';

const labels = { name: 'Категория', count: 'Кол-во ингредиентов', stock: 'Остатки на всех складах', value: 'Стоимость остатков' };
type Column = keyof typeof labels;
const stockUnits = { kg: 'кг', l: 'л', pcs: 'шт.' };

function stockText(stock?: IngredientCategory['stockByUnit']) {
  const quantities = (Object.keys(stockUnits) as Array<keyof typeof stockUnits>).flatMap((key) =>
    stock?.[key] ? [balanceQuantity(stock[key], stockUnits[key])] : [],
  );
  return quantities.join(' · ') || '—';
}

function compareValues(a: number | null | undefined, b: number | null | undefined, direction: number) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return (a - b) * direction;
}

export function IngredientCategoriesPage({ search }: { search: string }) {
  const query = useIngredientCategories(true, true);
  const { save: rename, remove } = useIngredientCategoryMutations();
  const { can } = usePermissions();
  const [, setRoute] = useSearchParams();
  const [{ sort, sortBy }, setListOptions] = usePageFilters({ sort: 'asc', sortBy: 'name' });
  const [savedColumns, setSavedColumns] = useColumnPreference('ingredient-categories');
  const formId = useId();
  const { editor, openEditor, closeEditor } = useEditorRoute();
  const editing = editor?.type === 'ingredientCategory' ? editor.id : undefined;
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<IngredientCategory | null>(null);
  const [removeIngredients, setRemoveIngredients] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [printError, setPrintError] = useState('');
  useEffect(() => { setName(editing ?? ''); }, [editing]);
  const canManage = can('actions.warehouseSettings');
  const canSeeCosts = can('actions.warehouseCosts');
  const defaults: Column[] = canSeeCosts ? ['name', 'count', 'stock', 'value'] : ['name', 'count', 'stock'];
  const columns = visibleWarehouseColumns(savedColumns, defaults);
  const sortColumn = (sortBy === 'count' || sortBy === 'value') && columns.includes(sortBy) ? sortBy : 'name';
  const direction = sort === 'desc' ? -1 : 1;
  const searchText = search.trim().toLocaleLowerCase('ru');
  const rows = (query.data ?? []).filter(({ name }) => name.toLocaleLowerCase('ru').includes(searchText))
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, 'ru');
      if (sortColumn === 'name') return byName * direction;
      if (sortColumn === 'count') return (a.count - b.count) * direction || byName;
      return compareValues(a.stockValue, b.stockValue, direction) || byName;
    });
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const totalValue = rows.every(({ stockValue }) => stockValue != null)
    ? rows.reduce((sum, row) => sum + (row.stockValue ?? 0), 0) : null;
  const moneyText = (value: number | null | undefined) => value == null ? 'Не рассчитана' : balanceMoney(value);
  function cellText(row: IngredientCategory, column: Column) {
    switch (column) {
      case 'name': return row.name;
      case 'count': return String(row.count);
      case 'stock': return stockText(row.stockByUnit);
      case 'value': return moneyText(row.stockValue);
    }
  }
  function totalText(column: Column) {
    switch (column) {
      case 'name': return 'Итого';
      case 'count': return String(totalCount);
      case 'stock': return '—';
      case 'value': return moneyText(totalValue);
    }
  }
  function report(print: boolean) {
    const title = 'Категории ингредиентов';
    const headings = columns.map((column) => labels[column]);
    const data = [...rows.map((row) => columns.map((column) => cellText(row, column))), columns.map(totalText)];
    if (print) {
      setPrintError(printReport(title, '', headings, data) ? '' : 'Разрешите открытие окна печати в браузере.');
    } else exportCsv(title, headings, data);
  }
  if (editor?.type === 'ingredientCategory') {
    if (!canManage) {
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
        <div className="catalogue-header-actions">
          <ColumnButton onClick={() => setShowColumns(true)} />
          {can('actions.exportReports') && <button type="button" className="workspace-tool" title="Экспорт CSV"
            disabled={!rows.length} onClick={() => report(false)}><IconExport /><span className="catalogue-action-label">Экспорт</span></button>}
          <button type="button" className="workspace-tool" title="Печать" disabled={!rows.length} onClick={() => report(true)}>
            <IconPrinter /><span className="catalogue-action-label">Печать</span>
          </button>
          {canManage && <button type="button" className="catalogue-add" onClick={() => setCreating(true)}>Добавить</button>}
        </div>
      </WorkspaceHeaderActions>
      {printError && <p className="py-2 text-sm text-danger" role="alert">{printError}</p>}
      <QueryState pending={query.isPending} error={query.error}>
        <div className="overflow-x-auto"><table className="poster-table poster-directory-table w-full min-w-[480px]">
          <thead><tr>
            {columns.map((column) => <th key={column} scope="col"
              className={column === 'name' ? undefined : 'text-right'}
              aria-sort={column === sortColumn ? direction === 1 ? 'ascending' : 'descending' : undefined}>
              {column === 'stock' ? labels[column] : <button type="button" className="inline-flex items-center gap-2"
                onClick={() => setListOptions({ sortBy: column, sort: column === sortColumn && direction === 1 ? 'desc' : 'asc' })}>
                {labels[column]}{column === sortColumn && <span aria-hidden="true">{direction === 1 ? '↑' : '↓'}</span>}
              </button>}
            </th>)}
            {canManage && <th className="w-28"><span className="sr-only">Действия</span></th>}
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.name}>
            {columns.map((column) => <td key={column} className={column === 'name' ? undefined : 'text-right tabular-nums'}>
              {column === 'name' ? <button type="button" className="block max-w-full truncate text-left text-primary"
                title={row.name} onClick={() => setRoute({ section: 'menu', view: 'ingredients', category: row.name })}>{row.name}</button>
                : cellText(row, column)}
            </td>)}
            {canManage && <td><div className="poster-row-actions"><RowIconButton icon="edit"
              label={`Редактировать категорию: ${row.name}`} onClick={() => { rename.reset(); setName(row.name); openEditor({ type: 'ingredientCategory', id: row.name }); }} />
              <RowActionMenu label={row.name} action="Удалить" onAction={() => {
                remove.reset();
                setRemoveIngredients(false);
                setRemoving(row);
              }} />
            </div></td>}
          </tr>)}
          {!rows.length && <tr><td colSpan={columns.length + Number(canManage)} className="poster-directory-empty text-center text-text-muted">
            {search ? 'Категории не найдены' : 'Категории пока не добавлены.'}
          </td></tr>}
          </tbody>
          {rows.length > 0 && <tfoot><tr>
            {columns.map((column) => <td key={column} className={column === 'name' ? undefined : 'text-right tabular-nums'}>{totalText(column)}</td>)}
            {canManage && <td />}
          </tr></tfoot>}
        </table></div>
      </QueryState>
    </div>}
    {editing && canManage && <EditorPage onClose={closeEditor} title="Редактирование категории ингредиентов"
      footer={<button form={formId} type="submit" className="btn-primary btn-md" disabled={!name.trim() || rename.isPending}>Сохранить</button>}>
      <form id={formId} onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && !rename.isPending) rename.mutate({ name, from: editing }, { onSuccess: closeEditor });
      }} className="poster-form poster-form--directory space-y-4">
        <DocumentField label="Название"><input aria-label="Название категории" className="input w-full" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} /></DocumentField>
        {rename.error && <p role="alert" className="text-sm text-danger">{apiError(rename.error)}</p>}
      </form>
    </EditorPage>}
    {showColumns && <WarehouseColumnSettings columns={columns} defaults={defaults} label={(column) => labels[column]}
      onClose={() => setShowColumns(false)} onApply={(selected, reset) => {
        setSavedColumns(reset && selected.join(',') === defaults.join(',') ? '' : selected.join(','));
        if (!selected.includes(sortColumn)) setListOptions({ sortBy: 'name', sort: 'asc' });
        setShowColumns(false);
      }} />}
    {creating && <NewIngredientCategory onClose={() => setCreating(false)} />}
    {removing && <RemoveDirectoryEntry title="Удалить категорию ингредиентов?" pending={remove.isPending} error={remove.error}
      onClose={() => setRemoving(null)}
      onRemove={() => remove.mutate({ name: removing.name, removeIngredients }, { onSuccess: () => setRemoving(null) })}>
      <p>Категория «{removing.name}» будет удалена.</p>
      {removing.count > 0 && <fieldset className="mt-3 space-y-2" disabled={remove.isPending}>
        <legend className="mb-1 font-medium">Что сделать с ингредиентами?</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="remove-ingredient-category" className="accent-primary"
            checked={!removeIngredients} onChange={() => setRemoveIngredients(false)} />
          Оставить без категории
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="remove-ingredient-category" className="accent-primary"
            checked={removeIngredients} onChange={() => setRemoveIngredients(true)} />
          Удалить из каталога
        </label>
        {removeIngredients && <p className="text-text-muted">
          Удаление целиком остановится, если у ингредиента есть остаток на складе или он используется в действующей техкарте.
        </p>}
      </fieldset>}
    </RemoveDirectoryEntry>}
  </>;
}
